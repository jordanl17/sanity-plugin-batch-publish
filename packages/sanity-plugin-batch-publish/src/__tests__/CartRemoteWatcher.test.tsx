import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {makeCartRemoteWatcher, clearCartStoreRegistry} from '../CartRemoteWatcher'

// ---- Mocks ------------------------------------------------------------------

vi.mock('sanity', () => ({
  useWorkspace: vi.fn(),
  useCurrentUser: vi.fn(),
  useDocumentStore: vi.fn(),
  useSchema: vi.fn(),
  getPublishedId: vi.fn((id: string) => id.replace(/^drafts\./, '')),
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

// ---- Imports after mocks ----------------------------------------------------

import {useWorkspace, useCurrentUser, useDocumentStore} from 'sanity'
import {buildCartStorageKey} from '../cartStorage'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseDocumentStore = vi.mocked(useDocumentStore)
const mockBuildCartStorageKey = vi.mocked(buildCartStorageKey)

// ---- Helpers ----------------------------------------------------------------

function makeWorkspace() {
  return {projectId: 'proj1', dataset: 'production', name: 'default'} as ReturnType<
    typeof useWorkspace
  >
}

function makeCurrentUser() {
  return {id: 'user-alice', name: 'Alice'} as NonNullable<ReturnType<typeof useCurrentUser>>
}

function makeDocumentStore() {
  // Minimal document store with availability guard fields; checkoutPair returns empty
  // subscriptions so createCartRemoteWatcher runs but opens no real connections.
  return {
    pair: {
      editState: vi.fn(() => ({subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))})),
      documentEvents: vi.fn(() => ({subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))})),
    },
    checkoutPair: vi.fn(() => ({
      draft: {
        remoteSnapshot$: {subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))},
        events: {subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))},
      },
    })),
  } as unknown as ReturnType<typeof useDocumentStore>
}

// ---- Tests ------------------------------------------------------------------

afterEach(() => {
  cleanup()
  localStorage.clear()
  clearCartStoreRegistry()
  vi.clearAllMocks()
})

describe('CartRemoteWatcher - renders renderDefault unchanged', () => {
  it('renders the renderDefault output', () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartRemoteWatcherComponent = makeCartRemoteWatcher()

    const renderDefault = vi.fn(() => <div data-testid="studio-content">studio</div>)
    const props = {renderDefault}

    const {getByTestId} = render(<CartRemoteWatcherComponent {...props} />)

    expect(getByTestId('studio-content')).toBeTruthy()
    expect(renderDefault).toHaveBeenCalled()
  })
})

describe('CartRemoteWatcher - starts watcher on mount with logged-in user', () => {
  it('resolves the scoped cart key using buildCartStorageKey with workspace and user ids', async () => {
    const workspace = makeWorkspace()
    const user = makeCurrentUser()

    mockUseWorkspace.mockReturnValue(workspace)
    mockUseCurrentUser.mockReturnValue(user)
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartRemoteWatcherComponent = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    render(<CartRemoteWatcherComponent renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(mockBuildCartStorageKey).toHaveBeenCalledWith({
        projectId: workspace.projectId,
        dataset: workspace.dataset,
        workspace: workspace.name,
        userId: user.id,
      })
    })
  })

  it('calls checkoutPair on the documentStore for each cart item when there are tracked items', async () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    // Seed localStorage with one tracked item so the watcher subscribes for it
    const {readCart} = await import('../cartStorage')
    vi.mocked(readCart).mockReturnValue([
      {
        publishedId: 'doc-a',
        draftId: 'drafts.doc-a',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const documentStore = makeDocumentStore()
    mockUseDocumentStore.mockReturnValue(documentStore)

    const CartRemoteWatcherComponent = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    const {unmount} = render(<CartRemoteWatcherComponent renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(documentStore.checkoutPair).toHaveBeenCalledWith({
        draftId: 'drafts.doc-a',
        publishedId: 'doc-a',
      })
    })

    unmount()
  })

  it('unsubscribes from the remote-snapshot stream when the component unmounts', async () => {
    const unsubscribeSpy = vi.fn()
    const documentStore = {
      pair: {
        editState: vi.fn(() => ({subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))})),
        documentEvents: vi.fn(() => ({subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))})),
      },
      checkoutPair: vi.fn(() => ({
        draft: {
          remoteSnapshot$: {subscribe: vi.fn(() => ({unsubscribe: unsubscribeSpy}))},
          events: {subscribe: vi.fn(() => ({unsubscribe: vi.fn()}))},
        },
      })),
    } as unknown as ReturnType<typeof useDocumentStore>

    const {readCart} = await import('../cartStorage')
    vi.mocked(readCart).mockReturnValue([
      {
        publishedId: 'doc-a',
        draftId: 'drafts.doc-a',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-001',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(documentStore)

    const CartRemoteWatcherComponent = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    const {unmount} = render(<CartRemoteWatcherComponent renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(documentStore.checkoutPair).toHaveBeenCalled()
    })

    unmount()

    expect(unsubscribeSpy).toHaveBeenCalled()
  })
})

describe('CartRemoteWatcher - no user (no-op)', () => {
  it('does not call checkoutPair when useCurrentUser returns null', async () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)
    const documentStore = makeDocumentStore()
    mockUseDocumentStore.mockReturnValue(documentStore)

    const CartRemoteWatcherComponent = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div data-testid="studio">studio</div>)

    const {getByTestId} = render(<CartRemoteWatcherComponent renderDefault={renderDefault} />)

    // Children still render
    expect(getByTestId('studio')).toBeTruthy()
    // Watcher must not have started any subscriptions
    expect(documentStore.checkoutPair).not.toHaveBeenCalled()
  })
})
