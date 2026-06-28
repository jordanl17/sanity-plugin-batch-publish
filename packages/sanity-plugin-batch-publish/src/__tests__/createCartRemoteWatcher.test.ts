import {afterEach, describe, expect, it, vi} from 'vitest'

import {createCartRemoteWatcher} from '../createCartRemoteWatcher'

// ---- Helpers ---------------------------------------------------------------

/**
 * Creates a controllable observable subject for a single cart item's remote-snapshot stream.
 * Defers the first emission to a later tick to model async observable behaviour (load-bearing
 * lesson: sync-emitting doubles mask real boot-sweep bugs).
 */
function makeRemoteSnapshotSubject() {
  const subscribers: Array<(value: unknown) => void> = []
  const unsubscribeSpy = vi.fn()
  return {
    unsubscribeSpy,
    subscribe(observer: (value: unknown) => void) {
      subscribers.push(observer)
      return {
        unsubscribe() {
          const idx = subscribers.indexOf(observer)
          if (idx !== -1) subscribers.splice(idx, 1)
          unsubscribeSpy()
        },
      }
    },
    /** Emit an event asynchronously (next macrotask) to model real observable timing. */
    emitAsync(value: unknown): Promise<void> {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          subscribers.forEach((observer) => observer(value))
          resolve()
        }, 0)
      })
    },
    /** Emit synchronously for controlled reconciliation tests. */
    emitSync(value: unknown): void {
      subscribers.forEach((observer) => observer(value))
    },
    subscriberCount(): number {
      return subscribers.length
    },
  }
}

/**
 * Creates a controllable editState subject per publishedId.
 * Emits a configurable draft._rev so the watcher's rev re-read is exercised.
 */
function makeEditStateSubject(draftRev: string) {
  const subscribers: Array<(value: unknown) => void> = []
  const unsubscribeSpy = vi.fn()
  return {
    unsubscribeSpy,
    draftRev,
    subscribe(observer: (value: unknown) => void) {
      subscribers.push(observer)
      // Emit asynchronously to model real editState behaviour.
      setTimeout(() => {
        subscribers.forEach((sub) =>
          sub({ready: true, draft: {_rev: draftRev}, liveEditSchemaType: false}),
        )
      }, 0)
      return {
        unsubscribe() {
          const idx = subscribers.indexOf(observer)
          if (idx !== -1) subscribers.splice(idx, 1)
          unsubscribeSpy()
        },
      }
    },
  }
}

interface FakeItemSpec {
  publishedId: string
  draftId: string
  documentType: string
  remoteSnapshotSubject: ReturnType<typeof makeRemoteSnapshotSubject>
  editStateSubject: ReturnType<typeof makeEditStateSubject>
}

function makeDocumentStore(itemSpecs: FakeItemSpec[]) {
  const checkoutPairSpy = vi.fn((idPair: {draftId: string; publishedId: string}) => {
    const spec = itemSpecs.find((item) => item.publishedId === idPair.publishedId)
    return {
      draft: {
        remoteSnapshot$: spec?.remoteSnapshotSubject ?? makeRemoteSnapshotSubject(),
      },
    }
  })

  const editStateSpy = vi.fn((publishedId: string) => {
    const spec = itemSpecs.find((item) => item.publishedId === publishedId)
    return spec?.editStateSubject ?? makeEditStateSubject('fallback-rev')
  })

  return {
    checkoutPairSpy,
    editStateSpy,
    store: {
      checkoutPair: checkoutPairSpy,
      pair: {
        editState: editStateSpy,
      },
    },
  }
}

function makeCartStore(initialItems: FakeItemSpec[]) {
  const cartListeners: Array<(items: unknown[]) => void> = []
  const unsubscribeStoreSpy = vi.fn()
  const markChangedUnderneathSpy = vi.fn()

  let currentItems = initialItems.map((spec) => ({
    publishedId: spec.publishedId,
    draftId: spec.draftId,
    documentType: spec.documentType,
    addedRev: 'rev-001',
    baselineRev: 'rev-baseline',
    changedUnderneath: false,
    isNew: false,
    addedAt: '2026-01-01T00:00:00.000Z',
  }))

  return {
    markChangedUnderneathSpy,
    unsubscribeStoreSpy,
    /** Push a new cart membership state to all listeners. */
    pushMembership(newItems: typeof currentItems): void {
      currentItems = newItems
      cartListeners.forEach((listener) => listener(newItems))
    },
    store: {
      getItems: vi.fn(() => currentItems),
      subscribe: vi.fn((listener: (items: unknown[]) => void) => {
        cartListeners.push(listener)
        return function unsubscribe() {
          const idx = cartListeners.indexOf(listener)
          if (idx !== -1) cartListeners.splice(idx, 1)
          unsubscribeStoreSpy()
        }
      }),
      markChangedUnderneath: markChangedUnderneathSpy,
    },
  }
}

// ---- Tests -----------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks()
})

describe('createCartRemoteWatcher - subscription setup', () => {
  it('subscribes per current item on the DRAFT remote-snapshot stream at start', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }
    const specB: FakeItemSpec = {
      publishedId: 'doc-b',
      draftId: 'drafts.doc-b',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {checkoutPairSpy, store: docStore} = makeDocumentStore([specA, specB])
    const {store: cartStore} = makeCartStore([specA, specB])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    // checkoutPair called once per item on start
    expect(checkoutPairSpy).toHaveBeenCalledTimes(2)
    expect(checkoutPairSpy).toHaveBeenCalledWith({draftId: 'drafts.doc-a', publishedId: 'doc-a'})
    expect(checkoutPairSpy).toHaveBeenCalledWith({draftId: 'drafts.doc-b', publishedId: 'doc-b'})

    // Remote-snapshot subjects have one active subscriber each
    expect(specA.remoteSnapshotSubject.subscriberCount()).toBe(1)
    expect(specB.remoteSnapshotSubject.subscriberCount()).toBe(1)

    watcher.stop()
  })

  it('does not double-subscribe when reconcile re-reports an already-watched id', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {checkoutPairSpy, store: docStore} = makeDocumentStore([specA])
    const fakeCart = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore: fakeCart.store,
      currentUserId: 'user-alice',
    })

    // Simulate cartStore notifying with the same item still present
    fakeCart.pushMembership([
      {
        publishedId: 'doc-a',
        draftId: 'drafts.doc-a',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-baseline',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    // checkoutPair should still only have been called once (no re-subscription)
    expect(checkoutPairSpy).toHaveBeenCalledTimes(1)
    expect(specA.remoteSnapshotSubject.subscriberCount()).toBe(1)

    watcher.stop()
  })
})

describe('createCartRemoteWatcher - event handling', () => {
  it('ignores the initial snapshot event (does not call markChangedUnderneath)', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    await specA.remoteSnapshotSubject.emitAsync({
      type: 'snapshot',
      head: {_rev: 'rev-new'},
    })

    expect(markChangedUnderneathSpy).not.toHaveBeenCalled()

    watcher.stop()
  })

  it('flags via rev re-read from editState when remote mutation is by another user', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-new'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    // Wait for editState to emit and update the ref
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: 'user-bob',
      head: {_rev: 'rev-new'},
    })

    // Author differs from current user; rev from editState; should flag
    expect(markChangedUnderneathSpy).toHaveBeenCalledWith('doc-a', 'rev-new', false)
    watcher.stop()
  })

  it('calls markChangedUnderneath with isCurrentUserAuthor:true on self-echo (does not flag by store contract)', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-x'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: 'user-alice',
      head: {_rev: 'rev-x'},
    })

    // Self-echo: isCurrentUserAuthor true → the store's flag logic decides (no blind flag)
    expect(markChangedUnderneathSpy).toHaveBeenCalledWith('doc-a', expect.any(String), true)
    watcher.stop()
  })

  it('flags with isCurrentUserAuthor:false when author is an empty string', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-y'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: '',
      head: {_rev: 'rev-y'},
    })

    expect(markChangedUnderneathSpy).toHaveBeenCalledWith('doc-a', expect.any(String), false)
    watcher.stop()
  })

  it('flags with isCurrentUserAuthor:false when author is undefined (unresolved)', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-z'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: undefined,
      head: {_rev: 'rev-z'},
    })

    expect(markChangedUnderneathSpy).toHaveBeenCalledWith('doc-a', expect.any(String), false)
    watcher.stop()
  })
})

describe('createCartRemoteWatcher - membership reconciliation', () => {
  it('opens a new subscription when a new item is added to the cart', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }
    const specC: FakeItemSpec = {
      publishedId: 'doc-c',
      draftId: 'drafts.doc-c',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {checkoutPairSpy, store: docStore} = makeDocumentStore([specA, specC])
    const fakeCart = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore: fakeCart.store,
      currentUserId: 'user-alice',
    })

    // Initially only doc-a is watched
    expect(checkoutPairSpy).toHaveBeenCalledTimes(1)

    // Now add doc-c to the cart
    fakeCart.pushMembership([
      {
        publishedId: 'doc-a',
        draftId: 'drafts.doc-a',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-baseline',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        publishedId: 'doc-c',
        draftId: 'drafts.doc-c',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-baseline',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    // checkoutPair should now have been called for doc-c too
    expect(checkoutPairSpy).toHaveBeenCalledTimes(2)
    expect(checkoutPairSpy).toHaveBeenCalledWith({draftId: 'drafts.doc-c', publishedId: 'doc-c'})
    expect(specC.remoteSnapshotSubject.subscriberCount()).toBe(1)

    watcher.stop()
  })

  it('unsubscribes from a removed item and ignores further emits from it', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }
    const specB: FakeItemSpec = {
      publishedId: 'doc-b',
      draftId: 'drafts.doc-b',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {store: docStore} = makeDocumentStore([specA, specB])
    const fakeCart = makeCartStore([specA, specB])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore: fakeCart.store,
      currentUserId: 'user-alice',
    })

    expect(specA.remoteSnapshotSubject.subscriberCount()).toBe(1)

    // Remove doc-a from cart
    fakeCart.pushMembership([
      {
        publishedId: 'doc-b',
        draftId: 'drafts.doc-b',
        documentType: 'article',
        addedRev: 'rev-001',
        baselineRev: 'rev-baseline',
        changedUnderneath: false,
        isNew: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    // doc-a's unsubscribe should have fired
    expect(specA.remoteSnapshotSubject.unsubscribeSpy).toHaveBeenCalled()
    expect(specA.remoteSnapshotSubject.subscriberCount()).toBe(0)

    // A later emit on doc-a's stream does NOT call markChangedUnderneath
    const callCountBefore = fakeCart.markChangedUnderneathSpy.mock.calls.length
    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: 'user-bob',
      head: {_rev: 'rev-new'},
    })
    expect(fakeCart.markChangedUnderneathSpy.mock.calls.length).toBe(callCountBefore)

    watcher.stop()
  })
})

describe('createCartRemoteWatcher - teardown', () => {
  it('unsubscribes all remote-snapshot and cartStore subscriptions on stop()', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }
    const specB: FakeItemSpec = {
      publishedId: 'doc-b',
      draftId: 'drafts.doc-b',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {store: docStore} = makeDocumentStore([specA, specB])
    const {unsubscribeStoreSpy, store: cartStore} = makeCartStore([specA, specB])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    watcher.stop()

    // All per-item remote-snapshot subs torn down
    expect(specA.remoteSnapshotSubject.unsubscribeSpy).toHaveBeenCalled()
    expect(specB.remoteSnapshotSubject.unsubscribeSpy).toHaveBeenCalled()

    // CartStore subscription torn down
    expect(unsubscribeStoreSpy).toHaveBeenCalled()
  })

  it('ignores emits from all streams after stop()', async () => {
    const specA: FakeItemSpec = {
      publishedId: 'doc-a',
      draftId: 'drafts.doc-a',
      documentType: 'article',
      remoteSnapshotSubject: makeRemoteSnapshotSubject(),
      editStateSubject: makeEditStateSubject('rev-baseline'),
    }

    const {store: docStore} = makeDocumentStore([specA])
    const {markChangedUnderneathSpy, store: cartStore} = makeCartStore([specA])

    const watcher = createCartRemoteWatcher({
      documentStore: docStore,
      cartStore,
      currentUserId: 'user-alice',
    })

    watcher.stop()

    // Emit after stop — markChangedUnderneath must NOT be called
    await specA.remoteSnapshotSubject.emitAsync({
      type: 'remoteMutation',
      author: 'user-bob',
      head: {_rev: 'rev-new'},
    })

    expect(markChangedUnderneathSpy).not.toHaveBeenCalled()
  })
})

describe('createCartRemoteWatcher - availability guard', () => {
  it('returns a no-op stop() when documentStore.checkoutPair is unavailable', () => {
    const {store: cartStore} = makeCartStore([])

    const watcher = createCartRemoteWatcher({
      documentStore: {} as never,
      cartStore,
      currentUserId: 'user-alice',
    })

    // Should not throw; stop() is callable
    expect(() => watcher.stop()).not.toThrow()
  })
})
