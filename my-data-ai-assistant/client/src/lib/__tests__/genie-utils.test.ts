import { describe, it, expect } from 'vitest'
import { specIsValid } from '../genie-utils'

describe('specIsValid', () => {
  it('returns false for undefined', () => {
    expect(specIsValid(undefined)).toBe(false)
  })

  it('returns false for null', () => {
    expect(specIsValid(null)).toBe(false)
  })

  it('returns false for empty object', () => {
    expect(specIsValid({} as never)).toBe(false)
  })

  it('returns false for initial streaming placeholder { root: "", elements: {} }', () => {
    expect(specIsValid({ root: '', elements: {} } as never)).toBe(false)
  })

  it('returns false when root is non-empty but elements is empty', () => {
    expect(specIsValid({ root: 'main', elements: {} } as never)).toBe(false)
  })

  it('returns false when root key is absent from elements', () => {
    expect(specIsValid({
      root: 'main',
      elements: { other: { type: 'TextContent', props: {}, children: [] } },
    } as never)).toBe(false)
  })

  it('returns true for a minimal valid spec', () => {
    expect(specIsValid({
      root: 'main',
      elements: { main: { type: 'Stack', props: {}, children: [] } },
    })).toBe(true)
  })

  it('returns true for a valid spec with state and multiple elements', () => {
    expect(specIsValid({
      root: 'main',
      elements: {
        main: { type: 'Stack', props: { gap: 12 }, children: ['summary'] },
        summary: { type: 'TextContent', props: { content: { $state: '/summaryText' } }, children: [] },
      },
      state: { summaryText: 'No unbalanced entries found.' },
    })).toBe(true)
  })
})
