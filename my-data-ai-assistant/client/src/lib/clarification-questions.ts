import type { ControllerQuestion, ControllerQuestionOption } from '../types/chat'

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptions(options: ControllerQuestionOption[] | undefined): ControllerQuestionOption[] | undefined {
  if (!Array.isArray(options)) return undefined

  const seen = new Set<string>()
  const result: ControllerQuestionOption[] = []

  for (const option of options) {
    const value = toNonEmptyString(option?.value)
    const label = toNonEmptyString(option?.label)
    if (!value || !label) continue
    if (seen.has(value)) continue
    seen.add(value)
    result.push({ value, label })
  }

  return result
}

/**
 * Normalizes controller clarification questions and removes duplicates by `id`.
 * Keeps the first valid question as canonical and merges stricter flags/options from duplicates.
 */
export function normalizeClarificationQuestions(questions: ControllerQuestion[]): ControllerQuestion[] {
  const byId = new Map<string, ControllerQuestion>()

  for (const rawQuestion of questions) {
    const id = toNonEmptyString(rawQuestion?.id)
    const label = toNonEmptyString(rawQuestion?.label)
    if (!id || !label) continue

    const normalized: ControllerQuestion = {
      ...rawQuestion,
      id,
      label,
      placeholder: rawQuestion.placeholder?.trim() || undefined,
      options: normalizeOptions(rawQuestion.options),
    }

    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, normalized)
      continue
    }

    byId.set(id, {
      ...existing,
      required: Boolean(existing.required || normalized.required),
      inputType: existing.inputType ?? normalized.inputType,
      placeholder: existing.placeholder ?? normalized.placeholder,
      options: existing.options ?? normalized.options,
      min: existing.min ?? normalized.min,
      max: existing.max ?? normalized.max,
      step: existing.step ?? normalized.step,
    })
  }

  return Array.from(byId.values())
}
