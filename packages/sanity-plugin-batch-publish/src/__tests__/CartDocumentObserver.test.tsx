import {cleanup, render, renderHook, act} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {makeCartDocumentObserver, clearCartStoreRegistry} from '../CartDocumentObserver'
import {useCart} from '../useCart'

// ---- Mocks ----------------------------------------------------------------

vi.mock('sanity', () => ({
  useWorkspace: vi.fn(),
  useCurrentUser: vi.fn(),
  useDocumentStore: vi.fn(),
  useSchema: vi.fn(),
  getPublishedId: vi.fn((id: string) => id.replace(/^drafts\./, '')),
  isLiveEditEnabled: vi.fn(() => false),
  isDraftId: vi.fn((id: string) => id.startsWith('drafts.')),
  definePlugin: vi.fn((fn: unknown) => fn),
}))

vi.mock('../cartStorage', () => ({
  buildCartStorageKey: vi.fn(
    (scope: {projectId: string; dataset: string; workspace: string; userId: string}) =>
      `test:${scope.projectId}:${scope.dataset}:${scope.workspace}:${scope.userId}`,
  ),
  readCart: vi.fn(() => []),
  writeCart: vi.fn(),
  subscribeToCartStorage: vi.fn(() => () => undefined),
}))

// ---- Helpers ---------------------------------------------------------------

import {useWorkspace, useCurrentUser, useDocumentStore, useSchema} from 'sanity'
import {writeCart, readCart} from '../cartStorage'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseDocumentStore = vi.mocked(useDocumentStore)
const mockUseSchema = vi.mocked(useSchema)
const mockWriteCart = vi.mocked(writeCart)

/**
 * Minimal observable subject for testing: collects subscribers and lets tests emit events.
 */
function makeTestSubject<T>() {
  const subscribers: Array<(value: T) => void> = []
  return {
    subscribe(observer: (value: T) => void) {
      subscribers.push(observer)
      return {
        unsubscribe() {
          const idx = subscribers.indexOf(observer)
          if (idx !== -1) subscribers.splice(idx, 1)
        },
      }
    },
    next(value: T) {
      subscribers.forEach((observer) => observer(value))
    },
    asObservable() {
      return {
        subscribe(observer: (value: T) => void) {
          subscribers.push(observer)
          return {
            unsubscribe() {
              const idx = subscribers.indexOf(observer)
              if (idx !== -1) subscribers.splice(idx, 1)
            },
          }
        },
      }
    },
  }
}

/**
 * Minimal single-value observable for editState (emits once on subscribe).
 */
function makeSingleValueObservable<T>(value: T) {
  return {
    subscribe(observer: (value: T) => void) {
      observer(value)
      return {unsubscribe() {}}
    },
  }
}

function makeWorkspace() {
  return {projectId: 'proj1', dataset: 'production', name: 'default'} as ReturnType<
    typeof useWorkspace
  >
}

function makeCurrentUser() {
  return {id: 'user-alice', name: 'Alice'} as ReturnType<typeof useCurrentUser>
}

function makeSanityDocument(id: string, rev = 'rev-001'): {_id: string; _rev: string} {
  return {_id: id, _rev: rev}
}

function makeEditStateSnapshot(opts: {
  draftId: string
  publishedId: string
  ready?: boolean
  liveEditSchemaType?: boolean
  hasPublished?: boolean
}) {
  return {
    id: opts.publishedId,
    type: 'article',
    draft: {
      _id: opts.draftId,
      _rev: 'rev-001',
      _type: 'article',
      _createdAt: '',
      _updatedAt: '',
      content: 'some content',
    },
    published: opts.hasPublished ? makeSanityDocument(opts.publishedId) : null,
    version: null,
    liveEdit: opts.liveEditSchemaType ?? false,
    liveEditSchemaType: opts.liveEditSchemaType ?? false,
    ready: opts.ready ?? true,
    transactionSyncLock: null,
  }
}

type EventPayload = {type: string; origin?: string; document?: unknown}

function buildDocumentStore(
  eventSubject: ReturnType<typeof makeTestSubject<EventPayload>>,
  editStateSnapshot: unknown,
) {
  return {
    pair: {
      documentEvents: vi.fn(() => eventSubject.asObservable()),
      editState: vi.fn(() => makeSingleValueObservable(editStateSnapshot)),
    },
  } as unknown as ReturnType<typeof useDocumentStore>
}

// ---- Tests -----------------------------------------------------------------

afterEach(() => {
  cleanup()
  localStorage.clear()
  clearCartStoreRegistry()
  vi.clearAllMocks()
})

describe('CartDocumentObserver - render output', () => {
  it('renders the renderDefault output unchanged', () => {
    const eventSubject = makeTestSubject<EventPayload>()
    const editState = makeEditStateSnapshot({draftId: 'drafts.doc-1', publishedId: 'doc-1'})

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div data-testid="document-pane">document content</div>)
    const props = {
      documentId: 'drafts.doc-1',
      documentType: 'article',
      renderDefault,
    }

    const {getByTestId} = render(<CartDocumentObserver {...props} />)

    expect(getByTestId('document-pane')).toBeTruthy()
    expect(renderDefault).toHaveBeenCalled()
  })
})

describe('CartDocumentObserver - local mutation auto-add', () => {
  it('adds to the cart when a local mutation event fires for a qualifying draft', async () => {
    const eventSubject = makeTestSubject<EventPayload>()
    const editState = makeEditStateSnapshot({
      draftId: 'drafts.doc-2',
      publishedId: 'doc-2',
      ready: true,
    })

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    vi.mocked(readCart).mockReturnValue([])

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div>pane</div>)
    const props = {
      documentId: 'drafts.doc-2',
      documentType: 'article',
      renderDefault,
    }

    render(<CartDocumentObserver {...props} />)

    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {
          _id: 'drafts.doc-2',
          _rev: 'rev-001',
          _type: 'article',
          content: 'some content',
        },
      })
    })

    expect(mockWriteCart).toHaveBeenCalled()
    const callArgs = mockWriteCart.mock.calls[0]
    expect(callArgs[1]).toHaveLength(1)
    expect(callArgs[1][0].publishedId).toBe('doc-2')
    expect(callArgs[1][0].draftId).toBe('drafts.doc-2')
  })

  it('does NOT add to the cart when a remote mutation event fires', async () => {
    const eventSubject = makeTestSubject<EventPayload>()
    const editState = makeEditStateSnapshot({
      draftId: 'drafts.doc-3',
      publishedId: 'doc-3',
      ready: true,
    })

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div>pane</div>)
    render(
      <CartDocumentObserver
        {...{documentId: 'drafts.doc-3', documentType: 'article', renderDefault}}
      />,
    )

    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'remote',
        document: {_id: 'drafts.doc-3', _rev: 'rev-001', _type: 'article', content: 'content'},
      })
    })

    expect(mockWriteCart).not.toHaveBeenCalled()
  })
})

describe('CartDocumentObserver - ready === false guard (definitive: false)', () => {
  it('does not remove a tracked item when editState.ready is false', async () => {
    const eventSubject = makeTestSubject<EventPayload>()
    const editState = makeEditStateSnapshot({
      draftId: 'drafts.doc-tracked',
      publishedId: 'doc-tracked',
      ready: false,
    })

    // Pre-seed so item is already tracked
    const trackedItem = {
      publishedId: 'doc-tracked',
      draftId: 'drafts.doc-tracked',
      documentType: 'article',
      addedRev: 'rev-001',
      baselineRev: 'rev-001',
      changedUnderneath: false,
      isNew: false,
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(readCart).mockReturnValue([trackedItem])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div>pane</div>)
    render(
      <CartDocumentObserver
        {...{documentId: 'drafts.doc-tracked', documentType: 'article', renderDefault}}
      />,
    )

    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {_id: 'drafts.doc-tracked', _rev: 'rev-001', _type: 'article'},
      })
    })

    // writeCart should NOT have been called to remove the item (definitive:false -> keep)
    const removeCalls = mockWriteCart.mock.calls.filter((callArgs) => callArgs[1].length === 0)
    expect(removeCalls).toHaveLength(0)
  })
})

describe('CartDocumentObserver - local mutation clears flag (ownByCurrentUser)', () => {
  it('calls ownByCurrentUser on the cart store when a local mutation fires for a tracked flagged item', async () => {
    const publishedId = 'doc-flagged'
    const draftRev = 'rev-002'
    const storageKey = `test:proj1:production:default:user-alice`

    // Pre-seed the store with a flagged tracked item.
    const trackedItem = {
      publishedId,
      draftId: `drafts.${publishedId}`,
      documentType: 'article',
      addedRev: 'rev-001',
      baselineRev: 'rev-001',
      changedUnderneath: true,
      isNew: false,
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(readCart).mockReturnValue([trackedItem])

    const eventSubject = makeTestSubject<EventPayload>()

    // Async editState observable — emit on a later tick to model real Server-fetch timing
    // (load-bearing lesson: sync doubles can mask missing reads of editStateRef.current).
    function makeAsyncEditStateObservable<T>(value: T) {
      return {
        subscribe(observer: (value: T) => void) {
          const timer = setTimeout(() => observer(value), 0)
          return {
            unsubscribe() {
              clearTimeout(timer)
            },
          }
        },
      }
    }

    const editState = makeEditStateSnapshot({
      draftId: `drafts.${publishedId}`,
      publishedId,
      ready: true,
    })
    const editStateWithRev = {...editState, draft: {...editState.draft!, _rev: draftRev}}

    const documentStore = {
      pair: {
        documentEvents: vi.fn(() => eventSubject.asObservable()),
        editState: vi.fn(() => makeAsyncEditStateObservable(editStateWithRev)),
      },
    } as unknown as ReturnType<typeof useDocumentStore>

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()
    const renderDefault = vi.fn(() => <div>pane</div>)

    render(
      <CartDocumentObserver
        {...{documentId: `drafts.${publishedId}`, documentType: 'article', renderDefault}}
      />,
    )

    // Obtain the shared CartStore for this key so we can spy on ownByCurrentUser directly.
    const {getCartStore} = await import('../CartDocumentObserver')
    const cartStore = getCartStore(storageKey)
    const ownByCurrentUserSpy = vi.spyOn(cartStore, 'ownByCurrentUser')

    // Wait for the async editState emission to populate editStateRef.current.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // Fire a local mutation. Include a content field so draftHasRealContent returns true
    // (system-only fields would fail the content check and result in a remove decision).
    // The observer must call ownByCurrentUser with the publishedId and the draft._rev
    // resolved from editStateRef.
    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {
          _id: `drafts.${publishedId}`,
          _rev: draftRev,
          _type: 'article',
          title: 'some content',
        },
      })
    })

    expect(ownByCurrentUserSpy).toHaveBeenCalledWith(publishedId, draftRev)
  })
})

describe('CartDocumentObserver - unmount cleanup', () => {
  it('unsubscribes from documentEvents on unmount', async () => {
    const unsubscribeSpy = vi.fn()
    const editState = makeEditStateSnapshot({draftId: 'drafts.doc-1', publishedId: 'doc-1'})

    const mockSubscribe = vi.fn(() => ({unsubscribe: unsubscribeSpy}))
    const documentStore = {
      pair: {
        documentEvents: vi.fn(() => ({subscribe: mockSubscribe})),
        editState: vi.fn(() => makeSingleValueObservable(editState)),
      },
    } as unknown as ReturnType<typeof useDocumentStore>

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()
    const renderDefault = vi.fn(() => <div>pane</div>)
    const props = {documentId: 'drafts.doc-1', documentType: 'article', renderDefault}

    const {unmount} = render(<CartDocumentObserver {...props} />)
    unmount()

    expect(unsubscribeSpy).toHaveBeenCalled()
  })
})

describe('CartDocumentObserver - no user (no-op)', () => {
  it('renders without tracking when useCurrentUser returns null', () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)
    mockUseDocumentStore.mockReturnValue({pair: {}} as ReturnType<typeof useDocumentStore>)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()
    const renderDefault = vi.fn(() => <div data-testid="pane">pane</div>)
    const props = {documentId: 'drafts.doc-1', documentType: 'article', renderDefault}

    const {getByTestId} = render(<CartDocumentObserver {...props} />)

    expect(getByTestId('pane')).toBeTruthy()
    expect(mockWriteCart).not.toHaveBeenCalled()
  })
})

describe('useCart - hook', () => {
  it('returns items from the cart store', () => {
    vi.mocked(readCart).mockReturnValue([])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())

    const {result} = renderHook(() => useCart())

    expect(result.current.items).toEqual([])
  })

  it('returns empty items when there is no current user', () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)

    const {result} = renderHook(() => useCart())

    expect(result.current.items).toEqual([])
  })
})

describe('CartDocumentObserver - baseline re-advances to committed rev (GAP-03-B)', () => {
  const storageKey = 'test:proj1:production:default:user-alice'
  const publishedId = 'doc-gap-b'
  const draftId = 'drafts.doc-gap-b'
  const preCommitRev = 'rev-pre'
  const committedRev = 'rev-committed'

  function makeGapBTrackedItem() {
    return {
      publishedId,
      draftId,
      documentType: 'article',
      addedRev: preCommitRev,
      baselineRev: preCommitRev,
      changedUnderneath: false,
      isNew: false,
      addedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  function makeGapBEditState(draftRev: string) {
    return {
      id: publishedId,
      type: 'article',
      draft: {
        _id: draftId,
        _rev: draftRev,
        _type: 'article',
        _createdAt: '',
        _updatedAt: '',
        content: 'some content',
      },
      published: null,
      version: null,
      liveEdit: false,
      liveEditSchemaType: false,
      ready: true,
      transactionSyncLock: null,
    }
  }

  it('re-advances baselineRev to the committed rev when the committed rev arrives in a later editState emission', async () => {
    vi.mocked(readCart).mockReturnValue([makeGapBTrackedItem()])

    // Multi-emission editState subject — models real two-phase timing where:
    // (a) initial emission carries pre-commit rev (populates editStateRef.current)
    // (b) later emission carries the committed rev after the mutation lands on the server
    const editStateSubject = makeTestSubject<ReturnType<typeof makeGapBEditState>>()
    const eventSubject = makeTestSubject<EventPayload>()

    const documentStore = {
      pair: {
        documentEvents: vi.fn(() => eventSubject.asObservable()),
        editState: vi.fn(() => editStateSubject.asObservable()),
      },
    } as unknown as ReturnType<typeof useDocumentStore>

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()
    const renderDefault = vi.fn(() => <div>pane</div>)

    render(
      <CartDocumentObserver {...{documentId: draftId, documentType: 'article', renderDefault}} />,
    )

    const {getCartStore} = await import('../CartDocumentObserver')
    const cartStore = getCartStore(storageKey)
    const ownByCurrentUserSpy = vi.spyOn(cartStore, 'ownByCurrentUser')

    // Phase (a): initial ready editState with pre-commit rev populates editStateRef.current
    await act(async () => {
      editStateSubject.next(makeGapBEditState(preCommitRev))
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // Local mutation event fires — at this moment editStateRef.current still holds pre-commit rev
    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {
          _id: draftId,
          _rev: preCommitRev,
          _type: 'article',
          title: 'edited content',
        },
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // Phase (b): later editState emission carrying the committed rev
    await act(async () => {
      editStateSubject.next(makeGapBEditState(committedRev))
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // The stored baseline must equal the committed rev, not the pre-commit rev.
    // Without the GAP-03-B fix, this assertion fails because the baseline remains 'rev-pre'.
    const trackedItem = cartStore.getItems().find((item) => item.publishedId === publishedId)
    expect(trackedItem?.baselineRev).toBe(committedRev)

    // ownByCurrentUser must have been called with the committed rev (not just the pre-commit rev)
    expect(ownByCurrentUserSpy).toHaveBeenCalledWith(publishedId, committedRev)
  })

  it('does NOT advance baselineRev when a bare editState rev change arrives without a preceding local mutation (remote-isolation invariant)', async () => {
    vi.mocked(readCart).mockReturnValue([makeGapBTrackedItem()])

    const editStateSubject = makeTestSubject<ReturnType<typeof makeGapBEditState>>()
    const eventSubject = makeTestSubject<EventPayload>()

    const documentStore = {
      pair: {
        documentEvents: vi.fn(() => eventSubject.asObservable()),
        editState: vi.fn(() => editStateSubject.asObservable()),
      },
    } as unknown as ReturnType<typeof useDocumentStore>

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)

    const CartDocumentObserver = makeCartDocumentObserver()
    const renderDefault = vi.fn(() => <div>pane</div>)

    render(
      <CartDocumentObserver {...{documentId: draftId, documentType: 'article', renderDefault}} />,
    )

    const {getCartStore} = await import('../CartDocumentObserver')
    const cartStore = getCartStore(storageKey)

    // Initial editState with pre-commit rev
    await act(async () => {
      editStateSubject.next(makeGapBEditState(preCommitRev))
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // Local mutation + committed rev settling — establishes baseline at committedRev
    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {_id: draftId, _rev: preCommitRev, _type: 'article', title: 'edited content'},
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    await act(async () => {
      editStateSubject.next(makeGapBEditState(committedRev))
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    // Confirm baseline is at committedRev after the local-edit cycle
    const itemAfterLocalEdit = cartStore.getItems().find((item) => item.publishedId === publishedId)
    expect(itemAfterLocalEdit?.baselineRev).toBe(committedRev)

    // Now emit another editState with a new rev WITHOUT any local mutation event preceding it.
    // This models a remote author's change landing while the doc is open.
    // The re-advance must NOT fire — the pending marker was cleared by the committed-rev emission.
    const remoteRev = 'rev-remote'
    await act(async () => {
      editStateSubject.next(makeGapBEditState(remoteRev))
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    })

    const itemAfterRemoteEditState = cartStore
      .getItems()
      .find((item) => item.publishedId === publishedId)
    expect(itemAfterRemoteEditState?.baselineRev).toBe(committedRev)
    expect(itemAfterRemoteEditState?.baselineRev).not.toBe(remoteRev)
  })
})
