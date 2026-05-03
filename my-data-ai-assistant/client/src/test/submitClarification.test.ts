/**
 * Unit tests for submitClarification enriched-prompt logic.
 * Mirrors the exact behaviour of the useCallback in useProductAssistant.ts.
 */
import { describe, it, expect } from 'vitest'
import type { ControllerQuestion } from '../types/chat'

// ── Inline the logic under test ───────────────────────────────────────────────

function buildEnrichedPrompt(
  original: string,
  questions: ControllerQuestion[],
  answers: Record<string, string>,
): { enriched: string; pairs: { label: string; answer: string }[] } {
  const pairs: { label: string; answer: string }[] = questions
    .filter((q) => answers[q.id] != null && answers[q.id] !== '')
    .map((q) => ({ label: q.label, answer: answers[q.id] }))

  if (pairs.length === 0 && answers['clarification']?.trim()) {
    pairs.push({ label: 'Votre précision', answer: answers['clarification'].trim() })
  }

  const enriched =
    pairs.length > 0
      ? `${original}\n\nPrécisions apportées :\n${pairs.map((p) => `• ${p.label} : ${p.answer}`).join('\n')}`
      : original

  return { enriched, pairs }
}

function buildQRSummary(pairs: { label: string; answer: string }[]): string | null {
  if (pairs.length === 0) return null
  return `Paramètres confirmés :\n\n${pairs.map((p) => `Q : ${p.label}\nR : ${p.answer}`).join('\n\n')}`
}

// ── tests ─────────────────────────────────────────────────────────────────────

const ORIG = 'Des fournisseurs inactifs continuent-ils à être réglés ?'

describe('buildEnrichedPrompt', () => {
  it('returns original unchanged when no answers provided', () => {
    const { enriched } = buildEnrichedPrompt(ORIG, [], {})
    expect(enriched).toBe(ORIG)
  })

  it('returns original unchanged when answers are all empty strings', () => {
    const qs: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text' }]
    const { enriched } = buildEnrichedPrompt(ORIG, qs, { period: '' })
    expect(enriched).toBe(ORIG)
  })

  it('appends structured Q answers to the prompt', () => {
    const qs: ControllerQuestion[] = [
      { id: 'period', label: 'Période', inputType: 'text' },
      { id: 'scope', label: 'Périmètre', inputType: 'text' },
    ]
    const { enriched } = buildEnrichedPrompt(ORIG, qs, { period: '12 mois', scope: 'groupe' })
    expect(enriched).toContain('Précisions apportées :')
    expect(enriched).toContain('• Période : 12 mois')
    expect(enriched).toContain('• Périmètre : groupe')
  })

  it('skips questions whose answer is empty', () => {
    const qs: ControllerQuestion[] = [
      { id: 'period', label: 'Période', inputType: 'text' },
      { id: 'scope', label: 'Périmètre', inputType: 'text' },
    ]
    const { enriched } = buildEnrichedPrompt(ORIG, qs, { period: '12 mois', scope: '' })
    expect(enriched).toContain('• Période : 12 mois')
    expect(enriched).not.toContain('Périmètre')
  })

  it('uses fallback free-text field when questions is empty', () => {
    const { enriched, pairs } = buildEnrichedPrompt(ORIG, [], { clarification: 'sans transaction depuis 6 mois' })
    expect(pairs).toHaveLength(1)
    expect(pairs[0].label).toBe('Votre précision')
    expect(enriched).toContain('• Votre précision : sans transaction depuis 6 mois')
  })

  it('trims the fallback free-text value', () => {
    const { pairs } = buildEnrichedPrompt(ORIG, [], { clarification: '  some answer  ' })
    expect(pairs[0].answer).toBe('some answer')
  })

  it('does not use fallback when structured questions produce answers', () => {
    const qs: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text' }]
    const { pairs } = buildEnrichedPrompt(ORIG, qs, { period: '12 mois', clarification: 'ignored' })
    expect(pairs).toHaveLength(1)
    expect(pairs[0].label).toBe('Période')
  })

  it('returns original when fallback clarification field is blank', () => {
    const { enriched } = buildEnrichedPrompt(ORIG, [], { clarification: '   ' })
    expect(enriched).toBe(ORIG)
  })
})

describe('buildQRSummary', () => {
  it('returns null when pairs is empty', () => {
    expect(buildQRSummary([])).toBeNull()
  })

  it('formats single pair as Q:/R: block', () => {
    const summary = buildQRSummary([{ label: 'Période', answer: '12 mois' }])
    expect(summary).toBe('Paramètres confirmés :\n\nQ : Période\nR : 12 mois')
  })

  it('separates multiple pairs with double newline', () => {
    const summary = buildQRSummary([
      { label: 'Période', answer: '12 mois' },
      { label: 'Périmètre', answer: 'groupe' },
    ])
    expect(summary).toContain('Q : Période\nR : 12 mois\n\nQ : Périmètre\nR : groupe')
  })
})
