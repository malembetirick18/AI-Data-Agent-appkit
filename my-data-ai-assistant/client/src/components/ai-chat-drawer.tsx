'use client'

import { Suspense, use, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useEffectEvent } from 'react'
import {
  Drawer, Text, TextInput, ActionIcon, Group, Box, ScrollArea,
  Paper, ThemeIcon, Stack, Divider, List, Accordion, UnstyledButton,
  Tooltip, Badge, Alert, Skeleton,
} from '@mantine/core'
import {
  IconSparkles, IconSend, IconArrowsMaximize, IconTrash, IconX,
  IconBulb, IconChevronDown, IconDeviceFloppy,
  IconListDetails, IconRobot, IconAlertTriangle,
} from '@tabler/icons-react'
import { useGenieChat } from '@databricks/appkit-ui/react'
import type { GenieAttachmentResponse } from '@databricks/appkit-ui/react'

import { chatUiRegistry } from '../registry/chat-ui-registry'
import MessageContent, { CopyButton } from './MessageContent'
import { TeamControlsPanel } from './TeamControlsPanel'
import { ClarificationPanel } from './ClarificationPanel'
import { SaveControlModal } from './SaveControlModal'
import { PeriodPickerPanel } from './PeriodPickerPanel'
import { useSpecStreaming } from '../hooks/useSpecStreaming'
import { useControllerState } from '../hooks/useControllerState'
import { useSaveDialog } from '../hooks/useSaveDialog'
import { blocksToPlainText, formatQRAnswers } from '../lib/message-utils'
import { buildGenieResultPayload } from '../lib/genie-utils'
import type { Message, AiChatDrawerProps, TeamControl, SavedControl, ControllerApiResponse, PendingClarification } from '../types/chat'

export type { SavedControl }

const suggestions = [
  'Les variations de dépenses par fournisseur ou catégorie sont-elles cohérentes avec les tendances historiques et les volumes d\'activité ?',
  'Existe-t-il des transactions d\'achats présentant des montants, fréquences ou dates atypiques (ex. fractionnement de factures, achats en fin de période, doublons potentiels) ?',
  'Des fournisseurs inactifs continuent-ils à être réglés ?',
  'Quels tiers ont une activité à la fois fournisseur et client ?',
  'Y a-t-il des écarts significatifs entre les soldes comptables fournisseurs et les balances auxiliaires ?',
]

/** Appended to every controller-provided period list so the dossier's fiscal period is always selectable. */
const FOLDER_PERIOD_OPTION = { label: 'Période du dossier (exercice complet)', value: 'folder_period' }

let dynamicSuggestionsPromise: Promise<string[]> | null = null

function loadDynamicSuggestions(): Promise<string[]> {
  if (typeof window === 'undefined') return Promise.resolve(suggestions)
  return fetch('/api/suggestions')
    .then((response) => (response.ok ? (response.json() as Promise<{ suggestions: string[] }>) : null))
    .then((data) => (data?.suggestions?.length ? data.suggestions : suggestions))
    .catch(() => suggestions)
}

function getDynamicSuggestionsPromise(): Promise<string[]> {
  dynamicSuggestionsPromise ??= loadDynamicSuggestions()
  return dynamicSuggestionsPromise
}

function SuggestionsListContent({
  suggestionItems,
  onSelect,
}: {
  suggestionItems: string[]
  onSelect: (suggestion: string, index: number) => void
}) {
  return (
    <Stack gap={6}>
      {suggestionItems.map((suggestion, suggestionIndex) => (
        <UnstyledButton
          key={suggestion}
          onClick={() => onSelect(suggestion, suggestionIndex)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e9ecef', backgroundColor: '#fff', transition: 'all 150ms ease', cursor: 'pointer' }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            const target = e.currentTarget
            target.style.borderColor = '#0c8599'
            target.style.backgroundColor = '#f0fdf9'
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            const target = e.currentTarget
            target.style.borderColor = '#e9ecef'
            target.style.backgroundColor = '#fff'
          }}
        >
          <Text size="xs" c="dark" style={{ lineHeight: 1.5 }}>{suggestion}</Text>
        </UnstyledButton>
      ))}
    </Stack>
  )
}

function DynamicSuggestionsList({
  onSelect,
}: {
  onSelect: (suggestion: string, index: number) => void
}) {
  const dynamicSuggestions = use(getDynamicSuggestionsPromise())
  return <SuggestionsListContent suggestionItems={dynamicSuggestions} onSelect={onSelect} />
}

function useAutoScrollToBottom({
  viewport,
  messages,
  pendingClarification,
  controllerHint,
  controllerLoading,
}: {
  viewport: React.RefObject<HTMLDivElement | null>
  messages: Message[]
  pendingClarification: PendingClarification | null
  controllerHint: ControllerApiResponse | null
  controllerLoading: boolean
}) {
  const scrollToBottom = useEffectEvent(() => {
    if (viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })
    }
  })

  useEffect(() => {
    scrollToBottom()
  }, [messages, pendingClarification, controllerHint, controllerLoading])
}

function useGeneratedSpecTrigger({
  chatStatus,
  messages,
  setControllerHint,
  genieFollowUpRef,
  attemptedSpecIdsRef,
  lastSpecCandidateIdRef,
  triggerSpec,
}: {
  chatStatus: string
  messages: Message[]
  setControllerHint: React.Dispatch<React.SetStateAction<ControllerApiResponse | null>>
  genieFollowUpRef: React.MutableRefObject<boolean>
  attemptedSpecIdsRef: React.MutableRefObject<Set<string>>
  lastSpecCandidateIdRef: React.MutableRefObject<string | null>
  triggerSpec: (messageId: string, promptText: string, genieResult: unknown) => void
}) {
  const syncGeneratedSpec = useEffectEvent(() => {
    setControllerHint((prev) => (prev?.decision !== 'error' ? null : prev))

    let latestAssistantMessage: Message | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role === 'assistant' && !message.loading && !message.periodPrompt &&
          (Boolean(message.content?.trim()) || Boolean(message.blocks?.length) || Boolean(message.attachments?.length))) {
        latestAssistantMessage = message
        break
      }
    }
    if (!latestAssistantMessage) return

    const hasGenieData = Boolean(latestAssistantMessage.blocks?.length || latestAssistantMessage.attachments?.length)
    if (!hasGenieData) {
      genieFollowUpRef.current = true
      return
    }
    genieFollowUpRef.current = false

    const messageId = String(latestAssistantMessage.id)
    if (attemptedSpecIdsRef.current.has(messageId)) return
    if (lastSpecCandidateIdRef.current === messageId) return

    lastSpecCandidateIdRef.current = messageId
    attemptedSpecIdsRef.current.add(messageId)

    if (latestAssistantMessage.attachments?.length) {
      triggerSpec(
        messageId,
        latestAssistantMessage.content || blocksToPlainText(latestAssistantMessage.blocks ?? []),
        buildGenieResultPayload(latestAssistantMessage),
      )
    }
  })

  useEffect(() => {
    if (chatStatus !== 'idle') return
    syncGeneratedSpec()
  }, [chatStatus, messages])
}

function useClarificationSpecSync({
  clarificationRetryCount,
  pendingClarification,
  triggerClarificationSpec,
  clearClarificationSpec,
}: {
  clarificationRetryCount: number
  pendingClarification: PendingClarification | null
  triggerClarificationSpec: (pendingClarification: PendingClarification) => void
  clearClarificationSpec: () => void
}) {
  const syncClarificationSpec = useEffectEvent(() => {
    if (pendingClarification) {
      triggerClarificationSpec(pendingClarification)
    } else {
      clearClarificationSpec()
    }
  })

  useEffect(() => {
    syncClarificationSpec()
  }, [clarificationRetryCount, pendingClarification])
}

export function AiChatDrawer({ opened, onClose, onSaveControl }: AiChatDrawerProps) {
  const { messages: genieMessages, status: chatStatus, error: genieError, sendMessage, reset } = useGenieChat({
    alias: "demo",
    basePath: '/api/chat-controller',
  })
  const [localUserMessages, setLocalUserMessages] = useState<Message[]>([])

  const [genieTimestamps] = useState(() => new Map<string, string>())
  const [genieEpochs] = useState(() => new Map<string, number>())
  const [enrichedToOriginal] = useState(() => new Map<string, string>())
  // Wall-clock time of the most recent user action.  Updated in event handlers
  // (impure context OK); read during render to assign epochs without calling Date.now().
  const lastActionTimeRef = useRef(0)
  const latestReasoningRef = useRef<string>('')
  // Dual-tracking: ref for stale-closure-free callbacks, state for rendering.
  // latestReasoningRef.current must NOT be read during render (react-hooks/refs).
  const [latestReasoning, setLatestReasoning] = useState<string>('')
  const genieFollowUpRef = useRef(false)
  const [sessionId] = useState<string>(() => crypto.randomUUID())
  const [conversationId] = useState<string>(() => crypto.randomUUID())
  const sessionIdRef = useRef(sessionId)
  const conversationIdRef = useRef(conversationId)

  const messages: Message[] = useMemo(() => {
    // Populate first-seen epochs/timestamps inline to avoid a separate useEffect
    // that runs after paint — which caused new Genie messages to sort at epoch=0
    // (top of the list) for one render before the effect corrected them.
    // Derive the base epoch from localUserMessages to avoid calling Date.now()
    // during render (react-hooks/purity).  The latest user-message epoch is a
    // close-enough wall time (set via Date.now() in event handlers).
    const baseEpoch = localUserMessages.reduce((max, m) => Math.max(max, m.epoch ?? 0), 0) || 1
    for (const gm of genieMessages) {
      const key = String(gm.id)
      if (!genieTimestamps.has(key)) {
        // For user messages echoed by Genie, reuse the original local message's epoch so
        // the initial user question always sorts before the QR-summary clarification bubble.
        let epoch = baseEpoch
        if (gm.role === 'user') {
          const originalContent = enrichedToOriginal.get(gm.content.trim()) ?? gm.content.trim()
          const localMatch = localUserMessages.find((lm) => lm.content.trim() === originalContent)
          if (localMatch?.epoch != null) epoch = localMatch.epoch
        } else {
          // Assistant messages sort after local messages that share the same baseEpoch
          // (e.g. the QR-summary bubble added in handleClarificationSubmit).
          epoch = baseEpoch + 1
        }
        genieTimestamps.set(key, new Date(epoch).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
        genieEpochs.set(key, epoch)
      }
    }

    // Dedup: derive the set of user-message contents confirmed by Genie so we
    // can exclude still-pending local echoes from the merged list, instead of
    // calling setState inside an effect (react-hooks/set-state-in-effect).
    const genieUserContents = new Set(
      genieMessages
        .filter((m) => m.role === 'user')
        .map((m) => {
          const original = enrichedToOriginal.get(m.content.trim())
          return original ?? m.content.trim()
        })
    )

    let lastGenieAssistantId: string | number | null = null
    if (chatStatus === 'idle') {
      for (let i = genieMessages.length - 1; i >= 0; i--) {
        const m = genieMessages[i]
        if (m.role === 'assistant' && Boolean((m as Message).content?.trim() || (m as Message).attachments?.length)) {
          lastGenieAssistantId = m.id
          break
        }
      }
    }

    // Loading placeholder: derived here instead of stored in localUserMessages
    // state via an effect, to avoid react-hooks/set-state-in-effect errors.
    const hasGenieResponse = genieMessages.some(m => m.role === 'assistant')
    const loadingPlaceholder: Message[] = chatStatus !== 'idle' && !hasGenieResponse
      ? [{ id: 'genie-streaming', role: 'assistant' as const, content: '', loading: true, epoch: Number.MAX_SAFE_INTEGER, timestamp: '' }]
      : []

    const merged: Message[] = [
      ...genieMessages.map((gm) => {
        const originalContent = gm.role === 'user' ? enrichedToOriginal.get(gm.content.trim()) : undefined
        const isThinking = gm.id === lastGenieAssistantId
        return {
          ...gm,
          content: originalContent ?? gm.content,
          timestamp: (gm as Message).timestamp ?? genieTimestamps.get(String(gm.id)),
          epoch: (gm as Message).epoch ?? genieEpochs.get(String(gm.id)),
          thinking: isThinking,
          reasoning: isThinking ? latestReasoning : undefined,
        }
      }),
      // Exclude local messages already echoed by Genie (dedup without setState in effect)
      ...localUserMessages.filter((local) => !genieUserContents.has(local.content.trim())),
      ...loadingPlaceholder,
    ]

    const filtered = merged.filter((msg) => {
      if (msg.type === 'controller') return false
      if (msg.role === 'user') return true
      return Boolean(msg.content?.trim()) || Boolean('blocks' in msg && msg.blocks?.length) ||
        Boolean(msg.attachments?.length) || Boolean('loading' in msg && msg.loading) ||
        Boolean('periodPrompt' in msg && msg.periodPrompt)
    })
    filtered.sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0))
    return filtered
  }, [genieMessages, localUserMessages, chatStatus, latestReasoning, enrichedToOriginal, genieEpochs, genieTimestamps])

  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [showTeamControls, setShowTeamControls] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)

  const specStreaming = useSpecStreaming()
  const {
    generatedSpecs, failedSpecIds, streamingSpecMessageId, isStreaming,
    lastSpecCandidateIdRef, attemptedSpecIdsRef,
    clarificationSpec, clarificationIsStreaming, clarificationError,
    triggerClarificationSpec, clearClarificationSpec,
  } = specStreaming

  const messagesRef = useRef(messages)
  useLayoutEffect(() => { messagesRef.current = messages }, [messages])

  const controller = useControllerState({
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
  })

  const saveDialog = useSaveDialog(onSaveControl)
  const { lastSuggestionIndexRef } = saveDialog

  useAutoScrollToBottom({
    viewport,
    messages,
    pendingClarification: controller.pendingClarification,
    controllerHint: controller.ControllerHint,
    controllerLoading: controller.ControllerLoading,
  })

  useGeneratedSpecTrigger({
    chatStatus,
    messages,
    setControllerHint: controller.setControllerHint,
    genieFollowUpRef,
    attemptedSpecIdsRef,
    lastSpecCandidateIdRef,
    triggerSpec: specStreaming.triggerSpec,
  })

  useClarificationSpecSync({
    clarificationRetryCount: controller.clarificationRetryCount,
    pendingClarification: controller.pendingClarification,
    triggerClarificationSpec,
    clearClarificationSpec,
  })

  const handlePeriodConfirm = (periodLabel: string) => {
    lastActionTimeRef.current = Date.now()
    void controller.submitPromptThroughController(`Période confirmée : ${periodLabel}`)
  }

  const handleSend = useCallback((text?: string) => {
    const msgText = text || input.trim()
    if (!msgText) return
    lastActionTimeRef.current = Date.now()

    if (genieFollowUpRef.current) {
      genieFollowUpRef.current = false
      setInput('')
      setShowSuggestions(false)
      controller.setControllerHint(null)
      controller.setPendingClarification(null)
      const now = lastActionTimeRef.current
      setLocalUserMessages((prev) => [...prev, {
        id: `local-${now}`, role: 'user' as const, content: msgText,
        timestamp: new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        epoch: now,
      }])
      sendMessage(msgText)
      return
    }
    void controller.submitPromptThroughController(msgText)
  }, [input, sendMessage, controller, setLocalUserMessages])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleClear = useCallback(() => {
    reset()
    specStreaming.clearSpecs()
    setLocalUserMessages([])
    enrichedToOriginal.clear()
    genieTimestamps.clear()
    genieEpochs.clear()
    genieFollowUpRef.current = false
    latestReasoningRef.current = ''
    setLatestReasoning('')
    lastSuggestionIndexRef.current = -1
    setShowSuggestions(true)
    controller.resetControllerState()
  }, [reset, specStreaming, setLocalUserMessages, controller, lastSuggestionIndexRef, enrichedToOriginal, genieTimestamps, genieEpochs])

  const handleClarificationSubmit = useCallback((answers: Record<string, string>) => {
    const { pendingClarification } = controller
    if (!pendingClarification) return
    lastActionTimeRef.current = Date.now()

    const questionLines = pendingClarification.questions
      .map((q) => { const v = answers[q.id]?.trim(); return v ? `- ${q.label}: ${v}` : null })
      .filter((v): v is string => Boolean(v))

    const basePrompt = pendingClarification.rewrittenPrompt?.trim() || pendingClarification.originalPrompt
    const clarifiedPrompt = questionLines.length > 0 ? `${basePrompt}\nClarifications:\n${questionLines.join('\n')}` : basePrompt
    const qrSummary = formatQRAnswers(pendingClarification.questions, answers)

    controller.setPendingClarification(null)

    const addQrBubble = (text: string) => {
      const now = lastActionTimeRef.current
      enrichedToOriginal.set(text.trim(), pendingClarification.originalPrompt)
      setLocalUserMessages((prev) => [...prev, {
        id: `qr-${now}`, role: 'user' as const, content: text,
        timestamp: new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        epoch: now,
      }])
    }

    if (pendingClarification.canSendDirectly) {
      // Use clarifiedPrompt directly — it already includes clarification lines when present.
      // Do NOT re-append questionLines (that would duplicate them).
      const promptToSend = clarifiedPrompt
      enrichedToOriginal.set(promptToSend.trim(), pendingClarification.originalPrompt)
      if (qrSummary) addQrBubble(qrSummary)
      sendMessage(promptToSend)
    } else {
      enrichedToOriginal.set(clarifiedPrompt.trim(), pendingClarification.originalPrompt)
      if (qrSummary) addQrBubble(qrSummary)
      void controller.submitPromptThroughController(clarifiedPrompt, { suppressControllerBubble: true })
    }
  }, [controller, sendMessage, setLocalUserMessages, enrichedToOriginal])

  const handleSpecSubmit = useCallback((specState: Record<string, unknown>) => {
    const params = Object.entries(specState)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k} = ${String(v)}`)
      .join(', ')
    const prompt = params
      ? `Relance l'analyse avec ces paramètres : ${params}`
      : `Relance l'analyse`
    // Route through the controller so a fresh approval token is issued before
    // sending to Genie — calling sendMessage() directly would 403 (single-use token
    // was already consumed by the original proceed → sendMessage call).
    void controller.submitPromptThroughController(prompt)
  }, [controller])

  const handlePublishTeamControls = useCallback((controls: TeamControl[]) => {
    if (onSaveControl) {
      controls.forEach((tc) => onSaveControl({ id: `team-${tc.id}-${Date.now()}`, name: tc.name, description: tc.description, results: tc.results, rubriqueId: tc.rubriqueId }))
    }
  }, [onSaveControl])

  const getCopyText = (msg: Message): string => {
    let text = msg.content || ''
    if (msg.blocks && msg.blocks.length > 0) text += (text ? '\n' : '') + blocksToPlainText(msg.blocks)
    return text.trim()
  }

  return (
    <>
    <Drawer
      opened={opened} onClose={onClose} position="right" size={560}
      withCloseButton={false} padding={0} lockScroll={false} withOverlay={false} shadow="xl"
      styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column' }, content: { display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {showTeamControls ? (
        <TeamControlsPanel teamControls={[]} onBack={() => setShowTeamControls(false)} onPublish={handlePublishTeamControls} />
      ) : (
      <>
      {/* Header */}
      <Box px="md" py="sm" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}>
        <Group justify="space-between">
          <Group gap="xs">
            <ThemeIcon size="sm" radius="sm" style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
              <IconSparkles size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>Assistant</Text>
          </Group>
          <Group gap={4}>
            <Tooltip label={"Contrôles de l'équipe"} position="bottom" withArrow>
              <ActionIcon variant="subtle" color="teal" size="sm" onClick={() => setShowTeamControls(true)} aria-label={"Contrôles de l'équipe"}>
                <IconListDetails size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Effacer la conversation" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClear} aria-label="Effacer la conversation"><IconTrash size={15} /></ActionIcon>
            </Tooltip>
            <Tooltip label="Agrandir" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Agrandir"><IconArrowsMaximize size={15} /></ActionIcon>
            </Tooltip>
            <Tooltip label="Fermer" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose} aria-label="Fermer"><IconX size={15} /></ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      {/* Messages area */}
      <ScrollArea style={{ flex: 1 }} viewportRef={viewport}>
        <Box px="md" py="sm">
          {showSuggestions && messages.length === 0 && (
            <Stack gap="md">
              <Paper p="md" radius="md" style={{ backgroundColor: '#f0fdf9', border: '1px solid #c3fae8' }}>
                <Group gap="xs" mb="xs">
                  <IconBulb size={16} color="#0c8599" />
                  <Text size="sm" fw={600} c="#0c8599">Assistant IA de génération de contrôles</Text>
                </Group>
                <Text size="xs" style={{ lineHeight: 1.6 }} c="dark">
                  Cet assistant vous permet de <b>générer de nouveaux contrôles personnalisés en langage naturel</b>. Décrivez simplement le type de vérification que vous souhaitez effectuer et l{"'"}assistant analysera vos données pour produire des résultats détaillés.
                </Text>
                <Divider my="xs" color="#c3fae8" />
                <Text size="xs" fw={600} mb={4} c="dark">Bonnes pratiques :</Text>
                <List size="xs" spacing={2} withPadding>
                  <List.Item><Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>Soyez précis dans votre description (périmètre comptable, seuils, période)</Text></List.Item>
                  <List.Item><Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>Utilisez le vocabulaire comptable pour de meilleurs résultats</Text></List.Item>
                  <List.Item><Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>Posez des questions de suivi pour affiner l{"'"}analyse</Text></List.Item>
                  <List.Item><Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>Les résultats incluent textes, tableaux et graphiques interactifs</Text></List.Item>
                </List>
              </Paper>
              <Box>
                <Text size="xs" fw={600} c="dimmed" mb="xs">{'Exemples de questions d\'analyse et de contrôle'}</Text>
                <Suspense fallback={<SuggestionsListContent suggestionItems={suggestions} onSelect={(suggestion, suggestionIndex) => { lastSuggestionIndexRef.current = suggestionIndex; handleSend(suggestion) }} />}>
                  <DynamicSuggestionsList onSelect={(suggestion, suggestionIndex) => { lastSuggestionIndexRef.current = suggestionIndex; handleSend(suggestion) }} />
                </Suspense>
              </Box>
            </Stack>
          )}

          <Stack gap="md" mt={showSuggestions && messages.length === 0 ? 0 : undefined}>
            {messages.map((msg) => (
              <Box key={msg.id}>
                {msg.role === 'user' ? (
                  <Box>
                    <Paper p="sm" radius="md" ml={40} style={{ backgroundColor: '#1a1b25', color: '#fff' }}>
                      <Text size="sm" c="white" style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
                    </Paper>
                    <Text size="xs" c="dimmed" mt={4} ta="right" mr={4}>{msg.timestamp}</Text>
                  </Box>
                ) : (
                  <Group align="flex-start" gap="xs" wrap="nowrap">
                    <ThemeIcon size="sm" radius="xl" mt={2} style={{ flexShrink: 0, background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
                      <IconSparkles size={12} color="#fff" />
                    </ThemeIcon>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      {msg.loading && (
                        <Stack gap={7} py={2}>
                          <Skeleton height={10} radius="sm" width="72%" />
                          <Skeleton height={10} radius="sm" width="88%" />
                          <Skeleton height={10} radius="sm" width="55%" />
                        </Stack>
                      )}

                      {msg.periodPrompt && !msg.loading && (
                        <PeriodPickerPanel
                          message={msg.content}
                          options={(() => {
                            const opts = msg.periodOptions ?? []
                            return opts.some((o: { value: string }) => o.value === 'folder_period')
                              ? opts
                              : [...opts, FOLDER_PERIOD_OPTION]
                          })()}
                          onConfirm={handlePeriodConfirm}
                        />
                      )}

                      {msg.thinking && !msg.loading && (
                        <Accordion defaultValue="thinking" variant="subtle" styles={{ item: { borderBottom: 'none' }, control: { padding: '2px 0', minHeight: 24 }, label: { fontSize: 11, color: '#868e96' }, chevron: { width: 14, height: 14 }, content: { padding: 0 } }}>
                          <Accordion.Item value="thinking">
                            <Accordion.Control chevron={<IconChevronDown size={12} />}>Analyse Genie terminée</Accordion.Control>
                            <Accordion.Panel>
                              {msg.reasoning ? (
                                <Text size="xs" c="dimmed" fs="italic" style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.reasoning}</Text>
                              ) : (
                                <Text size="xs" c="dimmed" fs="italic" style={{ lineHeight: 1.55 }}>{msg.content || 'Analyse des données terminée.'}</Text>
                              )}
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}

                      {streamingSpecMessageId === String(msg.id) && isStreaming && (
                        <Stack gap={8} mt="xs" mb={4}>
                          <Skeleton height={10} radius="sm" width="45%" />
                          <Skeleton height={160} radius="md" />
                          <Group gap={8}>
                            <Skeleton height={8} radius="sm" width="18%" />
                            <Skeleton height={8} radius="sm" width="18%" />
                            <Skeleton height={8} radius="sm" width="18%" />
                          </Group>
                        </Stack>
                      )}

                      {!msg.periodPrompt && !msg.loading && (() => {
                        const msgId = String(msg.id)
                        // Only use the finalized spec from onComplete — never the live uiStream.spec.
                        // The hook guarantees a valid spec on success; errors are tracked in failedSpecIds.
                        const resolvedSpec = generatedSpecs[msgId]
                        const isActivelyStreaming = streamingSpecMessageId === msgId && isStreaming
                        const hasSpecFailed = failedSpecIds.has(msgId)

                        // Suppress the Paper for thinking messages while streaming:
                        // the two-step loader above already handles UX; rendering an
                        // empty Paper here would produce a blank bordered box.
                        if (isActivelyStreaming && msg.thinking && !msg.blocks?.length) return null

                        return (
                          !msg.thinking || Boolean(msg.blocks?.length) ||
                          (msg.attachments?.some((a: GenieAttachmentResponse) => Boolean(a.attachmentId)) && Boolean(msg.queryResults?.size)) ||
                          Boolean(resolvedSpec) ||
                          hasSpecFailed
                        ) && (
                          <Paper mt="xs" p="sm" radius="md" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderLeft: '3px solid #0c8599' }}>
                            <MessageContent msg={msg} messageId={msgId} generatedSpec={resolvedSpec} registry={chatUiRegistry} hideText={Boolean(msg.thinking)} isSpecStreaming={isStreaming} onSpecSubmit={handleSpecSubmit} />
                          </Paper>
                        )
                      })()}

                      {!msg.loading && (
                        <Group justify="space-between" mt={4} ml={4}>
                          <Text size="xs" c="dimmed">{msg.timestamp}</Text>
                          <Group gap={4}>
                            {(msg.content || (msg.blocks && msg.blocks.length > 0)) && !msg.periodPrompt && (
                              <CopyButton text={getCopyText(msg)} />
                            )}
                            {(generatedSpecs[String(msg.id)] || (msg.blocks && msg.blocks.length > 0)) && (
                              <Tooltip label="Enregistrer comme contrôle" position="top" withArrow>
                                <ActionIcon variant="subtle" color="teal" size="xs" onClick={() => saveDialog.handleOpenSave(msg)} aria-label="Enregistrer comme contrôle">
                                  <IconDeviceFloppy size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Group>
                      )}
                    </Box>
                  </Group>
                )}
              </Box>
            ))}
          </Stack>

          {controller.ControllerLoading && (
            <Group align="flex-start" gap="xs" wrap="nowrap" mt="md" mb="md">
              <ThemeIcon size="sm" radius="xl" mt={2} style={{ flexShrink: 0, background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
                <IconSparkles size={12} color="#fff" />
              </ThemeIcon>
              <Paper p="sm" radius="md" style={{ flex: 1, backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderLeft: '3px solid #0c8599' }}>
                <Stack gap={7}>
                  <Skeleton height={10} radius="sm" width="62%" />
                  <Skeleton height={10} radius="sm" width="80%" />
                  <Skeleton height={10} radius="sm" width="42%" />
                </Stack>
              </Paper>
            </Group>
          )}

          {genieError && !controller.ControllerLoading && (
            <Alert variant="light" color="red" radius="md" mt="md" mb="md" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm" fw={600}>{"Requête refusée par l'agent IA"}</Text>
              <Text size="xs" mt={4} style={{ lineHeight: 1.55 }}>{typeof genieError === 'string' ? genieError : String(genieError)}</Text>
            </Alert>
          )}

          {controller.pendingClarification && !controller.ControllerLoading && (
            <Group align="flex-start" gap="xs" wrap="nowrap" mt="md" mb="md">
              <ThemeIcon size="sm" radius="xl" mt={2} style={{ flexShrink: 0, background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
                <IconSparkles size={12} color="#fff" />
              </ThemeIcon>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <ClarificationPanel
                  key={controller.clarificationRetryCount}
                  pendingClarification={controller.pendingClarification}
                  spec={clarificationSpec}
                  isStreaming={clarificationIsStreaming}
                  hasStreamError={clarificationError}
                  onSubmit={handleClarificationSubmit}
                />
              </Box>
            </Group>
          )}

          {controller.ControllerHint && !controller.pendingClarification && !controller.ControllerLoading && (
            <Paper p="sm" radius="md" mt="md" mb="md" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}>
              <Group gap="xs" align="flex-start">
                <IconRobot size={16} color="#0c8599" />
                <Box style={{ flex: 1 }}>
                  <Text size="xs" fw={600}>Pré-analyse par un agent IA</Text>
                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>{controller.ControllerHint.message}</Text>
                  <Group gap={6} mt={6}>
                    <Badge size="xs" variant="light" color={
                      controller.ControllerHint.decision === 'error' ? 'red' :
                      controller.ControllerHint.decision === 'clarify' ? 'orange' :
                      controller.ControllerHint.decision === 'guide' ? 'blue' : 'teal'
                    }>
                      {({ clarify: 'Précision requise', guide: 'À affiner', proceed: 'Approuvé', error: 'Erreur' } as Record<string, string>)[controller.ControllerHint.decision] ?? controller.ControllerHint.decision}
                    </Badge>
                    {typeof controller.ControllerHint.confidence === 'number' && (
                      <Badge size="xs" variant="outline" color="gray">{`Confiance ${Math.round(controller.ControllerHint.confidence * 100)}%`}</Badge>
                    )}
                  </Group>
                  {controller.ControllerHint.decision === 'error' && (
                    <Box mt="xs">
                      <UnstyledButton onClick={() => controller.setControllerHint(null)} style={{ fontSize: 12, color: '#c92a2a', textDecoration: 'underline', cursor: 'pointer' }}>
                        Fermer et réessayer
                      </UnstyledButton>
                    </Box>
                  )}
                </Box>
              </Group>
            </Paper>
          )}

          {chatStatus === 'streaming' && !controller.ControllerLoading && (
            <Box mt="md" px={4}>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <ThemeIcon size="sm" radius="xl" mt={2} style={{ flexShrink: 0, background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
                  <IconSparkles size={12} color="#fff" />
                </ThemeIcon>
                <Paper p="sm" radius="md" style={{ backgroundColor: '#f8f9fa', flex: 1 }}>
                  <Stack gap={7}>
                    <Skeleton height={10} radius="sm" width="70%" />
                    <Skeleton height={10} radius="sm" width="50%" />
                  </Stack>
                </Paper>
              </Group>
            </Box>
          )}
        </Box>
      </ScrollArea>

      {/* Input */}
      <Box px="md" py="sm" style={{ borderTop: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Décrivez le contrôle à générer..."
            size="sm" radius="md" value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            style={{ flex: 1 }}
            styles={{ input: { borderColor: '#dee2e6' } }}
          />
          <ActionIcon
            size="lg" radius="md" onClick={() => handleSend()}
            disabled={!input.trim() || chatStatus === 'streaming' || controller.ControllerLoading}
            aria-label="Envoyer"
            style={{
              background: input.trim() && chatStatus !== 'streaming' && !controller.ControllerLoading
                ? 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' : '#e9ecef',
              border: 'none',
              color: input.trim() && chatStatus !== 'streaming' && !controller.ControllerLoading ? '#fff' : '#adb5bd',
            }}
          >
            <IconSend size={16} />
          </ActionIcon>
        </Group>
        <Text ta="center" size="xs" c="dimmed" mt={6}>{'Vérifiez toujours l\'exactitude des réponses.'}</Text>
      </Box>
      </>
      )}
    </Drawer>

    <SaveControlModal
      opened={saveDialog.saveModalOpened}
      onClose={saveDialog.closeModal}
      saveForm={saveDialog.saveForm}
      setSaveForm={saveDialog.setSaveForm}
      aiSuggestedRubrique={saveDialog.aiSuggestedRubrique}
      rubriqueAlert={saveDialog.rubriqueAlert}
      setRubriqueAlert={saveDialog.setRubriqueAlert}
      saved={saveDialog.saved}
      applyToGroup={saveDialog.applyToGroup}
      setApplyToGroup={saveDialog.setApplyToGroup}
      dossierUsers={[]}
      userRights={saveDialog.userRights}
      setUserRights={saveDialog.setUserRights}
      onSubmit={saveDialog.handleSaveSubmit}
    />
    </>
  )
}
