import { Component, type ReactNode } from 'react'
import {
  Stack, Box, Title, Text, Skeleton, ThemeIcon, Group, Badge, Button, ActionIcon, Tooltip, Paper,
} from '@mantine/core'
import {
  IconChartBar, IconRefresh, IconDownload, IconAlertTriangle, IconTrash,
} from '@tabler/icons-react'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { chatUiRegistry } from '../registry/chat-ui-registry'
import type { GenericUiSpec } from '../types/chat'
import type { Product } from '../../../shared/products'
import { specIsValid } from '../lib/genie-utils'

const EMPTY_STATE: Record<string, unknown> = {}

type Props = {
  product: Product
  spec: GenericUiSpec | null
  isStreaming: boolean
  hasError: boolean
  lastQuery: string | null
  onReset: () => void
  onReload: () => void
}

export function OutputCanvas({ product, spec, isStreaming, hasError, lastQuery, onReset, onReload }: Props) {
  const accent = product === 'closing' ? 'closingPink' : 'teal'
  const showLoading = isStreaming && !specIsValid(spec)
  const showLoaded = specIsValid(spec)

  return (
    <Box style={{ flex: 1, minWidth: 0, background: 'var(--mantine-color-gray-0)', overflow: 'auto' }}>
      {hasError && !showLoaded ? (
        <ErrorState product={product} onRetry={onReset} onReload={onReload} />
      ) : showLoading ? (
        <LoadingState />
      ) : showLoaded && spec ? (
        <LoadedState
          product={product}
          spec={spec}
          lastQuery={lastQuery}
          isStreaming={isStreaming}
          onReset={onReset}
          onReload={onReload}
        />
      ) : (
        <EmptyState accent={accent} />
      )}
    </Box>
  )
}

function EmptyState({ accent }: { accent: 'teal' | 'closingPink' }) {
  return (
    <Stack align="center" justify="center" h="100%" mih="100%" p="xl" ta="center" gap="md">
      <ThemeIcon size={64} radius="md" variant="light" color={accent}>
        <IconChartBar size={32} />
      </ThemeIcon>
      <Title order={2}>Aucune analyse générée</Title>
      <Text c="dimmed" maw={400}>
        Posez une question dans le panneau de gauche. Le résultat structuré (synthèse, tableau,
        graphique, sources) apparaîtra ici, généré par l&apos;agent IA.
      </Text>
    </Stack>
  )
}

function LoadingState() {
  return (
    <Stack p="xl" gap="lg">
      <Skeleton height={28} width={260} />
      <Stack gap={10}>
        <Skeleton height={12} />
        <Skeleton height={12} width="92%" />
        <Skeleton height={12} width="78%" />
      </Stack>
      <Skeleton height={220} radius="md" />
      <Skeleton height={180} radius="md" />
    </Stack>
  )
}

function ErrorState({ product, onRetry, onReload }: { product: Product; onRetry: () => void; onReload: () => void }) {
  return (
    <Stack align="center" justify="center" h="100%" mih="100%" p="xl" ta="center" gap="md">
      <ThemeIcon size={64} radius="md" variant="light" color="red">
        <IconAlertTriangle size={32} />
      </ThemeIcon>
      <Title order={3}>Échec de la génération</Title>
      <Text c="dimmed" maw={400}>
        L&apos;agent {product === 'closing' ? 'Closing' : 'Geoficiency'} n&apos;a pas pu produire de canvas.
        Réessayez ou reformulez votre question.
      </Text>
      <Group gap="xs">
        <Button onClick={onReload} leftSection={<IconRefresh size={14} />}>
          Relancer l&apos;analyse
        </Button>
        <Button onClick={onRetry} variant="default">
          Réinitialiser
        </Button>
      </Group>
    </Stack>
  )
}

function LoadedState({
  product,
  spec,
  lastQuery,
  isStreaming,
  onReset,
  onReload,
}: {
  product: Product
  spec: GenericUiSpec
  lastQuery: string | null
  isStreaming: boolean
  onReset: () => void
  onReload: () => void
}) {
  const accent = product === 'closing' ? 'closingPink' : 'teal'
  const initialState =
    ((spec as unknown as { state?: unknown }).state as Record<string, unknown> | undefined) ??
    EMPTY_STATE
  return (
    <Stack gap={0}>
      <Group
        p="md"
        justify="space-between"
        style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}
      >
        <Stack gap={2}>
          <Text size="xs" c={`${accent}.6`} fw={600} tt="uppercase">
            {product === 'closing' ? 'Contrôle généré' : 'Analyse géo'}
          </Text>
          <Title order={3}>{product === 'closing' ? 'Atelier de contrôles' : 'Explorateur Géo'}</Title>
          {lastQuery && (
            <Text size="xs" c="dimmed">
              Question&nbsp;: <em>{lastQuery}</em>
            </Text>
          )}
        </Stack>
        <Group gap="xs">
          {isStreaming ? (
            <Badge color="gray" variant="light">Streaming…</Badge>
          ) : (
            <Badge color="green" variant="light">Terminé</Badge>
          )}
          <Tooltip label="Relancer l'analyse">
            <ActionIcon
              variant="light"
              color={accent}
              onClick={onReload}
              disabled={isStreaming}
              aria-label="Relancer l'analyse"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Réinitialiser la conversation">
            <ActionIcon variant="default" onClick={onReset} disabled={isStreaming} aria-label="Réinitialiser">
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Exporter (à venir)">
            <ActionIcon variant="default" disabled aria-label="Exporter">
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Paper m="md" p="md" radius="md" withBorder>
        <RenderErrorBoundary resetKey={spec.root}>
          <JSONUIProvider registry={chatUiRegistry} initialState={initialState}>
            <Renderer spec={spec} registry={chatUiRegistry} loading={isStreaming} />
          </JSONUIProvider>
        </RenderErrorBoundary>
      </Paper>
    </Stack>
  )
}

class RenderErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string | number },
  { hasError: boolean; prevResetKey?: string | number }
> {
  constructor(props: { children: ReactNode; resetKey?: string | number }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  static getDerivedStateFromProps(
    props: { resetKey?: string | number },
    state: { hasError: boolean; prevResetKey?: string | number },
  ) {
    if (state.hasError && props.resetKey !== state.prevResetKey) {
      return { hasError: false, prevResetKey: props.resetKey }
    }
    return { prevResetKey: props.resetKey }
  }
  componentDidCatch(error: unknown) {
    console.error('[OutputCanvas] render error:', error)
  }
  render() {
    if (this.state.hasError) {
      return (
        <Text size="sm" c="dimmed" fs="italic">
          Une erreur est survenue lors de l&apos;affichage du contenu généré.
        </Text>
      )
    }
    return this.props.children
  }
}
