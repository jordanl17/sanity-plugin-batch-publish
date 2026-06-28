import {afterEach, describe, expect, it, vi} from 'vitest'

import {buildMembershipSnapshot} from '../cartSnapshot'
import {revalidateCartOnBoot} from '../revalidateCartOnBoot'
import {clearCartStoreRegistry} from '../CartDocumentObserver'

vi.mock('../cartStorage', () => ({
  buildCartStorageKey: vi.fn(
    (scope: {projectId: string; dataset: string; workspace: string; userId: string}) =>
      `test:${scope.projectId}:${scope.dataset}:${scope.workspace}:${scope.userId}`,
  ),
  readCart: vi.fn(() => []),
  writeCart: vi.fn(),
  subscribeToCartStorage: vi.fn(() => () => undefined),
}))

// ---- Helpers ----------------------------------------------------------------

/**
 * Minimal observable that emits a single value synchronously then completes.
 */
function makeSingleValueObservable<T>(value: T) {
  return {
    subscribe(observer: (value: T) => void) {
      observer(value)
      return {unsubscribe: vi.fn()}
    },
  }
}

/**
 * Observable that emits a single value asynchronously (on a later macrotask) then
 * completes. Models the real `editState` observable, which fetches draft+published
 * from the server and emits its `ready: true` state on a later tick rather than
 * synchronously inside `subscribe`.
 */
function makeAsyncSingleValueObservable<T>(value: T, delayMs = 0) {
  const unsubscribeSpy = vi.fn()
  return {
    unsubscribeSpy,
    subscribe(observer: (value: T) => void) {
      const timer = setTimeout(() => observer(value), delayMs)
      return {
        unsubscribe() {
          clearTimeout(timer)
          unsubscribeSpy()
        },
      }
    },
  }
}

/**
 * Minimal observable that never emits (simulates a never-ready editState).
 */
function makeNeverObservable<T>() {
  return {
    subscribe(_observer: (value: T) => void) {
      const unsubscribeSpy = vi.fn()
      return {unsubscribe: unsubscribeSpy}
    },
  }
}

/**
 * Observable whose subscribe call throws an error.
 */
function makeErrorObservable<T>(error: Error) {
  return {
    subscribe(_observer: (value: T) => void) {
      throw error
    },
  }
}

interface EditStateShape {
  draft: {_id: string; _rev: string; _type: string; [key: string]: unknown} | null
  published: {_id: string; _rev: string; _type: string; [key: string]: unknown} | null
  liveEditSchemaType: boolean
  ready: boolean
}

function makeReadyEditState(opts: {
  hasDraft?: boolean
  hasContent?: boolean
  matchesPublished?: boolean
}): EditStateShape {
  const published = {_id: 'doc-1', _rev: 'pub-rev-001', _type: 'article'}

  if (opts.hasDraft === false) {
    return {
      draft: null,
      published,
      liveEditSchemaType: false,
      ready: true,
    }
  }

  const draftBase = {
    _id: 'drafts.doc-1',
    _rev: 'draft-rev-001',
    _type: 'article',
  }

  if (opts.matchesPublished) {
    // Draft exactly matches published (only meta differs)
    return {
      draft: {...draftBase, title: 'same title'},
      published: {...published, title: 'same title'},
      liveEditSchemaType: false,
      ready: true,
    }
  }

  if (opts.hasContent === false) {
    // Bare draft with only system fields (no content)
    return {
      draft: draftBase,
      published: null,
      liveEditSchemaType: false,
      ready: true,
    }
  }

  return {
    draft: {...draftBase, title: 'different from published title'},
    published: null,
    liveEditSchemaType: false,
    ready: true,
  }
}

function makeTrackedItem(publishedId = 'doc-1') {
  return {
    publishedId,
    draftId: `drafts.${publishedId}`,
    documentType: 'article',
    addedRev: 'rev-001',
    baselineRev: 'rev-001',
    changedUnderneath: false,
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeCartStore(initialItems: ReturnType<typeof makeTrackedItem>[] = []) {
  const applyDecisionSpy = vi.fn()
  const markChangedUnderneathSpy = vi.fn()
  const store = {
    getItems: vi.fn(() => initialItems),
    applyDecision: applyDecisionSpy,
    markChangedUnderneath: markChangedUnderneathSpy,
    subscribe: vi.fn(() => () => undefined),
    destroy: vi.fn(),
  }
  return store
}

function makeDocumentStore(
  editStateObservable: ReturnType<typeof makeSingleValueObservable<EditStateShape>>,
) {
  return {
    pair: {
      editState: vi.fn(() => editStateObservable),
    },
  }
}

// ---- buildMembershipSnapshot tests -----------------------------------------

describe('buildMembershipSnapshot', () => {
  it('returns draftHasContent: true when draft has a non-underscore key', () => {
    const editState = makeReadyEditState({hasDraft: true, hasContent: true})
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: false,
    })
    expect(snapshot.draftHasContent).toBe(true)
  })

  it('returns draftHasContent: false for a bare draft with only system fields', () => {
    const editState = makeReadyEditState({hasDraft: true, hasContent: false})
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: false,
    })
    expect(snapshot.draftHasContent).toBe(false)
  })

  it('returns matchesPublished: true when draft matches published ignoring meta fields', () => {
    const editState = makeReadyEditState({hasDraft: true, matchesPublished: true})
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: false,
    })
    expect(snapshot.matchesPublished).toBe(true)
  })

  it('returns matchesPublished: false when draft differs from published', () => {
    const editState: EditStateShape = {
      draft: {_id: 'drafts.doc-1', _rev: 'rev-1', _type: 'article', title: 'new title'},
      published: {
        _id: 'doc-1',
        _rev: 'pub-rev',
        _type: 'article',
        title: 'old title',
      },
      liveEditSchemaType: false,
      ready: true,
    }
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: false,
    })
    expect(snapshot.matchesPublished).toBe(false)
  })

  it('mirrors definitive from ready flag', () => {
    const readyState = makeReadyEditState({hasDraft: true})
    const readySnapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState: readyState,
      alreadyTracked: false,
    })
    expect(readySnapshot.definitive).toBe(true)

    const notReadyState = {...makeReadyEditState({hasDraft: true}), ready: false}
    const notReadySnapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState: notReadyState,
      alreadyTracked: false,
    })
    expect(notReadySnapshot.definitive).toBe(false)
  })

  it('reduces draft and published to {_id, _rev} or null', () => {
    const editState = makeReadyEditState({hasDraft: true, hasContent: true})
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: false,
    })
    // draft should only have _id and _rev
    expect(Object.keys(snapshot.draft ?? {})).toEqual(expect.arrayContaining(['_id', '_rev']))
    // no extra fields
    if (snapshot.draft !== null) {
      expect(Object.keys(snapshot.draft).length).toBe(2)
    }
  })

  it('returns draft: null and published: null when no draft exists', () => {
    const editState = makeReadyEditState({hasDraft: false})
    const snapshot = buildMembershipSnapshot({
      publishedId: 'doc-1',
      documentType: 'article',
      editState,
      alreadyTracked: true,
    })
    expect(snapshot.draft).toBeNull()
  })
})

// ---- revalidateCartOnBoot tests ---------------------------------------------

afterEach(() => {
  clearCartStoreRegistry()
  vi.clearAllMocks()
})

describe('revalidateCartOnBoot', () => {
  it('drops a stale item (draft === null) with action: remove', async () => {
    const publishedId = 'doc-stale'
    const editState: EditStateShape = {
      draft: null,
      published: {_id: publishedId, _rev: 'pub-rev', _type: 'article'},
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeSingleValueObservable(editState)
    const docStore = makeDocumentStore(observable)
    const cartStore = makeCartStore([
      {
        publishedId,
        draftId: `drafts.${publishedId}`,
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    expect(cartStore.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({action: 'remove', publishedId}),
    )
  })

  it('drops a reverted item (draft matches published) with action: remove', async () => {
    const publishedId = 'doc-reverted'
    const editState: EditStateShape = {
      draft: {_id: `drafts.${publishedId}`, _rev: 'rev-1', _type: 'article', title: 'same'},
      published: {
        _id: publishedId,
        _rev: 'pub-rev',
        _type: 'article',
        title: 'same',
      },
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeSingleValueObservable(editState)
    const docStore = makeDocumentStore(observable)
    const cartStore = makeCartStore([
      {
        publishedId,
        draftId: `drafts.${publishedId}`,
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    expect(cartStore.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({action: 'remove', publishedId}),
    )
  })

  it('keeps a still-qualifying item (no remove decision emitted)', async () => {
    const publishedId = 'doc-qualifying'
    const editState: EditStateShape = {
      draft: {
        _id: `drafts.${publishedId}`,
        _rev: 'rev-1',
        _type: 'article',
        title: 'different content',
      },
      published: null,
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeSingleValueObservable(editState)
    const docStore = makeDocumentStore(observable)
    const cartStore = makeCartStore([
      {
        publishedId,
        draftId: `drafts.${publishedId}`,
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: true,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('keeps a never-ready item (transient guard: no remove emitted)', async () => {
    const publishedId = 'doc-never-ready'
    const neverObservable = makeNeverObservable<EditStateShape>()
    const docStore = {
      pair: {
        editState: vi.fn(() => neverObservable),
      },
    }
    const cartStore = makeCartStore([
      {
        publishedId,
        draftId: `drafts.${publishedId}`,
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await revalidateCartOnBoot(
      docStore as never,
      cartStore as never,
      cartStore.getItems(),
      undefined,
      {
        readTimeoutMs: 50,
      },
    )

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('keeps an errored item (transient guard: subscription throws, no remove emitted)', async () => {
    const publishedId = 'doc-error'
    const errorObservable = makeErrorObservable<EditStateShape>(new Error('network error'))
    const docStore = {
      pair: {
        editState: vi.fn(() => errorObservable),
      },
    }
    const cartStore = makeCartStore([
      {
        publishedId,
        draftId: `drafts.${publishedId}`,
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('resolves without calling editState or applyDecision for an empty cart', async () => {
    const editStateSpy = vi.fn()
    const docStore = {
      pair: {
        editState: editStateSpy,
      },
    }
    const cartStore = makeCartStore([])

    await revalidateCartOnBoot(docStore as never, cartStore as never, [])

    expect(editStateSpy).not.toHaveBeenCalled()
    expect(cartStore.applyDecision).not.toHaveBeenCalled()
  })

  it('calls editState once per item and unsubscribes after reading', async () => {
    const unsubscribeSpy = vi.fn()
    const editState = makeReadyEditState({hasDraft: true, hasContent: true})
    const observableFactory = () => ({
      subscribe(observer: (value: EditStateShape) => void) {
        observer(editState)
        return {unsubscribe: unsubscribeSpy}
      },
    })
    const editStateSpy = vi.fn(observableFactory)
    const docStore = {
      pair: {
        editState: editStateSpy,
      },
    }

    const items = [makeTrackedItem('doc-a'), makeTrackedItem('doc-b'), makeTrackedItem('doc-c')]
    const cartStore = makeCartStore(items)

    await revalidateCartOnBoot(docStore as never, cartStore as never, items)

    expect(editStateSpy).toHaveBeenCalledTimes(3)
    expect(unsubscribeSpy).toHaveBeenCalledTimes(3)
  })

  it('is a no-op when documentStore.pair.editState is unavailable', async () => {
    const applyDecisionSpy = vi.fn()
    const cartStore = makeCartStore([makeTrackedItem()])
    cartStore.applyDecision = applyDecisionSpy

    await revalidateCartOnBoot({} as never, cartStore as never, cartStore.getItems())

    expect(applyDecisionSpy).not.toHaveBeenCalled()
  })
})

// ---- revalidateCartOnBoot async editState tests -----------------------------
//
// The real `documentStore.pair.editState` observable fetches draft + published
// from the server and emits its `ready: true` state ASYNCHRONOUSLY, on a later
// tick. These cases model that timing so the boot sweep is exercised the way it
// behaves in a real studio - a synchronous-emitting double gave false confidence.

describe('revalidateCartOnBoot (async editState emission)', () => {
  it('drops a stale item that emits ready:true with draft=null on a later tick', async () => {
    const publishedId = 'doc-async-stale'
    const editState: EditStateShape = {
      draft: null,
      published: {_id: publishedId, _rev: 'pub-rev', _type: 'article'},
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const cartStore = makeCartStore([makeTrackedItem(publishedId)])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    expect(cartStore.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({action: 'remove', publishedId}),
    )
  })

  it('drops a reverted item (draft matches published) emitted on a later tick', async () => {
    const publishedId = 'doc-async-reverted'
    const editState: EditStateShape = {
      draft: {_id: `drafts.${publishedId}`, _rev: 'rev-1', _type: 'article', title: 'same'},
      published: {_id: publishedId, _rev: 'pub-rev', _type: 'article', title: 'same'},
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const cartStore = makeCartStore([makeTrackedItem(publishedId)])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    expect(cartStore.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({action: 'remove', publishedId}),
    )
  })

  it('keeps a still-qualifying item emitted on a later tick (no remove)', async () => {
    const publishedId = 'doc-async-qualifying'
    const editState: EditStateShape = {
      draft: {
        _id: `drafts.${publishedId}`,
        _rev: 'rev-1',
        _type: 'article',
        title: 'different content',
      },
      published: null,
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const cartStore = makeCartStore([makeTrackedItem(publishedId)])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('keeps an item that only ever emits ready:false within the bounded wait (no remove)', async () => {
    const publishedId = 'doc-async-not-ready'
    const editState: EditStateShape = {
      draft: null,
      published: {_id: publishedId, _rev: 'pub-rev', _type: 'article'},
      liveEditSchemaType: false,
      ready: false,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const cartStore = makeCartStore([makeTrackedItem(publishedId)])

    await revalidateCartOnBoot(
      docStore as never,
      cartStore as never,
      cartStore.getItems(),
      undefined,
      {readTimeoutMs: 50},
    )

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('keeps an item whose editState never emits within the bounded wait (no remove)', async () => {
    const publishedId = 'doc-async-never'
    const neverObservable = makeNeverObservable<EditStateShape>()
    const docStore = {pair: {editState: vi.fn(() => neverObservable)}}
    const cartStore = makeCartStore([makeTrackedItem(publishedId)])

    await revalidateCartOnBoot(
      docStore as never,
      cartStore as never,
      cartStore.getItems(),
      undefined,
      {readTimeoutMs: 50},
    )

    const removeCalls = (cartStore.applyDecision as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => (args[0] as {action: string}).action === 'remove',
    )
    expect(removeCalls).toHaveLength(0)
  })

  it('unsubscribes per item even with async emission timing', async () => {
    const publishedIds = ['doc-async-1', 'doc-async-2', 'doc-async-3']
    const observables = publishedIds.map((publishedId) => {
      const editState: EditStateShape = {
        draft: {
          _id: `drafts.${publishedId}`,
          _rev: 'rev-1',
          _type: 'article',
          title: 'different content',
        },
        published: null,
        liveEditSchemaType: false,
        ready: true,
      }
      return makeAsyncSingleValueObservable(editState)
    })

    let observableIndex = 0
    const editStateSpy = vi.fn(() => {
      const observable = observables[observableIndex]
      observableIndex += 1
      return observable
    })
    const docStore = {pair: {editState: editStateSpy}}
    const items = publishedIds.map((publishedId) => makeTrackedItem(publishedId))
    const cartStore = makeCartStore(items)

    await revalidateCartOnBoot(docStore as never, cartStore as never, items)

    expect(editStateSpy).toHaveBeenCalledTimes(3)
    observables.forEach((observable) => {
      expect(observable.unsubscribeSpy).toHaveBeenCalledTimes(1)
    })
  })
})

// ---- boot-time divergence flagging tests ------------------------------------
//
// When the boot sweep reads editState, it compares the live draft._rev against the
// stored baselineRev. Divergence at boot is treated as a remote change (the user did
// not advance the baseline while the tab was closed), so markChangedUnderneath is
// called with isCurrentUserAuthor: false. A non-confident read or a removed item
// must never trigger a flag.

describe('revalidateCartOnBoot - boot-time baseline divergence', () => {
  it('flags an item whose draft rev diverged from its stored baselineRev at boot', async () => {
    const publishedId = 'doc-diverged'
    const draftRev = 'rev-new'
    const baselineRev = 'rev-old'

    const editState: EditStateShape = {
      draft: {
        _id: `drafts.${publishedId}`,
        _rev: draftRev,
        _type: 'article',
        title: 'edited while tab was closed',
      },
      published: null,
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const item = {...makeTrackedItem(publishedId), baselineRev}
    const cartStore = makeCartStore([item])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    expect(cartStore.markChangedUnderneath).toHaveBeenCalledWith(publishedId, draftRev, false)
  })

  it('does not flag an item whose draft rev equals its stored baselineRev', async () => {
    const publishedId = 'doc-unchanged'
    const rev = 'rev-same'

    const editState: EditStateShape = {
      draft: {
        _id: `drafts.${publishedId}`,
        _rev: rev,
        _type: 'article',
        title: 'content',
      },
      published: null,
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    const item = {...makeTrackedItem(publishedId), baselineRev: rev}
    const cartStore = makeCartStore([item])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    // markChangedUnderneath may be called to resolve no-flag, but must not have been
    // called with isCurrentUserAuthor: false (which would set the flag)
    const flaggingCalls = (
      cartStore.markChangedUnderneath as ReturnType<typeof vi.fn>
    ).mock.calls.filter((args: unknown[]) => args[2] === false)
    expect(flaggingCalls).toHaveLength(0)
  })

  it('does not flag an item when the boot read was non-confident (transient guard)', async () => {
    const publishedId = 'doc-non-confident'
    const neverObservable = makeNeverObservable<EditStateShape>()
    const docStore = {pair: {editState: vi.fn(() => neverObservable)}}
    const item = {...makeTrackedItem(publishedId), baselineRev: 'rev-stored'}
    const cartStore = makeCartStore([item])

    await revalidateCartOnBoot(
      docStore as never,
      cartStore as never,
      cartStore.getItems(),
      undefined,
      {readTimeoutMs: 50},
    )

    expect(cartStore.markChangedUnderneath).not.toHaveBeenCalled()
  })

  it('does not flag a removed item (removal wins over divergence flagging)', async () => {
    const publishedId = 'doc-stale-diverged'

    const editState: EditStateShape = {
      // Draft is null — membership decision will be remove
      draft: null,
      published: {_id: publishedId, _rev: 'pub-rev', _type: 'article'},
      liveEditSchemaType: false,
      ready: true,
    }
    const observable = makeAsyncSingleValueObservable(editState)
    const docStore = {pair: {editState: vi.fn(() => observable)}}
    // baselineRev differs from any draft rev (though draft is null here)
    const item = {...makeTrackedItem(publishedId), baselineRev: 'rev-old'}
    const cartStore = makeCartStore([item])

    await revalidateCartOnBoot(docStore as never, cartStore as never, cartStore.getItems())

    // Membership remove was applied
    expect(cartStore.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({action: 'remove', publishedId}),
    )
    // No flag was set
    expect(cartStore.markChangedUnderneath).not.toHaveBeenCalled()
  })
})
