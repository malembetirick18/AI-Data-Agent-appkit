import { createApp, genie, server } from '@databricks/appkit';
import type { Application, Request, Response } from 'express';
import { controllerAiAgent, handleControllerRequest, SEMANTIC_LAYER_API_URL, REQUEST_TIMEOUT_MS } from '../plugins/controller-ai-agent';
import {
  CONTROLLER_APPROVAL_COOKIE_NAME,
  clearControllerApprovalCookie,
  consumeControllerApproval,
  parseCookieValue,
} from './controller-approval-store';

// Two Genie spaces — one per product. Env vars:
//   DATABRICKS_GENIE_SPACE_ID_GEO       → "geo" alias    (Geoficiency surface)
//   DATABRICKS_GENIE_SPACE_ID_CLOSING   → "closing" alias (Closing surface)
// Any unset alias is dropped from the registration so AppKit doesn't reject undefined IDs.
const genieSpaces: Record<string, string> = {};
if (process.env.DATABRICKS_GENIE_SPACE_ID_GEO) {
  genieSpaces.geo = process.env.DATABRICKS_GENIE_SPACE_ID_GEO;
}
if (process.env.DATABRICKS_GENIE_SPACE_ID_CLOSING) {
  genieSpaces.closing = process.env.DATABRICKS_GENIE_SPACE_ID_CLOSING;
}

// Maximum rows forwarded per query_result SSE event. Keeps SSE payloads small
// enough to avoid Databricks App HTTP buffer limits.
const MAX_SSE_ROWS = 2000;

type GuardedGenieMessageBody = {
  content?: unknown;
  conversationId?: unknown;
};

type GenieStreamEvent = {
  type: string;
  [key: string]: unknown;
};

function truncateQueryResultEvent(event: GenieStreamEvent): GenieStreamEvent {
  if (event.type !== 'query_result') return event;
  const data = event.data as { result?: { data_array?: unknown[] } } | undefined;
  const rows = data?.result?.data_array;
  if (!Array.isArray(rows) || rows.length <= MAX_SSE_ROWS) return event;
  return {
    ...event,
    data: {
      ...(data as object),
      result: {
        ...(data!.result as object),
        data_array: rows.slice(0, MAX_SSE_ROWS),
      },
    },
    _truncated: true,
    _originalCount: rows.length,
  };
}

function writeSseEvent(res: Response, payload: unknown): void {
  const safe = payload && typeof payload === 'object' && 'type' in payload
    ? truncateQueryResultEvent(payload as GenieStreamEvent)
    : payload;
  res.write(`data: ${JSON.stringify(safe)}\n\n`);
}

/**
 * Backpressure-aware SSE write. Returns false if the response is destroyed
 * (client disconnected) — callers should break the loop.
 */
async function writeSseEventSafe(res: Response, payload: unknown): Promise<boolean> {
  if (res.destroyed) return false;
  const safe = payload && typeof payload === 'object' && 'type' in payload
    ? truncateQueryResultEvent(payload as GenieStreamEvent)
    : payload;
  const ok = res.write(`data: ${JSON.stringify(safe)}\n\n`);
  if (!ok && !res.destroyed) {
    await new Promise<void>((resolve) => res.once('drain', resolve));
  }
  return !res.destroyed;
}

function openSseStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

createApp({
  plugins: [
    server({ autoStart: false }),
    controllerAiAgent(),
    genie(Object.keys(genieSpaces).length > 0 ? { spaces: genieSpaces } : {}),
  ],
}).then(async (appKit) => {
  appKit.server.extend((app: Application) => {
    app.post('/api/controller', handleControllerRequest);

    app.get('/api/suggestions', async (req: Request, res: Response) => {
      try {
        const appType = typeof req.query['app_type'] === 'string' ? req.query['app_type'] : ''
        const qs = appType ? `?app_type=${encodeURIComponent(appType)}` : ''
        const resp = await fetch(`${SEMANTIC_LAYER_API_URL}/suggestions${qs}`, {
          signal: AbortSignal.timeout(Number(REQUEST_TIMEOUT_MS)),
        });
        if (!resp.ok) {
          res.status(200).json({ suggestions: [] });
          return;
        }
        const data = await resp.json() as { suggestions: string[] };
        res.json(data);
        return;
      } catch {
        res.status(200).json({ suggestions: [] });
      }
    });

    app.post('/api/spec-stream', async (req: Request, res: Response) => {
      // useUIStream.send(prompt, context) wraps the second argument under a 'context' key.
      // The request body shape is:
      //   { prompt, context: { genieResult, questions, product }, currentSpec }
      const body = req.body as
        | { prompt?: unknown; context?: { genieResult?: unknown; questions?: unknown; product?: unknown } }
        | undefined;
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      const context = body?.context;
      const product =
        context?.product === 'geo' || context?.product === 'closing' ? context.product : null;

      if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      try {
        const specResp = await fetch(`${SEMANTIC_LAYER_API_URL}/spec/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            product,
            genie_result: context?.genieResult ?? null,
            questions: Array.isArray(context?.questions) ? context.questions : null,
          }),
          signal: AbortSignal.timeout(Number(REQUEST_TIMEOUT_MS)),
        });

        if (!specResp.ok) {
          const errorText = await specResp.text().catch(() => '');
          res.status(502).json({ error: `Spec generation failed: ${errorText || specResp.statusText}` });
          return;
        }

        // Stream JSONL patches directly to the client instead of buffering the full response.
        // This avoids OOM on large specs and lets useUIStream parse patches incrementally.
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.status(200);

        if (specResp.body) {
          const reader = specResp.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
          try {
            for (;;) {
              if (res.destroyed) break;
              const chunk = await reader.read();
              if (chunk.done) break;
              const ok = res.write(chunk.value);
              if (!ok && !res.destroyed) {
                await new Promise<void>((resolve) => res.once('drain', resolve));
              }
            }
          } catch {
            // Upstream stream broke mid-transfer. If headers already sent, write a
            // JSONL error line so useUIStream can detect the failure instead of hanging.
            if (res.headersSent && !res.destroyed) {
              res.write(JSON.stringify({ error: 'Upstream spec stream interrupted.' }) + '\n');
            }
          } finally {
            reader.releaseLock();
          }
        }
        if (!res.destroyed) res.end();
      } catch (error) {
        if (!res.headersSent) {
          res.status(502).json({
            error: error instanceof Error ? error.message : 'Failed to generate spec.',
          });
        }
      }
    });

    /**
     * Unified Genie chat stream. Accepts { content, appType, conversationId? } in the body.
     * appType must be 'geo' | 'closing' — maps directly to the registered Genie space alias.
     * Requires a valid controller approval cookie issued by POST /api/controller.
     */
    app.post('/api/chat/stream', async (req: Request, res: Response) => {
      const body = req.body as { content?: unknown; appType?: unknown; conversationId?: unknown } | undefined;
      const content = typeof body?.content === 'string' ? body.content.trim() : '';
      const rawAppType = body?.appType;
      const appType: 'geo' | 'closing' | null =
        rawAppType === 'geo' ? 'geo' : rawAppType === 'closing' ? 'closing' : null;
      const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

      if (!appType) {
        clearControllerApprovalCookie(res);
        res.status(400).json({ error: 'appType must be "geo" or "closing"' });
        return;
      }

      if (!content) {
        clearControllerApprovalCookie(res);
        res.status(400).json({ error: 'content is required' });
        return;
      }

      const approvalToken = parseCookieValue(req.headers.cookie, CONTROLLER_APPROVAL_COOKIE_NAME);
      if (!approvalToken) {
        clearControllerApprovalCookie(res);
        res.status(403).json({
          error: 'Genie request blocked: controller approval is required before sending a prompt.',
        });
        return;
      }

      const approval = consumeControllerApproval({ token: approvalToken, content });
      clearControllerApprovalCookie(res);

      if (!approval.ok) {
        res.status(403).json({ error: `Genie request blocked: ${approval.reason}` });
        return;
      }

      try {
        openSseStream(res);

        for await (const event of appKit.genie.asUser(req).sendMessage(appType, content, conversationId)) {
          if (!await writeSseEventSafe(res, event)) break;
        }

        if (!res.destroyed) res.end();
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream Genie response.' });
          return;
        }
        writeSseEvent(res, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to stream Genie response.',
        });
        res.end();
      }
    });

    app.post('/api/chat-controller/:alias/messages', async (req: Request, res: Response) => {
      const alias = Array.isArray(req.params.alias) ? req.params.alias[0] : req.params.alias;
      const body = req.body as GuardedGenieMessageBody | undefined;
      const content = typeof body?.content === 'string' ? body.content.trim() : '';
      const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

      if (!alias) {
        clearControllerApprovalCookie(res);
        res.status(400).json({ error: 'alias is required' });
        return;
      }

      if (!content) {
        clearControllerApprovalCookie(res);
        res.status(400).json({ error: 'content is required' });
        return;
      }

      const approvalToken = parseCookieValue(req.headers.cookie, CONTROLLER_APPROVAL_COOKIE_NAME);
      if (!approvalToken) {
        clearControllerApprovalCookie(res);
        res.status(403).json({
          error: 'Genie request blocked: controller approval is required before sending a prompt.',
        });
        return;
      }

      const approval = consumeControllerApproval({ token: approvalToken, content });
      clearControllerApprovalCookie(res);

      if (!approval.ok) {
        res.status(403).json({
          error: `Genie request blocked: ${approval.reason}`,
        });
        return;
      }

      try {
        openSseStream(res);

        for await (const event of appKit.genie.asUser(req).sendMessage(alias, content, conversationId)) {
          if (!await writeSseEventSafe(res, event)) break;
        }

        if (!res.destroyed) res.end();
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream Genie response.' });
          return;
        }

        writeSseEvent(res, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to stream Genie response.',
        });
        res.end();
      }
    });

    app.get('/api/chat-controller/:alias/conversations/:conversationId', async (req: Request, res: Response) => {
      const alias = Array.isArray(req.params.alias) ? req.params.alias[0] : req.params.alias;
      const conversationId = Array.isArray(req.params.conversationId)
        ? req.params.conversationId[0]
        : req.params.conversationId;

      if (!alias || !conversationId) {
        res.status(400).json({ error: 'alias and conversationId are required' });
        return;
      }

      try {
        const conversation = await appKit.genie.asUser(req).getConversation(alias, conversationId);
        openSseStream(res);

        let disconnected = false;
        for (const message of conversation.messages) {
          if (!await writeSseEventSafe(res, { type: 'message_result', message })) {
            disconnected = true;
            break;
          }
        }

        if (!disconnected) {
          await writeSseEventSafe(res, {
            type: 'history_info',
            conversationId: conversation.conversationId,
            spaceId: conversation.spaceId,
            nextPageToken: null,
            loadedCount: conversation.messages.length,
          });
        }

        res.end();
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to load Genie conversation.' });
          return;
        }

        writeSseEvent(res, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to load Genie conversation.',
        });
        res.end();
      }
    });
  });

  await appKit.server.start();
}).catch((error) => {
  console.error('Failed to start AppKit server:', error);
});
