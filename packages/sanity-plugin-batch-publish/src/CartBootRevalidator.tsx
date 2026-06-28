import React, {useEffect, useRef} from 'react'
import {useCurrentUser, useDocumentStore, useWorkspace} from 'sanity'
import type {LayoutProps} from 'sanity'

import {buildCartStorageKey} from './cartStorage'
import {getCartStore, clearCartStoreRegistry} from './CartDocumentObserver'
import {revalidateCartOnBoot} from './revalidateCartOnBoot'
import type {BatchPublishPluginConfig} from './types'

export {clearCartStoreRegistry}

/**
 * Factory that returns a CartBootRevalidator component closed over the plugin config.
 *
 * The returned component is registered at `studio.components.layout` and mounts once
 * per workspace inside the StudioProvider. On mount it resolves the shared scoped cart
 * store and runs `revalidateCartOnBoot` exactly once, silently dropping any cart items
 * that stopped qualifying while the tab was closed (published, discarded, or reverted
 * elsewhere). A ref guard prevents double-invocation under React 18 StrictMode.
 *
 * @public
 */
export function makeCartBootRevalidator(config?: BatchPublishPluginConfig) {
  /**
   * App-level layout component registered via `studio.components.layout`.
   *
   * Resolves the shared scoped cart store and runs the boot-time re-validation sweep
   * once on mount. Renders the Studio unchanged via `props.renderDefault`.
   *
   * @public
   */
  function CartBootRevalidatorComponent(props: LayoutProps): React.JSX.Element {
    const workspace = useWorkspace()
    const currentUser = useCurrentUser()
    const documentStore = useDocumentStore()

    const hasSweptRef = useRef(false)

    useEffect(() => {
      if (currentUser === null || currentUser === undefined) {
        return undefined
      }

      if (hasSweptRef.current) {
        return undefined
      }
      hasSweptRef.current = true

      const storageKey = buildCartStorageKey({
        projectId: workspace.projectId,
        dataset: workspace.dataset,
        workspace: workspace.name,
        userId: currentUser.id,
      })

      const cartStore = getCartStore(storageKey)
      const items = cartStore.getItems()

      revalidateCartOnBoot(documentStore, cartStore, items, config)

      return undefined
    }, [workspace, currentUser, documentStore])

    return props.renderDefault(props)
  }

  return CartBootRevalidatorComponent
}

/**
 * Zero-config convenience export — a CartBootRevalidator with no plugin config bound.
 *
 * The plugin's `index.ts` creates a config-bound version via
 * `makeCartBootRevalidator(config)`. This export is for tests and consumers that
 * do not need config.
 *
 * @public
 */
export const CartBootRevalidator = makeCartBootRevalidator()
