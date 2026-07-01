import {describe, expect, it} from 'vitest'

import {
  applyRemoteRevChange,
  clearFlagAndAdvanceBaseline,
  shouldFlagChangedUnderneath,
} from '../cartFlag'
import type {CartItem} from '../types'

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    publishedId: 'doc-1',
    draftId: 'drafts.doc-1',
    documentType: 'article',
    addedRev: 'rev-added',
    baselineRev: 'rev-baseline',
    changedUnderneath: false,
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('shouldFlagChangedUnderneath', () => {
  it('returns false when currentRev equals baselineRev (no divergence), regardless of author', () => {
    expect(
      shouldFlagChangedUnderneath({
        baselineRev: 'rev-1',
        currentRev: 'rev-1',
        isCurrentUserAuthor: false,
      }),
    ).toBe(false)

    expect(
      shouldFlagChangedUnderneath({
        baselineRev: 'rev-1',
        currentRev: 'rev-1',
        isCurrentUserAuthor: true,
      }),
    ).toBe(false)
  })

  it('returns false when revs diverge but the current user is the author', () => {
    expect(
      shouldFlagChangedUnderneath({
        baselineRev: 'rev-1',
        currentRev: 'rev-2',
        isCurrentUserAuthor: true,
      }),
    ).toBe(false)
  })

  it('returns true when revs diverge and the author is not the current user', () => {
    expect(
      shouldFlagChangedUnderneath({
        baselineRev: 'rev-1',
        currentRev: 'rev-2',
        isCurrentUserAuthor: false,
      }),
    ).toBe(true)
  })

  it('returns true when caller maps an unresolved/empty author to isCurrentUserAuthor:false', () => {
    // The falsy-author → isCurrentUserAuthor:false mapping is the caller's responsibility (Plan 02).
    // This test documents that shouldFlagChangedUnderneath treats isCurrentUserAuthor:false as remote.
    expect(
      shouldFlagChangedUnderneath({
        baselineRev: 'rev-1',
        currentRev: 'rev-2',
        isCurrentUserAuthor: false,
      }),
    ).toBe(true)
  })
})

describe('clearFlagAndAdvanceBaseline', () => {
  it('returns a new item with changedUnderneath false and baselineRev advanced to currentRev', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: true})
    const result = clearFlagAndAdvanceBaseline(item, 'rev-2')

    expect(result.changedUnderneath).toBe(false)
    expect(result.baselineRev).toBe('rev-2')
  })

  it('leaves addedRev unchanged', () => {
    const item = makeCartItem({addedRev: 'rev-added', baselineRev: 'rev-1'})
    const result = clearFlagAndAdvanceBaseline(item, 'rev-2')

    expect(result.addedRev).toBe('rev-added')
  })

  it('leaves addedAt unchanged', () => {
    const item = makeCartItem({addedAt: '2026-01-01T00:00:00.000Z', baselineRev: 'rev-1'})
    const result = clearFlagAndAdvanceBaseline(item, 'rev-2')

    expect(result.addedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('does not mutate the input item', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: true})
    clearFlagAndAdvanceBaseline(item, 'rev-2')

    expect(item.baselineRev).toBe('rev-1')
    expect(item.changedUnderneath).toBe(true)
  })

  it('returns the same reference when already at target state (no-op identity)', () => {
    const item = makeCartItem({baselineRev: 'rev-current', changedUnderneath: false})
    const result = clearFlagAndAdvanceBaseline(item, 'rev-current')

    expect(result).toBe(item)
  })
})

describe('applyRemoteRevChange', () => {
  it('sets changedUnderneath true when rev diverges and the author is not the current user', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: false})
    const result = applyRemoteRevChange(item, 'rev-2', false)

    expect(result.changedUnderneath).toBe(true)
    expect(result.baselineRev).toBe('rev-1')
  })

  it('does not advance baselineRev on a remote change (only local edits advance the baseline)', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: false})
    const result = applyRemoteRevChange(item, 'rev-2', false)

    expect(result.baselineRev).toBe('rev-1')
  })

  it('clears changedUnderneath when currentRev returns to baselineRev (revert-to-baseline)', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: true})
    const result = applyRemoteRevChange(item, 'rev-1', false)

    expect(result.changedUnderneath).toBe(false)
  })

  it('does not set the flag when the remote event is a self-echo (isCurrentUserAuthor true)', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: false})
    const result = applyRemoteRevChange(item, 'rev-2', true)

    expect(result.changedUnderneath).toBe(false)
  })

  it('returns the same reference when the transition would not change the item (no-op identity)', () => {
    const item = makeCartItem({baselineRev: 'rev-1', changedUnderneath: false})
    // Same rev as baseline and self-echo: nothing changes
    const result = applyRemoteRevChange(item, 'rev-1', true)

    expect(result).toBe(item)
  })
})
