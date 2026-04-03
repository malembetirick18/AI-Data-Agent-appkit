import { memo, useMemo, useState } from 'react'
import { Text, Box, List, Loader, Group, ActionIcon, Tooltip } from '@mantine/core'
import { AgGridReact } from 'ag-grid-react'
import { themeQuartz } from 'ag-grid-enterprise'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { chatUiRegistry } from '../registry/chat-ui-registry'
import {
  toGenieStatementResponse,
  buildSpecFromGenieStatement,
  specHasChartElement,
} from '../lib/genie-utils'
import type { Message, ContentBlock, GenericUiSpec } from '../types/chat'

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

const MessageContent = memo(function MessageContent({
  msg,
  messageId,
  generatedSpec,
  registry,
  hideText,
}: {
  msg: Message
  messageId: string
  generatedSpec: GenericUiSpec | undefined
  registry: typeof chatUiRegistry
  hideText?: boolean
}) {
  if (generatedSpec && specHasChartElement(generatedSpec)) {
    return (
      <>
        <JSONUIProvider key={messageId} registry={registry}>
          <Renderer spec={generatedSpec} registry={registry} />
        </JSONUIProvider>
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
          <JSONUIProvider key={`genie-${key}`} registry={registry}>
            <Renderer spec={attachmentSpec} registry={registry} />
          </JSONUIProvider>
        </Box>
      ))}
    </>
  )
})

export default MessageContent
