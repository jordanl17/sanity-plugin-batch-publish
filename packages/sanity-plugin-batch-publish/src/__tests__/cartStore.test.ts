import {beforeEach, describe, expect, it, vi} from 'vitest'

import type {CartMembershipDecision} from '../evaluateCartMembership'
import {writeCart} from '../cartStorage'
import {createCartStore} from '../cartStore'
import type {CartItem} from '../types'

function makeCartItem(publishedId: string, addedRev = 'rev-abc'): CartItem {
  return {
    publishedId,
    draftId: `drafts.${publishedId}`,
    documentType: 'article',
    addedRev,
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

const TEST_KEY = 'test-cart-store-key'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('createCartStore - re-hydration', () => {
  it('re-hydrates items from a pre-seeded localStorage key on construction', () => {
    const seededItems = [makeCartItem('doc-1'), makeCartItem('doc-2')]
    writeCart(TEST_KEY, seededItems)

    const store = createCartStore(TEST_KEY)

    expect(store.getItems()).toEqual(seededItems)

    store.destroy()
  })

  it('starts with an empty cart when localStorage key is absent', () => {
    const store = createCartStore(TEST_KEY)

    expect(store.getItems()).toEqual([])

    store.destroy()
  })
})

describe('createCartStore - applyDecision add', () => {
  it('adds an item when action is add', () => {
    const store = createCartStore(TEST_KEY)
    const item = makeCartItem('doc-new')

    const decision: CartMembershipDecision = {action: 'add', item}
    store.applyDecision(decision)

    expect(store.getItems()).toHaveLength(1)
    expect(store.getItems()[0]).toEqual(item)

    store.destroy()
  })

  it('writes through to localStorage on add', () => {
    const store = createCartStore(TEST_KEY)
    const item = makeCartItem('doc-new')

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    store.applyDecision({action: 'add', item})

    expect(setItemSpy).toHaveBeenCalledWith(TEST_KEY, expect.any(String))
    const storedValue = localStorage.getItem(TEST_KEY)
    expect(storedValue).not.toBeNull()
    const parsed = JSON.parse(storedValue!)
    expect(parsed).toEqual([item])

    store.destroy()
  })

  it('notifies subscribers on add', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    store.applyDecision({action: 'add', item: makeCartItem('doc-1')})

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith([makeCartItem('doc-1')])

    store.destroy()
  })

  it('keeps length at 1 and advances addedRev on re-add of the same publishedId', () => {
    const store = createCartStore(TEST_KEY)
    const firstItem = makeCartItem('doc-1', 'rev-001')
    const updatedItem = makeCartItem('doc-1', 'rev-002')

    store.applyDecision({action: 'add', item: firstItem})
    store.applyDecision({action: 'add', item: updatedItem})

    expect(store.getItems()).toHaveLength(1)
    expect(store.getItems()[0].addedRev).toBe('rev-002')
    expect(store.getItems()[0].addedAt).toBe(firstItem.addedAt)

    store.destroy()
  })
})

describe('createCartStore - applyDecision remove', () => {
  it('removes an item when action is remove', () => {
    const store = createCartStore(TEST_KEY)
    store.applyDecision({action: 'add', item: makeCartItem('doc-1')})
    store.applyDecision({action: 'add', item: makeCartItem('doc-2')})

    store.applyDecision({action: 'remove', publishedId: 'doc-1'})

    expect(store.getItems()).toHaveLength(1)
    expect(store.getItems()[0].publishedId).toBe('doc-2')

    store.destroy()
  })

  it('notifies subscribers on remove', () => {
    const store = createCartStore(TEST_KEY)
    store.applyDecision({action: 'add', item: makeCartItem('doc-1')})

    const listener = vi.fn()
    store.subscribe(listener)
    store.applyDecision({action: 'remove', publishedId: 'doc-1'})

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith([])

    store.destroy()
  })
})

describe('createCartStore - applyDecision keep', () => {
  it('does not notify subscribers when action is keep', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    store.applyDecision({action: 'keep'})

    expect(listener).not.toHaveBeenCalled()

    store.destroy()
  })

  it('does not call writeCart when action is keep', () => {
    const store = createCartStore(TEST_KEY)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    store.applyDecision({action: 'keep'})

    expect(setItemSpy).not.toHaveBeenCalled()

    store.destroy()
  })
})

describe('createCartStore - cross-tab sync (echo-loop guard)', () => {
  it('updates getItems() and notifies when a matching StorageEvent fires', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    const incomingItems = [makeCartItem('doc-cross-tab')]
    const storageEvent = new StorageEvent('storage', {
      key: TEST_KEY,
      newValue: JSON.stringify(incomingItems),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(store.getItems()).toEqual(incomingItems)
    expect(listener).toHaveBeenCalledWith(incomingItems)

    store.destroy()
  })

  it('does NOT call writeCart (setItem) on the incoming storage-event path (echo-loop guard)', () => {
    const store = createCartStore(TEST_KEY)

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const incomingItems = [makeCartItem('doc-cross-tab')]
    const storageEvent = new StorageEvent('storage', {
      key: TEST_KEY,
      newValue: JSON.stringify(incomingItems),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(setItemSpy).not.toHaveBeenCalled()

    store.destroy()
  })

  it('ignores storage events for unrelated keys', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    const storageEvent = new StorageEvent('storage', {
      key: 'some-other-key',
      newValue: JSON.stringify([makeCartItem('doc-1')]),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(listener).not.toHaveBeenCalled()
    expect(store.getItems()).toEqual([])

    store.destroy()
  })
})

describe('createCartStore - subscribe / unsubscribe', () => {
  it('does not call the listener synchronously on subscribe (consumers read getItems())', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    expect(listener).not.toHaveBeenCalled()

    store.destroy()
  })

  it('unsubscribe returned by subscribe stops further notifications', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.applyDecision({action: 'add', item: makeCartItem('doc-1')})

    expect(listener).not.toHaveBeenCalled()

    store.destroy()
  })

  it('multiple subscribers each receive notifications', () => {
    const store = createCartStore(TEST_KEY)
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    store.subscribe(listenerA)
    store.subscribe(listenerB)

    store.applyDecision({action: 'add', item: makeCartItem('doc-1')})

    expect(listenerA).toHaveBeenCalledOnce()
    expect(listenerB).toHaveBeenCalledOnce()

    store.destroy()
  })
})

describe('createCartStore - destroy', () => {
  it('detaches storage listener so later storage events do not notify', () => {
    const store = createCartStore(TEST_KEY)
    const listener = vi.fn()
    store.subscribe(listener)

    store.destroy()

    const storageEvent = new StorageEvent('storage', {
      key: TEST_KEY,
      newValue: JSON.stringify([makeCartItem('doc-1')]),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(listener).not.toHaveBeenCalled()
  })
})
