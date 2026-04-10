import { useState, useRef, useCallback } from 'react'
import { useUIStream } from '@json-render/react'
import type { GenericUiSpec, PendingClarification } from '../types/chat'
import { validateChartSpec } from '../lib/genie-utils'

export function useSpecStreaming() {
  const [generatedSpecs, setGeneratedSpecs] = useState<Record<string, GenericUiSpec>>({})
  // Tracks message IDs where spec generation failed — used to activate the Genie fallback renderer.
  const [failedSpecIds, setFailedSpecIds] = useState<Set<string>>(new Set())
  const [streamingSpecMessageId, setStreamingSpecMessageId] = useState<string | null>(null)
  // Ref counterpart — stable reference for use inside useUIStream callbacks (stale closure prevention)
  const streamingSpecMessageIdRef = useRef<string | null>(null)
  const attemptedSpecIdsRef = useRef<Set<string>>(new Set())
  const lastSpecCandidateIdRef = useRef<string | null>(null)

  // ── Genie result spec stream ──────────────────────────────────────────────
  const uiStream = useUIStream({
    api: '/api/spec-stream',
    onComplete: (spec) => {
      const id = streamingSpecMessageIdRef.current
      if (id) {
        const validated = validateChartSpec(spec)
        setGeneratedSpecs((prev) => (prev[id] ? prev : { ...prev, [id]: validated }))
        streamingSpecMessageIdRef.current = null
        setStreamingSpecMessageId(null)
      }
    },
    onError: () => {
      const id = streamingSpecMessageIdRef.current
      if (id) setFailedSpecIds((prev) => { const next = new Set(prev); next.add(id); return next })
      streamingSpecMessageIdRef.current = null
      setStreamingSpecMessageId(null)
    },
  })

  const triggerSpec = (messageId: string, promptText: string, genieResult: unknown) => {
    streamingSpecMessageIdRef.current = messageId
    setStreamingSpecMessageId(messageId)
    void uiStream.send(promptText, { genieResult })
  }

  const clearStreaming = () => {
    uiStream.clear()
    streamingSpecMessageIdRef.current = null
    setStreamingSpecMessageId(null)
    attemptedSpecIdsRef.current.clear()
    lastSpecCandidateIdRef.current = null
  }

  const clearSpecs = () => {
    setGeneratedSpecs({})
    setFailedSpecIds(new Set())
    clearStreaming()
  }

  // ── Clarification form spec stream ────────────────────────────────────────
  const [clarificationSpec, setClarificationSpec] = useState<GenericUiSpec | null>(null)
  const [clarificationError, setClarificationError] = useState(false)

  const clarificationStream = useUIStream({
    api: '/api/spec-stream',
    onComplete: (spec) => {
      setClarificationSpec(spec)
    },
    onError: () => {
      setClarificationError(true)
    },
  })

  const triggerClarificationSpec = useCallback((pendingClarification: PendingClarification) => {
    // Abort any in-flight clarification stream before starting a new one (rapid retry guard)
    clarificationStream.clear()
    setClarificationSpec(null)
    setClarificationError(false)
    void clarificationStream.send(pendingClarification.message, {
      genieResult: null,
      questions: pendingClarification.questions,
    })
  }, [clarificationStream])

  const clearClarificationSpec = useCallback(() => {
    clarificationStream.clear()
    setClarificationSpec(null)
    setClarificationError(false)
  }, [clarificationStream])

  return {
    // Genie result specs
    generatedSpecs,
    failedSpecIds,
    streamingSpecMessageId,
    streamingSpecMessageIdRef,
    isStreaming: uiStream.isStreaming,
    hasPartialSpec: Boolean(uiStream.spec),
    uiStream,
    attemptedSpecIdsRef,
    lastSpecCandidateIdRef,
    triggerSpec,
    clearSpecs,
    // Clarification form specs
    clarificationSpec,
    clarificationIsStreaming: clarificationStream.isStreaming,
    clarificationError,
    triggerClarificationSpec,
    clearClarificationSpec,
  }
}
