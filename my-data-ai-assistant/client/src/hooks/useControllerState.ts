import { useState, useCallback, useRef, useReducer, useEffect, useEffectEvent } from 'react'
import { runControllerPreflight, isControllerApproved } from '../lib/spec-utils'
import { normalizeClarificationQuestions } from '../lib/clarification-questions'
import type { ControllerApiResponse, PendingClarification, Message } from '../types/chat'

// ── Streaming reducer ──────────────────────────────────────────────────────
//
// Centralises every SSE-driven state update into a single dispatcher so React
// 18 auto-batching groups rapid updates, and the `finalized` flag prevents any
// desync from late-arriving status or reasoning events after the final decision.

type StreamingState = {
  status: string | null
  reasoningLive: string
  finalized: boolean
}

type StreamingAction =
  | { type: 'STATUS'; message: string }
  | { type: 'REASONING_TOKEN'; chunk: string }
  | { type: 'FINALIZED' }
  | { type: 'RESET' }

const INITIAL_STREAMING_STATE: StreamingState = {
  status: null,
  reasoningLive: '',
  finalized: false,
}

function streamingReducer(state: StreamingState, action: StreamingAction): StreamingState {
  if (state.finalized && action.type !== 'RESET') return state
  switch (action.type) {
    case 'STATUS':
      return { ...state, status: action.message }
    case 'REASONING_TOKEN':
      return { ...state, reasoningLive: state.reasoningLive + action.chunk }
    case 'FINALIZED':
      return { ...state, finalized: true }
    case 'RESET':
      return INITIAL_STREAMING_STATE
  }
}

function useAbortOnUnmount(activeAbortRef: React.MutableRefObject<AbortController | null>) {
  const abortLatestRequest = useEffectEvent(() => {
    activeAbortRef.current?.abort()
  })

  useEffect(() => {
    return () => { abortLatestRequest() }
  }, [])
}

interface UseControllerStateParams {
  enrichedToOriginal: Map<string, string>
  latestReasoningRef: React.MutableRefObject<string>
  setLatestReasoning: (v: string) => void
  messagesRef: React.MutableRefObject<Message[]>
  sessionIdRef: React.MutableRefObject<string>
  conversationIdRef: React.MutableRefObject<string>
  sendMessage: (content: string) => void
  setLocalUserMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setShowSuggestions: (v: boolean) => void
  setInput: (v: string) => void
}

export function useControllerState({
  enrichedToOriginal,
  latestReasoningRef,
  setLatestReasoning,
  messagesRef,
  sessionIdRef,
  conversationIdRef,
  sendMessage,
  setLocalUserMessages,
  setShowSuggestions,
  setInput,
}: UseControllerStateParams) {
  const [ControllerLoading, setControllerLoading] = useState(false)
  const [ControllerHint, setControllerHint] = useState<ControllerApiResponse | null>(null)
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(null)
  const [_clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({})
  const [clarificationRetryCount, setClarificationRetryCount] = useState(0)
  const [streamingState, dispatchStreaming] = useReducer(streamingReducer, INITIAL_STREAMING_STATE)
  const activeAbortRef = useRef<AbortController | null>(null)

  useAbortOnUnmount(activeAbortRef)

  const buildConversationContext = useCallback((currentUserMessage?: string) => {
    const pastMessages = messagesRef.current
      .filter((message) => Boolean(message.content?.trim()))
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content }))
    const messages = currentUserMessage
      ? [...pastMessages, { role: 'user' as const, content: currentUserMessage }]
      : pastMessages
    return {
      conversationId: conversationIdRef.current,
      sessionId: sessionIdRef.current,
      source: 'ai-chat-drawer' as const,
      messages,
    }
  }, [messagesRef, sessionIdRef, conversationIdRef])

  const submitPromptThroughController = useCallback(async (
    rawPrompt: string,
    options?: { suppressControllerBubble?: boolean }
  ) => {
    const trimmedPrompt = rawPrompt.trim()
    if (!trimmedPrompt) return

    // Reset the clarification counter on every fresh user request (not on clarification re-runs).
    if (!options?.suppressControllerBubble) {
      setClarificationRetryCount(0)
    }

    // Cancel any previous in-flight request before starting a new one.
    activeAbortRef.current?.abort()
    const abortController = new AbortController()
    activeAbortRef.current = abortController

    setShowSuggestions(false)
    setControllerLoading(true)
    setControllerHint(null)
    dispatchStreaming({ type: 'RESET' })
    setInput('')

    if (!enrichedToOriginal.has(trimmedPrompt)) {
      setLocalUserMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user' as const,
          content: trimmedPrompt,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          epoch: Date.now(),
        },
      ])
    }

    try {
      const ControllerResponse = await runControllerPreflight({
        prompt: trimmedPrompt,
        conversationContext: buildConversationContext(trimmedPrompt),
        signal: abortController.signal,
        onEvent: (ev) => {
          switch (ev.kind) {
            case 'status':
              dispatchStreaming({ type: 'STATUS', message: ev.message })
              break
            case 'reasoning_token':
              dispatchStreaming({ type: 'REASONING_TOKEN', chunk: ev.chunk })
              break
            case 'decision':
            case 'error':
              dispatchStreaming({ type: 'FINALIZED' })
              break
          }
        },
      })

      if (!ControllerResponse) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setControllerHint({
          decision: 'error',
          message: "L'agent IA n'a pas répondu. La demande est bloquée tant qu'elle n'a pas été validée.",
        })
        return
      }

      setControllerHint(ControllerResponse)

      if (ControllerResponse.decision === 'error') {
        setPendingClarification(null)
        setClarificationAnswers({})
        return
      }

      if (ControllerResponse.decision === 'clarify' && ControllerResponse.periodOptions?.length) {
        // Controller signals that the only missing context is a time period — show the period
        // picker UI directly instead of routing through the standard clarification panel.
        const now = Date.now()
        setLocalUserMessages((prev) => [
          ...prev,
          {
            id: `period-${now}`,
            role: 'assistant' as const,
            content: ControllerResponse.message,
            periodPrompt: true,
            periodOptions: ControllerResponse.periodOptions,
            timestamp: new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            epoch: now,
          },
        ])
        setControllerLoading(false)
        return
      }

      if (ControllerResponse.decision === 'clarify') {
        const newRetryCount = clarificationRetryCount + 1
        setClarificationRetryCount(newRetryCount)

        if (newRetryCount >= 3) {
          setPendingClarification(null)
          setClarificationAnswers({})
          const now = Date.now()
          setLocalUserMessages((prev) => [
            ...prev,
            {
              id: `clarify-exhaust-${now}`,
              role: 'assistant' as const,
              content: 'Désolé, nous n\'avons pas pu traiter votre demande après plusieurs tentatives de clarification. Veuillez reformuler votre demande ou contacter le support pour obtenir de l\'aide.',
              timestamp: new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
              epoch: now,
            },
          ])
          return
        }

        const questions = normalizeClarificationQuestions(ControllerResponse.questions ?? [])
        setPendingClarification({
          originalPrompt: trimmedPrompt,
          message: ControllerResponse.message,
          decision: ControllerResponse.decision,
          rewrittenPrompt: ControllerResponse.rewrittenPrompt,
          questions,
          suggestedTables: ControllerResponse.suggestedTables ?? [],
          suggestedFunctions: ControllerResponse.suggestedFunctions ?? [],
          canSendDirectly: false,
          needsParams: ControllerResponse.needsParams ?? false,
          guardrailSource: ControllerResponse.guardrailSource ?? null,
        })
        setClarificationAnswers(
          Object.fromEntries(questions.map((q) => [q.id, ''])) as Record<string, string>
        )
        return
      }

      if (isControllerApproved(ControllerResponse.decision, ControllerResponse.confidence)) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setClarificationRetryCount(0)
        setControllerHint(null)
        latestReasoningRef.current = ControllerResponse.reasoning ?? ''
        setLatestReasoning(ControllerResponse.reasoning ?? '')
        const promptToSend = ControllerResponse.rewrittenPrompt?.trim() || trimmedPrompt
        if (promptToSend !== trimmedPrompt) {
          const ultimate = enrichedToOriginal.get(trimmedPrompt) ?? trimmedPrompt
          enrichedToOriginal.set(promptToSend.trim(), ultimate)
        }
        if (!options?.suppressControllerBubble && ControllerResponse.message?.trim()) {
          setLocalUserMessages((prev) => [
            ...prev,
            {
              id: `ctrl-${Date.now()}`,
              role: 'assistant' as const,
              content: ControllerResponse.message,
              timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
              epoch: Date.now(),
              type: 'controller' as const,
            },
          ])
        }
        sendMessage(promptToSend)
        return
      }

      setClarificationRetryCount(0)
      latestReasoningRef.current = ControllerResponse.reasoning ?? ''
      setLatestReasoning(ControllerResponse.reasoning ?? '')
      const questions = normalizeClarificationQuestions(ControllerResponse.questions ?? [])
      setPendingClarification({
        originalPrompt: trimmedPrompt,
        message: ControllerResponse.message || "L'agent IA recommande de vérifier la reformulation avant envoi à l'agent IA.",
        decision: ControllerResponse.decision,
        rewrittenPrompt: ControllerResponse.rewrittenPrompt,
        questions,
        suggestedTables: ControllerResponse.suggestedTables ?? [],
        suggestedFunctions: ControllerResponse.suggestedFunctions ?? [],
        // guide: questions are optional, user can send directly to Genie
        // proceed (confidence < 0.90): re-run controller with clarifications
        canSendDirectly: ControllerResponse.decision === 'guide',
        needsParams: ControllerResponse.needsParams ?? false,
        guardrailSource: ControllerResponse.guardrailSource ?? null,
      })
      setClarificationAnswers(
        Object.fromEntries(questions.map((q) => [q.id, ''])) as Record<string, string>
      )
    } finally {
      setControllerLoading(false)
    }
  }, [buildConversationContext, clarificationRetryCount, latestReasoningRef, setLatestReasoning, sendMessage, setInput, setLocalUserMessages, setShowSuggestions, enrichedToOriginal])

  const resetControllerState = () => {
    setControllerLoading(false)
    setControllerHint(null)
    setPendingClarification(null)
    setClarificationAnswers({})
    setClarificationRetryCount(0)
    dispatchStreaming({ type: 'RESET' })
  }

  return {
    ControllerLoading,
    ControllerHint,
    setControllerHint,
    pendingClarification,
    setPendingClarification,
    clarificationRetryCount,
    submitPromptThroughController,
    resetControllerState,
    streamingStatus: streamingState.status,
    streamingReasoning: streamingState.reasoningLive,
  }
}
