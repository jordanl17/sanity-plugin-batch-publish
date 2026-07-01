/**
 * Configuration options for the batch publish plugin.
 *
 * A type is eligible only if:
 *   (includeTypes is absent OR type is in includeTypes) AND type is not in excludeTypes
 *
 * Deny subtracts from allow: a type present in both lists is ineligible.
 * liveEdit types are always ineligible regardless of these lists.
 *
 * @public
 */
export interface BatchPublishPluginConfig {
  /**
   * Allowlist of schema type names. When present, only these types are eligible for the cart.
   * Absent means all draftable types are eligible.
   */
  includeTypes?: string[]
  /**
   * Denylist of schema type names. When present, these types are ineligible for the cart.
   */
  excludeTypes?: string[]
}

/**
 * A single tracked entry in the batch publish cart.
 *
 * Fields here seed the data needs of later phases (auto-tracking, persistence,
 * concurrency flagging, UI, publishing). Phase-specific fields (remote-change flags,
 * validation state, permission state) are added in subsequent phases.
 *
 * @public
 */
export interface CartItem {
  /** The published-document id (the cart's set key; idempotency key). */
  publishedId: string
  /** The `drafts.<publishedId>` id. */
  draftId: string
  /** The schema `_type` of the document. */
  documentType: string
  /** Snapshot of the draft `_rev` captured at add-time. Advances on idempotent re-add (upsert). */
  addedRev: string
  /**
   * The moving concurrency baseline rev. Advances when the current user edits the item (a local
   * edit means the user now owns all in-flight changes). The changed-underneath flag compares the
   * live draft rev against this field, never against `addedRev`.
   *
   * @public
   */
  baselineRev: string
  /**
   * True when an unreviewed remote change sits on top of the stored baseline (CONC-02). Sticky:
   * clears only when the current user edits the item (advancing the baseline) or the draft rev
   * reverts to the baseline.
   *
   * @public
   */
  changedUnderneath: boolean
  /** True when there is no published version yet (brand-new draft vs an update). */
  isNew: boolean
  /** ISO timestamp of when the item entered the cart. */
  addedAt: string
}
