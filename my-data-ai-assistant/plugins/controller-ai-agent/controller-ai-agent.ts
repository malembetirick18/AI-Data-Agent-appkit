import { Plugin, toPlugin, type PluginManifest } from '@databricks/appkit';
import type { Request, Response } from 'express';
import {
  issueControllerApproval,
  setControllerApprovalCookie,
  clearControllerApprovalCookie,
  updateControllerApproval,
  invalidateControllerApproval,
} from '../../server/controller-approval-store';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ControllerRequest = {
  prompt: string;
  catalogInfo?: string;
  conversationContext?: Record<string, unknown> | null;
};

/** Minimal question type matching the Python guardrail schema and client ControllerQuestion. */
export type ControllerQuestion = {
  id: string;
  label: string;
  inputType?: 'select' | 'text' | 'number' | 'toggle';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
};

export type ControllerResponse = {
  decision: 'proceed' | 'guide' | 'clarify' | 'error';
  confidence: number;
  message: string;
  rewrittenPrompt?: string;
  suggestedTables: string[];
  suggestedFunctions: string[];
  requiredColumns: string[];
  predictiveFunctions: string[];
  questions: ControllerQuestion[];
  queryClassification?: string;
  coherenceNote?: string;
  needsParams: boolean;
  canSendDirectly: boolean;
  reasoning: string;
  /** Set when a guardrail (scope/temporal) overrode the original decision to 'clarify'. */
  guardrailSource?: 'scope' | 'temporal' | null;
};

// ── Confidence helpers ────────────────────────────────────────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 0.90;

function isApproved(decision: string, confidence: number): boolean {
  return decision === 'proceed' && confidence >= HIGH_CONFIDENCE_THRESHOLD;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

type ParsedSseEvent = { event: string | null; data: string };

/** Split a raw SSE stream buffer on the "\n\n" record delimiter and yield
 *  complete events. Any trailing partial event is returned as `rest` so the
 *  caller can re-prepend it to the next chunk. */
function splitSseEvents(buffer: string): { events: ParsedSseEvent[]; rest: string } {
  const events: ParsedSseEvent[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const raw of parts) {
    if (!raw.trim()) continue;
    let eventName: string | null = null;
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    events.push({ event: eventName, data: dataLines.join('\n') });
  }
  return { events, rest };
}

/** Extract the controller decision payload from a parsed SSE event.
 *  Returns null for any event that is not `event: controller_decision`. */
function extractControllerDecision(ev: ParsedSseEvent): Record<string, unknown> | null {
  if (ev.event !== 'controller_decision' || !ev.data) return null;
  try {
    const parsed = JSON.parse(ev.data) as Record<string, unknown>;
    if (parsed.role === 'controller' && parsed.data != null && typeof parsed.data === 'object') {
      return parsed.data as Record<string, unknown>;
    }
    return parsed;
  } catch (err) {
    console.warn('[controller] Could not parse controller_decision payload:', err);
    return null;
  }
}

// ── Shared config ─────────────────────────────────────────────────────────────

export const SEMANTIC_LAYER_API_URL = process.env.SEMANTIC_LAYER_API_URL ?? 'http://localhost:8001/api';
export const REQUEST_TIMEOUT_MS = 45_000;

// ── Plugin (manifest only — routes registered directly in server.ts) ──────────

class ControllerAiAgentPlugin extends Plugin {
  static manifest = {
    name: 'controller-ai-agent',
    displayName: 'Controller AI Agent',
    description: 'Routes user intent through the semantic layer API for controller decisions and UI spec generation.',
    version: '0.1.0',
    resources: {
      required: [],
      optional: [],
    },
  } satisfies PluginManifest<'controller-ai-agent'>;

  injectRoutes(): void {
    // All routes are registered directly in server.ts
  }
}

export const ControllerAiAgent = ControllerAiAgentPlugin;
export const controllerAiAgent = toPlugin(ControllerAiAgentPlugin);

// ── POST /api/controller ──────────────────────────────────────────────────────

const MAX_PROMPT_LENGTH = 10_000;
const MAX_CONTEXT_SIZE = 50_000;

const VALID_DECISIONS: readonly ControllerResponse['decision'][] = ['proceed', 'guide', 'clarify', 'error'];

function coerceControllerResponse(raw: Record<string, unknown>, fallbackPrompt: string, canSendDirectly: boolean): ControllerResponse {
  const rawDecision = typeof raw.decision === 'string' ? raw.decision : '';
  const decision: ControllerResponse['decision'] = VALID_DECISIONS.includes(rawDecision as ControllerResponse['decision'])
    ? (rawDecision as ControllerResponse['decision'])
    : 'error';
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
  const rewrittenPrompt = typeof raw.rewrittenPrompt === 'string' ? raw.rewrittenPrompt : fallbackPrompt;

  return {
    decision,
    confidence,
    message: typeof raw.message === 'string' ? raw.message : '',
    rewrittenPrompt,
    suggestedTables: Array.isArray(raw.suggestedTables) ? (raw.suggestedTables as string[]) : [],
    suggestedFunctions: Array.isArray(raw.suggestedFunctions) ? (raw.suggestedFunctions as string[]) : [],
    requiredColumns: Array.isArray(raw.requiredColumns) ? (raw.requiredColumns as string[]) : [],
    predictiveFunctions: Array.isArray(raw.predictiveFunctions) ? (raw.predictiveFunctions as string[]) : [],
    questions: Array.isArray(raw.questions) ? (raw.questions as ControllerQuestion[]) : [],
    queryClassification: typeof raw.queryClassification === 'string' ? raw.queryClassification : undefined,
    coherenceNote: typeof raw.coherenceNote === 'string' ? raw.coherenceNote : undefined,
    needsParams: raw.needsParams === true,
    canSendDirectly,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    guardrailSource: typeof raw.guardrailSource === 'string' ? (raw.guardrailSource as ControllerResponse['guardrailSource']) : null,
  };
}

/**
 * Streaming proxy for /api/controller.
 *
 * The Python semantic-layer emits an SSE stream with `status`, `reasoning_token` and
 * `controller_decision` events. We forward every chunk verbatim to the client while
 * parsing in-flight for the final `controller_decision` event so we can (a) inject a
 * computed `canSendDirectly` flag into its payload and (b) upgrade/invalidate the
 * pre-issued approval token accordingly.
 *
 * Cookies are pre-issued with an `__pending__` approved prompt *before* the stream
 * begins, because Set-Cookie must travel with the initial response headers and the
 * final decision is only known at the end of the stream.
 */
export async function handleControllerRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as ControllerRequest | undefined;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (!prompt) {
    clearControllerApprovalCookie(res);
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    clearControllerApprovalCookie(res);
    res.status(400).json({ error: `prompt exceeds maximum length (${MAX_PROMPT_LENGTH} chars)` });
    return;
  }

  if (body?.conversationContext != null) {
    try {
      const ctxSize = JSON.stringify(body.conversationContext).length;
      if (ctxSize > MAX_CONTEXT_SIZE) {
        clearControllerApprovalCookie(res);
        res.status(400).json({ error: `conversationContext exceeds maximum size (${MAX_CONTEXT_SIZE} bytes)` });
        return;
      }
    } catch {
      clearControllerApprovalCookie(res);
      res.status(400).json({ error: 'conversationContext is not serializable' });
      return;
    }
  }

  // Pre-issue a placeholder token so Set-Cookie can ride the initial response headers.
  // Its approvedPrompt is rewritten (or the token invalidated) once the final decision arrives.
  let pendingToken: string | null = null;
  try {
    pendingToken = issueControllerApproval({ approvedPrompt: '__pending__' });
  } catch (err) {
    console.error('[controller] Failed to pre-issue approval token:', err);
    clearControllerApprovalCookie(res);
    res.status(503).json({
      decision: 'error' as const,
      confidence: 0,
      message: "Capacité d'approbation saturée. Veuillez réessayer dans quelques instants.",
      error: 'Approval store capacity exceeded.',
    });
    return;
  }

  setControllerApprovalCookie(res, pendingToken);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // disables nginx response buffering where relevant
  res.flushHeaders();

  const writeError = (message: string) => {
    const payload = JSON.stringify({ decision: 'error', confidence: 0, message });
    res.write(`event: error\ndata: ${payload}\n\n`);
  };

  let pythonResponse: globalThis.Response;
  try {
    pythonResponse = await fetch(`${SEMANTIC_LAYER_API_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_text: prompt,
        catalog_info: body?.catalogInfo ?? '',
        conversation_context: body?.conversationContext ?? null,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[controller] Failed to reach semantic layer API:', err instanceof Error ? err.message : err);
    invalidateControllerApproval(pendingToken);
    writeError("Impossible de joindre l'agent IA. Veuillez réessayer.");
    res.end();
    return;
  }

  if (!pythonResponse.ok || !pythonResponse.body) {
    const errorText = await pythonResponse.text().catch(() => '');
    console.error('[controller] Semantic layer API error:', pythonResponse.status, errorText || pythonResponse.statusText);
    invalidateControllerApproval(pendingToken);
    writeError("L'agent IA a rencontré une erreur. Veuillez réessayer.");
    res.end();
    return;
  }

  // Abort the upstream read if the client closes the connection mid-stream.
  const upstreamAbort = new AbortController();
  const reader: ReadableStreamDefaultReader<Uint8Array> = pythonResponse.body.getReader();
  req.on('close', () => {
    upstreamAbort.abort();
    reader.cancel().catch(() => {/* already closed */});
  });

  const decoder = new TextDecoder();
  let eventBuffer = '';
  let finalDecisionHandled = false;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = decoder.decode(result.value, { stream: true });
      eventBuffer += chunk;

      const { events, rest } = splitSseEvents(eventBuffer);
      eventBuffer = rest;

      for (const ev of events) {
        // Forward every Python event verbatim to the client EXCEPT controller_decision,
        // which we re-emit after injecting canSendDirectly below.
        if (ev.event === 'controller_decision') {
          if (finalDecisionHandled) continue;
          const raw = extractControllerDecision(ev);
          if (!raw) continue;
          finalDecisionHandled = true;

          const rawDecision = typeof raw.decision === 'string' ? raw.decision : '';
          const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
          const rewrittenPrompt = typeof raw.rewrittenPrompt === 'string' && raw.rewrittenPrompt.trim()
            ? raw.rewrittenPrompt
            : prompt;

          const approved = isApproved(rawDecision, confidence);
          const canSendDirectly = approved || rawDecision === 'guide';

          if (canSendDirectly) {
            updateControllerApproval(pendingToken, { approvedPrompt: rewrittenPrompt });
          } else {
            invalidateControllerApproval(pendingToken);
          }

          const controllerResponse = coerceControllerResponse(raw, prompt, canSendDirectly);
          const payload = JSON.stringify({ role: 'controller', data: controllerResponse });
          res.write(`event: controller_decision\ndata: ${payload}\n\n`);
        } else {
          // status / reasoning_token / error / anything else — forward verbatim.
          const reassembled =
            (ev.event ? `event: ${ev.event}\n` : '') +
            `data: ${ev.data}\n\n`;
          res.write(reassembled);
        }
      }
    }
  } catch (err) {
    console.error('[controller] Streaming error:', err instanceof Error ? err.message : err);
    if (!finalDecisionHandled) {
      invalidateControllerApproval(pendingToken);
      writeError("Le flux d'analyse a été interrompu. Veuillez réessayer.");
    }
  } finally {
    // If the stream ended without ever emitting controller_decision, the token is stale.
    if (!finalDecisionHandled) {
      invalidateControllerApproval(pendingToken);
    }
    res.end();
  }
}


