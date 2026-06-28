import React from 'react'
import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {makeCartBootRevalidator, clearCartStoreRegistry} from '../CartBootRevalidator'

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

vi.mock('../revalidateCartOnBoot', () => ({
  revalidateCartOnBoot: vi.fn(() => Promise.resolve()),
}))

// ---- Imports after mocks ----------------------------------------------------

import {useWorkspace, useCurrentUser, useDocumentStore} from 'sanity'
import {buildCartStorageKey} from '../cartStorage'
import {revalidateCartOnBoot} from '../revalidateCartOnBoot'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)
const mockUseDocumentStore = vi.mocked(useDocumentStore)
const mockBuildCartStorageKey = vi.mocked(buildCartStorageKey)
const mockRevalidateCartOnBoot = vi.mocked(revalidateCartOnBoot)

// ---- Helpers ----------------------------------------------------------------

function makeWorkspace() {
  return {projectId: 'proj1', dataset: 'production', name: 'default'} as ReturnType<
    typeof useWorkspace
  >
}

function makeCurrentUser() {
  return {id: 'user-alice', name: 'Alice'} as ReturnType<typeof useCurrentUser>
}

function makeDocumentStore() {
  return {
    pair: {
      editState: vi.fn(),
    },
  } as unknown as ReturnType<typeof useDocumentStore>
}

// ---- Tests ------------------------------------------------------------------

afterEach(() => {
  cleanup()
  localStorage.clear()
  clearCartStoreRegistry()
  vi.clearAllMocks()
})

describe('CartBootRevalidator - renders renderDefault unchanged', () => {
  it('renders the renderDefault output', () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartBootRevalidator = makeCartBootRevalidator()

    const renderDefault = vi.fn(() => <div data-testid="studio-content">studio</div>)
    const props = {renderDefault}

    const {getByTestId} = render(<CartBootRevalidator {...props} />)

    expect(getByTestId('studio-content')).toBeTruthy()
    expect(renderDefault).toHaveBeenCalled()
  })
})

describe('CartBootRevalidator - runs sweep on mount with logged-in user', () => {
  it('calls revalidateCartOnBoot once with resolved documentStore, cartStore, and items', async () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())
    const documentStore = makeDocumentStore()
    mockUseDocumentStore.mockReturnValue(documentStore)

    const CartBootRevalidator = makeCartBootRevalidator()

    const renderDefault = vi.fn(() => <div>studio</div>)
    const {unmount} = render(<CartBootRevalidator renderDefault={renderDefault} />)

    // Wait for useEffect to fire (React testing library flushes effects in render)
    await vi.waitFor(() => {
      expect(mockRevalidateCartOnBoot).toHaveBeenCalledTimes(1)
    })

    const [calledDocStore, , calledItems] = mockRevalidateCartOnBoot.mock.calls[0]
    expect(calledDocStore).toBe(documentStore)
    expect(Array.isArray(calledItems)).toBe(true)

    unmount()
  })

  it('resolves the scoped cart key using buildCartStorageKey with workspace and user ids', async () => {
    const workspace = makeWorkspace()
    const user = makeCurrentUser()
    mockUseWorkspace.mockReturnValue(workspace)
    mockUseCurrentUser.mockReturnValue(user)
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartBootRevalidator = makeCartBootRevalidator()
    const renderDefault = vi.fn(() => <div>studio</div>)

    render(<CartBootRevalidator renderDefault={renderDefault} />)

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

describe('CartBootRevalidator - no user (no-op)', () => {
  it('does not call revalidateCartOnBoot when useCurrentUser returns null', async () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)
    mockUseDocumentStore.mockReturnValue(makeDocumentStore())

    const CartBootRevalidator = makeCartBootRevalidator()
    const renderDefault = vi.fn(() => <div data-testid="studio">studio</div>)

    const {getByTestId} = render(<CartBootRevalidator renderDefault={renderDefault} />)

    // Children still render
    expect(getByTestId('studio')).toBeTruthy()
    // But sweep does not run
    expect(mockRevalidateCartOnBoot).not.toHaveBeenCalled()
  })
})
