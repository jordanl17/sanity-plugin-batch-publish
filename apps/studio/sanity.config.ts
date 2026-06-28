import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {batchPublishPlugin} from 'sanity-plugin-batch-publish'
import {schemaTypes} from './schemaTypes'

export default defineConfig({
  name: 'default',
  title: 'Batch Publish Dev',
  projectId: 'i2zyueht',
  dataset: 'production',
  plugins: [structureTool(), visionTool(), batchPublishPlugin()],
  schema: {
    types: schemaTypes,
  },
})
