import {applyRemoteRevChange, clearFlagAndAdvanceBaseline} from './cartFlag'
import {addItem, removeItem} from './cartSet'
import {readCart, subscribeToCartStorage, writeCart} from './cartStorage'
import type {CartMembershipDecision} from './evaluateCartMembership'
import type {CartItem} from './types'

/**
 * Options for `createCartStore`.
 *
 * @public
 */
export interface CartStoreOptions {
  /**
   * Milliseconds to wait after the last `ownByCurrentUser` call before writing the updated
   * baseline to localStorage. In-memory state and subscriber notifications are immediate;
   * only the persistence write is debounced. Defaults to 750ms.
   */
  baselineWriteDebounceMs?: number
}

/**
 * An observable singleton cart store for one scoped localStorage key.
 *
 * Consumers read the current state via `getItems()`, subscribe to changes via `subscribe()`,
 * and feed membership decisions via `applyDecision()`. The store write-throughs to
 * localStorage on every mutation and syncs cross-tab via storage events.
 *
 * @public
 */
export interface CartStore {
  /** Returns the current in-memory CartItem snapshot. */
  getItems(): CartItem[]
  /**
   * Registers a listener that fires with the new items array on every state change.
   * The listener is NOT called synchronously on subscribe - consumers read getItems().
   * Returns an unsubscribe function.
   */
  subscribe(listener: (items: CartItem[]) => void): () => void
  /**
   * Applies a cart membership decision from `evaluateCartMembership`.
   * - `add`: upserts the item (advancing addedRev, freezing addedAt, preserving baselineRev and changedUnderneath).
   * - `remove`: drops the item with the given publishedId.
   * - `keep`: no-op; no notification, no write.
   */
  applyDecision(decision: CartMembershipDecision): void
  /**
   * Sets `changedUnderneath` for a tracked item based on whether the live rev diverges from the
   * stored baseline and the change is not attributable to the current user.
   *
   * Writes through to localStorage immediately when the flag state changes. Is a no-op when:
   * - The publishedId is not tracked.
   * - The computed flag state matches the existing state (no-op identity).
   */
  markChangedUnderneath(publishedId: string, currentRev: string, isCurrentUserAuthor: boolean): void
  /**
   * Atomically clears the `changedUnderneath` flag and advances `baselineRev` to `currentRev`
   * for the tracked item. Applies the state change and notifies subscribers immediately; the
   * localStorage write is trailing-edge debounced to coalesce rapid successive calls (e.g. a
   * user typing into a field).
   *
   * Is a no-op when the publishedId is not tracked.
   */
  ownByCurrentUser(publishedId: string, currentRev: string): void
  /**
   * Detaches the cross-tab storage listener and clears subscribers. Flushes any pending
   * debounced baseline write before tearing down.
   * Call when the owning scope is torn down.
   */
  destroy(): void
}

/**
 * Normalises a cart item hydrated from localStorage to ensure the fields added in Phase 3
 * are present even when the persisted payload pre-dates this version.
 *
 * Defaults `baselineRev` to `addedRev` and `changedUnderneath` to `false` when absent.
 *
 * @internal
 */
export function normalizeCartItem(item: CartItem): CartItem {
  const hasBaselineRev = typeof (item as {baselineRev?: unknown}).baselineRev === 'string'
  const hasChangedUnderneath =
    typeof (item as {changedUnderneath?: unknown}).changedUnderneath === 'boolean'

  if (hasBaselineRev && hasChangedUnderneath) {
    return item
  }

  return {
    ...item,
    baselineRev: hasBaselineRev ? (item as {baselineRev: string}).baselineRev : item.addedRev,
    changedUnderneath: hasChangedUnderneath
      ? (item as {changedUnderneath: boolean}).changedUnderneath
      : false,
  }
}

const DEFAULT_BASELINE_WRITE_DEBOUNCE_MS = 750

/**
 * Creates a cart store backed by the given scoped localStorage key.
 *
 * On construction, re-hydrates from whatever is already in localStorage under that key.
 * Items missing Phase 3 fields (`baselineRev`, `changedUnderneath`) are normalised on load.
 * Cross-tab changes arrive via storage events (echo-loop guarded: incoming events update
 * in-memory state and notify subscribers but never call writeCart again).
 *
 * @public
 */
export function createCartStore(key: string, options?: CartStoreOptions): CartStore {
  const debounceMs = options?.baselineWriteDebounceMs ?? DEFAULT_BASELINE_WRITE_DEBOUNCE_MS

  let items: CartItem[] = readCart(key).map(normalizeCartItem)
  const listeners = new Set<(items: CartItem[]) => void>()

  let pendingBaselineWriteTimer: ReturnType<typeof setTimeout> | null = null

  function notify(nextItems: CartItem[]): void {
    listeners.forEach((listener) => listener(nextItems))
  }

  function flushPendingBaselineWrite(): void {
    if (pendingBaselineWriteTimer !== null) {
      clearTimeout(pendingBaselineWriteTimer)
      pendingBaselineWriteTimer = null
      writeCart(key, items)
    }
  }

  function scheduleBaselineWrite(): void {
    if (pendingBaselineWriteTimer !== null) {
      clearTimeout(pendingBaselineWriteTimer)
    }
    pendingBaselineWriteTimer = setTimeout(function persistBaseline() {
      pendingBaselineWriteTimer = null
      writeCart(key, items)
    }, debounceMs)
  }

  function applyDecision(decision: CartMembershipDecision): void {
    let nextItems: CartItem[]

    if (decision.action === 'add') {
      nextItems = addItem(items, decision.item, new Date().toISOString())
    } else if (decision.action === 'remove') {
      nextItems = removeItem(items, decision.publishedId)
    } else {
      return
    }

    if (nextItems === items) {
      return
    }

    items = nextItems
    writeCart(key, nextItems)
    notify(nextItems)
  }

  function markChangedUnderneath(
    publishedId: string,
    currentRev: string,
    isCurrentUserAuthor: boolean,
  ): void {
    const nextItems = items.map((item) => {
      if (item.publishedId === publishedId) {
        return applyRemoteRevChange(item, currentRev, isCurrentUserAuthor)
      }
      return item
    })

    const unchanged = nextItems.every((item, index) => item === items[index])
    if (unchanged) {
      return
    }

    items = nextItems
    writeCart(key, nextItems)
    notify(nextItems)
  }

  function ownByCurrentUser(publishedId: string, currentRev: string): void {
    const nextItems = items.map((item) => {
      if (item.publishedId === publishedId) {
        return clearFlagAndAdvanceBaseline(item, currentRev)
      }
      return item
    })

    const unchanged = nextItems.every((item, index) => item === items[index])
    if (unchanged) {
      return
    }

    items = nextItems
    notify(nextItems)
    scheduleBaselineWrite()
  }

  const unsubscribeStorage = subscribeToCartStorage(key, (incomingItems) => {
    items = incomingItems.map(normalizeCartItem)
    notify(items)
  })

  return {
    getItems(): CartItem[] {
      return items
    },

    subscribe(listener: (items: CartItem[]) => void): () => void {
      listeners.add(listener)
      return function unsubscribe(): void {
        listeners.delete(listener)
      }
    },

    applyDecision,
    markChangedUnderneath,
    ownByCurrentUser,

    destroy(): void {
      flushPendingBaselineWrite()
      unsubscribeStorage()
      listeners.clear()
    },
  }
}
