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
  conversationContext?: Record<string, unknown>[] | null;
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
  questions: unknown[];
  queryClassification?: string;
  canSendDirectly: boolean;
  isLowConfidenceProceed: boolean;
};

export type SpecRequest = {
  prompt: string;
  genieResult?: unknown;
};

export type SpecResponse = {
  spec: unknown;
  model: string;
};

// ── Confidence helpers ────────────────────────────────────────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 0.90;
const LOW_CONFIDENCE_THRESHOLD = 0.70;

function isApproved(decision: string, confidence: number): boolean {
  return decision === 'proceed' && confidence >= HIGH_CONFIDENCE_THRESHOLD;
}

function isLowConfidenceProceed(decision: string, confidence: number): boolean {
  return decision === 'proceed' && confidence >= LOW_CONFIDENCE_THRESHOLD && confidence < HIGH_CONFIDENCE_THRESHOLD;
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
      } catch {
        // continue
      }
    }
  }
  return null;
}

function parseSpecFromSse(text: string): unknown | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        // continue
      }
    }
  }
  return null;
}

// ── Shared config ─────────────────────────────────────────────────────────────

const SEMANTIC_LAYER_API_URL = process.env.SEMANTIC_LAYER_API_URL ?? 'http://localhost:8001/api';
const REQUEST_TIMEOUT_MS = 45_000;

// ── Plugin (manifest only — routes registered directly in server.ts) ──────────

class ControllerAiAgentPlugin extends Plugin {
  static manifest = {
    name: 'controllerAiAgent',
    displayName: 'Controller AI Agent',
    description: 'Routes user intent through the semantic layer API for controller decisions and UI spec generation.',
    version: '0.1.0',
    resources: {
      required: [],
      optional: [],
    },
  } satisfies PluginManifest<'controllerAiAgent'>;

  injectRoutes(): void {
    // All routes are registered directly in server.ts
  }
}

export const ControllerAiAgent = ControllerAiAgentPlugin;
export const controllerAiAgent = toPlugin(ControllerAiAgentPlugin);

// ── POST /api/controller ──────────────────────────────────────────────────────

export async function handleControllerRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as ControllerRequest | undefined;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (!prompt) {
    clearControllerApprovalCookie(res);
    res.status(400).json({ error: 'prompt is required' });
    return;
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
      clearControllerApprovalCookie(res);
      res.status(502).json({ error: `Semantic layer API error: ${errorText || response.statusText}` });
      return;
    }

    const text = await response.text();
    const parsed = parseControllerDecisionFromSse(text);

    if (!parsed) {
      clearControllerApprovalCookie(res);
      res.status(502).json({ error: 'Invalid response from semantic layer API.' });
      return;
    }

    raw = parsed;
  } catch (error) {
    clearControllerApprovalCookie(res);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to reach semantic layer API.',
    });
    return;
  }

  const decision = typeof raw.decision === 'string' ? raw.decision : 'error';
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
  const rewrittenPrompt = typeof raw.rewrittenPrompt === 'string' ? raw.rewrittenPrompt : prompt;

  const approved = isApproved(decision, confidence);
  const lowConfidence = isLowConfidenceProceed(decision, confidence);
  const canSendDirectly = approved || lowConfidence || decision === 'guide';

  if (canSendDirectly) {
    const token = issueControllerApproval({ approvedPrompt: rewrittenPrompt });
    setControllerApprovalCookie(res, token);
  } else {
    clearControllerApprovalCookie(res);
  }

  const controllerResponse: ControllerResponse = {
    decision: decision as ControllerResponse['decision'],
    confidence,
    message: typeof raw.message === 'string' ? raw.message : '',
    rewrittenPrompt,
    suggestedTables: Array.isArray(raw.suggestedTables) ? (raw.suggestedTables as string[]) : [],
    suggestedFunctions: Array.isArray(raw.suggestedFunctions) ? (raw.suggestedFunctions as string[]) : [],
    requiredColumns: Array.isArray(raw.requiredColumns) ? (raw.requiredColumns as string[]) : [],
    predictiveFunctions: Array.isArray(raw.predictiveFunctions) ? (raw.predictiveFunctions as string[]) : [],
    questions: Array.isArray(raw.questions) ? raw.questions : [],
    queryClassification: typeof raw.queryClassification === 'string' ? raw.queryClassification : undefined,
    canSendDirectly,
    isLowConfidenceProceed: lowConfidence,
  };

  res.status(200).json(controllerResponse);
}

// ── POST /api/spec ────────────────────────────────────────────────────────────

export async function handleSpecRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as SpecRequest | undefined;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  try {
    const response = await fetch(`${SEMANTIC_LAYER_API_URL}/spec/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, genie_result: body?.genieResult ?? null }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      res.status(502).json({ error: `Semantic layer API error: ${errorText || response.statusText}` });
      return;
    }

    const text = await response.text();
    const specData = parseSpecFromSse(text);

    if (!specData) {
      res.status(502).json({ error: 'Invalid spec response from semantic layer API.' });
      return;
    }

    res.status(200).json({ spec: specData, model: 'semantic-layer' } satisfies SpecResponse);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to generate spec.',
    });
  }
}
