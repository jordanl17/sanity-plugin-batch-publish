import {addItem, removeItem} from './cartSet'
import {readCart, subscribeToCartStorage, writeCart} from './cartStorage'
import type {CartMembershipDecision} from './evaluateCartMembership'
import type {CartItem} from './types'

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
   * - `add`: upserts the item (advancing addedRev, freezing addedAt).
   * - `remove`: drops the item with the given publishedId.
   * - `keep`: no-op; no notification, no write.
   */
  applyDecision(decision: CartMembershipDecision): void
  /**
   * Detaches the cross-tab storage listener and clears subscribers.
   * Call when the owning scope is torn down.
   */
  destroy(): void
}

/**
 * Creates a cart store backed by the given scoped localStorage key.
 *
 * On construction, re-hydrates from whatever is already in localStorage under that key.
 * Cross-tab changes arrive via storage events (echo-loop guarded: incoming events update
 * in-memory state and notify subscribers but never call writeCart again).
 *
 * @public
 */
export function createCartStore(key: string): CartStore {
  let items: CartItem[] = readCart(key)
  const listeners = new Set<(items: CartItem[]) => void>()

  function notify(nextItems: CartItem[]): void {
    listeners.forEach((listener) => listener(nextItems))
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

  const unsubscribeStorage = subscribeToCartStorage(key, (incomingItems) => {
    items = incomingItems
    notify(incomingItems)
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

    destroy(): void {
      unsubscribeStorage()
      listeners.clear()
    },
  }
}
