import { use, useEffect, useMemo, useState, Suspense } from 'react'
import { AppShell, Box, Stack, Skeleton } from '@mantine/core'
import type { Product } from '../../../shared/products'
import { PRODUCT_LABELS } from '../../../shared/products'
import { ShellHeader } from '../components/ShellHeader'
import { ConversationPanel } from '../components/ConversationPanel'
import { OutputCanvas } from '../components/OutputCanvas'
import { useProductAssistant } from '../hooks/useProductAssistant'
import { FOLDER_EXAMPLES } from '../data/folder-examples'
import type { FolderRow, SelectedFolder } from '../data/folder-examples'

const suggestionsCache: Partial<Record<Product, Promise<string[]>>> = {}
function getSuggestionsPromise(product: Product): Promise<string[]> {
  if (!suggestionsCache[product]) {
    suggestionsCache[product] = fetch(`/api/suggestions?app_type=${product}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ suggestions: [] })))
      .then((data: { suggestions?: string[] }) =>
        Array.isArray(data.suggestions) ? data.suggestions : [],
      )
      .catch(() => [])
  }
  return suggestionsCache[product]!
}

export function ProductPage({ product }: { product: Product }) {
  useEffect(() => {
    const previous = document.title
    document.title = `${PRODUCT_LABELS[product]} · AI Data Agent`
    return () => { document.title = previous }
  }, [product])

  const crumbs = useMemo(
    () =>
      product === 'closing'
        ? ['Liste des groupes', '00 LAST GROUP', 'Atelier de contrôles']
        : ['Liste des groupes', '00 LAST GROUP', 'Explorateur Géo'],
    [product],
  )

  const {
    messages, spec, displayedSpecId, showSpec,
    isStreaming, hasError, statusText, reasoningText, controllerInfo,
    send, reset, selectedFolder, selectFolder, clearFolder,
  } = useProductAssistant(product)

  const [lastQuery, setLastQuery] = useState<string | null>(null)

  const handleSend = (q: string) => {
    setLastQuery(q)
    send(q)
  }

  const handleReset = () => {
    setLastQuery(null)
    reset()
  }

  const handleReload = () => {
    if (lastQuery && !isStreaming) send(lastQuery)
  }

  const availableFolders = FOLDER_EXAMPLES[product]

  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <ShellHeader product={product} crumbs={crumbs} />
      <AppShell.Main style={{ height: 'calc(100vh - 56px)', display: 'flex', overflow: 'hidden' }}>
        <Suspense fallback={<ConversationPanelFallback />}>
          <SuggestionsAwareConversation
            product={product}
            messages={messages}
            busy={isStreaming}
            statusText={statusText}
            reasoningText={reasoningText}
            controllerInfo={controllerInfo}
            activeSpecId={displayedSpecId}
            onShowSpec={showSpec}
            selectedFolder={selectedFolder}
            availableFolders={availableFolders}
            onSelectFolder={selectFolder}
            onClearFolder={clearFolder}
            onSend={handleSend}
            onReload={handleReload}
          />
        </Suspense>
        <OutputCanvas
          product={product}
          spec={spec}
          isStreaming={isStreaming}
          hasError={hasError}
          lastQuery={lastQuery}
          onReset={handleReset}
          onReload={handleReload}
        />
      </AppShell.Main>
    </AppShell>
  )
}

function SuggestionsAwareConversation(props: {
  product: Product
  messages: ReturnType<typeof useProductAssistant>['messages']
  busy: boolean
  statusText: string
  reasoningText: string
  controllerInfo: ReturnType<typeof useProductAssistant>['controllerInfo']
  activeSpecId: string | null
  onShowSpec: (id: string) => void
  selectedFolder: SelectedFolder | null
  availableFolders: FolderRow[]
  onSelectFolder: (folder: SelectedFolder) => void
  onClearFolder: () => void
  onSend: (q: string) => void
  onReload: () => void
}) {
  const suggestions = use(getSuggestionsPromise(props.product))
  return (
    <ConversationPanel
      product={props.product}
      messages={props.messages}
      busy={props.busy}
      statusText={props.statusText}
      reasoningText={props.reasoningText}
      controllerInfo={props.controllerInfo}
      activeSpecId={props.activeSpecId}
      onShowSpec={props.onShowSpec}
      suggestions={suggestions}
      selectedFolder={props.selectedFolder}
      availableFolders={props.availableFolders}
      onSelectFolder={props.onSelectFolder}
      onClearFolder={props.onClearFolder}
      onSend={props.onSend}
      onReload={props.onReload}
    />
  )
}

function ConversationPanelFallback() {
  return (
    <Box
      p="md"
      style={{
        width: 460,
        minWidth: 460,
        borderRight: '1px solid var(--mantine-color-gray-2)',
        background: '#fff',
      }}
    >
      <Stack gap="md">
        <Skeleton h={48} />
        <Skeleton h={24} width="60%" />
        <Skeleton h={56} />
        <Skeleton h={56} />
        <Skeleton h={56} />
      </Stack>
    </Box>
  )
}
