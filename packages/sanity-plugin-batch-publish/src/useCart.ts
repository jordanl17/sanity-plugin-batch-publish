import {useSyncExternalStore} from 'react'
import {useCurrentUser, useWorkspace} from 'sanity'

import {buildCartStorageKey} from './cartStorage'
import {getCartStore} from './CartDocumentObserver'
import type {BatchPublishPluginConfig} from './types'
import type {CartItem} from './types'

const EMPTY_ITEMS: CartItem[] = []

/**
 * Exposes the singleton cart store's current items to React consumers and provides a
 * `remove` action to exclude an item from the cart.
 *
 * Resolves the scoped storage key from the current workspace and logged-in user,
 * then subscribes to the shared CartStore via `useSyncExternalStore` so the component
 * re-renders whenever the cart changes (from local edits or cross-tab sync).
 *
 * `remove(publishedId)` excludes the item with the given publishedId from the cart via
 * `applyDecision({action: 'remove'})`. It is a safe no-op when no user is logged in.
 *
 * Returns `{items: [], remove}` when no user is logged in (no scoped key can be derived).
 *
 * @public
 */
export function useCart(_config?: BatchPublishPluginConfig): {
  items: CartItem[]
  remove: (publishedId: string) => void
} {
  const workspace = useWorkspace()
  const currentUser = useCurrentUser()

  const storageKey =
    currentUser !== null && currentUser !== undefined
      ? buildCartStorageKey({
          projectId: workspace.projectId,
          dataset: workspace.dataset,
          workspace: workspace.name,
          userId: currentUser.id,
        })
      : null

  const cartStore = storageKey !== null ? getCartStore(storageKey) : null

  function remove(publishedId: string): void {
    cartStore?.applyDecision({action: 'remove', publishedId})
  }

  const items = useSyncExternalStore(
    cartStore !== null
      ? cartStore.subscribe
      : function noOpSubscribe() {
          return function noOpUnsubscribe() {
            // no-op: no store
          }
        },
    cartStore !== null
      ? cartStore.getItems
      : function getEmptyItems() {
          return EMPTY_ITEMS
        },
  )

  if (cartStore === null) {
    return {items: EMPTY_ITEMS, remove}
  }

  return {items, remove}
}
