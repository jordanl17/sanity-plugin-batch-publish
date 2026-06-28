import {isDraftId} from 'sanity'

import type {BatchPublishPluginConfig} from './types'

/**
 * Input to the cart candidate qualification function.
 *
 * `isLiveEditType` is passed in by the caller rather than resolved internally so that this
 * function remains pure and synchronously testable. Resolving liveEdit from the live schema
 * (via `isLiveEditEnabled(schema, type)` or `EditStateFor.liveEditSchemaType`) is the
 * caller's responsibility in a later phase.
 *
 * @public
 */
export interface CartCandidateInput {
  /** The document id as stored (may be `drafts.<id>`, `versions.<release>.<id>`, or bare `<id>`). */
  documentId: string
  /** The schema `_type` of the document. */
  documentType: string
  /** Whether the schema type has `liveEdit: true`. */
  isLiveEditType: boolean
}

function passesShapeGate(input: CartCandidateInput): boolean {
  return isDraftId(input.documentId) && input.isLiveEditType === false
}

function passesTypeNarrowing(documentType: string, config: BatchPublishPluginConfig): boolean {
  const includeTypes = config.includeTypes ?? []
  const excludeTypes = config.excludeTypes ?? []

  const passesInclude = includeTypes.length === 0 || includeTypes.includes(documentType)
  const passesExclude = excludeTypes.includes(documentType) === false

  return passesInclude && passesExclude
}

/**
 * Determines whether a document is eligible for the batch publish cart.
 *
 * Evaluation runs in two ordered steps:
 *
 * 1. **Shape gate** - the document must be a plain `drafts.<id>` (checked via `isDraftId`) and
 *    must not be a `liveEdit` type. This rejects published bare ids, release versions
 *    (`versions.<release>.<id>`), and liveEdit types regardless of the type lists. liveEdit
 *    always wins, even over an allowlist.
 *
 * 2. **Type narrowing** - applied only to shape-gate survivors. A document is eligible only
 *    if its `documentType` is in `includeTypes` (or `includeTypes` is absent/empty) AND is not
 *    in `excludeTypes`. A type in both lists is ineligible (deny wins).
 *
 * @public
 */
export function isCartCandidate(
  input: CartCandidateInput,
  config?: BatchPublishPluginConfig,
): boolean {
  if (passesShapeGate(input) === false) {
    return false
  }

  if (config === undefined) {
    return true
  }

  return passesTypeNarrowing(input.documentType, config)
}
