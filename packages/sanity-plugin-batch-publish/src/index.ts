import {definePlugin} from 'sanity'

import {makeCartDocumentObserver} from './CartDocumentObserver'
import type {BatchPublishPluginConfig} from './types'

export {addItem, hasItem, removeItem} from './cartSet'
export {buildCartStorageKey, readCart, writeCart, subscribeToCartStorage} from './cartStorage'
export {createCartStore} from './cartStore'
export type {CartStore} from './cartStore'
export {CartDocumentObserver} from './CartDocumentObserver'
export {evaluateCartMembership} from './evaluateCartMembership'
export type {CartMembershipDecision, CartMembershipSnapshot} from './evaluateCartMembership'
export {isCartCandidate} from './isCartCandidate'
export type {CartCandidateInput} from './isCartCandidate'
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
  }
})
