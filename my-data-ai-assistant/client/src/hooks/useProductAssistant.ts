import { useCallback, useRef, useState } from 'react'
import { useUIStream } from '@json-render/react'
import type { Product } from '../../../shared/products'
import type { GenericUiSpec, ControllerQuestion } from '../types/chat'
import { validateChartSpec, specIsValid } from '../lib/genie-utils'
import type { SelectedFolder } from '../data/folder-examples'

export type { SelectedFolder }

export type AssistantMessage = {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: string
  specId?: string
  metadata?: { type: 'qr_summary'; pairs: { label: string; answer: string }[] }
}

type Stage = 'idle' | 'running' | 'spec'

const formatTime = () =>
  new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

const makeId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const agentMsg = (text: string): AssistantMessage => ({
  id: makeId(),
  role: 'agent',
  text,
  timestamp: formatTime(),
})

async function* readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string | null; data: string }> {
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const raw of parts) {
        if (!raw.trim()) continue
        let eventName: string | null = null
        const dataLines: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        }
        if (dataLines.length > 0) yield { event: eventName, data: dataLines.join('\n') }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function buildClarificationSpec(
  questions: ControllerQuestion[],
  message: string,
  title = 'Précision requise',
): GenericUiSpec {
  const valid = questions.filter((q) => q.id && q.label?.trim())
  const elements: Record<string, unknown> = {}
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
        props: {
          label: q.label,
          placeholder: q.placeholder ?? 'Sélectionner…',
          options: q.options,
          required: q.required ?? false,
          value: { $bindState: `/${q.id}` },
        },
      }
    } else if (q.inputType === 'number') {
      elements[elemId] = {
        type: 'NumberInputField',
        props: {
          label: q.label,
          placeholder: q.placeholder ?? '',
          min: q.min,
          max: q.max,
          step: q.step ?? 1,
          required: q.required ?? false,
          value: { $bindState: `/${q.id}` },
        },
      }
    } else {
      elements[elemId] = {
        type: 'TextInputField',
        props: {
          label: q.label,
          placeholder: q.placeholder ?? '',
          required: q.required ?? false,
          value: { $bindState: `/${q.id}` },
        },
      }
    }
  }

  // When there are no renderable questions and this is not a guide decision,
  // add a free-text fallback so the submit button is never shown against an empty form.
  if (valid.length === 0 && !isGuide) {
    elements['field-clarification'] = {
      type: 'TextInputField',
      props: {
        label: 'Votre précision',
        placeholder: 'Décrivez votre demande en détail…',
        value: { $bindState: '/clarification' },
      },
    }
    state['clarification'] = ''
    children.push('field-clarification')
  }

  elements['form-panel'] = {
    type: 'FormPanel',
    props: { variant: 'bare' },
    children,
  }

  return { root: 'form-panel', elements, state, _guide: isGuide, _message: message } as unknown as GenericUiSpec
}

/**
 * Normalizes controller clarification questions and removes duplicates by `id`.
 * Keeps the first valid question as canonical and merges stricter flags from duplicates.
 */
function normalizeClarificationQuestions(questions: ControllerQuestion[]): ControllerQuestion[] {
  const byId = new Map<string, ControllerQuestion>()
  for (const q of questions) {
    const id = q?.id?.trim()
    const label = q?.label?.trim()
    if (!id || !label) continue
    const normalized: ControllerQuestion = {
      ...q,
      id,
      label,
      placeholder: q.placeholder?.trim() || undefined,
      options: Array.isArray(q.options)
        ? q.options.filter((o) => o?.value?.trim() && o?.label?.trim())
        : undefined,
    }
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, normalized)
    } else {
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
  }
  return Array.from(byId.values())
}

export function useProductAssistant(product: Product) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [specsHistory, setSpecsHistory] = useState<Record<string, GenericUiSpec>>({})
  const [displayedSpecId, setDisplayedSpecId] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null)
  const [statusText, setStatusText] = useState('')
  const [reasoningText, setReasoningText] = useState('')
  const [clarificationSpec, setClarificationSpec] = useState<GenericUiSpec | null>(null)
  const [clarificationQuestions, setClarificationQuestions] = useState<ControllerQuestion[]>([])
  const clarificationOriginalPromptRef = useRef<string>('')
  const [controllerInfo, setControllerInfo] = useState<{
    decision: string
    confidence: number
    wasRewritten: boolean
  } | null>(null)
  // Ref mirrors selectedFolder for stale-closure-free access inside async send()
  const selectedFolderRef = useRef<SelectedFolder | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const uiStream = useUIStream({
    api: '/api/spec-stream',
    onComplete: (spec) => {
      const validated = validateChartSpec(spec)
      if (specIsValid(validated)) {
        const specId = makeId()
        setSpecsHistory((prev) => ({ ...prev, [specId]: validated }))
        setDisplayedSpecId(specId)
        setMessages((prev) => [
          ...prev,
          { ...agentMsg('Analyse terminée. Canvas mis à jour.'), specId },
        ])
      } else {
        setHasError(true)
        setMessages((prev) => [
          ...prev,
          agentMsg("Le canvas généré n'est pas valide. Reformulez votre question."),
        ])
      }
      setControllerInfo(null)
      setStatusText('')
      setReasoningText('')
      setStage('idle')
    },
    onError: () => {
      setHasError(true)
      setMessages((prev) => [
        ...prev,
        agentMsg('Une erreur est survenue lors de la génération du canvas.'),
      ])
      setControllerInfo(null)
      setStatusText('')
      setReasoningText('')
      setStage('idle')
    },
  })

  const selectFolder = useCallback((folder: SelectedFolder) => {
    selectedFolderRef.current = folder
    setSelectedFolder(folder)
  }, [])

  const clearFolder = useCallback(() => {
    selectedFolderRef.current = null
    setSelectedFolder(null)
    abortRef.current?.abort()
    abortRef.current = null
    uiStream.clear()
    setMessages([])
    setSpecsHistory({})
    setDisplayedSpecId(null)
    setHasError(false)
    setControllerInfo(null)
    setStatusText('')
    setReasoningText('')
    setClarificationSpec(null)
    setClarificationQuestions([])
    clarificationOriginalPromptRef.current = ''
    setStage('idle')
  }, [uiStream])

  const send = useCallback(
    async (promptText: string, displayText?: string | null) => {
      const trimmed = promptText.trim()
      const folder = selectedFolderRef.current
      // Folder context (sp_folder_id + session_id) is required for any analysis.
      // Without both fields the Genie space cannot scope the query.
      if (
        !trimmed ||
        stage !== 'idle' ||
        !folder ||
        !folder.spFolderId.trim() ||
        !folder.sessionId.trim()
      ) {
        return
      }

      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort

      setHasError(false)
      setDisplayedSpecId(null)
      setControllerInfo(null)
      setStatusText('Analyse de la requête en cours…')
      setReasoningText('')
      setClarificationSpec(null)
      setClarificationQuestions([])
      clarificationOriginalPromptRef.current = trimmed
      uiStream.clear()
      setStage('running')
      // displayText === null means caller already added a user bubble (e.g. clarification re-submit)
      if (displayText !== null) {
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: 'user', text: displayText ?? trimmed, timestamp: formatTime() },
        ])
      }

      try {
        // ── Phase 1: Controller decision ──────────────────────────────────────
        const controllerResp = await fetch('/api/controller', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: trimmed,
            catalogInfo: '',
            conversationContext: {
              sp_folder_id: folder.spFolderId,
              session_id: folder.sessionId,
            },
          }),
          signal: abort.signal,
        })
        if (!controllerResp.ok || !controllerResp.body) {
          throw new Error("L'agent contrôleur est indisponible. Veuillez réessayer.")
        }

        let decision: Record<string, unknown> | null = null
        const ctrlReader = controllerResp.body.getReader()
        for await (const { event, data } of readSseStream(ctrlReader)) {
          if (abort.signal.aborted) return
          if (event === 'controller_decision') {
            try {
              const parsed = JSON.parse(data) as { role?: string; data?: Record<string, unknown> }
              decision =
                parsed.role === 'controller' && parsed.data != null
                  ? parsed.data
                  : (parsed as unknown as Record<string, unknown>)
            } catch {
              /* skip malformed event */
            }
          } else if (event === 'status') {
            try {
              const parsed = JSON.parse(data) as { message?: string }
              const msg = (parsed.message ?? data).trim()
              if (msg) setStatusText(msg)
            } catch {
              if (data.trim()) setStatusText(data.trim())
            }
          } else if (event === 'reasoning_token') {
            if (data.trim()) setReasoningText((prev) => prev + data)
          }
        }

        if (abort.signal.aborted) return

        if (!decision) {
          setMessages((prev) => [
            ...prev,
            agentMsg("L'agent n'a pas retourné de décision. Veuillez réessayer."),
          ])
          setStage('idle')
          return
        }

        const canSendDirectly = decision.canSendDirectly === true
        const decisionType = typeof decision.decision === 'string' ? decision.decision : 'proceed'
        const isGuide = decisionType === 'guide'
        const rewrittenPrompt =
          typeof decision.rewrittenPrompt === 'string' && decision.rewrittenPrompt.trim()
            ? decision.rewrittenPrompt
            : trimmed

        setControllerInfo({
          decision: decisionType,
          confidence: typeof decision.confidence === 'number' ? decision.confidence : 1,
          wasRewritten: rewrittenPrompt !== trimmed,
        })

        // Guide decisions always pause for user confirmation before Genie.
        // Clarify/low-confidence proceed also pause for required clarification.
        if (!canSendDirectly || isGuide) {
          const rawQuestions = Array.isArray(decision.questions) ? decision.questions : []
          const normalizedQuestions = normalizeClarificationQuestions(
            rawQuestions.filter(
              (q): q is ControllerQuestion =>
                typeof q === 'object' && q !== null && typeof (q as ControllerQuestion).id === 'string',
            ),
          )
          const labels = normalizedQuestions.map((q) => q.label)
          const baseMessage =
            typeof decision.message === 'string' && decision.message.trim()
              ? decision.message
              : isGuide
              ? "L'agent a optimisé votre requête. Confirmez pour lancer l'analyse."
              : "Pour affiner l'analyse, veuillez préciser votre demande."
          const text =
            labels.length > 0
              ? `${baseMessage}\n\n${labels.map((l) => `• ${l}`).join('\n')}`
              : baseMessage
          setMessages((prev) => [...prev, agentMsg(text)])

          if (isGuide) {
            clarificationOriginalPromptRef.current = rewrittenPrompt
          }

          setClarificationQuestions(normalizedQuestions)
          setClarificationSpec(
            buildClarificationSpec(
              normalizedQuestions,
              baseMessage,
              isGuide
                ? normalizedQuestions.length > 0 ? 'Paramètres optionnels' : 'Requête optimisée'
                : 'Précision requise',
            ),
          )
          setControllerInfo(null)
          setStatusText('')
          setReasoningText('')
          setStage('idle')
          return
        }

        // ── Phase 2: Genie execution via unified /api/chat/stream ─────────────
        // Re-check folder context here — it may have been cleared (clearFolder)
        // while the controller call was in flight. Without sp_folder_id +
        // session_id we cannot scope the Genie query, so we abort cleanly.
        const folderNow = selectedFolderRef.current
        if (!folderNow?.spFolderId?.trim() || !folderNow?.sessionId?.trim()) {
          setMessages((prev) => [
            ...prev,
            agentMsg('Contexte de dossier manquant (sp_folder_id et session_id requis). Sélectionnez un dossier et réessayez.'),
          ])
          setControllerInfo(null)
          setStatusText('')
          setReasoningText('')
          setStage('idle')
          return
        }

        setStatusText('Interrogation des données en cours…')
        const genieResp = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: rewrittenPrompt, appType: product }),
          signal: abort.signal,
        })
        if (!genieResp.ok) {
          const errBody = await genieResp.json().catch(() => ({})) as { error?: string }
          throw new Error(errBody.error ?? `Genie a répondu avec le statut ${genieResp.status}.`)
        }
        if (!genieResp.body) throw new Error('Genie response body is empty.')

        let genieResult: Record<string, unknown> | null = null
        const genieReader = genieResp.body.getReader()
        for await (const { data } of readSseStream(genieReader)) {
          if (abort.signal.aborted) return
          try {
            const ev = JSON.parse(data) as { type?: string; [k: string]: unknown }
            if (ev.type === 'query_result') {
              genieResult = ev
            } else if (ev.type === 'error') {
              throw new Error(typeof ev.error === 'string' ? ev.error : 'Genie stream error.')
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }

        if (abort.signal.aborted) return

        // Guard: require both conversation context and a data result before generating spec
        if (!selectedFolderRef.current) {
          setMessages((prev) => [...prev, agentMsg('Contexte de conversation manquant. Sélectionnez un dossier et réessayez.')])
          setStage('idle')
          return
        }
        if (!genieResult) {
          setMessages((prev) => [...prev, agentMsg("L'analyse n'a retourné aucune donnée. Reformulez votre question ou vérifiez que le dossier contient des données pour cette période.")])
          setStage('idle')
          return
        }

        // ── Phase 3: Spec streaming ───────────────────────────────────────────
        setStatusText('Génération du rapport…')
        setStage('spec')
        void uiStream.send(rewrittenPrompt, { product, genieResult })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setHasError(true)
        setControllerInfo(null)
        setStatusText('')
        setReasoningText('')
        setMessages((prev) => [
          ...prev,
          agentMsg(
            err instanceof Error && err.message
              ? err.message
              : "Une erreur est survenue lors de l'analyse. Veuillez réessayer.",
          ),
        ])
        setStage('idle')
      }
    },
    [stage, uiStream, product],
  )

  const submitClarification = useCallback(
    (answers: Record<string, string>) => {
      const original = clarificationOriginalPromptRef.current
      const qs = clarificationQuestions
      if (!original) return

      // Build Q/R pairs from structured questions
      const pairs: { label: string; answer: string }[] = qs
        .filter((q) => answers[q.id] != null && answers[q.id] !== '')
        .map((q) => ({ label: q.label, answer: answers[q.id] }))

      // Include fallback free-text field when no structured questions exist
      if (pairs.length === 0 && answers['clarification']?.trim()) {
        pairs.push({ label: 'Votre précision', answer: answers['clarification'].trim() })
      }

      const enriched = pairs.length > 0
        ? `${original}\n\nPrécisions apportées :\n${pairs.map((p) => `• ${p.label} : ${p.answer}`).join('\n')}`
        : original

      // Emit structured Q/R summary card before re-running
      if (pairs.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: 'agent' as const,
            text: '',
            timestamp: formatTime(),
            metadata: { type: 'qr_summary' as const, pairs },
          },
        ])
      }

      setClarificationSpec(null)
      setClarificationQuestions([])
      // null = suppress user bubble — the original query is already in history
      void send(enriched, null)
    },
    [clarificationQuestions, send],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    uiStream.clear()
    setMessages([])
    setSpecsHistory({})
    setDisplayedSpecId(null)
    setHasError(false)
    setControllerInfo(null)
    setStatusText('')
    setReasoningText('')
    setClarificationSpec(null)
    setClarificationQuestions([])
    clarificationOriginalPromptRef.current = ''
    setStage('idle')
  }, [uiStream])

  const isStreaming = stage !== 'idle'
  const liveSpec = uiStream.spec as GenericUiSpec | undefined
  const visibleSpec: GenericUiSpec | null =
    (displayedSpecId ? specsHistory[displayedSpecId] : null) ??
    (liveSpec && specIsValid(liveSpec) ? liveSpec : null)

  return {
    messages,
    spec: visibleSpec,
    displayedSpecId,
    showSpec: setDisplayedSpecId,
    isStreaming,
    hasError,
    statusText,
    reasoningText,
    controllerInfo,
    clarificationSpec,
    clarificationQuestions,
    send,
    reset,
    submitClarification,
    selectedFolder,
    selectFolder,
    clearFolder,
  }
}
