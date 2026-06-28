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
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeCartStore(initialItems: ReturnType<typeof makeTrackedItem>[] = []) {
  const applyDecisionSpy = vi.fn()
  return {
    getItems: vi.fn(() => initialItems),
    applyDecision: applyDecisionSpy,
    subscribe: vi.fn(() => () => undefined),
    destroy: vi.fn(),
  }
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
