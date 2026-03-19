import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;

type ApprovalEntry = {
  approvedPrompt: string;
  createdAt: number;
  expiresAt: number;
  traceId?: string;
};

const approvalStore = new Map<string, ApprovalEntry>();

export const SUPERVISOR_APPROVAL_COOKIE_NAME = 'genie_supervisor_approval';

function getApprovalTtlMs(): number {
  const rawValue = Number(process.env.GENIE_SUPERVISOR_APPROVAL_TTL_MS || DEFAULT_APPROVAL_TTL_MS);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : DEFAULT_APPROVAL_TTL_MS;
}

function normalizePrompt(prompt: string): string {
  return prompt.trim();
}

function sweepExpiredApprovals(now = Date.now()): void {
  for (const [token, approval] of approvalStore.entries()) {
    if (approval.expiresAt <= now) {
      approvalStore.delete(token);
    }
  }
}

export function issueSupervisorApproval(params: { approvedPrompt: string; traceId?: string }): string {
  const approvedPrompt = normalizePrompt(params.approvedPrompt);
  const now = Date.now();
  const ttlMs = getApprovalTtlMs();
  const token = randomUUID();

  sweepExpiredApprovals(now);
  approvalStore.set(token, {
    approvedPrompt,
    createdAt: now,
    expiresAt: now + ttlMs,
    traceId: params.traceId,
  });

  return token;
}

export function consumeSupervisorApproval(params: { token: string; content: string }):
  | { ok: true; traceId?: string }
  | { ok: false; reason: string } {
  const now = Date.now();
  sweepExpiredApprovals(now);

  const approval = approvalStore.get(params.token);
  approvalStore.delete(params.token);

  if (!approval) {
    return { ok: false, reason: 'Missing or expired supervisor approval.' };
  }

  if (approval.expiresAt <= now) {
    return { ok: false, reason: 'Supervisor approval expired.' };
  }

  if (normalizePrompt(params.content) !== approval.approvedPrompt) {
    return { ok: false, reason: 'Supervisor approval does not match the Genie prompt.' };
  }

  return { ok: true, traceId: approval.traceId };
}

export function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (rawName === cookieName) {
      return decodeURIComponent(rawValueParts.join('='));
    }
  }

  return undefined;
}

export function setSupervisorApprovalCookie(res: Response, token: string): void {
  res.cookie(SUPERVISOR_APPROVAL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
    maxAge: getApprovalTtlMs(),
  });
}

export function clearSupervisorApprovalCookie(res: Response): void {
  res.clearCookie(SUPERVISOR_APPROVAL_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
  });
}