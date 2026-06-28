import {isCartCandidate} from './isCartCandidate'
import type {BatchPublishPluginConfig, CartItem} from './types'

/**
 * A snapshot of a document's current edit state, as observed by the caller.
 *
 * `definitive` should be set to false when the snapshot is based on a transient or
 * uncertain read (e.g. during a network hiccup). When false, the evaluator always
 * returns `keep` to avoid silently dropping tracked items on flaky reads.
 *
 * @public
 */
export interface CartMembershipSnapshot {
  /** The published document id (cart set key). */
  publishedId: string
  /** The schema `_type` of the document. */
  documentType: string
  /** Whether the schema type has `liveEdit: true` (resolved by caller). */
  isLiveEditType: boolean
  /** The current draft document, or null when no draft exists. */
  draft: {_id: string; _rev: string} | null
  /** The current published document, or null when never published. */
  published: {_id: string; _rev: string} | null
  /** False for a bare auto-created empty draft that has no real content yet. */
  draftHasContent: boolean
  /** True when the draft has been reverted to exactly match the published version. */
  matchesPublished: boolean
  /** Whether this publishedId is currently in the cart. */
  alreadyTracked: boolean
  /**
   * Whether this snapshot reflects a confirmed, stable read.
   * Set to false during transient fetch failures - the evaluator will return `keep`
   * regardless of other fields, so flaky reads never silently drop tracked items.
   */
  definitive: boolean
}

/**
 * The decision returned by `evaluateCartMembership`, indicating what cart action to take.
 *
 * @public
 */
export type CartMembershipDecision =
  | {action: 'add'; item: CartItem}
  | {action: 'remove'; publishedId: string}
  | {action: 'keep'}

function buildCartItem(
  snapshot: CartMembershipSnapshot & {draft: {_id: string; _rev: string}},
  now: string,
): CartItem {
  return {
    publishedId: snapshot.publishedId,
    draftId: snapshot.draft._id,
    documentType: snapshot.documentType,
    addedRev: snapshot.draft._rev,
    baselineRev: snapshot.draft._rev,
    changedUnderneath: false,
    isNew: snapshot.published === null,
    addedAt: now,
  }
}

function qualifies(snapshot: CartMembershipSnapshot, config?: BatchPublishPluginConfig): boolean {
  const hasDraftWithContent =
    snapshot.draft !== null && snapshot.draftHasContent && snapshot.matchesPublished === false

  if (hasDraftWithContent === false) {
    return false
  }

  return isCartCandidate(
    {
      documentId: snapshot.draft!._id,
      documentType: snapshot.documentType,
      isLiveEditType: snapshot.isLiveEditType,
    },
    config,
  )
}

/**
 * Maps a draft's edit-state snapshot to a cart membership decision.
 *
 * Decision rules:
 * - When `definitive` is false, always returns `keep` (transient-failure guard).
 * - When the snapshot qualifies (draft with content, non-liveEdit, passes type config),
 *   returns `add` with a fully-formed CartItem.
 * - When it does not qualify and `alreadyTracked` is true, returns `remove` (stopped qualifying).
 * - When it does not qualify and `alreadyTracked` is false, returns `keep` (nothing to do).
 *
 * @public
 */
export function evaluateCartMembership(
  snapshot: CartMembershipSnapshot,
  now: string,
  config?: BatchPublishPluginConfig,
): CartMembershipDecision {
  if (snapshot.definitive === false) {
    return {action: 'keep'}
  }

  if (qualifies(snapshot, config)) {
    return {
      action: 'add',
      item: buildCartItem(
        snapshot as CartMembershipSnapshot & {draft: {_id: string; _rev: string}},
        now,
      ),
    }
  }

  if (snapshot.alreadyTracked) {
    return {action: 'remove', publishedId: snapshot.publishedId}
  }

  return {action: 'keep'}
}
