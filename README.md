# sanity-plugin-batch-publish

A [Sanity Studio](https://www.sanity.io/studio) plugin for publishing documents in bulk.

## Installation

```sh
pnpm add sanity-plugin-batch-publish
```

## Usage

Add the plugin to your `sanity.config.ts`:

```ts
import {defineConfig} from 'sanity'
import {batchPublishPlugin} from 'sanity-plugin-batch-publish'

export default defineConfig({
  // ...
  plugins: [batchPublishPlugin()],
})
```

## Development

```sh
pnpm install
pnpm dev:studio    # starts Sanity Studio at http://localhost:3333
```

See [Local Development](./docs/local-development.md) for the full dev workflow.

## Documentation

- [Local Development](./docs/local-development.md)
- [Release Process](./docs/release-process.md)
- [Contributing](./docs/contributing.md)

## License

MIT
