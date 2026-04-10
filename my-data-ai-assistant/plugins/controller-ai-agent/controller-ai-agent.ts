import { Plugin, toPlugin, type PluginManifest } from '@databricks/appkit';
import type { Request, Response } from 'express';
import {
  issueControllerApproval,
  setControllerApprovalCookie,
  clearControllerApprovalCookie,
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

function parseControllerDecisionFromSse(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        // Unwrap controller envelope: { role: 'controller', data: { ... } }
        if (parsed.role === 'controller' && parsed.data != null && typeof parsed.data === 'object') {
          return parsed.data as Record<string, unknown>;
        }
        return parsed;
      } catch (parseErr) {
        console.warn('[parseControllerDecisionFromSse] JSON parse failed for line:', line.slice(0, 200), parseErr);
      }
    }
  }
  return null;
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

  let raw: Record<string, unknown>;

  try {
    const response = await fetch(`${SEMANTIC_LAYER_API_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_text: prompt,
        catalog_info: body?.catalogInfo ?? '',
        conversation_context: body?.conversationContext ?? null,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[controller] Semantic layer API error:', response.status, errorText || response.statusText);
      clearControllerApprovalCookie(res);
      res.status(502).json({
        decision: 'error' as const,
        confidence: 0,
        message: "L'agent IA a rencontré une erreur. Veuillez réessayer.",
        error: 'Semantic layer API returned an error.',
      });
      return;
    }

    const text = await response.text();
    const parsed = parseControllerDecisionFromSse(text);

    if (!parsed) {
      clearControllerApprovalCookie(res);
      res.status(502).json({
        decision: 'error' as const,
        confidence: 0,
        message: 'Invalid response from semantic layer API.',
        error: 'Invalid response from semantic layer API.',
      });
      return;
    }

    raw = parsed;
  } catch (error) {
    console.error('[controller] Failed to reach semantic layer API:', error instanceof Error ? error.message : error);
    clearControllerApprovalCookie(res);
    res.status(502).json({
      decision: 'error' as const,
      confidence: 0,
      message: "Impossible de joindre l'agent IA. Veuillez réessayer.",
      error: 'Failed to reach semantic layer API.',
    });
    return;
  }

  const VALID_DECISIONS: readonly ControllerResponse['decision'][] = ['proceed', 'guide', 'clarify', 'error'];
  const rawDecision = typeof raw.decision === 'string' ? raw.decision : '';
  const decision: ControllerResponse['decision'] = VALID_DECISIONS.includes(rawDecision as ControllerResponse['decision'])
    ? (rawDecision as ControllerResponse['decision'])
    : 'error';
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
  const rewrittenPrompt = typeof raw.rewrittenPrompt === 'string' ? raw.rewrittenPrompt : prompt;

  const approved = isApproved(decision, confidence);
  const canSendDirectly = approved || decision === 'guide';

  if (canSendDirectly) {
    const token = issueControllerApproval({ approvedPrompt: rewrittenPrompt });
    setControllerApprovalCookie(res, token);
  } else {
    clearControllerApprovalCookie(res);
  }

  const controllerResponse: ControllerResponse = {
    decision: decision,
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

  res.status(200).json(controllerResponse);
}

