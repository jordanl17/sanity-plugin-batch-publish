import {describe, expect, it} from 'vitest'

import {evaluateCartMembership} from '../evaluateCartMembership'
import type {CartMembershipSnapshot} from '../evaluateCartMembership'

const now = '2026-06-28T12:00:00.000Z'

function buildSnapshot(overrides: Partial<CartMembershipSnapshot>): CartMembershipSnapshot {
  return {
    publishedId: 'abc',
    documentType: 'article',
    isLiveEditType: false,
    draft: {_id: 'drafts.abc', _rev: 'rev-1'},
    published: null,
    draftHasContent: true,
    matchesPublished: false,
    alreadyTracked: false,
    definitive: true,
    ...overrides,
  }
}

describe('evaluateCartMembership', () => {
  describe('qualifying new draft (no published version) -> add with isNew true', () => {
    it('returns add with isNew true when draft exists with content and no published version', () => {
      const result = evaluateCartMembership(buildSnapshot({published: null}), now)
      expect(result.action).toBe('add')
      if (result.action === 'add') {
        expect(result.item.isNew).toBe(true)
        expect(result.item.publishedId).toBe('abc')
        expect(result.item.draftId).toBe('drafts.abc')
        expect(result.item.addedRev).toBe('rev-1')
        expect(result.item.addedAt).toBe(now)
        expect(result.item.documentType).toBe('article')
      }
    })
  })

  describe('qualifying draft with published version -> add with isNew false', () => {
    it('returns add with isNew false when draft exists with content and published exists', () => {
      const result = evaluateCartMembership(
        buildSnapshot({
          published: {_id: 'abc', _rev: 'published-rev-1'},
          matchesPublished: false,
        }),
        now,
      )
      expect(result.action).toBe('add')
      if (result.action === 'add') {
        expect(result.item.isNew).toBe(false)
        expect(result.item.addedRev).toBe('rev-1')
      }
    })
  })

  describe('liveEdit type -> never add', () => {
    it('returns keep for untracked liveEdit type with draft content', () => {
      const result = evaluateCartMembership(
        buildSnapshot({isLiveEditType: true, alreadyTracked: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })

    it('returns remove for tracked liveEdit type (stopped qualifying)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({isLiveEditType: true, alreadyTracked: true}),
        now,
      )
      expect(result.action).toBe('remove')
      if (result.action === 'remove') {
        expect(result.publishedId).toBe('abc')
      }
    })
  })

  describe('version/non-draft id -> not add', () => {
    it('returns keep for untracked document with version id', () => {
      const result = evaluateCartMembership(
        buildSnapshot({
          draft: {_id: 'versions.summer.abc', _rev: 'rev-1'},
          alreadyTracked: false,
        }),
        now,
      )
      expect(result.action).toBe('keep')
    })

    it('returns remove for tracked document with version id (stopped qualifying)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({
          draft: {_id: 'versions.summer.abc', _rev: 'rev-1'},
          alreadyTracked: true,
        }),
        now,
      )
      expect(result.action).toBe('remove')
    })
  })

  describe('empty draft (no content)', () => {
    it('returns keep for untracked draft with no content', () => {
      const result = evaluateCartMembership(
        buildSnapshot({draftHasContent: false, alreadyTracked: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })

    it('returns remove for tracked draft with no content (stopped qualifying)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({draftHasContent: false, alreadyTracked: true}),
        now,
      )
      expect(result.action).toBe('remove')
    })
  })

  describe('draft reverted to match published', () => {
    it('returns remove for tracked draft that has been reverted to match published', () => {
      const result = evaluateCartMembership(
        buildSnapshot({matchesPublished: true, alreadyTracked: true}),
        now,
      )
      expect(result.action).toBe('remove')
    })

    it('returns keep for untracked draft that matches published (never was in cart)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({matchesPublished: true, alreadyTracked: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })
  })

  describe('draft null (discarded or published elsewhere)', () => {
    it('returns remove for tracked item when draft is null', () => {
      const result = evaluateCartMembership(buildSnapshot({draft: null, alreadyTracked: true}), now)
      expect(result.action).toBe('remove')
    })

    it('returns keep for untracked item when draft is null', () => {
      const result = evaluateCartMembership(
        buildSnapshot({draft: null, alreadyTracked: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })
  })

  describe('transient failure guard (definitive: false)', () => {
    it('returns keep even when snapshot would otherwise be a remove (tracked, no draft)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({draft: null, alreadyTracked: true, definitive: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })

    it('returns keep even when snapshot would otherwise be a remove (tracked, liveEdit)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({isLiveEditType: true, alreadyTracked: true, definitive: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })

    it('returns keep even when snapshot would otherwise be a remove (tracked, reverted)', () => {
      const result = evaluateCartMembership(
        buildSnapshot({matchesPublished: true, alreadyTracked: true, definitive: false}),
        now,
      )
      expect(result.action).toBe('keep')
    })
  })

  describe('config type filtering', () => {
    it('returns keep for untracked draft type excluded by config', () => {
      const result = evaluateCartMembership(buildSnapshot({alreadyTracked: false}), now, {
        excludeTypes: ['article'],
      })
      expect(result.action).toBe('keep')
    })

    it('returns remove for tracked draft type excluded by config (stopped qualifying)', () => {
      const result = evaluateCartMembership(buildSnapshot({alreadyTracked: true}), now, {
        excludeTypes: ['article'],
      })
      expect(result.action).toBe('remove')
    })

    it('returns add for draft type matching includeTypes config', () => {
      const result = evaluateCartMembership(buildSnapshot({alreadyTracked: false}), now, {
        includeTypes: ['article'],
      })
      expect(result.action).toBe('add')
    })

    it('returns keep for untracked draft type not in a restrictive includeTypes', () => {
      const result = evaluateCartMembership(buildSnapshot({alreadyTracked: false}), now, {
        includeTypes: ['product'],
      })
      expect(result.action).toBe('keep')
    })
  })
})
