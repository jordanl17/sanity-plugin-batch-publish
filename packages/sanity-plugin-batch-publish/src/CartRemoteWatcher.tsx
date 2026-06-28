import React, {useEffect, useRef} from 'react'
import {useCurrentUser, useDocumentStore, useWorkspace} from 'sanity'
import type {LayoutProps} from 'sanity'

import {buildCartStorageKey} from './cartStorage'
import {createCartRemoteWatcher} from './createCartRemoteWatcher'
import {getCartStore, clearCartStoreRegistry} from './CartDocumentObserver'
import type {BatchPublishPluginConfig} from './types'

export {clearCartStoreRegistry}

/**
 * Factory that returns a CartRemoteWatcher component closed over the plugin config.
 *
 * The returned component is registered at `studio.components.layout` and mounts once
 * per workspace inside the StudioProvider. On mount it resolves the shared scoped cart
 * store and starts `createCartRemoteWatcher` exactly once, maintaining per-cart-item
 * subscriptions to the DRAFT remote-snapshot stream for the lifetime of the component.
 * A ref guard prevents double-invocation under React 18 StrictMode. Calls `stop()` on
 * unmount to tear down all subscriptions.
 *
 * @public
 */
export function makeCartRemoteWatcher(config?: BatchPublishPluginConfig) {
  /**
   * App-level layout component registered via `studio.components.layout`.
   *
   * Resolves the shared scoped cart store and starts the remote-snapshot watcher once
   * on mount. Renders the Studio unchanged via `props.renderDefault`.
   *
   * @public
   */
  function CartRemoteWatcherComponent(props: LayoutProps): React.JSX.Element {
    const workspace = useWorkspace()
    const currentUser = useCurrentUser()
    const documentStore = useDocumentStore()

    const hasStartedRef = useRef(false)

    useEffect(() => {
      if (currentUser === null || currentUser === undefined) {
        return undefined
      }

      if (hasStartedRef.current) {
        return undefined
      }
      hasStartedRef.current = true

      const storageKey = buildCartStorageKey({
        projectId: workspace.projectId,
        dataset: workspace.dataset,
        workspace: workspace.name,
        userId: currentUser.id,
      })

      const cartStore = getCartStore(storageKey)

      const watcher = createCartRemoteWatcher({
        documentStore,
        cartStore,
        currentUserId: currentUser.id,
      })

      return function cleanup() {
        watcher.stop()
      }
    }, [workspace, currentUser, documentStore])

    return props.renderDefault(props)
  }

  // Suppress the unused parameter warning; config is available for future use.
  void config

  return CartRemoteWatcherComponent
}

/**
 * Zero-config convenience export — a CartRemoteWatcher with no plugin config bound.
 *
 * The plugin's `index.ts` creates a config-bound version via `makeCartRemoteWatcher(config)`.
 * This export is for tests and consumers that do not need config.
 *
 * @public
 */
export const CartRemoteWatcher = makeCartRemoteWatcher()
