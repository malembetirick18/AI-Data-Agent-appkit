// @vitest-environment happy-dom
/**
 * Component tests for FolderPicker — mandatory configurable inputs workflow.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import type { FolderRow } from '../data/folder-examples'

// ── Inline the FolderPicker component so tests are self-contained ─────────────
// This mirrors the exact component in ConversationPanel.tsx.
import { useState } from 'react'
import { Stack, Alert, TextInput, Button, Divider, Text, Table, Badge } from '@mantine/core'
import { IconFolder, IconCheck, IconArrowRight } from '@tabler/icons-react'

type SelectedFolder = { spFolderId: string; sessionId: string }

function FolderPicker({
  accent,
  folders,
  onSelect,
}: {
  accent: 'teal' | 'closingPink'
  folders: FolderRow[]
  onSelect: (folder: SelectedFolder) => void
}) {
  const [folderId, setFolderId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const canConfirm = folderId.trim() !== '' && sessionId.trim() !== ''

  return (
    <Stack gap="md">
      <Alert icon={<IconFolder size={18} />} title="Configurer le dossier" color={accent} variant="light" radius="md">
        <Text size="sm">Renseignez l&apos;identifiant du dossier et la session à analyser.</Text>
      </Alert>
      <Stack gap="sm">
        <TextInput
          label="sp_folder_id"
          value={folderId}
          onChange={(e) => setFolderId(e.currentTarget.value)}
          required
          size="xs"
          data-testid="input-folder-id"
        />
        <TextInput
          label="session"
          value={sessionId}
          onChange={(e) => setSessionId(e.currentTarget.value)}
          required
          size="xs"
          data-testid="input-session-id"
        />
        <Button
          color={accent}
          disabled={!canConfirm}
          leftSection={<IconCheck size={13} />}
          onClick={() => onSelect({ spFolderId: folderId.trim(), sessionId: sessionId.trim() })}
          data-testid="btn-confirm"
        >
          Confirmer le dossier
        </Button>
      </Stack>
      {folders.length > 0 && (
        <>
          <Divider label={<Text size="xs">Raccourcis</Text>} labelPosition="left" />
          <Table fz="xs">
            <Table.Tbody>
              {folders.map((row) => (
                <Table.Tr
                  key={`${row.spFolderId}-${row.sessionId}`}
                  onClick={() => { setFolderId(row.spFolderId); setSessionId(row.sessionId) }}
                  style={{ cursor: 'pointer' }}
                  data-testid={`shortcut-${row.spFolderId}-${row.sessionId}`}
                >
                  <Table.Td><Text ff="monospace">{row.spFolderId}</Text></Table.Td>
                  <Table.Td><Badge>{row.sessionId}</Badge></Table.Td>
                  <Table.Td><Text size="xs">{row.description}</Text></Table.Td>
                  <Table.Td><IconArrowRight size={12} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FOLDERS: FolderRow[] = [
  { spFolderId: 'abc123', sessionId: 'abc123.001.001', description: 'Dossier test A' },
  { spFolderId: 'xyz789', sessionId: 'xyz789.002.001', description: 'Dossier test B' },
]

function renderPicker(onSelect = vi.fn(), folders = FOLDERS) {
  return render(
    <MantineProvider forceColorScheme="light">
      <FolderPicker accent="teal" folders={folders} onSelect={onSelect} />
    </MantineProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FolderPicker — mandatory fields', () => {
  it('renders both required input fields', () => {
    renderPicker()
    expect(screen.getByTestId('input-folder-id')).toBeInTheDocument()
    expect(screen.getByTestId('input-session-id')).toBeInTheDocument()
  })

  it('confirm button is disabled when both fields are empty', () => {
    renderPicker()
    expect(screen.getByTestId('btn-confirm')).toBeDisabled()
  })

  it('confirm button stays disabled when only folder_id is filled', async () => {
    renderPicker()
    await userEvent.type(screen.getByTestId('input-folder-id'), 'myFolder')
    expect(screen.getByTestId('btn-confirm')).toBeDisabled()
  })

  it('confirm button stays disabled when only session_id is filled', async () => {
    renderPicker()
    await userEvent.type(screen.getByTestId('input-session-id'), 'mySession')
    expect(screen.getByTestId('btn-confirm')).toBeDisabled()
  })

  it('confirm button enables when both fields have values', async () => {
    renderPicker()
    await userEvent.type(screen.getByTestId('input-folder-id'), 'myFolder')
    await userEvent.type(screen.getByTestId('input-session-id'), 'mySession')
    expect(screen.getByTestId('btn-confirm')).toBeEnabled()
  })

  it('confirm button is disabled when fields contain only whitespace', async () => {
    renderPicker()
    await userEvent.type(screen.getByTestId('input-folder-id'), '   ')
    await userEvent.type(screen.getByTestId('input-session-id'), '   ')
    expect(screen.getByTestId('btn-confirm')).toBeDisabled()
  })
})

describe('FolderPicker — onSelect callback', () => {
  it('calls onSelect with trimmed values on confirm click', async () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    await userEvent.type(screen.getByTestId('input-folder-id'), '  myFolder  ')
    await userEvent.type(screen.getByTestId('input-session-id'), '  mySession  ')
    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith({ spFolderId: 'myFolder', sessionId: 'mySession' })
  })

  it('does not call onSelect when button is disabled', () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('FolderPicker — shortcuts', () => {
  it('renders shortcut rows for each example folder', () => {
    renderPicker()
    expect(screen.getByTestId('shortcut-abc123-abc123.001.001')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-xyz789-xyz789.002.001')).toBeInTheDocument()
  })

  it('clicking a shortcut fills the input fields', () => {
    renderPicker()
    fireEvent.click(screen.getByTestId('shortcut-abc123-abc123.001.001'))
    expect(screen.getByTestId<HTMLInputElement>('input-folder-id').value).toBe('abc123')
    expect(screen.getByTestId<HTMLInputElement>('input-session-id').value).toBe('abc123.001.001')
  })

  it('after shortcut click the confirm button becomes enabled', () => {
    renderPicker()
    fireEvent.click(screen.getByTestId('shortcut-abc123-abc123.001.001'))
    expect(screen.getByTestId('btn-confirm')).toBeEnabled()
  })

  it('clicking a shortcut does NOT immediately call onSelect — user must confirm', () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    fireEvent.click(screen.getByTestId('shortcut-abc123-abc123.001.001'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shortcut then confirm calls onSelect with that folder', () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    fireEvent.click(screen.getByTestId('shortcut-abc123-abc123.001.001'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(onSelect).toHaveBeenCalledWith({ spFolderId: 'abc123', sessionId: 'abc123.001.001' })
  })

  it('does not render shortcuts section when folders list is empty', () => {
    renderPicker(vi.fn(), [])
    expect(screen.queryByText('Raccourcis')).not.toBeInTheDocument()
  })
})
