import {buildMembershipSnapshot} from './cartSnapshot'
import {evaluateCartMembership} from './evaluateCartMembership'
import type {EditStateSnapshot} from './cartSnapshot'
import type {CartStore} from './cartStore'
import type {BatchPublishPluginConfig, CartItem} from './types'

/**
 * Minimal observable-like interface for `documentStore.pair.editState`.
 *
 * @internal
 */
interface Subscribable<T> {
  subscribe(observer: (value: T) => void): {unsubscribe(): void}
}

/**
 * Options for `revalidateCartOnBoot`.
 *
 * @public
 */
export interface RevalidateCartOnBootOptions {
  /**
   * Per-item bound, in milliseconds, for awaiting the first ready editState
   * emission before treating the read as non-confident (and keeping the item).
   * Defaults to a few seconds; exposed mainly so tests can run fast.
   */
  readTimeoutMs?: number
}

/**
 * Minimal interface for the document store used by the boot sweep.
 *
 * @internal
 */
interface DocumentStoreLike {
  pair?: {
    editState?: (publishedId: string, documentType: string) => Subscribable<EditStateSnapshot>
  }
}

/**
 * Default bound, in milliseconds, for awaiting a single item's first ready
 * editState emission before giving up and treating the read as non-confident.
 *
 * @internal
 */
const DEFAULT_READ_TIMEOUT_MS = 4000

/**
 * Awaits the first `ready === true` emission from an editState observable.
 *
 * The real `documentStore.pair.editState` observable fetches draft + published from
 * the server and emits its ready state asynchronously, so this subscribes and waits
 * (up to `timeoutMs`) for the first ready emission rather than reading synchronously.
 *
 * Resolves with the ready editState on success. Resolves with `null` — a
 * non-confident read — when the timeout elapses before any ready emission, or when
 * the subscription throws. The caller treats `null` as `definitive: false`, keeping
 * the item (transient-failure guard).
 *
 * Always unsubscribes: on the ready emission, on timeout, and on error.
 */
function readFirstReadyEditState(
  observable: Subscribable<EditStateSnapshot>,
  timeoutMs: number,
): Promise<EditStateSnapshot | null> {
  return new Promise((resolve) => {
    let settled = false
    let subscription: {unsubscribe(): void} | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (result: EditStateSnapshot | null) => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      // A synchronous ready emission settles before `subscribe` returns, so the
      // subscription is unsubscribed by the post-subscribe guard below instead.
      if (subscription !== null) {
        subscription.unsubscribe()
      }
      resolve(result)
    }

    timer = setTimeout(() => finish(null), timeoutMs)

    try {
      subscription = observable.subscribe((editState) => {
        if (editState.ready) {
          finish(editState)
        }
      })
      if (settled) {
        subscription.unsubscribe()
      }
    } catch {
      finish(null)
    }
  })
}

/**
 * Processes a single cart item: reads its editState once, builds a snapshot,
 * evaluates membership, and applies the decision to the store. Never throws —
 * errors are isolated so one item cannot abort the whole sweep.
 */
async function processItem(
  item: CartItem,
  documentStore: DocumentStoreLike,
  cartStore: CartStore,
  config: BatchPublishPluginConfig | undefined,
  timeoutMs: number,
): Promise<void> {
  const editStateFn = documentStore.pair?.editState
  if (editStateFn === undefined || editStateFn === null) {
    return
  }

  const observable = editStateFn(item.publishedId, item.documentType)

  const editState = await readFirstReadyEditState(observable, timeoutMs).catch(() => null)

  const resolvedEditState: EditStateSnapshot =
    editState !== null
      ? editState
      : {draft: null, published: null, liveEditSchemaType: false, ready: false}

  const snapshot = buildMembershipSnapshot({
    publishedId: item.publishedId,
    documentType: item.documentType,
    editState: resolvedEditState,
    alreadyTracked: true,
  })

  const decision = evaluateCartMembership(snapshot, new Date().toISOString(), config)
  cartStore.applyDecision(decision)
}

/**
 * Eagerly re-validates every item in a re-hydrated cart on studio boot.
 *
 * For each item, reads the current `editState` once via
 * `documentStore.pair.editState`, builds a `CartMembershipSnapshot`, and applies
 * the `evaluateCartMembership` decision to the shared scoped store. Stale items
 * (published, discarded, or reverted elsewhere while the tab was closed) are
 * silently removed. Items whose snapshots cannot be confidently read (network
 * error, never-ready) are kept via the transient-failure guard (`definitive: false`).
 *
 * Resolves when all items have been processed. Per-item errors are isolated — a
 * single slow or broken document never aborts the sweep.
 *
 * SSR/availability guard: if `documentStore.pair.editState` is unavailable,
 * resolves as a no-op.
 *
 * @public
 */
export async function revalidateCartOnBoot(
  documentStore: DocumentStoreLike,
  cartStore: CartStore,
  items: CartItem[],
  config?: BatchPublishPluginConfig,
  options?: RevalidateCartOnBootOptions,
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const editStateFn = documentStore?.pair?.editState
  if (editStateFn === undefined || editStateFn === null) {
    return
  }

  const timeoutMs = options?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS

  await Promise.all(
    items.map((item) => processItem(item, documentStore, cartStore, config, timeoutMs)),
  )
}
