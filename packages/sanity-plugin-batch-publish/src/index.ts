import {definePlugin} from 'sanity'

import {makeCartBootRevalidator} from './CartBootRevalidator'
import {makeCartDocumentObserver} from './CartDocumentObserver'
import type {BatchPublishPluginConfig} from './types'

export {
  applyRemoteRevChange,
  clearFlagAndAdvanceBaseline,
  shouldFlagChangedUnderneath,
} from './cartFlag'
export type {ShouldFlagParams} from './cartFlag'
export {addItem, hasItem, removeItem} from './cartSet'
export {
  buildMembershipSnapshot,
  draftHasRealContent,
  snapshotsMatchIgnoringMeta,
} from './cartSnapshot'
export type {
  BuildMembershipSnapshotParams,
  EditStateSnapshot,
  SanityDocumentSnapshot,
} from './cartSnapshot'
export {buildCartStorageKey, readCart, writeCart, subscribeToCartStorage} from './cartStorage'
export {createCartStore} from './cartStore'
export type {CartStore} from './cartStore'
export {CartBootRevalidator, makeCartBootRevalidator} from './CartBootRevalidator'
export {createCartRemoteWatcher} from './cartRemoteWatcher'
export type {CartRemoteWatcherParams} from './cartRemoteWatcher'
export {CartDocumentObserver} from './CartDocumentObserver'
export {evaluateCartMembership} from './evaluateCartMembership'
export type {CartMembershipDecision, CartMembershipSnapshot} from './evaluateCartMembership'
export {isCartCandidate} from './isCartCandidate'
export type {CartCandidateInput} from './isCartCandidate'
export {revalidateCartOnBoot} from './revalidateCartOnBoot'
export type {RevalidateCartOnBootOptions} from './revalidateCartOnBoot'
export type {BatchPublishPluginConfig, CartItem} from './types'
export {useCart} from './useCart'

/** @public */
export const batchPublish = definePlugin<BatchPublishPluginConfig | void>((config) => {
  return {
    name: 'sanity-plugin-batch-publish',
    document: {
      components: {
        unstable_layout: makeCartDocumentObserver(config ?? undefined),
      },
    },
    studio: {
      components: {
        layout: makeCartBootRevalidator(config ?? undefined),
      },
    },
  }
})
