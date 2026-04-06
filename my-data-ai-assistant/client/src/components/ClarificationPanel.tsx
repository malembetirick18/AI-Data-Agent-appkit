import { useMemo, useState, useCallback } from 'react'
import {
  Box, Text, Group, Button, Paper, Divider, Alert, Skeleton, Stack,
} from '@mantine/core'
import {
  IconAlertTriangle, IconFilter, IconSparkles, IconInfoCircle,
} from '@tabler/icons-react'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { sanitizeLabel, isDisplayOnlyLabel } from '../lib/message-utils'
import { questionsToSpec } from '../lib/clarification-spec'
import { normalizeClarificationQuestions } from '../lib/clarification-questions'
import { chatUiRegistry } from '../registry/chat-ui-registry'
import type { PendingClarification, GenericUiSpec } from '../types/chat'

interface SpecElement {
  type?: string
  children?: unknown
}

/** Guard against LLM-generated questions with missing id/label fields. */
function isValidQuestion(q: { id?: unknown; label?: unknown }): q is { id: string; label: string } {
  return typeof q.id === 'string' && q.id.length > 0 && typeof q.label === 'string'
}

/** Returns true when at least one required field is still empty. */
function computeMissingRequired(
  questions: PendingClarification['questions'],
  canSendDirectly: boolean | undefined,
  answers: Record<string, string>,
): boolean {
  if (canSendDirectly) return false
  return questions.some((q) => {
    if (!isValidQuestion(q)) return false
    if (!q.required) return false
    if (q.id === 'sp_folder_id' && answers['scope_level'] !== 'filiale') return false
    return !answers[q.id]?.trim()
  })
}

function toStringValue(val: unknown): string {
  if (val == null || typeof val === 'object') return ''
  return String(val as string | number | boolean)
}

function stripClarificationSubmitButtons(spec: GenericUiSpec): GenericUiSpec {
  const sourceElements = spec.elements as Record<string, SpecElement>
  const filteredEntries = Object.entries(sourceElements).filter(([, element]) => element?.type !== 'SubmitButton')
  const allowedKeys = new Set(filteredEntries.map(([key]) => key))

  if (!allowedKeys.has(spec.root)) return spec

  const elements = Object.fromEntries(
    filteredEntries.map(([key, element]) => {
      const nextElement: Record<string, unknown> = { ...element }
      if (Array.isArray(element.children)) {
        nextElement.children = element.children.filter(
          (child): child is string => typeof child === 'string' && allowedKeys.has(child)
        )
      }
      return [key, nextElement]
    })
  )

  return {
    ...spec,
    elements,
  } as unknown as GenericUiSpec
}

const EMPTY_STATE: Record<string, unknown> = {}

interface ClarificationPanelProps {
  pendingClarification: PendingClarification
  /** LLM-generated spec from clarificationStream — primary rendering path. */
  spec?: GenericUiSpec | null
  isStreaming?: boolean
  /** Set to true when the API call failed; triggers deterministic fallback. */
  hasStreamError?: boolean
  onSubmit: (answers: Record<string, string>) => void
}

export function ClarificationPanel({
  pendingClarification,
  spec,
  isStreaming,
  hasStreamError: _hasStreamError,
  onSubmit,
}: ClarificationPanelProps) {
  const normalizedQuestions = useMemo(
    () => normalizeClarificationQuestions(pendingClarification.questions),
    [pendingClarification.questions],
  )

  const questionIds = useMemo(
    () => new Set(normalizedQuestions.filter(isValidQuestion).map((q) => q.id)),
    [normalizedQuestions],
  )

  // Resolve spec: primary (LLM) → fallback (deterministic) → null
  // If the LLM spec exists but contains no form inputs (e.g. generated TextContent instead of
  // FormPanel), treat it as absent so questionsToSpec() deterministic fallback kicks in.
  const resolvedSpec = useMemo<GenericUiSpec | null>(() => {
    if (spec && normalizedQuestions.length > 0) {
      const cleanedSpec = stripClarificationSubmitButtons(spec)

      // Check 1: spec must contain at least one form input element type.
      const FORM_INPUT_TYPES = new Set([
        'FormPanel', 'SelectInputField', 'TextInputField', 'NumberInputField', 'ToggleField',
      ])
      const hasFormInputs = Object.values(cleanedSpec.elements as Record<string, { type?: string }>)
        .some((el) => FORM_INPUT_TYPES.has(el.type ?? ''))
      if (!hasFormInputs) return questionsToSpec(pendingClarification)

      // Check 2: the spec's top-level state keys must cover all required question IDs.
      // If the LLM invented its own field names (e.g. /analysis/method instead of
      // /high_activity_rule), computeMissingRequired will never see those answers and
      // the submit button stays permanently disabled.
      const specStateKeys = new Set(Object.keys(cleanedSpec.state ?? {}))
      const requiredIds = normalizedQuestions.filter(
        (q) => isValidQuestion(q) && q.required,
      )
      const allRequiredMapped = requiredIds.every((q) => specStateKeys.has(q.id))
      if (!allRequiredMapped) return questionsToSpec(pendingClarification)

      return cleanedSpec
    }
    return spec ?? questionsToSpec({ ...pendingClarification, questions: normalizedQuestions })
  }, [spec, pendingClarification, normalizedQuestions])

  // Seed initial answers from the spec's state.
  // json-render never fires onStateChange for initialState values — only user interactions.
  // By deriving specInitialAnswers from resolvedSpec, the button correctly reflects defaults
  // (e.g. LLM spec sets state.scope_level = 'group' → required field satisfied → button enabled).
  const specInitialAnswers = useMemo<Record<string, string>>(() => {
    const state = resolvedSpec?.state
    if (!state) return {}
    return Object.fromEntries(
      Object.entries(state).map(([k, v]) => [k, toStringValue(v)])
    )
  }, [resolvedSpec])

  // Only the fields the user has explicitly changed since this panel mounted.
  // On remount (clarificationRetryCount key change), this resets to {} automatically.
  const [userOverrides, setUserOverrides] = useState<Record<string, string>>({})

  // Merged answers: spec defaults + user changes — drives missingRequired and submit payload.
  const answers = useMemo(
    () => ({ ...specInitialAnswers, ...userOverrides }),
    [specInitialAnswers, userOverrides],
  )

  // The visible form state drives validation. Defaults provided by the controller or
  // streamed spec count immediately, and user edits override them.
  const missingRequired = useMemo(
    () => computeMissingRequired(normalizedQuestions, pendingClarification.canSendDirectly, answers),
    [normalizedQuestions, pendingClarification.canSendDirectly, answers],
  )

  const handleStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      const overrides: Record<string, string> = {}
      for (const { path, value } of changes) {
        // Strip leading '/' then unescape RFC 6901 JSON Pointer tokens (~1 → /, ~0 → ~)
        const key = (path.startsWith('/') ? path.slice(1) : path)
          .replace(/~1/g, '/').replace(/~0/g, '~')
        if (key === 'submitRequested' || !questionIds.has(key)) continue
        overrides[key] = toStringValue(value)
      }
      if (Object.keys(overrides).length === 0) return
      setUserOverrides((prev) => ({ ...prev, ...overrides }))
      // No auto-submit — submission requires explicit button click only.
    },
    [questionIds],
  )

  const buttonLabel = 'Relancer avec ces précisions'

  return (
    <Paper p="md" radius="md" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderLeft: '3px solid #0c8599' }}>
      <Group gap="xs" mb="sm" align="flex-start">
        {pendingClarification.needsParams
          ? <IconFilter size={14} color="#0c8599" style={{ marginTop: 2, flexShrink: 0 }} />
          : <IconAlertTriangle size={14} color="#f08c00" style={{ marginTop: 2, flexShrink: 0 }} />
        }
        <Box style={{ flex: 1 }}>
          <Text size="sm" fw={600} c={pendingClarification.needsParams ? '#0c8599' : '#e67700'}>
            {pendingClarification.needsParams
              ? 'Paramètres requis pour affiner la requête'
              : 'Précision requise avant l\u2019envoi à l\u2019agent IA'
            }
          </Text>
          <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.55 }}>
            {pendingClarification.message}
          </Text>
        </Box>
      </Group>

      <Divider mb="sm" color="#dee2e6" />

      {pendingClarification.canSendDirectly && pendingClarification.questions.length > 0 && (
        <Alert icon={<IconInfoCircle size={14} />} color="blue" variant="light" mb="sm" p="xs"
          styles={{ message: { fontSize: 'var(--mantine-font-size-xs)' } }}>
          Votre requête est valide et sera envoyée à l&apos;Agent IA pour analyse. Ces questions sont optionnelles mais nous vous recommandons fortement d&apos;y répondre pour affiner les résultats.
        </Alert>
      )}

      {isStreaming && (
        <Stack gap={10} mb="sm">
          <Stack gap={4}>
            <Skeleton height={8} radius="sm" width="38%" />
            <Skeleton height={34} radius="sm" />
          </Stack>
          <Stack gap={4}>
            <Skeleton height={8} radius="sm" width="45%" />
            <Skeleton height={34} radius="sm" />
          </Stack>
          <Stack gap={4}>
            <Skeleton height={8} radius="sm" width="30%" />
            <Skeleton height={34} radius="sm" />
          </Stack>
        </Stack>
      )}

      {resolvedSpec && !isStreaming && (
        <JSONUIProvider
          registry={chatUiRegistry}
          initialState={resolvedSpec.state ?? EMPTY_STATE}
          onStateChange={handleStateChange}
        >
          <Renderer spec={resolvedSpec} registry={chatUiRegistry} />
        </JSONUIProvider>
      )}

      {!resolvedSpec && !isStreaming && pendingClarification.questions.length > 0 && (
        // Minimal text fallback when questionsToSpec returns null (empty/invalid question list)
        <Box mb="sm">
          {normalizedQuestions
            .filter((q) => isValidQuestion(q) && !isDisplayOnlyLabel(q.label))
            .map((q) => (
              <Text key={q.id} size="xs" c="dimmed">{sanitizeLabel(q.label)}</Text>
            ))}
        </Box>
      )}

      <Group justify="flex-end" mt="sm">
        <Button
          size="xs" color="teal" variant="filled" disabled={missingRequired}
          leftSection={pendingClarification.needsParams ? <IconFilter size={12} /> : <IconSparkles size={12} />}
          onClick={() => onSubmit(answers)}
        >
          {buttonLabel}
        </Button>
      </Group>
    </Paper>
  )
}
