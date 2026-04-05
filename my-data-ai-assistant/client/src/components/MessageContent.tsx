import { memo, useMemo, useState, useRef, useCallback, Component } from 'react'
import type { ReactNode } from 'react'
import { Text, Box, List, Loader, Group, ActionIcon, Tooltip } from '@mantine/core'
import { AgGridReact } from 'ag-grid-react'
import { themeQuartz } from 'ag-grid-enterprise'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { chatUiRegistry } from '../registry/chat-ui-registry'
import {
  toGenieStatementResponse,
  buildSpecFromGenieStatement,
  specIsValid,
} from '../lib/genie-utils'
import type { Message, ContentBlock, GenericUiSpec } from '../types/chat'

/* ------------------------------------------------------------------ */
/*  Inline render error boundary (French fallback)                    */
/* ------------------------------------------------------------------ */

class RenderErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <Text size="sm" c="dimmed" fs="italic">
          Une erreur est survenue lors de l&apos;affichage de ce contenu.
        </Text>
      )
    }
    return this.props.children
  }
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <Tooltip label={copied ? 'Copié !' : 'Copier la réponse'} position="top" withArrow>
      <ActionIcon
        variant="subtle"
        color={copied ? 'teal' : 'gray'}
        size="xs"
        onClick={() => { void handleCopy() }}
        aria-label="Copier la réponse"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </ActionIcon>
    </Tooltip>
  )
}

/* ------------------------------------------------------------------ */
/*  Block renderers                                                    */
/* ------------------------------------------------------------------ */

const VISIBLE_COLS = 4
const LARGE_TABLE_THRESHOLD = 200

const TableBlock = memo(function TableBlock({ block }: { block: { caption?: string; headers: string[]; rows: string[][] } }) {
  const columnDefs = useMemo(() => block.headers.map((h, i) => ({
    field: h, headerName: h, sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100,
    hide: i >= VISIBLE_COLS,
  })), [block.headers])
  const rowData = useMemo(
    () => block.rows.map((row) => Object.fromEntries(block.headers.map((h, i) => [h, row[i] ?? '']))),
    [block.headers, block.rows]
  )
  const isLarge = rowData.length > LARGE_TABLE_THRESHOLD
  const gridHeight = isLarge ? 640 : Math.min(440, 56 + rowData.length * 42)
  const hasHiddenCols = block.headers.length > VISIBLE_COLS
  return (
    <Box mt="xs" mb="xs" style={{ width: '100%', overflow: 'hidden' }}>
      {block.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{block.caption}</Text>}
      {rowData.length === 0 || block.headers.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">Aucune donnée à afficher</Text>
      ) : (
        <div style={{ height: gridHeight, width: '100%' }}>
          <AgGridReact
            theme={themeQuartz}
            columnDefs={columnDefs}
            rowData={rowData}
            domLayout="normal"
            suppressMovableColumns
            rowBuffer={20}
            animateRows={!isLarge}
            pagination={rowData.length > 10}
            paginationPageSize={isLarge ? 50 : 10}
            sideBar={hasHiddenCols ? { toolPanels: [{ id: 'columns', labelDefault: 'Colonnes', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel', toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }] } : undefined}
          />
        </div>
      )}
    </Box>
  )
})

export function RenderBlock({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <Text size="sm" style={{ lineHeight: 1.6 }} mt={4}>{block.content}</Text>
    case 'bold':
      return <Text size="sm" fw={700} style={{ lineHeight: 1.6 }} mt={8}>{block.content}</Text>
    case 'heading':
      return <Text size="sm" fw={700} mt="md" mb={4} c="dark" style={{ lineHeight: 1.5 }}>{block.content}</Text>
    case 'bullets':
      return (
        <List size="sm" mt={4} mb={4} spacing={2} withPadding>
          {block.items.map((item, itemIndex) => (
            // eslint-disable-next-line react/no-array-index-key
            <List.Item key={itemIndex}>
              <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
            </List.Item>
          ))}
        </List>
      )
    case 'table':
      return <TableBlock block={block} />
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/*  Memoised message content                                           */
/* ------------------------------------------------------------------ */

const EMPTY_STATE: Record<string, unknown> = {}

const MessageContent = memo(function MessageContent({
  msg,
  messageId,
  generatedSpec,
  registry,
  hideText,
  isSpecStreaming,
  onSpecSubmit,
}: {
  msg: Message
  messageId: string
  generatedSpec: GenericUiSpec | undefined
  registry: typeof chatUiRegistry
  hideText?: boolean
  isSpecStreaming?: boolean
  onSpecSubmit?: (state: Record<string, unknown>) => void
}) {
  // Tracks the latest form-input state so the submit button can read it.
  const specStateRef = useRef<Record<string, unknown>>(
    (generatedSpec?.state as Record<string, unknown>) ?? {}
  )
  const handleSpecStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      for (const { path, value } of changes) {
        const key = (path.startsWith('/') ? path.slice(1) : path)
          .replace(/~1/g, '/').replace(/~0/g, '~')
        if (key === 'submitRequested' && value === true) {
          onSpecSubmit?.({ ...specStateRef.current })
        } else {
          specStateRef.current[key] = value
        }
      }
    },
    [onSpecSubmit]
  )
  if (specIsValid(generatedSpec)) {
    return (
      <RenderErrorBoundary>
        <JSONUIProvider
          key={messageId}
          registry={registry}
          initialState={(generatedSpec.state as Record<string, unknown>) ?? EMPTY_STATE}
          onStateChange={handleSpecStateChange}
        >
          <Renderer spec={generatedSpec} registry={registry} loading={isSpecStreaming} />
        </JSONUIProvider>
      </RenderErrorBoundary>
    )
  }

  // During active GenUI streaming: the parent renders the two-step progress indicator.
  // Skip attachment/fallback rendering here to prevent the Genie chart from flickering
  // in and out. Only preserve any visible text or block content.
  if (isSpecStreaming) {
    const hasText = !hideText && Boolean(msg.content?.trim())
    const hasBlocksNow = Boolean(msg.blocks?.length)
    if (!hasText && !hasBlocksNow) return null
    return (
      <>
        {hasText && <Text size="sm" style={{ lineHeight: 1.55 }}>{msg.content}</Text>}
        {hasBlocksNow && (
          <Box>
            {msg.blocks!.map((block, blockIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <RenderBlock key={blockIndex} block={block} />
            ))}
          </Box>
        )}
      </>
    )
  }

  const hasContent = !hideText && Boolean(msg.content?.trim())
  const hasBlocks = Boolean(msg.blocks && msg.blocks.length > 0)

  const skipAttachments = Boolean(msg.blocks?.some((b) => b.type === 'table'))
  const parsedAttachments: Array<{ key: string; spec: GenericUiSpec }> =
    !skipAttachments && msg.queryResults
      ? (msg.attachments ?? [])
          .filter((a) => Boolean(a.attachmentId))
          .flatMap((a) => {
            const statement = toGenieStatementResponse(msg.queryResults!.get(a.attachmentId!))
            if (!statement) return []
            return [{ key: a.attachmentId!, spec: buildSpecFromGenieStatement(statement, a.query?.title) }]
          })
      : []

  const hasRenderableAttachments = parsedAttachments.length > 0

  if (!hasContent && !hasBlocks && !hasRenderableAttachments && !generatedSpec) {
    if (hideText) return null
    return (
      <Group gap="xs">
        <Loader size="xs" color="teal" type="dots" />
      </Group>
    )
  }

  return (
    <>
      {!hideText && msg.content && (
        <Text size="sm" style={{ lineHeight: 1.55 }}>
          {msg.content}
        </Text>
      )}
      {msg.blocks && msg.blocks.length > 0 && (
        <Box>
          {msg.blocks.map((block, blockIndex) => (
            // eslint-disable-next-line react/no-array-index-key
            <RenderBlock key={blockIndex} block={block} />
          ))}
        </Box>
      )}
      {parsedAttachments.map(({ key, spec: attachmentSpec }) => (
        <Box key={key} mt="sm">
          <RenderErrorBoundary>
            <JSONUIProvider
              key={`genie-${key}`}
              registry={registry}
              initialState={(attachmentSpec.state as Record<string, unknown>) ?? EMPTY_STATE}
            >
              <Renderer spec={attachmentSpec} registry={registry} />
            </JSONUIProvider>
          </RenderErrorBoundary>
        </Box>
      ))}
    </>
  )
})

export default MessageContent
