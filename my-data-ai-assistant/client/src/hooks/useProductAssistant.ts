import { useCallback, useRef, useState } from 'react'
import { useUIStream } from '@json-render/react'
import type { Product } from '../../../shared/products'
import type { GenericUiSpec } from '../types/chat'
import { validateChartSpec, specIsValid } from '../lib/genie-utils'
import type { SelectedFolder } from '../data/folder-examples'

export type { SelectedFolder }

export type AssistantMessage = {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: string
  specId?: string  // set on agent completion messages that have a linked spec
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

/** Returns the label string from a question object, or null if the object is empty / has no label. */
function questionLabel(q: unknown): string | null {
  if (typeof q !== 'object' || q === null) return null
  const label = (q as Record<string, unknown>).label
  return typeof label === 'string' && label.trim() ? label.trim() : null
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
    setStage('idle')
  }, [uiStream])

  const send = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim()
      const folder = selectedFolderRef.current
      if (!trimmed || stage !== 'idle' || !folder) return

      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort

      setHasError(false)
      setDisplayedSpecId(null)
      setControllerInfo(null)
      setStatusText('Analyse de la requête en cours…')
      setReasoningText('')
      uiStream.clear()
      setStage('running')
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'user', text: trimmed, timestamp: formatTime() },
      ])

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
              session: folder.sessionId,
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
        const rewrittenPrompt =
          typeof decision.rewrittenPrompt === 'string' && decision.rewrittenPrompt.trim()
            ? decision.rewrittenPrompt
            : trimmed

        setControllerInfo({
          decision: typeof decision.decision === 'string' ? decision.decision : 'proceed',
          confidence: typeof decision.confidence === 'number' ? decision.confidence : 1,
          wasRewritten: rewrittenPrompt !== trimmed,
        })

        if (!canSendDirectly) {
          const rawQuestions = Array.isArray(decision.questions) ? decision.questions : []
          // Filter out empty objects or entries without a proper label string
          const labels = rawQuestions
            .map(questionLabel)
            .filter((l): l is string => l !== null)
          const baseMessage =
            typeof decision.message === 'string' && decision.message.trim()
              ? decision.message
              : "Pour affiner l'analyse, veuillez préciser votre demande."
          const text =
            labels.length > 0
              ? `${baseMessage}\n\n${labels.map((l) => `• ${l}`).join('\n')}`
              : baseMessage
          setMessages((prev) => [...prev, agentMsg(text)])
          setControllerInfo(null)
          setStatusText('')
          setReasoningText('')
          setStage('idle')
          return
        }

        // ── Phase 2: Genie execution via unified /api/chat/stream ─────────────
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
    setStage('idle')
  }, [uiStream])

  const isStreaming = stage !== 'idle'
  const liveSpec = uiStream.spec as GenericUiSpec | undefined
  const visibleSpec: GenericUiSpec | null =
    (displayedSpecId ? specsHistory[displayedSpecId] ?? null : null) ??
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
    send,
    reset,
    selectedFolder,
    selectFolder,
    clearFolder,
  }
}
