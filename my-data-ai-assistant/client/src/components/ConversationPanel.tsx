import { useEffect, useRef, useState } from 'react'
import {
  Stack, Group, Box, Text, Textarea, ActionIcon, ScrollArea, ThemeIcon, UnstyledButton,
  Paper, Alert, Table, Badge, Tooltip, Button, TextInput, Divider,
} from '@mantine/core'
import {
  IconSparkles, IconSend, IconBulb, IconFolder, IconX, IconArrowRight, IconRefresh, IconCheck,
} from '@tabler/icons-react'
import type { Product } from '../../../shared/products'
import { PRODUCT_LABELS } from '../../../shared/products'
import type { AssistantMessage, SelectedFolder } from '../hooks/useProductAssistant'
import type { FolderRow } from '../data/folder-examples'

type ControllerInfo = {
  decision: string
  confidence: number
  wasRewritten: boolean
} | null

type Props = {
  product: Product
  messages: AssistantMessage[]
  busy: boolean
  statusText: string
  reasoningText: string
  controllerInfo: ControllerInfo
  suggestions: string[]
  selectedFolder: SelectedFolder | null
  availableFolders: FolderRow[]
  onSelectFolder: (folder: SelectedFolder) => void
  onClearFolder: () => void
  onSend: (q: string) => void
  onReload: () => void
  activeSpecId: string | null
  onShowSpec: (id: string) => void
}

export function ConversationPanel({
  product,
  messages,
  busy,
  statusText,
  reasoningText,
  controllerInfo,
  suggestions,
  selectedFolder,
  availableFolders,
  onSelectFolder,
  onClearFolder,
  onSend,
  onReload,
  activeSpecId,
  onShowSpec,
}: Props) {
  const accent = product === 'closing' ? 'closingPink' : 'teal'
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, reasoningText])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || busy || !selectedFolder) return
    onSend(trimmed)
    setText('')
  }

  return (
    <Stack
      gap={0}
      style={{
        width: 520,
        minWidth: 520,
        borderRight: '1px solid var(--mantine-color-gray-2)',
        background: '#fff',
      }}
    >
      {/* Header */}
      <Group p="md" gap="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <ThemeIcon variant="light" color={accent} size="lg" radius="md">
          <IconSparkles size={18} />
        </ThemeIcon>
        <Stack gap={0} style={{ flex: 1 }}>
          <Text fw={600}>Assistant {PRODUCT_LABELS[product]}</Text>
          <Text size="xs" c="dimmed">
            {product === 'closing'
              ? 'Génération de contrôles pour une révision comptable en continue'
              : 'Génération de contrôles pour l\'analyse et l\'investigation comptable'}
          </Text>
        </Stack>
      </Group>

      {/* Selected folder badge */}
      {selectedFolder && (
        <Group
          px="md"
          py={6}
          gap="xs"
          style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', background: 'var(--mantine-color-gray-0)' }}
        >
          <IconFolder size={13} color={`var(--mantine-color-${accent}-5)`} />
          <Text size="xs" fw={600} c={`${accent}.6`} ff="monospace">
            {selectedFolder.spFolderId}
          </Text>
          <Badge variant="dot" color={accent} size="xs">
            {selectedFolder.sessionId}
          </Badge>
          <Tooltip label="Changer de dossier" withArrow position="right">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              ml="auto"
              onClick={onClearFolder}
              aria-label="Changer de dossier"
            >
              <IconX size={12} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}

      {/* Main scrollable area */}
      <ScrollArea viewportRef={scrollRef} style={{ flex: 1 }} p="md">
        {!selectedFolder ? (
          <FolderPicker
            product={product}
            accent={accent}
            folders={availableFolders}
            onSelect={onSelectFolder}
          />
        ) : messages.length === 0 ? (
          <EmptyState product={product} suggestions={suggestions} onPick={(q) => onSend(q)} />
        ) : (
          <Stack gap="md">
            {messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                accent={accent}
                busy={busy}
                onReload={m.role === 'agent' ? onReload : undefined}
                onShowSpec={m.specId ? () => onShowSpec(m.specId as string) : undefined}
                isActiveSpec={!!m.specId && m.specId === activeSpecId}
              />
            ))}
            {busy && (
              <Stack gap={6}>
                <Group gap={6} align="center">
                  <IconSparkles size={14} />
                  <Text size="sm" c="dimmed" fw={500} style={{ flex: 1 }}>
                    {statusText || "L'agent analyse vos données…"}
                  </Text>
                </Group>
                {controllerInfo && (
                  <Group gap={6} pl={20}>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        controllerInfo.decision === 'proceed' ? 'green'
                        : controllerInfo.decision === 'guide' ? 'orange'
                        : controllerInfo.decision === 'clarify' ? 'yellow'
                        : 'red'
                      }
                    >
                      {controllerInfo.decision === 'proceed' ? 'Analyse lancée'
                        : controllerInfo.decision === 'guide' ? 'Guidé'
                        : controllerInfo.decision === 'clarify' ? 'Clarification requise'
                        : 'Erreur'}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      Confiance&nbsp;{Math.round(controllerInfo.confidence * 100)}%
                    </Text>
                    {controllerInfo.wasRewritten && (
                      <Text size="xs" c="dimmed" fs="italic">· Requête optimisée</Text>
                    )}
                  </Group>
                )}
                {reasoningText && (
                  <Paper
                    p="xs"
                    radius="md"
                    style={{
                      background: 'var(--mantine-color-gray-0)',
                      border: '1px solid var(--mantine-color-gray-2)',
                    }}
                  >
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {reasoningText}
                    </Text>
                  </Paper>
                )}
              </Stack>
            )}
          </Stack>
        )}
      </ScrollArea>

      {/* Input */}
      <Box
        p="md"
        style={{
          borderTop: '1px solid var(--mantine-color-gray-2)',
          background: 'var(--mantine-color-gray-0)',
        }}
      >
        <Box style={{ position: 'relative' }}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder={
              !selectedFolder
                ? 'Sélectionnez un dossier ci-dessus pour commencer…'
                : product === 'closing'
                ? 'Décrivez le contrôle à exécuter…'
                : 'Posez une question géo-comptable…'
            }
            minRows={2}
            autosize
            disabled={busy || !selectedFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <ActionIcon
            color={accent}
            size="lg"
            onClick={submit}
            disabled={!text.trim() || busy || !selectedFolder}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
            aria-label="Envoyer"
          >
            <IconSend size={16} />
          </ActionIcon>
        </Box>
        <Text ta="center" size="xs" c="dimmed" mt={8}>
          Vérifiez toujours l&apos;exactitude des réponses
        </Text>
      </Box>
    </Stack>
  )
}

function FolderPicker({
  product,
  accent,
  folders,
  onSelect,
}: {
  product: Product
  accent: 'teal' | 'closingPink'
  folders: FolderRow[]
  onSelect: (folder: SelectedFolder) => void
}) {
  const [folderId, setFolderId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const canConfirm = folderId.trim() !== '' && sessionId.trim() !== ''

  const fillFromShortcut = (row: FolderRow) => {
    setFolderId(row.spFolderId)
    setSessionId(row.sessionId)
  }

  return (
    <Stack gap="md">
      <Alert
        variant="light"
        color={accent}
        radius="md"
        icon={<IconFolder size={18} />}
        title="Configurer le dossier"
      >
        <Text size="sm">
          Renseignez l&apos;identifiant du dossier et la session à analyser.
          Les deux champs sont obligatoires.
        </Text>
      </Alert>

      {/* Mandatory inputs */}
      <Stack gap="sm">
        <TextInput
          label="sp_folder_id"
          placeholder={product === 'closing' ? 'ex: _sj5lh47d_s5' : 'ex: 3kmctw701a4k'}
          value={folderId}
          onChange={(e) => setFolderId(e.currentTarget.value)}
          required
          size="xs"
          styles={{ input: { fontFamily: 'monospace' } }}
        />
        <TextInput
          label="session"
          placeholder={product === 'closing' ? 'ex: _sj5lh47d_s5.001.001' : 'ex: 3kmctw701a4k.001.001'}
          value={sessionId}
          onChange={(e) => setSessionId(e.currentTarget.value)}
          required
          size="xs"
          styles={{ input: { fontFamily: 'monospace' } }}
        />
        <Button
          color={accent}
          fullWidth
          size="xs"
          disabled={!canConfirm}
          leftSection={<IconCheck size={13} />}
          onClick={() => onSelect({ spFolderId: folderId.trim(), sessionId: sessionId.trim() })}
        >
          Confirmer le dossier
        </Button>
      </Stack>

      {/* Quick-select shortcuts */}
      {folders.length > 0 && (
        <>
          <Divider
            label={<Text size="xs" c="dimmed">Raccourcis — cliquer pour remplir</Text>}
            labelPosition="left"
          />
          <Table
            horizontalSpacing="sm"
            verticalSpacing="xs"
            fz="xs"
            style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--mantine-color-gray-2)' }}
          >
            <Table.Thead style={{ background: 'var(--mantine-color-gray-0)' }}>
              <Table.Tr>
                <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
                  sp_folder_id
                </Table.Th>
                <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
                  session
                </Table.Th>
                <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
                  description
                </Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {folders.map((row) => (
                <Table.Tr
                  key={`${row.spFolderId}-${row.sessionId}`}
                  onClick={() => fillFromShortcut(row)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>
                    <Text size="xs" ff="monospace" c={`${accent}.6`} fw={500}>
                      {row.spFolderId}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="dot" color={accent} size="xs">
                      {row.sessionId}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lh={1.4}>
                      {row.description}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <IconArrowRight size={12} color="var(--mantine-color-gray-4)" />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  )
}

const BEST_PRACTICES: Record<Product, string[]> = {
  closing: [
    'Soyez précis dans votre description (périmètre comptable, seuils, période)',
    'Utilisez le vocabulaire comptable pour de meilleurs résultats',
    'Posez des questions de suivi pour affiner l\'analyse',
    'Les résultats incluent textes, tableaux et graphiques interactifs',
  ],
  geo: [
    'Soyez précis dans votre description (périmètre comptable, seuils, période)',
    'Utilisez le vocabulaire comptable pour de meilleurs résultats',
    'Posez des questions de suivi pour affiner l\'analyse',
    'Les résultats incluent textes, tableaux et graphiques interactifs',
  ],
}

function EmptyState({
  product,
  suggestions,
  onPick,
}: {
  product: Product
  suggestions: string[]
  onPick: (q: string) => void
}) {
  const accent = product === 'closing' ? 'closingPink' : 'teal'

  return (
    <>
      <Alert
        variant="light"
        color={accent}
        radius="md"
        icon={<IconBulb size={18} />}
        title={`Atelier IA · ${PRODUCT_LABELS[product]}`}
        mb="md"
      >
        <Stack gap="xs">
          <Text size="sm">
            {product === 'closing'
              ? "Décrivez en langage naturel un contrôle à exécuter sur vos données comptables. L'agent IA produit un rapport structuré (synthèse, tableau, graphique, sources)."
              : "Cet assistant vous permet de générer de nouveaux contrôles personnalisés en langage naturel. Décrivez simplement le type de vérification que vous souhaitez effectuer et l'assistant analysera vos données pour produire des résultats détaillés."}
          </Text>
          <Text size="sm" fw={600} c={`${accent}.7`} mt={4}>Bonnes pratiques</Text>
          <Stack gap={4}>
            {BEST_PRACTICES[product].map((tip) => (
              <Group key={tip} gap={6} align="flex-start" wrap="nowrap">
                <Text size="sm" c={`${accent}.5`} style={{ flexShrink: 0, lineHeight: 1.6 }}>·</Text>
                <Text size="sm" c="dimmed" lh={1.6}>{tip}</Text>
              </Group>
            ))}
          </Stack>
        </Stack>
      </Alert>
      {suggestions.length > 0 && (
        <>
          <Text size="xs" tt="uppercase" c="dimmed" mb={8}>Exemples de questions</Text>
          <Stack gap={8}>
            {suggestions.map((s) => (
              <UnstyledButton
                key={s}
                onClick={() => onPick(s)}
                p="sm"
                style={{
                  border: '1px solid var(--mantine-color-gray-3)',
                  borderRadius: 6,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {s}
              </UnstyledButton>
            ))}
          </Stack>
        </>
      )}
    </>
  )
}

function QRSummaryCard({ pairs }: { pairs: { label: string; answer: string }[] }) {
  return (
    <Stack gap={6}>
      {pairs.map((p) => (
        <Box key={p.label}>
          <Text size="xs" c="dimmed" lh={1.4}>{p.label}</Text>
          <Text size="sm" fw={500} lh={1.5}>{p.answer}</Text>
        </Box>
      ))}
    </Stack>
  )
}

function Message({
  m,
  accent,
  onReload,
  onShowSpec,
  isActiveSpec,
  busy,
}: {
  m: AssistantMessage
  accent: 'teal' | 'closingPink'
  onReload?: () => void
  onShowSpec?: () => void
  isActiveSpec?: boolean
  busy: boolean
}) {
  type _Meta = { pairs: { label: string; answer: string }[] }
  const qrMeta = (m as unknown as { metadata?: _Meta }).metadata ?? null

  if (m.role === 'user') {
    return (
      <Box maw="85%">
        <Paper
          p="xs"
          px="sm"
          radius="md"
          withBorder={false}
          style={{ background: 'var(--mantine-color-gray-1)' }}
        >
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</Text>
        </Paper>
      </Box>
    )
  }
  return (
    <Stack gap={6}>
      <Box maw="85%">
        <Group gap={6} justify="space-between" mb={4}>
          <Group gap={6}>
            <IconSparkles size={14} />
            <Text size="xs" c="dimmed">Agent · {m.timestamp}</Text>
          </Group>
          {onReload && (
            <Tooltip label="Relancer l'analyse" withArrow position="left">
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                disabled={busy}
                onClick={onReload}
                aria-label="Relancer l'analyse"
              >
                <IconRefresh size={12} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
        <Paper
          p="xs"
          px="sm"
          radius="md"
          withBorder={false}
          style={{ background: 'var(--mantine-color-gray-1)' }}
        >
          {qrMeta ? (
            <QRSummaryCard pairs={qrMeta.pairs} />
          ) : (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</Text>
          )}
          {onShowSpec && (
            <Button
              size="compact-xs"
              variant={isActiveSpec ? 'filled' : 'light'}
              color={accent}
              leftSection={<IconArrowRight size={11} />}
              onClick={onShowSpec}
              style={{ alignSelf: 'flex-start', marginTop: 6 }}
            >
              Afficher les résultats
            </Button>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}
