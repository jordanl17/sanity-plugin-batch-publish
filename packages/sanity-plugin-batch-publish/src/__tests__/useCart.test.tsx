import {renderHook, act, cleanup} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {clearCartStoreRegistry} from '../CartDocumentObserver'
import {useCart} from '../useCart'

// ---- Mocks ----------------------------------------------------------------

vi.mock('sanity', () => ({
  useWorkspace: vi.fn(),
  useCurrentUser: vi.fn(),
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

import {useWorkspace, useCurrentUser} from 'sanity'
import {readCart} from '../cartStorage'
import type {CartItem} from '../types'

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockUseCurrentUser = vi.mocked(useCurrentUser)

function makeWorkspace() {
  return {projectId: 'proj1', dataset: 'production', name: 'default'} as ReturnType<
    typeof useWorkspace
  >
}

function makeCurrentUser() {
  return {id: 'user-alice', name: 'Alice'} as ReturnType<typeof useCurrentUser>
}

function makeSeedCartItem(): CartItem {
  return {
    publishedId: 'doc-seed',
    draftId: 'drafts.doc-seed',
    documentType: 'article',
    addedRev: 'rev-001',
    baselineRev: 'rev-001',
    changedUnderneath: false,
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

// ---- Tests -----------------------------------------------------------------

afterEach(() => {
  cleanup()
  clearCartStoreRegistry()
  vi.clearAllMocks()
})

beforeEach(() => {
  clearCartStoreRegistry()
})

describe('useCart - remove function', () => {
  it('returns a remove function', () => {
    vi.mocked(readCart).mockReturnValue([])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())

    const {result} = renderHook(() => useCart())

    expect(typeof result.current.remove).toBe('function')
  })

  it('remove drops the item from the cart', () => {
    const seedItem = makeSeedCartItem()
    vi.mocked(readCart).mockReturnValue([seedItem])

    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(makeCurrentUser())

    const {result} = renderHook(() => useCart())

    expect(result.current.items).toHaveLength(1)

    act(() => {
      result.current.remove(seedItem.publishedId)
    })

    expect(result.current.items).toHaveLength(0)
  })

  it('remove is a no-op when no user is logged in', () => {
    mockUseWorkspace.mockReturnValue(makeWorkspace())
    mockUseCurrentUser.mockReturnValue(null)

    const {result} = renderHook(() => useCart())

    expect(result.current.items).toHaveLength(0)

    expect(() => result.current.remove('anything')).not.toThrow()
  })
})
