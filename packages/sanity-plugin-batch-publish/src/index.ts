import {definePlugin} from 'sanity'

import type {BatchPublishPluginConfig} from './types'

export {isCartCandidate} from './isCartCandidate'
export type {CartCandidateInput} from './isCartCandidate'
export type {BatchPublishPluginConfig, CartItem} from './types'

/** @public */
export const batchPublish = definePlugin<BatchPublishPluginConfig | void>((_config) => {
  return {
    name: 'sanity-plugin-batch-publish',
  }
})
