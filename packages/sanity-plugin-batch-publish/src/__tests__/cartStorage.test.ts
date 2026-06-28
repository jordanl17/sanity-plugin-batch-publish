import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import type {CartItem} from '../types'
import {buildCartStorageKey, readCart, subscribeToCartStorage, writeCart} from '../cartStorage'

function makeCartItem(publishedId: string): CartItem {
  return {
    publishedId,
    draftId: `drafts.${publishedId}`,
    documentType: 'article',
    addedRev: 'rev-abc',
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('buildCartStorageKey', () => {
  it('encodes all four scope parts in the key', () => {
    const key = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'default',
      userId: 'user-alice',
    })
    expect(key).toBe('sanity-plugin-batch-publish:cart:proj1:production:default:user-alice')
  })

  it('produces a distinct key when userId differs', () => {
    const aliceKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'default',
      userId: 'user-alice',
    })
    const bobKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'default',
      userId: 'user-bob',
    })
    expect(aliceKey).not.toBe(bobKey)
  })

  it('produces a distinct key when workspace differs', () => {
    const workspaceAKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'workspace-a',
      userId: 'user-alice',
    })
    const workspaceBKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'workspace-b',
      userId: 'user-alice',
    })
    expect(workspaceAKey).not.toBe(workspaceBKey)
  })

  it('produces a distinct key when dataset differs', () => {
    const prodKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'production',
      workspace: 'default',
      userId: 'user-alice',
    })
    const stagingKey = buildCartStorageKey({
      projectId: 'proj1',
      dataset: 'staging',
      workspace: 'default',
      userId: 'user-alice',
    })
    expect(prodKey).not.toBe(stagingKey)
  })
})

describe('writeCart / readCart round-trip', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a CartItem[] through write then read', () => {
    const key = 'test-round-trip-key'
    const items: CartItem[] = [makeCartItem('doc-1'), makeCartItem('doc-2')]
    writeCart(key, items)
    const result = readCart(key)
    expect(result).toEqual(items)
  })

  it('readCart returns [] for an absent key', () => {
    const result = readCart('nonexistent-key')
    expect(result).toEqual([])
  })

  it('readCart returns [] for malformed JSON', () => {
    localStorage.setItem('bad-json-key', '{bad')
    const result = readCart('bad-json-key')
    expect(result).toEqual([])
  })

  it('readCart returns [] for a non-array JSON payload', () => {
    localStorage.setItem('non-array-key', JSON.stringify({publishedId: 'doc-1'}))
    const result = readCart('non-array-key')
    expect(result).toEqual([])
  })

  it('readCart drops entries missing required string publishedId', () => {
    const validItem = makeCartItem('doc-valid')
    const malformedItem = {draftId: 'drafts.doc-bad', documentType: 'article'}
    localStorage.setItem('mixed-key', JSON.stringify([validItem, malformedItem]))
    const result = readCart('mixed-key')
    expect(result).toEqual([validItem])
  })

  it('readCart drops entries missing required string draftId', () => {
    const validItem = makeCartItem('doc-valid')
    const malformedItem = {publishedId: 'doc-bad', documentType: 'article'}
    localStorage.setItem('mixed-key-2', JSON.stringify([validItem, malformedItem]))
    const result = readCart('mixed-key-2')
    expect(result).toEqual([validItem])
  })
})

describe('SSR guard', () => {
  let originalLocalStorage: Storage

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  it('readCart returns [] when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    expect(() => readCart('any-key')).not.toThrow()
    expect(readCart('any-key')).toEqual([])
  })

  it('writeCart does not throw when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    expect(() => writeCart('any-key', [makeCartItem('doc-1')])).not.toThrow()
  })

  it('subscribeToCartStorage returns a no-op unsubscribe when window is unavailable', () => {
    const savedWindow = globalThis.window
    // @ts-expect-error - intentionally setting window to undefined for SSR test
    globalThis.window = undefined
    try {
      const unsubscribe = subscribeToCartStorage('any-key', () => {
        // should never be called
      })
      expect(unsubscribe).toBeTypeOf('function')
      expect(() => unsubscribe()).not.toThrow()
    } finally {
      globalThis.window = savedWindow
    }
  })
})

describe('subscribeToCartStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('calls onChange with parsed items when a matching StorageEvent fires', () => {
    const key = 'sync-test-key'
    const items = [makeCartItem('doc-cross-tab')]
    const onChange = vi.fn()

    const unsubscribe = subscribeToCartStorage(key, onChange)

    const storageEvent = new StorageEvent('storage', {
      key,
      newValue: JSON.stringify(items),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(items)

    unsubscribe()
  })

  it('does NOT call onChange for a non-matching storage key', () => {
    const watchedKey = 'my-watched-key'
    const onChange = vi.fn()

    const unsubscribe = subscribeToCartStorage(watchedKey, onChange)

    const storageEvent = new StorageEvent('storage', {
      key: 'some-other-key',
      newValue: JSON.stringify([makeCartItem('doc-1')]),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(onChange).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('calls onChange with [] when newValue is null (item cleared from another tab)', () => {
    const key = 'null-value-key'
    const onChange = vi.fn()

    const unsubscribe = subscribeToCartStorage(key, onChange)

    const storageEvent = new StorageEvent('storage', {
      key,
      newValue: null,
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(onChange).toHaveBeenCalledWith([])

    unsubscribe()
  })

  it('unsubscribe detaches the listener so later events do not call onChange', () => {
    const key = 'unsubscribe-test-key'
    const onChange = vi.fn()

    const unsubscribe = subscribeToCartStorage(key, onChange)
    unsubscribe()

    const storageEvent = new StorageEvent('storage', {
      key,
      newValue: JSON.stringify([makeCartItem('doc-1')]),
      storageArea: localStorage,
    })
    window.dispatchEvent(storageEvent)

    expect(onChange).not.toHaveBeenCalled()
  })
})
