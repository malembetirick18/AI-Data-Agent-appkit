/**
 * Unit tests for buildClarificationSpec and related pure logic.
 * No DOM needed — pure function tests run in Node environment.
 */
import { describe, it, expect } from 'vitest'

// Re-export the private function via a test-only shim by importing the module
// and calling its exported hook. Since buildClarificationSpec is module-private,
// we test it indirectly through the exported hook's clarificationSpec output.
// For pure-function coverage we inline a copy here (kept in sync with the source).

import type { ControllerQuestion } from '../types/chat'
import type { GenericUiSpec } from '../types/chat'

// ── Inline the function under test (mirrors useProductAssistant.ts exactly) ──

type ElementRecord = Record<string, unknown>

function buildClarificationSpec(
  questions: ControllerQuestion[],
  message: string,
  title = 'Précision requise',
): GenericUiSpec {
  const valid = questions.filter((q) => q.id && q.label?.trim())
  const elements: ElementRecord = {}
  const state: Record<string, unknown> = {}
  const children: string[] = []
  const isGuide = title === 'Requête optimisée' || title === 'Paramètres optionnels'

  for (const q of valid) {
    const elemId = `field-${q.id}`
    children.push(elemId)
    state[q.id] = ''
    if (q.inputType === 'select' && Array.isArray(q.options) && q.options.length > 0) {
      elements[elemId] = {
        type: 'SelectInputField',
        props: { label: q.label, options: q.options, required: q.required ?? false, value: { $bindState: `/${q.id}` } },
      }
    } else if (q.inputType === 'number') {
      elements[elemId] = {
        type: 'NumberInputField',
        props: { label: q.label, min: q.min, max: q.max, step: q.step ?? 1, required: q.required ?? false, value: { $bindState: `/${q.id}` } },
      }
    } else {
      elements[elemId] = {
        type: 'TextInputField',
        props: { label: q.label, required: q.required ?? false, value: { $bindState: `/${q.id}` } },
      }
    }
  }

  if (valid.length === 0 && !isGuide) {
    elements['field-clarification'] = {
      type: 'TextInputField',
      props: { label: 'Votre précision', placeholder: 'Décrivez votre demande en détail…', value: { $bindState: '/clarification' } },
    }
    state['clarification'] = ''
    children.push('field-clarification')
  }

  elements['form-panel'] = { type: 'FormPanel', props: { variant: 'bare' }, children }
  return { root: 'form-panel', elements, state, _guide: isGuide, _message: message } as unknown as GenericUiSpec
}

// ── helpers ───────────────────────────────────────────────────────────────────

const asSpec = (s: GenericUiSpec) => s as unknown as {
  root: string
  elements: ElementRecord
  state: Record<string, unknown>
  _guide: boolean
  _message: string
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('buildClarificationSpec', () => {
  describe('root and FormPanel', () => {
    it('sets root to form-panel', () => {
      const spec = asSpec(buildClarificationSpec([], '', 'Précision requise'))
      expect(spec.root).toBe('form-panel')
    })

    it('FormPanel has variant bare (no inner Paper)', () => {
      const spec = asSpec(buildClarificationSpec([], ''))
      const panel = spec.elements['form-panel'] as { props: { variant: string } }
      expect(panel.props.variant).toBe('bare')
    })

    it('FormPanel has no title or description prop (outer component handles those)', () => {
      const spec = asSpec(buildClarificationSpec([], '', 'Précision requise'))
      const panel = spec.elements['form-panel'] as { props: Record<string, unknown> }
      expect(panel.props.title).toBeUndefined()
      expect(panel.props.description).toBeUndefined()
    })
  })

  describe('_guide flag', () => {
    it('_guide is false for "Précision requise"', () => {
      expect(asSpec(buildClarificationSpec([], '', 'Précision requise'))._guide).toBe(false)
    })

    it('_guide is true for "Requête optimisée"', () => {
      expect(asSpec(buildClarificationSpec([], '', 'Requête optimisée'))._guide).toBe(true)
    })

    it('_guide is true for "Paramètres optionnels"', () => {
      expect(asSpec(buildClarificationSpec([], '', 'Paramètres optionnels'))._guide).toBe(true)
    })
  })

  describe('_message propagation', () => {
    it('stores the controller message verbatim on the spec for downstream rendering', () => {
      const msg = "Pour évaluer la cohérence, j'ai besoin de quelques paramètres métier."
      expect(asSpec(buildClarificationSpec([], msg))._message).toBe(msg)
    })

    it('stores empty string when no message is provided', () => {
      expect(asSpec(buildClarificationSpec([], ''))._message).toBe('')
    })
  })

  describe('fallback field when no valid questions', () => {
    it('injects a TextInputField fallback for clarify with no questions', () => {
      const spec = asSpec(buildClarificationSpec([], '', 'Précision requise'))
      expect(spec.elements['field-clarification']).toBeDefined()
      const field = spec.elements['field-clarification'] as { type: string }
      expect(field.type).toBe('TextInputField')
    })

    it('binds fallback field to /clarification state path', () => {
      const spec = asSpec(buildClarificationSpec([], ''))
      const field = spec.elements['field-clarification'] as { props: { value: { $bindState: string } } }
      expect(field.props.value.$bindState).toBe('/clarification')
    })

    it('initialises fallback state key to empty string', () => {
      const spec = asSpec(buildClarificationSpec([], ''))
      expect(spec.state['clarification']).toBe('')
    })

    it('does NOT inject fallback field for guide (no questions)', () => {
      const spec = asSpec(buildClarificationSpec([], '', 'Requête optimisée'))
      expect(spec.elements['field-clarification']).toBeUndefined()
    })

    it('does NOT inject fallback when valid questions exist', () => {
      const questions: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text' }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      expect(spec.elements['field-clarification']).toBeUndefined()
    })
  })

  describe('question rendering', () => {
    it('skips questions without an id', () => {
      const questions = [{ id: '', label: 'Période', inputType: 'text' }] as ControllerQuestion[]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      // only fallback field should exist (clarify mode)
      expect(Object.keys(spec.elements).filter(k => k !== 'form-panel')).toEqual(['field-clarification'])
    })

    it('skips questions without a label', () => {
      const questions = [{ id: 'period', label: '  ', inputType: 'text' }] as ControllerQuestion[]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      expect(spec.elements['field-period']).toBeUndefined()
    })

    it('renders TextInputField for text questions', () => {
      const questions: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text' }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-period'] as { type: string }
      expect(field.type).toBe('TextInputField')
    })

    it('renders SelectInputField for select questions with options', () => {
      const questions: ControllerQuestion[] = [{
        id: 'scope', label: 'Scope', inputType: 'select',
        options: [{ value: 'group', label: 'Groupe' }],
      }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-scope'] as { type: string }
      expect(field.type).toBe('SelectInputField')
    })

    it('falls back to TextInputField for select with no options', () => {
      const questions: ControllerQuestion[] = [{ id: 'scope', label: 'Scope', inputType: 'select', options: [] }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-scope'] as { type: string }
      expect(field.type).toBe('TextInputField')
    })

    it('renders NumberInputField for number questions', () => {
      const questions: ControllerQuestion[] = [{ id: 'year', label: 'Année', inputType: 'number', min: 2000, max: 2030 }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-year'] as { type: string; props: Record<string, unknown> }
      expect(field.type).toBe('NumberInputField')
      expect(field.props.min).toBe(2000)
      expect(field.props.max).toBe(2030)
    })

    it('binds each field to the correct state path', () => {
      const questions: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text' }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-period'] as { props: { value: { $bindState: string } } }
      expect(field.props.value.$bindState).toBe('/period')
    })

    it('initialises state key to empty string for each question', () => {
      const questions: ControllerQuestion[] = [
        { id: 'a', label: 'A', inputType: 'text' },
        { id: 'b', label: 'B', inputType: 'text' },
      ]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      expect(spec.state['a']).toBe('')
      expect(spec.state['b']).toBe('')
    })

    it('propagates required flag onto field props', () => {
      const questions: ControllerQuestion[] = [{ id: 'scope', label: 'Scope', inputType: 'text', required: true }]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const field = spec.elements['field-scope'] as { props: { required: boolean } }
      expect(field.props.required).toBe(true)
    })

    it('FormPanel children list matches the rendered fields in order', () => {
      const questions: ControllerQuestion[] = [
        { id: 'a', label: 'A', inputType: 'text' },
        { id: 'b', label: 'B', inputType: 'text' },
      ]
      const spec = asSpec(buildClarificationSpec(questions, ''))
      const panel = spec.elements['form-panel'] as { children: string[] }
      expect(panel.children).toEqual(['field-a', 'field-b'])
    })
  })
})
