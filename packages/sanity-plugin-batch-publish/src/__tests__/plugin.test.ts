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

  it('registers exactly one top-level tool with the correct name, title, icon, and component', () => {
    const plugin = batchPublish()
    const tools = plugin.tools as Array<{
      name: string
      title: string
      icon: unknown
      component: unknown
    }>
    expect(Array.isArray(tools)).toBe(true)
    expect(tools).toHaveLength(1)
    const tool = tools[0]
    expect(tool.name).toBe('batch-publish')
    expect(tool.title).toBe('Batch Publish')
    expect(tool.icon).toBeDefined()
    expect(tool.component).toBeDefined()
  })

  it('preserves the studio.components.layout slot (BootRevalidator + RemoteWatcher chain)', () => {
    const plugin = batchPublish()
    expect(plugin.studio?.components?.layout).toBeDefined()
  })

  it('preserves the document.components.unstable_layout slot (CartDocumentObserver chain)', () => {
    const plugin = batchPublish()
    expect(plugin.document?.components?.unstable_layout).toBeDefined()
  })
})
