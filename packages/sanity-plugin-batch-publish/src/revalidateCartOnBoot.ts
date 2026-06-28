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
 * Reads the first emission from an editState observable. If it is `ready === true`,
 * resolves with it. If no synchronous emission arrives, or the first emission is not
 * ready, or the subscription throws, resolves with `null` (transient-failure guard —
 * the caller treats null as `definitive: false`, keeping the item).
 *
 * Always unsubscribes after the first emission or on error.
 */
function readFirstReadyEditState(
  observable: Subscribable<EditStateSnapshot>,
): Promise<EditStateSnapshot | null> {
  return new Promise((resolve) => {
    const collectedStates: EditStateSnapshot[] = []

    try {
      const subscription = observable.subscribe((editState) => {
        collectedStates.push(editState)
      })
      // Unsubscribe after processing synchronous emissions
      subscription.unsubscribe()

      const readyState = collectedStates.find((state) => state.ready) ?? null
      resolve(readyState)
    } catch {
      // Subscription threw — transient failure; keep the item
      resolve(null)
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
): Promise<void> {
  const editStateFn = documentStore.pair?.editState
  if (editStateFn === undefined || editStateFn === null) {
    return
  }

  const observable = editStateFn(item.publishedId, item.documentType)

  const editState = await readFirstReadyEditState(observable).catch(() => null)

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
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const editStateFn = documentStore?.pair?.editState
  if (editStateFn === undefined || editStateFn === null) {
    return
  }

  await Promise.all(items.map((item) => processItem(item, documentStore, cartStore, config)))
}
