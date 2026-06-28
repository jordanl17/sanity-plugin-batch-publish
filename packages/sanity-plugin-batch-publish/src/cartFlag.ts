import type {CartItem} from './types'

/**
 * Parameters for evaluating whether a cart item should be flagged as changed underneath.
 *
 * @public
 */
export interface ShouldFlagParams {
  /** The stored moving baseline rev for the cart item. */
  baselineRev: string
  /** The live draft rev to compare against the baseline. */
  currentRev: string
  /**
   * Whether the author of the change is the current user. The caller is responsible for mapping a
   * falsy author (empty string, null, undefined) to `false` so unresolved authors flag as remote.
   */
  isCurrentUserAuthor: boolean
}

/**
 * Returns true when the live draft rev diverges from the stored baseline AND the change is
 * attributable to someone other than the current user.
 *
 * When `currentRev === baselineRev`, the flag is always false (no divergence, or reverted to
 * baseline). When the current user is the author, the flag is also false — local edits are handled
 * by `ownByCurrentUser` which advances the baseline atomically.
 *
 * @public
 */
export function shouldFlagChangedUnderneath(params: ShouldFlagParams): boolean {
  const revsMatch = params.currentRev === params.baselineRev
  if (revsMatch) {
    return false
  }
  return params.isCurrentUserAuthor === false
}

/**
 * Atomically clears the `changedUnderneath` flag and advances `baselineRev` to `currentRev`.
 *
 * Use when the current user has edited the item — the user now owns all in-flight changes, so the
 * previously remote change sits below the new baseline and must not re-flag.
 *
 * Returns the same `item` reference unchanged when `baselineRev` is already `currentRev` and
 * `changedUnderneath` is already false (no-op identity, so callers can skip writes).
 *
 * `addedRev` and `addedAt` are not touched.
 *
 * @public
 */
export function clearFlagAndAdvanceBaseline(item: CartItem, currentRev: string): CartItem {
  const alreadyAtBaseline = item.baselineRev === currentRev
  const alreadyCleared = item.changedUnderneath === false
  if (alreadyAtBaseline && alreadyCleared) {
    return item
  }
  return {...item, baselineRev: currentRev, changedUnderneath: false}
}

/**
 * Applies a remote-event rev transition to a cart item.
 *
 * Computes the next `changedUnderneath` value via `shouldFlagChangedUnderneath`. When the computed
 * flag value matches the item's current value (no state change), returns the same `item` reference
 * (no-op identity, so callers can skip writes). `baselineRev` is never advanced by this function —
 * only the current user's own edits advance the baseline.
 *
 * When `currentRev` equals the item's `baselineRev`, the flag clears automatically (the remote
 * change was reverted to baseline).
 *
 * @public
 */
export function applyRemoteRevChange(
  item: CartItem,
  currentRev: string,
  isCurrentUserAuthor: boolean,
): CartItem {
  const nextFlag = shouldFlagChangedUnderneath({
    baselineRev: item.baselineRev,
    currentRev,
    isCurrentUserAuthor,
  })
  if (nextFlag === item.changedUnderneath) {
    return item
  }
  return {...item, changedUnderneath: nextFlag}
}
