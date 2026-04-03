import type { ControllerApiResponse, ControllerConversationContext } from '../types/chat'

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

export async function runControllerPreflight(params: {
  prompt: string
  conversationContext: ControllerConversationContext
  signal?: AbortSignal
}): Promise<ControllerApiResponse | null> {
  try {
    const response = await fetch('/api/controller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        conversationContext: params.conversationContext,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      try {
        const errorBody = (await response.json()) as ControllerApiResponse
        if (errorBody && errorBody.decision) return errorBody
      } catch { /* body not parseable */ }
      return null
    }
    return (await response.json()) as ControllerApiResponse
  } catch {
    return null
  }
}
