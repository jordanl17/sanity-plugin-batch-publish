---
paths:
  - 'packages/sanity-plugin-batch-publish/src/**/*.ts'
  - 'packages/sanity-plugin-batch-publish/src/**/*.tsx'
---

# Sanity Studio internals reference

Grounded API map for building the batch publish cart. All symbols below are re-exported
from the top-level `sanity` package unless noted. File paths refer to the Sanity monorepo
(`packages/sanity/src/...`) for reading source, not for importing.

## Document identity (drafts vs versions vs published)

Re-exported from `sanity` (originally `@sanity/client/csm`, via `core/util/draftUtils.ts`):

- `getPublishedId(id)` / `getDraftId(id)` / `getVersionId(id, version)` - build/normalise IDs.
- `isDraftId(id)` (`drafts.<id>`), `isVersionId(id)` (`versions.<release>.<id>`), `isPublishedId(id)`.
- `getVersionFromId(id)` - release name from a version ID, else `undefined`.
- `getDocumentVariantType(id)` -> `'draft' | 'version' | 'published'` (`core/util/getDocumentVariantType.ts`).
- `collate(documents)` / `CollatedHit` / `getIdPair(id, {version?})` - group/normalise pairs.

Cart invariant: include only `isDraftId`; exclude `isVersionId`.

## liveEdit (drafts-disabled types)

- `isLiveEditEnabled(schema, typeName)` -> `schema.get(typeName)?.liveEdit === true`
  (`core/store/document/document-pair/utils/isLiveEditEnabled.ts`).
- `EditStateFor.liveEditSchemaType` is `true` only when the schema type itself is liveEdit.
- The publish op is disabled with reason `'LIVE_EDIT_ENABLED'` for these.

Cart invariant: exclude types where `liveEditSchemaType` is true.

## Detecting edits / draft-vs-published state

- `useEditState(publishedId, type, priority?, version?)` (`core/hooks/useEditState.ts`)
  returns `EditStateFor`: `{draft, published, version, liveEdit, liveEditSchemaType, ready,
transactionSyncLock, release}`. Each doc carries `_rev`.
  - `draft !== null` -> unsaved changes exist (an amended draft).
  - `draft === null && published !== null` -> published, no pending changes.
  - `draft === null && published === null` -> never saved.
- Lower level: `useDocumentStore()` -> `documentStore.pair.editState(publishedId, type, version?)`
  (`core/store/document/document-store.ts`, `core/store/datastores.ts`).

Use `draft._rev` for the concurrency snapshot.

## Publish

- Action: `client.action({actionType: 'sanity.action.document.publish', draftId,
publishedId, ifPublishedRevisionId})` - `ifPublishedRevisionId` is the optimistic lock.
  See `core/store/document/document-pair/serverOperations/publish.ts`.
- Batch many: `client.action([...actions])` (pattern in `releases/store/createReleaseOperationStore.ts`).
- Client setup: `actionsApiClient(client, idPair)` (apiVersion `2025-02-19`).
- Per-doc op hook: `useDocumentOperation(publishedId, type)` -> `publish.execute()` /
  `publish.disabled` (reasons: `'LIVE_EDIT_ENABLED'`, `'ALREADY_PUBLISHED'`, `'NO_CHANGES'`).
- True atomic multi-doc publish only exists via releases: `client.releases.publish({releaseId})`
  - out of scope for the ad-hoc cart.

## Edit attribution (local vs remote, who)

Two author signals; use document-store events for live tracking, events API for UI detail only.

- `DocumentMutationEvent` (`core/store/document/buffered-doc/types.ts`) - has
  `origin: 'local' | 'remote'`. `origin: 'local'` = this tab's `BufferedDocument` issued it
  (computed in `buffered-doc/createObservableBufferedDocument.ts`; `remote` derives from the
  mutator matching incoming `transactionId` against locally-buffered transactions in
  `@sanity/mutator` `Document.ts`/`BufferedDocument.ts`). Use for auto-add.
- `DocumentRemoteMutationEvent` (same `types.ts`) - `{type: 'remoteMutation', head,
transactionId, author, timestamp, effects}`; fires for every remote transaction and carries
  `author` (mapped from the listener's `identity`). Flag external change on
  `author !== useCurrentUser()?.id`.
- Subscriptions (all from `sanity`): `documentStore.pair.editState`,
  `documentStore.pair.documentEvents` (`document-pair/documentEvents.ts`),
  `remoteSnapshots(client, idPair, type)` (`document-pair/remoteSnapshots.ts`).
- Raw equivalent: `client.listen` emits `MutationEvent` (`@sanity/client`) with
  `identity` (author user id), `transactionId`, `mutations`, `effects` (with
  `effectFormat: 'mendoza'`), `transition`. Prefer the store route - the pair listener
  (`getPairListener.ts`) already configures `includeAllVersions`, resume, mendoza, and
  sequentialises out-of-order events (`utils/sequentializeListenerEvents.ts`).
- Attribution detail for UI only: `useEventsStore` (`core/store/events/useEventsStore.ts`);
  `BaseEvent.author`, `EditDocumentVersionEvent.contributors[]` / `transactions[].author`.
  Translog: `getTransactionsLogs` (`core/store/translog/getTransactionsLogs.ts`),
  `TransactionLogEventWithEffects.author` (`@sanity/types`).
- `MutationEvent.identity`, `DocumentRemoteMutationEvent.author`, `BaseEvent.author`, and
  `useCurrentUser().id` share the same user-id space - compare directly.
- Multi-tab: `origin` is per-tab, so gate "changed by someone else" on `author`, not `origin`.

## Validation & permissions (block-upfront gating)

- `useValidationStatus(targetId, type, requirePublishedReferences?)` (`core/hooks/useValidationStatus.ts`)
  -> `{validation: ValidationMarker[], isValidating, revision?}`. Block on
  `validation.some(isValidationErrorMarker)`.
- `useDocumentPairPermissions({id, type, permission: 'publish', version?})`
  (`core/store/grants/documentPairPermissions.ts`) -> `[{granted, reason}, isLoading]`.
- `useCurrentUser()` (`core/store/user/hooks.ts`) -> `CurrentUser | null`.
- Reference for how the Studio gates publish on validation + sync:
  `packages/sanity/src/structure/documentActions/PublishAction.tsx`.
