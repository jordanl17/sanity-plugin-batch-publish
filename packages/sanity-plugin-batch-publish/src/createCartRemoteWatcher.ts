import type {EditStateSnapshot} from './cartSnapshot'
import type {CartItem} from './types'

/**
 * Minimal observable-like interface (mirrors the shape used throughout this codebase;
 * no rxjs dependency).
 *
 * @internal
 */
interface Subscribable<T> {
  subscribe(observer: (value: T) => void): {unsubscribe(): void}
}

/**
 * A remote-snapshot event from the DRAFT remote-snapshot stream.
 *
 * The stream emits both `SnapshotEvent` (initial snapshot) and `DocumentRemoteMutationEvent`
 * (every remote transaction). Only `remoteMutation` events carry `author`.
 *
 * @internal
 */
interface RemoteSnapshotEventLike {
  type: string
  /** Present on `remoteMutation` events. Mapped from the listener's `identity` field. */
  author?: string | null
  /** Head document snapshot — `_rev` is the live draft rev at the time of the mutation. */
  head?: {_rev?: string}
}

/**
 * Minimal interface for the document store used by the watcher.
 * Exposes only the streams the watcher needs:
 *  - `checkoutPair` for the per-item remote-snapshot and events streams.
 *  - `pair.editState` for the editState fallback ref.
 *
 * `draft.events` is subscribed alongside `remoteSnapshot$` to drive the checkout's
 * realtime listener; without an active `events` subscriber the listener never starts
 * and `remoteSnapshot$` only delivers the initial snapshot event.
 *
 * @internal
 */
interface DocumentStoreLike {
  checkoutPair?: (idPair: {draftId: string; publishedId: string}) => {
    draft: {
      remoteSnapshot$: Subscribable<RemoteSnapshotEventLike>
      events: Subscribable<unknown>
    }
  }
  pair?: {
    editState?: (publishedId: string, documentType: string) => Subscribable<EditStateSnapshot>
  }
}

/**
 * Minimal cart store interface used by the watcher.
 *
 * @internal
 */
interface CartStoreLike {
  getItems(): CartItem[]
  subscribe(listener: (items: CartItem[]) => void): () => void
  markChangedUnderneath(publishedId: string, currentRev: string, isCurrentUserAuthor: boolean): void
}

/**
 * Per-item subscription bundle: holds teardowns for the remote-snapshot, events, and
 * editState subscriptions.
 *
 * @internal
 */
interface ItemSubscription {
  remoteSnapshotUnsub: () => void
  eventsUnsub: () => void
  editStateUnsub: () => void
}

/**
 * Params for `createCartRemoteWatcher`.
 *
 * @public
 */
export interface CartRemoteWatcherParams {
  documentStore: unknown
  cartStore: CartStoreLike
  currentUserId: string
}

/**
 * Maps a possibly-falsy author value to `isCurrentUserAuthor`.
 *
 * Falsy author (empty string, null, undefined) → false (treat as remote) because an
 * unresolved author is safer to flag than to silently ignore.
 */
function resolveIsCurrentUserAuthor(
  author: string | null | undefined,
  currentUserId: string,
): boolean {
  if (author === undefined || author === null || author === '') {
    return false
  }
  return author === currentUserId
}

/**
 * Builds a per-item subscription to the DRAFT remote-snapshot stream.
 *
 * Subscribes to both `pair.draft.events` and `pair.draft.remoteSnapshot$`. The `events`
 * subscription drives the checkout's realtime listener — without it the listener is never
 * started and `remoteSnapshot$` only delivers the initial snapshot event and no live
 * `remoteMutation` events.
 *
 * On each `remoteMutation` event:
 *  1. Resolves the current draft rev from `event.head._rev` (the authoritative post-mutation
 *     rev), falling back to the per-item editState ref when `head._rev` is absent.
 *  2. Computes `isCurrentUserAuthor` (falsy author → false).
 *  3. Calls `cartStore.markChangedUnderneath` — the store's flag logic decides whether to set
 *     or clear the flag based on whether the rev diverges from the baseline.
 *
 * Also maintains a lightweight editState subscription that keeps a local ref current as a
 * fallback rev source when `event.head._rev` is absent.
 */
function buildItemSubscription(
  item: CartItem,
  documentStore: DocumentStoreLike,
  cartStore: CartStoreLike,
  currentUserId: string,
): ItemSubscription | null {
  const checkoutPair = documentStore.checkoutPair
  const editStateFn = documentStore.pair?.editState

  if (checkoutPair === undefined || checkoutPair === null) {
    return null
  }

  const idPair = {draftId: item.draftId, publishedId: item.publishedId}

  // Keep a local editState ref as a fallback rev source when event.head._rev is absent.
  let editStateRef: EditStateSnapshot | null = null

  let editStateUnsub: () => void = function noop() {}

  if (editStateFn !== undefined && editStateFn !== null) {
    const editStateSub = editStateFn(item.publishedId, item.documentType).subscribe((editState) => {
      editStateRef = editState
    })
    editStateUnsub = function unsubscribeEditState() {
      editStateSub.unsubscribe()
    }
  }

  const pair = checkoutPair(idPair)

  // Subscribe to pair.draft.events to drive the checkout's realtime listener.
  // Without an active subscriber here, the pair listener never starts and
  // remoteSnapshot$ delivers only the initial snapshot — no live remoteMutation events.
  const eventsSub = pair.draft.events.subscribe(function handleDraftEvent(_event: unknown) {
    // No-op: the subscription exists solely to keep the pair listener active.
  })
  const eventsUnsub = function unsubscribeEvents() {
    eventsSub.unsubscribe()
  }

  const remoteSnapshotSub = pair.draft.remoteSnapshot$.subscribe(
    (event: RemoteSnapshotEventLike) => {
      if (event.type !== 'remoteMutation') {
        // Ignore initial snapshot events and any other non-mutation events.
        return
      }

      // Prefer event.head._rev — the authoritative post-mutation rev delivered with the
      // event itself. Fall back to editState when head._rev is absent (e.g. deletions).
      const currentRev = event.head?._rev ?? editStateRef?.draft?._rev
      if (currentRev === undefined) {
        return
      }

      const isCurrentUserAuthor = resolveIsCurrentUserAuthor(event.author, currentUserId)
      cartStore.markChangedUnderneath(item.publishedId, currentRev, isCurrentUserAuthor)
    },
  )

  return {
    remoteSnapshotUnsub: function unsubscribeRemoteSnapshot() {
      remoteSnapshotSub.unsubscribe()
    },
    eventsUnsub,
    editStateUnsub,
  }
}

/**
 * Creates a Studio-wide watcher that maintains a per-cart-item subscription to the DRAFT
 * remote-snapshot stream (`documentStore.checkoutPair(idPair).draft.remoteSnapshot$`).
 *
 * For each item the watcher also subscribes to `pair.draft.events` to drive the checkout's
 * realtime listener (without this, `remoteSnapshot$` only delivers the initial snapshot and
 * no live `remoteMutation` events). An editState subscription provides a fallback rev source
 * when `event.head._rev` is absent.
 *
 * On each `remoteMutation` event, the watcher resolves the live draft rev from
 * `event.head._rev` (authoritative) and calls `cartStore.markChangedUnderneath`. The store's
 * own flag logic (`applyRemoteRevChange`) decides whether to set or clear the flag.
 *
 * The subscription set reconciles as items enter and leave the cart: a new subscription is
 * opened when an item is added, and all three subscriptions are torn down when the item is
 * removed. On `stop()`, all subscriptions are torn down and the cart-store listener is
 * detached.
 *
 * Availability guard: when `documentStore.checkoutPair` is absent (SSR or stripped build),
 * returns a no-op `{stop(){}}`.
 *
 * @public
 */
export function createCartRemoteWatcher(params: CartRemoteWatcherParams): {stop(): void} {
  const documentStore = params.documentStore as DocumentStoreLike
  const {cartStore, currentUserId} = params

  if (documentStore === undefined || documentStore === null) {
    return {stop(): void {}}
  }

  const checkoutPair = documentStore.checkoutPair
  if (checkoutPair === undefined || checkoutPair === null) {
    return {stop(): void {}}
  }

  // Map from publishedId → teardown bundle for the active subscriptions.
  const itemSubscriptions = new Map<string, ItemSubscription>()

  /**
   * Opens remote-snapshot, events, and editState subscriptions for a cart item if not
   * already open. Guards against double-subscribe for the same publishedId.
   */
  function subscribeItem(item: CartItem): void {
    if (itemSubscriptions.has(item.publishedId)) {
      return
    }

    const sub = buildItemSubscription(item, documentStore, cartStore, currentUserId)
    if (sub !== null) {
      itemSubscriptions.set(item.publishedId, sub)
    }
  }

  /**
   * Tears down all subscriptions for the given publishedId and removes it from the map.
   */
  function unsubscribeItem(publishedId: string): void {
    const sub = itemSubscriptions.get(publishedId)
    if (sub === undefined) {
      return
    }
    sub.remoteSnapshotUnsub()
    sub.eventsUnsub()
    sub.editStateUnsub()
    itemSubscriptions.delete(publishedId)
  }

  /**
   * Reconciles the active subscription set against the current cart membership.
   *
   * - Opens subscriptions for items not yet watched.
   * - Tears down subscriptions for items no longer in the cart.
   */
  function reconcile(currentItems: CartItem[]): void {
    const currentIds = new Set(currentItems.map((item) => item.publishedId))

    // Open subscriptions for newly-added items.
    currentItems.forEach((item) => subscribeItem(item))

    // Remove subscriptions for items no longer in the cart.
    itemSubscriptions.forEach((_sub, publishedId) => {
      if (currentIds.has(publishedId)) {
        return
      }
      unsubscribeItem(publishedId)
    })
  }

  // Subscribe to the initial cart membership.
  reconcile(cartStore.getItems())

  // Track cart membership changes to reconcile subscriptions as items enter/leave.
  const unsubscribeCartStore = cartStore.subscribe((items: CartItem[]) => {
    reconcile(items)
  })

  return {
    stop(): void {
      unsubscribeCartStore()
      itemSubscriptions.forEach((_sub, publishedId) => {
        unsubscribeItem(publishedId)
      })
      itemSubscriptions.clear()
    },
  }
}
