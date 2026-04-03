import { useState, useRef } from 'react'
import { useUIStream } from '@json-render/react'
import type { GenericUiSpec } from '../types/chat'

export function useSpecStreaming() {
  const [generatedSpecs, setGeneratedSpecs] = useState<Record<string, GenericUiSpec>>({})
  // Tracks message IDs where spec generation failed — used to activate the Genie fallback renderer.
  const [failedSpecIds, setFailedSpecIds] = useState<Set<string>>(new Set())
  const [streamingSpecMessageId, setStreamingSpecMessageId] = useState<string | null>(null)
  // Ref counterpart — stable reference for use inside useUIStream callbacks (stale closure prevention)
  const streamingSpecMessageIdRef = useRef<string | null>(null)
  const attemptedSpecIdsRef = useRef<Set<string>>(new Set())
  const lastSpecCandidateIdRef = useRef<string | null>(null)

  const uiStream = useUIStream({
    api: '/api/spec-stream',
    onComplete: (spec) => {
      const id = streamingSpecMessageIdRef.current
      if (id) {
        setGeneratedSpecs((prev) => (prev[id] ? prev : { ...prev, [id]: spec }))
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

  return {
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
  }
}
