import type { GenericUiSpec, PendingClarification, ControllerQuestion } from '../types/chat'
import { sanitizeLabel, isDisplayOnlyLabel } from './message-utils'

/** Guard against LLM-generated questions with missing id/label fields. */
function isValidQuestion(q: ControllerQuestion): boolean {
  return typeof q.id === 'string' && q.id.length > 0 && typeof q.label === 'string'
}

/**
 * Deterministically converts a PendingClarification's questions into a GenUI spec.
 *
 * Returns null if there are no valid renderable questions (empty questions list,
 * all questions filtered out as display-only, or all select inputs with no options).
 * The caller should handle null by skipping the JSONUIProvider rendering.
 *
 * This is the client-side fallback when the LLM-generated spec from /api/spec-stream
 * is unavailable (network error, API 500, or empty spec).
 */
export function questionsToSpec(pc: PendingClarification): GenericUiSpec | null {
  const validQuestions = pc.questions.filter((q) => {
    if (!isValidQuestion(q)) return false
    if (isDisplayOnlyLabel(q.label)) return false
    if (q.inputType === 'select' && (!q.options || q.options.length === 0)) return false
    return true
  })

  if (validQuestions.length === 0) return null

  const elements: Record<string, unknown> = {}
  const state: Record<string, unknown> = {}
  const childKeys: string[] = []

  for (const question of validQuestions) {
    const elementKey = `q-${question.id}`
    // RFC 6901 JSON Pointer escaping: ~ → ~0, / → ~1 (for the $bindState path only)
    // The state object key remains the raw question.id (plain JS property, no escaping needed)
    const escapedId = question.id.replace(/~/g, '~0').replace(/\//g, '~1')
    const statePath = `/${escapedId}`

    const baseProps: Record<string, unknown> = {
      label: sanitizeLabel(question.label),
    }
    if (question.placeholder) baseProps.placeholder = question.placeholder
    if (question.required) baseProps.required = true

    let element: Record<string, unknown>

    if (question.inputType === 'select') {
      element = {
        type: 'SelectInputField',
        props: {
          ...baseProps,
          value: { $bindState: statePath },
          options: question.options,
        },
        children: [],
      }
      state[question.id] = question.options?.[0]?.value ?? ''
    } else if (question.inputType === 'number') {
      const numProps: Record<string, unknown> = {
        ...baseProps,
        value: { $bindState: statePath },
      }
      if (question.min != null) numProps.min = question.min
      if (question.max != null) numProps.max = question.max
      if (question.step != null) numProps.step = question.step
      element = { type: 'NumberInputField', props: numProps, children: [] }
      state[question.id] = ''
    } else if (question.inputType === 'toggle') {
      const toggleProps: Record<string, unknown> = {
        label: sanitizeLabel(question.label),
        checked: { $bindState: statePath },
      }
      if (question.placeholder) toggleProps.description = question.placeholder
      element = { type: 'ToggleField', props: toggleProps, children: [] }
      state[question.id] = false
    } else {
      // text / default
      element = {
        type: 'TextInputField',
        props: { ...baseProps, value: { $bindState: statePath } },
        children: [],
      }
      state[question.id] = ''
    }

    // Special visibility rule: sp_folder_id is only shown when scope_level === 'filiale'
    if (question.id === 'sp_folder_id') {
      element.visible = { $state: '/scope_level', eq: 'filiale' }
    }

    elements[elementKey] = element
    childKeys.push(elementKey)
  }

  elements['form'] = {
    type: 'FormPanel',
    props: {},
    children: childKeys,
  }

  return {
    root: 'form',
    elements,
    state,
  } as GenericUiSpec
}
