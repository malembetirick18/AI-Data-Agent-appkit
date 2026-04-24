import type {
  ControllerApiResponse,
  ControllerConversationContext,
  ControllerStreamEvent,
} from '../types/chat'

export const RUBRIQUES = [
  { value: '01', label: '01. CARTOGRAPHIES GENERALES' },
  { value: '02', label: "02. COMPLETUDE DE L'INFORMATION COMPTABLE" },
  { value: '03', label: '03. CONFORMITE COMPTABLE' },
  { value: '04', label: '04. OPERATIONS DIVERSES' },
  { value: '05', label: '05. ACHATS' },
  { value: '06', label: '06. VENTES' },
  { value: '07', label: '07. TVA' },
  { value: '08', label: '08. RESULTAT ET IS' },
  { value: '09', label: '09. ECRITURES COMPLEXES' },
]

export const suggestedRubriqueMap: Record<number, string> = {
  0: '05',
  1: '05',
  2: '05',
  3: '04',
  4: '03',
}

export function inferRubriqueFromText(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('achat') || lower.includes('fournisseur') || lower.includes('facture')) return '05'
  if (lower.includes('vente') || lower.includes('client') || lower.includes('chiffre d\'affaires')) return '06'
  if (lower.includes('tva') || lower.includes('taxe')) return '07'
  if (lower.includes('resultat') || lower.includes('impot') || lower.includes('is ')) return '08'
  if (lower.includes('ecriture') || lower.includes('complexe') || lower.includes('ajustement')) return '09'
  if (lower.includes('completude') || lower.includes('information comptable')) return '02'
  if (lower.includes('conformite') || lower.includes('solde') || lower.includes('balance')) return '03'
  if (lower.includes('operation') || lower.includes('diverse') || lower.includes('tiers')) return '04'
  if (lower.includes('cartographie') || lower.includes('volumetrie') || lower.includes('ratio')) return '01'
  return '01'
}

export function isControllerApproved(decision: ControllerApiResponse['decision'], confidence?: number): boolean {
  return decision === 'proceed' && typeof confidence === 'number' && confidence >= 0.90
}

/** Split an SSE text buffer on the "\n\n" record delimiter. Returns the parsed
 *  events plus any trailing partial record so the caller can re-prepend it. */
function splitSseEvents(buffer: string): {
  events: Array<{ event: string | null; data: string }>
  rest: string
} {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: Array<{ event: string | null; data: string }> = []
  for (const raw of parts) {
    if (!raw.trim()) continue
    let eventName: string | null = null
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    events.push({ event: eventName, data: dataLines.join('\n') })
  }
  return { events, rest }
}

/**
 * Streams the controller SSE response from /api/controller, invoking `onEvent`
 * for every status / reasoning_token / decision / error event in order. The
 * returned Promise resolves with the final `ControllerApiResponse` (or null
 * on stream failure).
 *
 * The underlying `fetch` is aborted via `params.signal`. Desync safety: events
 * are emitted strictly in arrival order, so a reducer with a `finalized` flag
 * can guarantee no post-decision updates leak into UI state.
 */
export async function runControllerPreflight(params: {
  prompt: string
  conversationContext: ControllerConversationContext
  signal?: AbortSignal
  onEvent?: (event: ControllerStreamEvent) => void
}): Promise<ControllerApiResponse | null> {
  let response: Response
  try {
    response = await fetch('/api/controller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        conversationContext: params.conversationContext,
      }),
      signal: params.signal,
    })
  } catch {
    return null
  }

  // Non-streaming error responses still come back as JSON (400 / 502 / 503).
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok && !contentType.includes('text/event-stream')) {
    try {
      const errorBody = (await response.json()) as ControllerApiResponse
      if (errorBody && errorBody.decision) {
        params.onEvent?.({ kind: 'decision', data: errorBody })
        return errorBody
      }
    } catch { /* body not parseable */ }
    return null
  }

  if (!response.body) return null

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalDecision: ControllerApiResponse | null = null

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { events, rest } = splitSseEvents(buffer)
      buffer = rest

      for (const ev of events) {
        if (ev.event === 'status') {
          try {
            const payload = JSON.parse(ev.data) as { message?: string }
            if (typeof payload.message === 'string' && payload.message) {
              params.onEvent?.({ kind: 'status', message: payload.message })
            }
          } catch { /* ignore malformed */ }
        } else if (ev.event === 'reasoning_token') {
          try {
            const payload = JSON.parse(ev.data) as { chunk?: string }
            if (typeof payload.chunk === 'string' && payload.chunk) {
              params.onEvent?.({ kind: 'reasoning_token', chunk: payload.chunk })
            }
          } catch { /* ignore malformed */ }
        } else if (ev.event === 'controller_decision') {
          try {
            const payload = JSON.parse(ev.data) as { role?: string; data?: ControllerApiResponse }
            const data = payload.role === 'controller' && payload.data ? payload.data : (payload as unknown as ControllerApiResponse)
            finalDecision = data
            params.onEvent?.({ kind: 'decision', data })
          } catch { /* ignore malformed */ }
        } else if (ev.event === 'error') {
          let message = "L'agent IA a rencontré une erreur."
          try {
            const payload = JSON.parse(ev.data) as { message?: string }
            if (typeof payload.message === 'string' && payload.message) message = payload.message
          } catch { /* use default */ }
          params.onEvent?.({ kind: 'error', message })
        }
      }
    }
  } catch {
    return finalDecision
  }

  return finalDecision
}
