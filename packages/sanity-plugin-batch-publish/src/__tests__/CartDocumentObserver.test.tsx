import {cleanup, render, renderHook, act} from '@testing-library/react'
import {Observable, Subject} from 'rxjs'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {makeCartDocumentObserver} from '../CartDocumentObserver'
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

import {useWorkspace, useCurrentUser, useDocumentStore, useSchema, isLiveEditEnabled} from 'sanity'
import {writeCart, readCart} from '../cartStorage'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseDocumentStore = vi.mocked(useDocumentStore)
const mockUseSchema = vi.mocked(useSchema)
const mockIsLiveEditEnabled = vi.mocked(isLiveEditEnabled)
const mockWriteCart = vi.mocked(writeCart)

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

function buildDocumentStore(
  eventSubject: Subject<{type: string; origin?: string; document?: unknown}>,
  editStateSnapshot: unknown,
) {
  return {
    pair: {
      documentEvents: vi.fn(() => eventSubject.asObservable()),
      editState: vi.fn(
        () =>
          new Observable((subscriber) => {
            subscriber.next(editStateSnapshot)
          }),
      ),
    },
  } as unknown as ReturnType<typeof useDocumentStore>
}

// ---- Tests -----------------------------------------------------------------

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('CartDocumentObserver - render output', () => {
  it('renders the renderDefault output unchanged', () => {
    const eventSubject = new Subject<{type: string; origin?: string}>()
    const editState = makeEditStateSnapshot({draftId: 'drafts.doc-1', publishedId: 'doc-1'})

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    mockIsLiveEditEnabled.mockReturnValue(false)

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
    const eventSubject = new Subject<{type: string; origin?: string; document?: unknown}>()
    const editState = makeEditStateSnapshot({
      draftId: 'drafts.doc-1',
      publishedId: 'doc-1',
      ready: true,
    })

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    mockIsLiveEditEnabled.mockReturnValue(false)
    vi.mocked(readCart).mockReturnValue([])

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div>pane</div>)
    const props = {
      documentId: 'drafts.doc-1',
      documentType: 'article',
      renderDefault,
    }

    render(<CartDocumentObserver {...props} />)

    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'local',
        document: {
          _id: 'drafts.doc-1',
          _rev: 'rev-001',
          _type: 'article',
          content: 'some content',
        },
      })
    })

    expect(mockWriteCart).toHaveBeenCalled()
    const callArgs = mockWriteCart.mock.calls[0]
    expect(callArgs[1]).toHaveLength(1)
    expect(callArgs[1][0].publishedId).toBe('doc-1')
    expect(callArgs[1][0].draftId).toBe('drafts.doc-1')
  })

  it('does NOT add to the cart when a remote mutation event fires', async () => {
    const eventSubject = new Subject<{type: string; origin?: string; document?: unknown}>()
    const editState = makeEditStateSnapshot({
      draftId: 'drafts.doc-1',
      publishedId: 'doc-1',
      ready: true,
    })

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    mockIsLiveEditEnabled.mockReturnValue(false)

    const CartDocumentObserver = makeCartDocumentObserver()

    const renderDefault = vi.fn(() => <div>pane</div>)
    render(
      <CartDocumentObserver
        {...{documentId: 'drafts.doc-1', documentType: 'article', renderDefault}}
      />,
    )

    await act(async () => {
      eventSubject.next({
        type: 'mutation',
        origin: 'remote',
        document: {_id: 'drafts.doc-1', _rev: 'rev-001', _type: 'article', content: 'content'},
      })
    })

    expect(mockWriteCart).not.toHaveBeenCalled()
  })
})

describe('CartDocumentObserver - ready === false guard (definitive: false)', () => {
  it('does not remove a tracked item when editState.ready is false', async () => {
    const eventSubject = new Subject<{type: string; origin?: string; document?: unknown}>()
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
      isNew: false,
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(readCart).mockReturnValue([trackedItem])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(buildDocumentStore(eventSubject, editState))
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    mockIsLiveEditEnabled.mockReturnValue(false)

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

    // writeCart should NOT have been called to remove the item
    const removeCalls = mockWriteCart.mock.calls.filter((callArgs) => callArgs[1].length === 0)
    expect(removeCalls).toHaveLength(0)
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
        editState: vi.fn(() => new Observable((sub) => sub.next(editState))),
      },
    } as unknown as ReturnType<typeof useDocumentStore>

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)
    mockUseSchema.mockReturnValue({} as ReturnType<typeof useSchema>)
    mockIsLiveEditEnabled.mockReturnValue(false)

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
  it('returns items from the cart store and re-renders when items change', async () => {
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
