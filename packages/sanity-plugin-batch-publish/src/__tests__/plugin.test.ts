import {describe, expect, it} from 'vitest'

import {batchPublish} from '../index'

describe('batchPublish', () => {
  it('returns a plugin definition with the correct name when called with no argument', () => {
    const plugin = batchPublish()
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })

  it('returns a plugin definition when called with no argument (zero-config)', () => {
    const plugin = batchPublish()
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })

  it('returns a plugin definition when called with a config object', () => {
    const plugin = batchPublish({includeTypes: ['article']})
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })

  it('returns a plugin definition when called with an excludeTypes config', () => {
    const plugin = batchPublish({excludeTypes: ['page']})
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })

  it('returns a plugin definition when called with both includeTypes and excludeTypes', () => {
    const plugin = batchPublish({includeTypes: ['article', 'product'], excludeTypes: ['page']})
    expect(plugin.name).toBe('sanity-plugin-batch-publish')
  })
})
