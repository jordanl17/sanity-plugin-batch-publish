import {describe, expect, it} from 'vitest'

import {isCartCandidate} from '../isCartCandidate'

describe('isCartCandidate', () => {
  describe('shape gate - plain draft requirement', () => {
    it('classifies a plain draft of an unrestricted non-liveEdit type as eligible (no config)', () => {
      const result = isCartCandidate({
        documentId: 'drafts.abc',
        documentType: 'article',
        isLiveEditType: false,
      })
      expect(result).toBe(true)
    })

    it('classifies a release version document as ineligible (shape gate)', () => {
      const result = isCartCandidate({
        documentId: 'versions.summer.abc',
        documentType: 'article',
        isLiveEditType: false,
      })
      expect(result).toBe(false)
    })

    it('classifies a published bare-id document as ineligible (shape gate)', () => {
      const result = isCartCandidate({
        documentId: 'abc',
        documentType: 'article',
        isLiveEditType: false,
      })
      expect(result).toBe(false)
    })
  })

  describe('shape gate - liveEdit invariant', () => {
    it('classifies a plain draft of a liveEdit type as ineligible (shape gate, liveEdit wins)', () => {
      const result = isCartCandidate({
        documentId: 'drafts.abc',
        documentType: 'livePost',
        isLiveEditType: true,
      })
      expect(result).toBe(false)
    })

    it('classifies a plain draft with liveEdit type as ineligible even when the type is in includeTypes', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.abc',
          documentType: 'livePost',
          isLiveEditType: true,
        },
        {includeTypes: ['livePost']},
      )
      expect(result).toBe(false)
    })
  })

  describe('type narrowing - excludeTypes', () => {
    it('classifies a plain draft whose type is in excludeTypes as ineligible (deny)', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.abc',
          documentType: 'article',
          isLiveEditType: false,
        },
        {excludeTypes: ['article']},
      )
      expect(result).toBe(false)
    })
  })

  describe('type narrowing - includeTypes', () => {
    it('classifies a plain draft whose type is in includeTypes as eligible', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.abc',
          documentType: 'article',
          isLiveEditType: false,
        },
        {includeTypes: ['article', 'product']},
      )
      expect(result).toBe(true)
    })

    it('classifies a plain draft whose type is NOT in a non-empty includeTypes as ineligible', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.def',
          documentType: 'page',
          isLiveEditType: false,
        },
        {includeTypes: ['article', 'product']},
      )
      expect(result).toBe(false)
    })
  })

  describe('type narrowing - both lists', () => {
    it('classifies a plain draft whose type is in both includeTypes and excludeTypes as ineligible (deny wins)', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.abc',
          documentType: 'article',
          isLiveEditType: false,
        },
        {includeTypes: ['article'], excludeTypes: ['article']},
      )
      expect(result).toBe(false)
    })

    it('classifies a plain draft whose type is not in a non-empty includeTypes as ineligible (unknown to allowlist - silently dropped)', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.xyz',
          documentType: 'unknownType',
          isLiveEditType: false,
        },
        {includeTypes: ['article']},
      )
      expect(result).toBe(false)
    })

    it('classifies a plain draft as eligible when both includeTypes and excludeTypes are empty arrays (zero-config behaviour)', () => {
      const result = isCartCandidate(
        {
          documentId: 'drafts.abc',
          documentType: 'article',
          isLiveEditType: false,
        },
        {includeTypes: [], excludeTypes: []},
      )
      expect(result).toBe(true)
    })
  })

  describe('worked example from CONTEXT.md', () => {
    it('classifies versions.abc.def of type article as ineligible even when article is in includeTypes (version shape beats type allow)', () => {
      const result = isCartCandidate(
        {
          documentId: 'versions.abc.def',
          documentType: 'article',
          isLiveEditType: false,
        },
        {includeTypes: ['article']},
      )
      expect(result).toBe(false)
    })
  })
})
