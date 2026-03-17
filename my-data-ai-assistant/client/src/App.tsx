import { useState } from 'react'
import { Box } from '@mantine/core'
import { Navbar } from '@/components/navbar'
import { BreadcrumbBar, PeriodBar } from '@/components/breadcrumb-bar'
import { ActionBar } from '@/components/action-bar'
import { PeriodActions } from '@/components/period-actions'
import { SummaryCards } from '@/components/summary-cards'
import { ControlsToolbar } from '@/components/controls-toolbar'
import { ControlsList } from '@/components/controls-list'
import { AiChatDrawer } from '@/components/ai-chat-drawer'
import type { SavedControl } from '@/components/ai-chat-drawer'
import type { SavedControlItem } from '@/components/controls-list'

export default function App() {
  return <HomePage />;
}

function HomePage() {
  const [chatOpened, setChatOpened] = useState(false)
  const [savedControls, setSavedControls] = useState<SavedControlItem[]>([])

  const DRAWER_WIDTH = 560

  const handleSaveControl = (control: SavedControl) => {
    setSavedControls((prev) => [
      ...prev,
      {
        id: control.id,
        name: control.name,
        description: control.description,
        results: control.results,
        rubriqueId: control.rubriqueId,
      },
    ])
  }
  return (
    <Box style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', display: 'flex' }}>
      <Box
        style={{
          flex: 1,
          minWidth: 0,
          marginRight: chatOpened ? DRAWER_WIDTH : 0,
          transition: 'margin-right 300ms ease',
        }}
      >
        <Navbar />
        <Box style={{ backgroundColor: '#fff' }}>
          <BreadcrumbBar />
          <ActionBar onOpenChat={() => setChatOpened(true)} />
          <PeriodBar />
          <PeriodActions />
        </Box>
        <SummaryCards />
        <ControlsToolbar />
        <ControlsList savedControls={savedControls} />
      </Box>
      <AiChatDrawer
        opened={chatOpened}
        onClose={() => setChatOpened(false)}
        onSaveControl={handleSaveControl}
      />
    </Box>
  );
}
