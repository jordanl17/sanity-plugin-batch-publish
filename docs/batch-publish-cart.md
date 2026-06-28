# Batch Publish Cart - Design

Status: requirements agreed, not yet implemented.

## Concept

As an editor works through a Studio session, the plugin tracks the draft documents
they amend - building up a "cart" of pending changes that follows them around. When
ready, the editor opens the cart, inspects each draft, optionally removes some, and
publishes the whole set in one action.

This is intentionally a lighter, ad-hoc alternative to Content Releases: there is no
schedule and no version documents. The cart is just "the set of drafts I'm working on
right now, published together."

## Invariants

A document is only ever a cart candidate when **all** of these hold:

1. It is a plain draft (`drafts.<id>`) - never a release version (`versions.<releaseId>.<id>`).
2. Its type does not have `liveEdit` enabled (drafts-disabled types publish directly and
   have no draft to batch).
3. The draft has been amended by the current user during this session (auto-tracked from
   their edits), and the draft still differs from / does not yet exist as the published doc.
4. The document type is permitted by the plugin's optional allowlist/denylist config.

New drafts (a draft with no published version yet) are valid candidates and are flagged
as **new** vs **updated** in the cart.

Tracking is **idempotent**: the cart is a set keyed by published ID, so a document is only
ever added once. Editing the same draft repeatedly - including a first edit and another many
minutes later in the same session - keeps a single cart entry; it never duplicates.

## Decisions

| Area              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking          | **Auto-track only.** Any qualifying draft the user edits this session is added automatically as they go. No manual add; removal/exclusion from the cart is supported.                                                                                                                                                                                                                                                       |
| Persistence       | **localStorage only.** Session-specific and private to the browser; survives reload. No dataset persistence, not shared across users/devices.                                                                                                                                                                                                                                                                               |
| Re-hydration      | On load, restore tracked IDs from localStorage and re-validate each still qualifies.                                                                                                                                                                                                                                                                                                                                        |
| Stops qualifying  | If a tracked draft is discarded, published elsewhere, or reverted to match published, **silently remove** it - it is no longer a candidate.                                                                                                                                                                                                                                                                                 |
| Concurrency       | **Snapshot the draft `_rev` on add**; live-flag any item whose draft changes underneath (another user or another tab) for review; use `ifPublishedRevisionId` as the optimistic-lock backstop at publish time. We flag _that_ it changed, not _who_ changed it. The current user's own continued edits advance the baseline `_rev` (they do not self-flag); only an un-attributed remote change flags "changed underneath." |
| Publish gating    | **Block upfront.** The batch publish action stays disabled until every item is valid and the user is permitted to publish it. Removing an offending item is the escape hatch.                                                                                                                                                                                                                                               |
| Execution failure | **Best-effort.** If an individual publish still fails at execution (e.g. last-second optimistic-lock rejection), keep publishing the rest and report which succeeded and which failed.                                                                                                                                                                                                                                      |
| Config            | Optional allowlist/denylist of document types via plugin config; zero-config tracks every draftable type.                                                                                                                                                                                                                                                                                                                   |

## UI

Build all UI - the navbar indicator, the cart tool, and every control within it - with
`@sanity/ui` primitives (and `@sanity/icons`) so it matches the Studio look and feel and
inherits theming. No bespoke styling frameworks.

- **Navbar count indicator** in the top-right, via Studio's `studio.components.navbar`
  customization, showing the current number of items in the cart. Clicking it navigates
  to the cart tool. No floating overlay (it would sit over the Studio UI).
- **Dedicated Studio tool** - the full cart page: inspect each draft (new vs updated,
  validation state, changed-underneath flags), remove items, and publish the batch.

## Publish flow

- Use the Actions API publish per document: `actionType: 'sanity.action.document.publish'`
  with `{draftId, publishedId, ifPublishedRevisionId}` (see `serverOperations/publish.ts`
  in the Sanity repo). Candidates can be issued individually for best-effort reporting, or
  batched via a single `client.action([...])` call.
- Gate on validation with `useValidationStatus` and on permission with
  `useDocumentPairPermissions({permission: 'publish'})` before enabling the batch action.

## Edit attribution (resolved)

The Studio exposes two independent author signals; we use both, and never the events/history
API for live tracking (it is a higher-latency paginated audit log - good only for rendering
"who changed this and when" detail in the cart UI).

- **Auto-add ("edited by me, here, now"):** subscribe to the document store's mutation stream
  for the draft id and add on `DocumentMutationEvent.origin === 'local'`. `origin` is computed
  per `BufferedDocument` (i.e. per tab): a mutation issued by this tab arrives as `'local'`,
  anything else as `'remote'`. This is inherently session/tab-scoped (exactly the cart's
  requirement) and snapshot emits do not false-trigger it. To also catch the same user's
  edits in another tab, additionally accept remote mutations whose `author === useCurrentUser().id`.
- **Flag "changed by someone else":** per cart item, watch `DocumentRemoteMutationEvent` and
  flag when `author !== useCurrentUser()?.id`, diffed against the `transactionId`/rev captured
  at add-time so only post-add changes flag. Equivalent raw signal: `MutationEvent.identity`
  from `client.listen` - but the document-store route reuses the existing pair listener
  (one connection, dedupe, resume, mendoza) rather than opening a parallel one.
- `MutationEvent.identity`, `DocumentRemoteMutationEvent.author`, `BaseEvent.author`, and
  `useCurrentUser().id` are all the same user-id space, so the comparison is direct.
- **Multi-tab gotcha:** `origin: 'local'` is per-tab, so gate "changed by someone else" on
  `author !== currentUser.id`, never on `origin` alone (the user's other tab is `remote` but
  is still "me").

Subscription points (all reachable from `sanity`): `documentStore.pair.editState` /
`documentStore.pair.documentEvents` / `remoteSnapshots(client, idPair, type)`. See
`.claude/rules/sanity-internals.md` for exact symbols and file paths.

## Open implementation questions (defer to build time)

- Whether to issue publishes as N individual actions or one batched `client.action([...])`
  while still surfacing per-item success/failure.
- Runtime confirmation that `identity`/`author` are exposed for the dataset's non-admin
  session token (the type/source layer does not gate them behind admin, but worth verifying).

See `.claude/rules/sanity-internals.md` for the grounded Studio API reference.
