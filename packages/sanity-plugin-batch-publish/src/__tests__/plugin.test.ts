import {describe, expect, it} from 'vitest'

import {batchPublishPlugin} from '../index'

describe('batchPublishPlugin', () => {
  it('should return a plugin definition', () => {
    const plugin = batchPublishPlugin()
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })
})
