import { createApp, genie, server } from '@databricks/appkit';
import type { Application, Request, Response } from 'express';
import { controllerAiAgent, handleControllerRequest, handleSpecRequest } from '../plugins/controller-ai-agent';
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
  res.flushHeaders?.();
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
    app.post('/api/spec', handleSpecRequest);

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
