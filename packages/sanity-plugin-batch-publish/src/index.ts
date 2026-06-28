import {definePlugin} from 'sanity'

import type {BatchPublishPluginConfig} from './types'

export {addItem, hasItem, removeItem} from './cartSet'
export {evaluateCartMembership} from './evaluateCartMembership'
export type {CartMembershipDecision, CartMembershipSnapshot} from './evaluateCartMembership'
export {isCartCandidate} from './isCartCandidate'
export type {CartCandidateInput} from './isCartCandidate'
export type {BatchPublishPluginConfig, CartItem} from './types'

/** @public */
export const batchPublish = definePlugin<BatchPublishPluginConfig | void>((_config) => {
  return {
    name: 'sanity-plugin-batch-publish',
  }
})
