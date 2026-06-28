import type {CartMembershipSnapshot} from './evaluateCartMembership'

/**
 * A Sanity document that has at least `_id`, `_rev`, and `_type` fields.
 *
 * @public
 */
export interface SanityDocumentSnapshot {
  _id: string
  _rev: string
  _type: string
  [key: string]: unknown
}

/**
 * Shape of the edit state snapshot used to build a CartMembershipSnapshot.
 *
 * Matches the relevant fields from `EditStateFor` emitted by
 * `documentStore.pair.editState`. Each document carries `_rev`.
 *
 * @public
 */
export interface EditStateSnapshot {
  draft: SanityDocumentSnapshot | null
  published: {_id: string; _rev: string} | null
  liveEditSchemaType: boolean
  ready: boolean
}

/**
 * Parameters for `buildMembershipSnapshot`.
 *
 * @public
 */
export interface BuildMembershipSnapshotParams {
  publishedId: string
  documentType: string
  editState: EditStateSnapshot
  alreadyTracked: boolean
}

/**
 * Determines whether a draft document has real content beyond bare system fields.
 * A document with at least one non-underscore-prefixed key has content.
 *
 * @public
 */
export function draftHasRealContent(draft: SanityDocumentSnapshot): boolean {
  return Object.keys(draft).some((key) => key.startsWith('_') === false)
}

/**
 * Deep-compares two snapshot objects for equality, ignoring system meta fields
 * (`_rev`, `_updatedAt`, `_id`, `_type`, `_createdAt`).
 * Used to detect reverted-to-published state.
 *
 * @public
 */
export function snapshotsMatchIgnoringMeta(
  draft: SanityDocumentSnapshot,
  published: {_id: string; _rev: string},
): boolean {
  const ignoredKeys = new Set(['_rev', '_updatedAt', '_id', '_type', '_createdAt'])

  const draftKeys = Object.keys(draft).filter((key) => ignoredKeys.has(key) === false)
  const publishedKeys = Object.keys(published).filter((key) => ignoredKeys.has(key) === false)

  if (draftKeys.length !== publishedKeys.length) {
    return false
  }

  return draftKeys.every((key) => {
    const draftValue = (draft as Record<string, unknown>)[key]
    const publishedValue = (published as Record<string, unknown>)[key]
    return JSON.stringify(draftValue) === JSON.stringify(publishedValue)
  })
}

/**
 * Assembles a `CartMembershipSnapshot` from an edit-state snapshot.
 *
 * Used by both the per-document `CartDocumentObserver` and the boot-time
 * `revalidateCartOnBoot` sweep so that both paths agree on what "qualifies" means.
 * Sets `definitive` from `editState.ready` — when false, the evaluator always returns
 * `keep`, preventing transient reads from silently dropping tracked items.
 *
 * @public
 */
export function buildMembershipSnapshot(
  params: BuildMembershipSnapshotParams,
): CartMembershipSnapshot {
  const {publishedId, documentType, editState, alreadyTracked} = params
  const {draft, published, liveEditSchemaType, ready} = editState

  const draftHasContent = draft !== null ? draftHasRealContent(draft) : false

  const matchesPublished =
    draft !== null && published !== null ? snapshotsMatchIgnoringMeta(draft, published) : false

  return {
    publishedId,
    documentType,
    isLiveEditType: liveEditSchemaType,
    draft: draft !== null ? {_id: draft._id, _rev: draft._rev} : null,
    published: published !== null ? {_id: published._id, _rev: published._rev} : null,
    draftHasContent,
    matchesPublished,
    alreadyTracked,
    definitive: ready,
  }
}
