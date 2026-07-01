# sanity-plugin-batch-publish

## Architecture

Turborepo monorepo with one publishable npm package and a dev studio app.

### Packages

| Package                       | Path                                   | Description                                           |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------- |
| `sanity-plugin-batch-publish` | `packages/sanity-plugin-batch-publish` | Sanity Studio plugin for publishing documents in bulk |

### Apps (dev only, not published)

| App      | Path          | Description                          |
| -------- | ------------- | ------------------------------------ |
| `studio` | `apps/studio` | Dev Sanity Studio for testing plugin |

## Feature: Batch Publish Cart

The plugin tracks draft documents an editor amends during a Studio session - a "cart" of
pending changes - then publishes the set together. Full design and the grounded Studio API
map: [`docs/batch-publish-cart.md`](docs/batch-publish-cart.md) and
[`.claude/rules/sanity-internals.md`](.claude/rules/sanity-internals.md).

Agreed behaviour (do not violate these invariants):

- **Candidates only:** include only amended plain drafts (`drafts.<id>`). Never include
  release versions (`versions.<release>.<id>`) or `liveEdit` (drafts-disabled) types.
- **Auto-track, idempotent:** qualifying drafts the current user edits this session are added
  automatically (on the document store's `DocumentMutationEvent.origin === 'local'`); the cart
  is a set keyed by published ID, so repeated edits add a doc once.
- **localStorage only:** session-specific, private to the browser, survives reload; no dataset
  persistence. Re-hydrate and re-validate on load.
- **New vs updated:** brand-new drafts (no published version yet) are valid and flagged as new.
- **Stops qualifying -> silently remove** (discarded, published elsewhere, or reverted to match).
- **Concurrency:** snapshot `draft._rev` on add; the user's own continued edits advance the
  baseline; flag items changed by anyone else (`DocumentRemoteMutationEvent.author !==
useCurrentUser().id`); use `ifPublishedRevisionId` as the publish-time optimistic lock.
- **Block-upfront publishing:** the batch action is disabled until every item is valid and the
  user is permitted; removing an item is the escape hatch. Execution is best-effort with
  per-item success/failure reporting.
- **UI:** navbar count indicator (top-right, via `studio.components.navbar`) linking to a
  dedicated cart tool. No floating overlay. Build all UI with `@sanity/ui` (and `@sanity/icons`).
- **Config:** optional allowlist/denylist of document types; zero-config tracks all draftable types.

## Commands

| Command               | Description                       |
| --------------------- | --------------------------------- |
| `pnpm install`        | Install all dependencies          |
| `pnpm build`          | Build all packages and apps       |
| `pnpm build:packages` | Build only publishable packages   |
| `pnpm dev`            | Start all dev servers in parallel |
| `pnpm dev:studio`     | Start Sanity Studio dev server    |
| `pnpm check`          | Build packages, lint, type-check  |
| `pnpm lint`           | Run ESLint across the monorepo    |
| `pnpm format`         | Format all files with Prettier    |
| `pnpm format:check`   | Check formatting without writing  |
| `pnpm test`           | Run Vitest tests                  |
| `pnpm type-check`     | Run TypeScript type checking      |
| `pnpm clean`          | Clean all build outputs           |

## Build System

- **Build tool**: `@sanity/pkg-utils` for `sanity-plugin-batch-publish`
- **Output**: `dist/` with ESM (`.js`), CJS (`.cjs`), and TypeScript declarations (`.d.ts`)
- **Local dev**: Workspace consumers import directly from `src/` via the `source` field in exports maps - no build needed during development
- **Orchestration**: Turborepo handles task dependencies and caching

## Coding Conventions

- Use `pnpm` as the package manager
- Prefer functional declarations and higher-order functions (map, filter, reduce)
- Use descriptive variable names (no single-character names)
- Do not use negated expressions
- Do not use immediately invoked function expressions (IIFEs)
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
- ESLint + Prettier enforce code style (run automatically via lint-staged on commit)

## Release Process

- Releases are managed by [release-please](https://github.com/googleapis/release-please)
- Merging a release PR triggers npm publish via GitHub Actions
- Requires `NPM_TOKEN` secret configured in GitHub repo settings

## Peer Dependencies

- `sanity-plugin-batch-publish` supports `sanity ^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0` and `react ^18.0.0 || ^19.0.0`

## Workflow

- **Verification Before Done**: Never mark a task complete without proving it works. Two gates:
  1. **Automated**: `pnpm check && pnpm test` pass, with tests covering the new logic.
  2. **In-studio (Playwright MCP)**: run `pnpm run dev:studio` and drive the studio with the
     Playwright MCP to confirm the change behaves as expected in a real Studio. Always confirm a
     clean console (no errors/warnings). Inspect network calls (Actions API, mutations) and the
     console where relevant; add temporary console logging to confirm internal state, then
     remove it. Logic-only work verifies via boot + console/network/log inspection; UI work adds
     click-through interaction testing.
- **Simplicity First**: Minimal code impact. Find root causes. No temporary fixes.

## File Conventions

- Test files: `src/__tests__/*.test.{ts,tsx}` within each package
- Package config: `package.config.ts` for the sanity plugin
- TypeScript configs: `tsconfig.json` (IDE) + `tsconfig.build.json` (build output, excludes tests)
- Schema types: `apps/studio/schemaTypes/`

## Testing

- Vitest with jsdom environment (configured at root `vitest.config.ts`)

## Sanity Project

- Project ID: `i2zyueht`
- Dataset: `production`
