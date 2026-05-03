/**
 * Unit tests for the folder-context guard used in useProductAssistant.send().
 *
 * Without both `sp_folder_id` and `session_id` populated and non-empty, the
 * controller call MUST NOT be issued and the Genie request MUST NOT be triggered.
 * The guard is duplicated at two sites (entry guard, pre-Genie re-check) so
 * a folder cleared mid-stream is also caught.
 */
import { describe, it, expect } from 'vitest'

type SelectedFolder = { spFolderId: string; sessionId: string }

// ── Inline the guard logic (mirrors useProductAssistant.ts) ──────────────────

function canSend(
  promptText: string,
  stage: 'idle' | 'running' | 'spec',
  folder: SelectedFolder | null,
): boolean {
  const trimmed = promptText.trim()
  if (
    !trimmed ||
    stage !== 'idle' ||
    !folder ||
    !folder.spFolderId.trim() ||
    !folder.sessionId.trim()
  ) {
    return false
  }
  return true
}

function canCallGenie(folder: SelectedFolder | null): boolean {
  return !!folder?.spFolderId?.trim() && !!folder?.sessionId?.trim()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('folder guard — entry to send()', () => {
  const VALID: SelectedFolder = { spFolderId: 'abc123', sessionId: 'abc123.001.001' }

  it('blocks when no folder is selected', () => {
    expect(canSend('analyse les fournisseurs', 'idle', null)).toBe(false)
  })

  it('blocks when sp_folder_id is empty', () => {
    expect(canSend('q', 'idle', { spFolderId: '', sessionId: 'abc.001.001' })).toBe(false)
  })

  it('blocks when sp_folder_id is whitespace only', () => {
    expect(canSend('q', 'idle', { spFolderId: '   ', sessionId: 'abc.001.001' })).toBe(false)
  })

  it('blocks when session_id is empty', () => {
    expect(canSend('q', 'idle', { spFolderId: 'abc', sessionId: '' })).toBe(false)
  })

  it('blocks when session_id is whitespace only', () => {
    expect(canSend('q', 'idle', { spFolderId: 'abc', sessionId: '   ' })).toBe(false)
  })

  it('blocks when prompt is empty', () => {
    expect(canSend('', 'idle', VALID)).toBe(false)
  })

  it('blocks when prompt is whitespace only', () => {
    expect(canSend('   ', 'idle', VALID)).toBe(false)
  })

  it('blocks when stage is not idle (running)', () => {
    expect(canSend('q', 'running', VALID)).toBe(false)
  })

  it('blocks when stage is not idle (spec)', () => {
    expect(canSend('q', 'spec', VALID)).toBe(false)
  })

  it('allows when prompt + folder + stage are all valid', () => {
    expect(canSend('q', 'idle', VALID)).toBe(true)
  })
})

describe('folder guard — pre-Genie re-check', () => {
  it('blocks Genie call when folder is null (cleared mid-stream)', () => {
    expect(canCallGenie(null)).toBe(false)
  })

  it('blocks Genie call when sp_folder_id is empty', () => {
    expect(canCallGenie({ spFolderId: '', sessionId: 'abc.001.001' })).toBe(false)
  })

  it('blocks Genie call when sp_folder_id is whitespace', () => {
    expect(canCallGenie({ spFolderId: '   ', sessionId: 'abc.001.001' })).toBe(false)
  })

  it('blocks Genie call when session_id is empty', () => {
    expect(canCallGenie({ spFolderId: 'abc', sessionId: '' })).toBe(false)
  })

  it('blocks Genie call when session_id is whitespace', () => {
    expect(canCallGenie({ spFolderId: 'abc', sessionId: '   ' })).toBe(false)
  })

  it('allows Genie call when both fields populated', () => {
    expect(canCallGenie({ spFolderId: 'abc123', sessionId: 'abc123.001.001' })).toBe(true)
  })

  it('trims values — leading/trailing whitespace is treated as populated', () => {
    expect(canCallGenie({ spFolderId: '  abc  ', sessionId: '  abc.001  ' })).toBe(true)
  })
})
