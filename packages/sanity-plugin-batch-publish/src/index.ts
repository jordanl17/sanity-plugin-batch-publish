import {definePlugin} from 'sanity'

import type {BatchPublishPluginConfig} from './types'

/** @public */
export const batchPublish = definePlugin<BatchPublishPluginConfig | void>((_config) => {
  return {
    name: 'sanity-plugin-batch-publish',
  }
})
