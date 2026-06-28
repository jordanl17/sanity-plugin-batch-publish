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

vi.mock('../cartRemoteWatcher', () => ({
  createCartRemoteWatcher: vi.fn(() => ({stop: vi.fn()})),
}))

// ---- Imports after mocks ----------------------------------------------------

import {useWorkspace, useCurrentUser, useDocumentStore} from 'sanity'
import {buildCartStorageKey} from '../cartStorage'
import {createCartRemoteWatcher} from '../cartRemoteWatcher'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseDocumentStore = vi.mocked(useDocumentStore)
const mockBuildCartStorageKey = vi.mocked(buildCartStorageKey)
const mockCreateCartRemoteWatcher = vi.mocked(createCartRemoteWatcher)

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
  return {
    pair: {
      editState: vi.fn(),
      documentEvents: vi.fn(),
    },
    checkoutPair: vi.fn(),
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

    const CartRemoteWatcher = makeCartRemoteWatcher()

    const renderDefault = vi.fn(() => <div data-testid="studio-content">studio</div>)
    const props = {renderDefault}

    const {getByTestId} = render(<CartRemoteWatcher {...props} />)

    expect(getByTestId('studio-content')).toBeTruthy()
    expect(renderDefault).toHaveBeenCalled()
  })
})

describe('CartRemoteWatcher - starts watcher on mount with logged-in user', () => {
  it('calls createCartRemoteWatcher once with the resolved documentStore, cartStore, and currentUserId', async () => {
    const workspace = makeWorkspace()
    const user = makeCurrentUser()
    const documentStore = makeDocumentStore()

    mockUseWorkspace.mockReturnValue(workspace)
    mockUseCurrentUser.mockReturnValue(user)
    mockUseDocumentStore.mockReturnValue(documentStore)

    const CartRemoteWatcher = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    const {unmount} = render(<CartRemoteWatcher renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(mockCreateCartRemoteWatcher).toHaveBeenCalledTimes(1)
    })

    const [calledParams] = mockCreateCartRemoteWatcher.mock.calls[0]
    expect(calledParams.documentStore).toBe(documentStore)
    expect(calledParams.currentUserId).toBe(user.id)
    expect(calledParams.cartStore).toBeDefined()

    unmount()
  })

  it('calls stop() on the watcher when the component unmounts', async () => {
    const stopSpy = vi.fn()
    mockCreateCartRemoteWatcher.mockReturnValue({stop: stopSpy})

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartRemoteWatcher = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    const {unmount} = render(<CartRemoteWatcher renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(mockCreateCartRemoteWatcher).toHaveBeenCalledTimes(1)
    })

    unmount()

    expect(stopSpy).toHaveBeenCalled()
  })

  it('resolves the scoped cart key using buildCartStorageKey with workspace and user ids', async () => {
    const workspace = makeWorkspace()
    const user = makeCurrentUser()

    mockUseWorkspace.mockReturnValue(workspace)
    mockUseCurrentUser.mockReturnValue(user)
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartRemoteWatcher = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div>studio</div>)

    render(<CartRemoteWatcher renderDefault={renderDefault} />)

    await vi.waitFor(() => {
      expect(mockBuildCartStorageKey).toHaveBeenCalledWith({
        projectId: workspace.projectId,
        dataset: workspace.dataset,
        workspace: workspace.name,
        userId: user.id,
      })
    })
  })
})

describe('CartRemoteWatcher - no user (no-op)', () => {
  it('does not start the watcher when useCurrentUser returns null', async () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartRemoteWatcher = makeCartRemoteWatcher()
    const renderDefault = vi.fn(() => <div data-testid="studio">studio</div>)

    const {getByTestId} = render(<CartRemoteWatcher renderDefault={renderDefault} />)

    // Children still render
    expect(getByTestId('studio')).toBeTruthy()
    // Watcher must not be started
    expect(mockCreateCartRemoteWatcher).not.toHaveBeenCalled()
  })
})
