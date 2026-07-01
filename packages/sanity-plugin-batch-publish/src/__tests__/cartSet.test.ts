import {describe, expect, it} from 'vitest'

import {addItem, hasItem, removeItem} from '../cartSet'
import type {CartItem} from '../types'

const articleDraft: CartItem = {
  publishedId: 'abc',
  draftId: 'drafts.abc',
  documentType: 'article',
  addedRev: 'rev-1',
  baselineRev: 'rev-1',
  changedUnderneath: false,
  isNew: false,
  addedAt: '2026-06-28T10:00:00.000Z',
}

const productDraft: CartItem = {
  publishedId: 'def',
  draftId: 'drafts.def',
  documentType: 'product',
  addedRev: 'rev-a',
  baselineRev: 'rev-a',
  changedUnderneath: false,
  isNew: true,
  addedAt: '2026-06-28T11:00:00.000Z',
}

describe('hasItem', () => {
  it('returns false for an empty cart', () => {
    expect(hasItem([], 'abc')).toBe(false)
  })

  it('returns false when the publishedId is absent', () => {
    expect(hasItem([articleDraft], 'def')).toBe(false)
  })

  it('returns true when the publishedId is present', () => {
    expect(hasItem([articleDraft], 'abc')).toBe(true)
  })

  it('returns true when one of multiple items matches', () => {
    expect(hasItem([articleDraft, productDraft], 'def')).toBe(true)
  })
})

describe('addItem', () => {
  const now = '2026-06-28T12:00:00.000Z'

  it('grows the cart by one when adding a new publishedId', () => {
    const cart = addItem([], articleDraft, now)
    expect(cart).toHaveLength(1)
    expect(cart[0]).toEqual(articleDraft)
  })

  it('keeps length at 1 when the same publishedId is added twice (idempotent set)', () => {
    const updatedItem: CartItem = {...articleDraft, addedRev: 'rev-2'}
    const firstCart = addItem([], articleDraft, now)
    const secondCart = addItem(firstCart, updatedItem, '2026-06-28T13:00:00.000Z')
    expect(secondCart).toHaveLength(1)
  })

  it('advances addedRev to the incoming rev when the same id is re-added', () => {
    const updatedItem: CartItem = {...articleDraft, addedRev: 'rev-2'}
    const firstCart = addItem([], articleDraft, now)
    const secondCart = addItem(firstCart, updatedItem, '2026-06-28T13:00:00.000Z')
    expect(secondCart[0].addedRev).toBe('rev-2')
  })

  it('keeps addedAt frozen at the first-add value when the same id is re-added', () => {
    const updatedItem: CartItem = {
      ...articleDraft,
      addedRev: 'rev-2',
      addedAt: '2026-06-28T13:00:00.000Z',
    }
    const firstCart = addItem([], articleDraft, now)
    const secondCart = addItem(firstCart, updatedItem, '2026-06-28T13:00:00.000Z')
    expect(secondCart[0].addedAt).toBe(articleDraft.addedAt)
  })

  it('reflects the latest isNew value on re-add', () => {
    const updatedItem: CartItem = {...articleDraft, isNew: true}
    const firstCart = addItem([], articleDraft, now)
    const secondCart = addItem(firstCart, updatedItem, now)
    expect(secondCart[0].isNew).toBe(true)
  })

  it('reflects the latest documentType value on re-add', () => {
    const updatedItem: CartItem = {...articleDraft, documentType: 'updatedType'}
    const firstCart = addItem([], articleDraft, now)
    const secondCart = addItem(firstCart, updatedItem, now)
    expect(secondCart[0].documentType).toBe('updatedType')
  })

  it('appends to an existing cart without disturbing other items', () => {
    const cart = addItem([articleDraft], productDraft, now)
    expect(cart).toHaveLength(2)
    expect(cart[0]).toEqual(articleDraft)
    expect(cart[1]).toEqual(productDraft)
  })

  it('does not mutate the original cart array when adding a new item', () => {
    const originalCart: CartItem[] = [articleDraft]
    const originalLength = originalCart.length
    addItem(originalCart, productDraft, now)
    expect(originalCart).toHaveLength(originalLength)
  })

  it('does not mutate the original cart array when re-adding an existing item', () => {
    const originalItem = {...articleDraft}
    const originalCart = [originalItem]
    const updatedItem: CartItem = {...articleDraft, addedRev: 'rev-2'}
    addItem(originalCart, updatedItem, now)
    expect(originalCart[0].addedRev).toBe('rev-1')
  })
})

describe('removeItem', () => {
  it('returns an empty cart when removing the only item', () => {
    const cart = removeItem([articleDraft], 'abc')
    expect(cart).toHaveLength(0)
  })

  it('removes the matching item from a multi-item cart', () => {
    const cart = removeItem([articleDraft, productDraft], 'abc')
    expect(cart).toHaveLength(1)
    expect(cart[0].publishedId).toBe('def')
  })

  it('is a no-op when the publishedId is absent (idempotent)', () => {
    const cart = removeItem([articleDraft], 'unknown-id')
    expect(cart).toHaveLength(1)
    expect(cart[0]).toEqual(articleDraft)
  })

  it('is a no-op on an empty cart', () => {
    const cart = removeItem([], 'abc')
    expect(cart).toHaveLength(0)
  })

  it('does not mutate the original cart array', () => {
    const originalCart = [articleDraft, productDraft]
    removeItem(originalCart, 'abc')
    expect(originalCart).toHaveLength(2)
  })
})
