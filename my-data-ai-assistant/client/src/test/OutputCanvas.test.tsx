// @vitest-environment happy-dom
/**
 * Component tests for OutputCanvas routing and ClarificationState reactivity.
 * Covers all state-machine branches: empty, loading, error, loaded, clarification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { OutputCanvas } from '../components/OutputCanvas'
import type { GenericUiSpec, ControllerQuestion } from '../types/chat'

type BaseProps = {
  product: 'geo' | 'closing'
  spec: GenericUiSpec | null
  clarificationSpec: GenericUiSpec | null
  clarificationQuestions: ControllerQuestion[]
  isStreaming: boolean
  hasError: boolean
  lastQuery: string | null
  onReset: () => void
  onReload: () => void
  onClarificationSubmit: (answers: Record<string, string>) => void
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@json-render/react', () => ({
  JSONUIProvider: ({ children }: { children: React.ReactNode; onStateChange?: (c: unknown) => void }) => <div data-testid="json-ui-provider">{children}</div>,
  Renderer: ({ spec }: { spec: unknown }) => <div data-testid="renderer" data-root={(spec as { root?: string })?.root} />,
  useUIStream: () => ({ spec: null, send: vi.fn(), clear: vi.fn() }),
}))

vi.mock('../registry/chat-ui-registry', () => ({
  chatUiRegistry: {},
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SPEC: GenericUiSpec = {
  root: 'stack-1',
  elements: { 'stack-1': { type: 'Stack', props: {}, children: [] } },
} as unknown as GenericUiSpec

function clarifySpec(_questions: ControllerQuestion[] = [], isGuide = false): GenericUiSpec {
  const title = isGuide ? 'Requête optimisée' : 'Précision requise'
  return {
    root: 'form-panel',
    elements: {
      'form-panel': { type: 'FormPanel', props: { variant: 'bare' }, children: [] },
    },
    state: {},
    _guide: isGuide,
    _title: title,
  } as unknown as GenericUiSpec
}

const baseProps: BaseProps = {
  product: 'geo',
  spec: null,
  clarificationSpec: null,
  clarificationQuestions: [],
  isStreaming: false,
  hasError: false,
  lastQuery: null,
  onReset: vi.fn(),
  onReload: vi.fn(),
  onClarificationSubmit: vi.fn(),
}

function renderCanvas(props: Partial<BaseProps> = {}) {
  return render(
    <MantineProvider forceColorScheme="light">
      <OutputCanvas {...{ ...baseProps, ...props }} />
    </MantineProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OutputCanvas — state routing', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows EmptyState when idle with no spec', () => {
    renderCanvas()
    expect(screen.getByText('Aucune analyse générée')).toBeInTheDocument()
  })

  it('shows LoadingState when streaming with no valid spec', () => {
    renderCanvas({ isStreaming: true, spec: null })
    // Skeleton elements rendered by LoadingState
    expect(document.querySelectorAll('.mantine-Skeleton-root').length).toBeGreaterThan(0)
    expect(screen.queryByText('Aucune analyse générée')).not.toBeInTheDocument()
  })

  it('shows ErrorState when hasError and no loaded spec', () => {
    renderCanvas({ hasError: true })
    expect(screen.getByText('Échec de la génération')).toBeInTheDocument()
  })

  it('shows LoadedState when spec is valid', () => {
    renderCanvas({ spec: VALID_SPEC })
    expect(screen.getByTestId('renderer')).toBeInTheDocument()
    expect(screen.queryByText('Aucune analyse générée')).not.toBeInTheDocument()
  })

  it('shows ClarificationState when clarificationSpec is set (no loaded spec)', () => {
    renderCanvas({ clarificationSpec: clarifySpec() })
    expect(screen.getByText('Paramètres d\'analyse')).toBeInTheDocument()
  })

  it('prefers LoadedState over ClarificationState when both are set', () => {
    renderCanvas({ spec: VALID_SPEC, clarificationSpec: clarifySpec() })
    expect(screen.getByTestId('renderer')).toBeInTheDocument()
    expect(screen.queryByText("Paramètres d'analyse")).not.toBeInTheDocument()
  })

  it('prefers ErrorState over ClarificationState when hasError and no loaded spec', () => {
    renderCanvas({ hasError: true, clarificationSpec: clarifySpec() })
    expect(screen.getByText('Échec de la génération')).toBeInTheDocument()
    expect(screen.queryByText("Paramètres d'analyse")).not.toBeInTheDocument()
  })
})

describe('ClarificationState — guide vs clarify header', () => {
  it('shows "Guidage" label for guide spec', () => {
    renderCanvas({ clarificationSpec: clarifySpec([], true) })
    expect(screen.getByText('Guidage')).toBeInTheDocument()
  })

  it('shows "Précision requise" label for clarify spec', () => {
    renderCanvas({ clarificationSpec: clarifySpec() })
    expect(screen.getByText('Précision requise')).toBeInTheDocument()
  })

  it('shows "Confirmation avant analyse" title for guide', () => {
    renderCanvas({ clarificationSpec: clarifySpec([], true) })
    expect(screen.getByText('Confirmation avant analyse')).toBeInTheDocument()
  })

  it('shows correct description for guide', () => {
    renderCanvas({ clarificationSpec: clarifySpec([], true) })
    expect(screen.getByText(/Vérifiez la requête optimisée/)).toBeInTheDocument()
  })

  it('shows correct description for clarify', () => {
    renderCanvas({ clarificationSpec: clarifySpec() })
    expect(screen.getByText(/Renseignez les paramètres/)).toBeInTheDocument()
  })
})

describe('ClarificationState — submit button', () => {
  it('shows "Confirmer et analyser" for guide', () => {
    renderCanvas({ clarificationSpec: clarifySpec([], true) })
    expect(screen.getByRole('button', { name: /Confirmer et analyser/ })).toBeInTheDocument()
  })

  it('shows "Relancer avec ces précisions" for clarify', () => {
    renderCanvas({ clarificationSpec: clarifySpec() })
    expect(screen.getByRole('button', { name: /Relancer avec ces précisions/ })).toBeInTheDocument()
  })

  it('guide submit button is always enabled (no required fields)', () => {
    renderCanvas({ clarificationSpec: clarifySpec([], true) })
    expect(screen.getByRole('button', { name: /Confirmer et analyser/ })).toBeEnabled()
  })

  it('clarify submit button is enabled when no required questions (no-op clarify)', () => {
    renderCanvas({ clarificationSpec: clarifySpec([]), clarificationQuestions: [] })
    expect(screen.getByRole('button', { name: /Relancer avec ces précisions/ })).toBeEnabled()
  })

  it('clarify submit button is DISABLED when a required question has no answer', () => {
    const questions: ControllerQuestion[] = [{ id: 'period', label: 'Période', inputType: 'text', required: true }]
    renderCanvas({
      clarificationSpec: clarifySpec(questions),
      clarificationQuestions: questions,
    })
    expect(screen.getByRole('button', { name: /Relancer avec ces précisions/ })).toBeDisabled()
  })

  it('calls onClarificationSubmit when confirm button clicked', () => {
    const onClarificationSubmit = vi.fn()
    renderCanvas({
      clarificationSpec: clarifySpec([], true),
      onClarificationSubmit,
    })
    fireEvent.click(screen.getByRole('button', { name: /Confirmer et analyser/ }))
    expect(onClarificationSubmit).toHaveBeenCalledOnce()
  })
})

describe('ClarificationState — reset button', () => {
  it('renders the reset (trash) action icon', () => {
    renderCanvas({ clarificationSpec: clarifySpec() })
    expect(screen.getByLabelText('Réinitialiser')).toBeInTheDocument()
  })

  it('calls onReset when trash icon clicked', () => {
    const onReset = vi.fn()
    renderCanvas({ clarificationSpec: clarifySpec(), onReset })
    fireEvent.click(screen.getByLabelText('Réinitialiser'))
    expect(onReset).toHaveBeenCalledOnce()
  })
})

describe('ClarificationState — required field reactivity', () => {
  it('submit button enables after onStateChange receives a required field value', async () => {
    // We simulate the state-change path by verifying that when JSONUIProvider fires
    // onStateChange (mocked below), setUserOverrides updates and missingRequired flips.
    // Since our JSONUIProvider mock doesn't fire state changes, we test the initialState
    // seed path: a required question with a pre-seeded state value should enable the button.
    const questions: ControllerQuestion[] = [
      { id: 'scope', label: 'Scope', inputType: 'select', required: true,
        options: [{ value: 'group', label: 'Groupe' }] },
    ]
    // Spec whose state pre-seeds scope = 'group' — simulates a select with a default value
    const specWithDefault: GenericUiSpec = {
      root: 'form-panel',
      elements: { 'form-panel': { type: 'FormPanel', props: { variant: 'bare' }, children: [] } },
      state: { scope: 'group' },
      _guide: false,
    } as unknown as GenericUiSpec

    renderCanvas({ clarificationSpec: specWithDefault, clarificationQuestions: questions })
    // specInitialAnswers seeds scope='group' → missingRequired = false → button enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Relancer avec ces précisions/ })).toBeEnabled()
    })
  })
})

describe('ErrorState actions', () => {
  it('reload button calls onReload', () => {
    const onReload = vi.fn()
    renderCanvas({ hasError: true, onReload })
    fireEvent.click(screen.getByRole('button', { name: /Relancer l'analyse/ }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('reset button calls onReset', () => {
    const onReset = vi.fn()
    renderCanvas({ hasError: true, onReset })
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(onReset).toHaveBeenCalledOnce()
  })
})
