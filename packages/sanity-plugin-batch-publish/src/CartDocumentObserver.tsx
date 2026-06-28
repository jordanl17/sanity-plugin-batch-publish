import React, {useEffect, useRef} from 'react'
import {useCurrentUser, useDocumentStore, useWorkspace, getPublishedId} from 'sanity'

import {buildCartStorageKey} from './cartStorage'
import {draftHasRealContent, snapshotsMatchIgnoringMeta} from './cartSnapshot'
import {createCartStore} from './cartStore'
import {evaluateCartMembership} from './evaluateCartMembership'
import type {CartStore} from './cartStore'
import type {EditStateSnapshot, SanityDocumentSnapshot} from './cartSnapshot'
import type {BatchPublishPluginConfig} from './types'

/**
 * Minimal local interface matching `DocumentLayoutProps` from `sanity@5.13.0`.
 *
 * `DocumentLayoutProps` carries `@internal` in Sanity's source and is not re-exported
 * from the main `sanity` entry, so we redeclare the shape we need here.
 */
interface DocumentLayoutProps {
  documentId: string
  documentType: string
  renderDefault: (props: DocumentLayoutProps) => React.JSX.Element
}

/**
 * A mutation event from `documentStore.pair.documentEvents`.
 */
interface DocumentMutationEventLike {
  type: string
  origin?: 'local' | 'remote'
  document?: SanityDocumentSnapshot
}

/**
 * Observable-like with a subscribe method (minimal interface for RxJS Observable).
 */
interface Subscribable<T> {
  subscribe(observer: (value: T) => void): {unsubscribe(): void}
}

/**
 * Module-level registry: one CartStore per scoped key across all mounted observers and hooks.
 */
const cartStoreRegistry = new Map<string, CartStore>()

/**
 * Returns the shared CartStore for the given key, creating it once on first access.
 * Internal; not exported as public API.
 */
function getCartStore(key: string): CartStore {
  const existing = cartStoreRegistry.get(key)
  if (existing !== undefined) {
    return existing
  }
  const store = createCartStore(key)
  cartStoreRegistry.set(key, store)
  return store
}

/**
 * Factory that returns a CartDocumentObserver component closed over the plugin config.
 *
 * Used by the plugin's `document.components.unstable_layout` registration so that the
 * component receives plugin configuration without needing React context.
 *
 * The returned component mounts per opened document (via `unstable_layout` — note:
 * `@internal` in sanity@5.13.0, carries `unstable_` prefix), subscribes to that
 * document's local mutation stream, feeds decisions to the shared singleton cart store,
 * and renders the document pane unchanged via `props.renderDefault`.
 */
export function makeCartDocumentObserver(config?: BatchPublishPluginConfig) {
  /**
   * Per-document observer component registered via `document.components.unstable_layout`.
   *
   * Subscribes to the document's local mutation events and editState while mounted.
   * On each local mutation, evaluates cart membership and applies the decision to the
   * shared singleton cart store. Renders the document pane unchanged.
   *
   * @public
   */
  function CartDocumentObserver(props: DocumentLayoutProps): React.JSX.Element {
    const workspace = useWorkspace()
    const currentUser = useCurrentUser()
    const documentStore = useDocumentStore()

    const publishedId = getPublishedId(props.documentId)
    const {documentType} = props

    const editStateRef = useRef<EditStateSnapshot | null>(null)

    useEffect(() => {
      if (currentUser === null || currentUser === undefined) {
        return undefined
      }

      const storageKey = buildCartStorageKey({
        projectId: workspace.projectId,
        dataset: workspace.dataset,
        workspace: workspace.name,
        userId: currentUser.id,
      })
      const cartStore = getCartStore(storageKey)

      const editStateObservable = documentStore.pair.editState(
        publishedId,
        documentType,
      ) as unknown as Subscribable<EditStateSnapshot>

      const editStateSub = editStateObservable.subscribe((editState) => {
        editStateRef.current = editState
      })

      const documentEventsObservable = documentStore.pair.documentEvents(
        publishedId,
        documentType,
      ) as unknown as Subscribable<DocumentMutationEventLike>

      const eventsSub = documentEventsObservable.subscribe((event) => {
        if (event.type !== 'mutation' || event.origin !== 'local') {
          return
        }

        const currentEditState = editStateRef.current
        const draft = currentEditState?.draft ?? null
        const published = currentEditState?.published ?? null
        const isLiveEditType = currentEditState?.liveEditSchemaType ?? false
        const ready = currentEditState?.ready ?? false

        const draftWithContent =
          draft !== null && event.document !== undefined
            ? draftHasRealContent(event.document)
            : draft !== null && draftHasRealContent(draft)

        const matchesPublished =
          draft !== null && published !== null
            ? snapshotsMatchIgnoringMeta(draft, published)
            : false

        const alreadyTracked = cartStore.getItems().some((item) => item.publishedId === publishedId)

        const decision = evaluateCartMembership(
          {
            publishedId,
            documentType,
            isLiveEditType,
            draft: draft ? {_id: draft._id, _rev: draft._rev} : null,
            published: published ? {_id: published._id, _rev: published._rev} : null,
            draftHasContent: draftWithContent,
            matchesPublished,
            alreadyTracked,
            definitive: ready,
          },
          new Date().toISOString(),
          config,
        )

        cartStore.applyDecision(decision)
      })

      return function cleanup() {
        editStateSub.unsubscribe()
        eventsSub.unsubscribe()
      }
    }, [publishedId, documentType, currentUser, workspace, documentStore])

    return props.renderDefault(props)
  }

  return CartDocumentObserver
}

/**
 * Exported singleton observer component (zero-config).
 *
 * This is a convenience export for tests and consumers that do not need config.
 * The plugin's `index.ts` creates a config-bound version via `makeCartDocumentObserver(config)`.
 *
 * @public
 */
export const CartDocumentObserver = makeCartDocumentObserver()

export {getCartStore}

/**
 * Clears the module-level CartStore registry.
 * Intended for use in tests only - allows test isolation when stores carry state between cases.
 *
 * @internal
 */
export function clearCartStoreRegistry(): void {
  cartStoreRegistry.forEach((store) => store.destroy())
  cartStoreRegistry.clear()
}
