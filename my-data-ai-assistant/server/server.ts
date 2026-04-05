import { createApp, genie, server } from '@databricks/appkit';
import type { Application, Request, Response } from 'express';
import { controllerAiAgent, handleControllerRequest, SEMANTIC_LAYER_API_URL, REQUEST_TIMEOUT_MS } from '../plugins/controller-ai-agent';
import {
  CONTROLLER_APPROVAL_COOKIE_NAME,
  clearControllerApprovalCookie,
  consumeControllerApproval,
  parseCookieValue,
} from './controller-approval-store';

const genieSpaceId = process.env.DATABRICKS_GENIE_SPACE_ID;

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
    genie(
      genieSpaceId
        ? {
            spaces: {
              demo: genieSpaceId,
            },
          }
        : {},
    ),
  ],
}).then(async (appKit) => {
  appKit.server.extend((app: Application) => {
    app.post('/api/controller', handleControllerRequest);

    app.get('/api/suggestions', async (_req: Request, res: Response) => {
      try {
        const resp = await fetch(`${SEMANTIC_LAYER_API_URL}/suggestions`, {
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
      // The request body shape is: { prompt, context: { genieResult, questions }, currentSpec }
      const body = req.body as { prompt?: unknown; context?: { genieResult?: unknown; questions?: unknown } } | undefined;
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      const context = body?.context;

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
              const chunk = await reader.read();
              if (chunk.done) break;
              res.write(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
      } catch (error) {
        if (!res.headersSent) {
          res.status(502).json({
            error: error instanceof Error ? error.message : 'Failed to generate spec.',
          });
        }
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
          writeSseEvent(res, event);
        }

        res.end();
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

        for (const message of conversation.messages) {
          writeSseEvent(res, {
            type: 'message_result',
            message,
          });
        }

        writeSseEvent(res, {
          type: 'history_info',
          conversationId: conversation.conversationId,
          spaceId: conversation.spaceId,
          nextPageToken: null,
          loadedCount: conversation.messages.length,
        });

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
