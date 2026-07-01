import type {CartItem} from './types'

function isValidCartItem(value: unknown): value is CartItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).publishedId === 'string' &&
    typeof (value as Record<string, unknown>).draftId === 'string'
  )
}

function safeParseCart(rawValue: string | null): CartItem[] {
  if (rawValue === null) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (Array.isArray(parsed) === false) {
      return []
    }
    return parsed.filter(isValidCartItem)
  } catch {
    return []
  }
}

/**
 * Builds a deterministic localStorage key scoped to all four isolation dimensions.
 *
 * Format: `sanity-plugin-batch-publish:cart:<projectId>:<dataset>:<workspace>:<userId>`
 *
 * Each part is required. Distinct `userId` values produce distinct keys (account isolation).
 * Distinct `workspace` values also produce distinct keys (workspace cart isolation per PERSIST-01).
 *
 * @public
 */
export function buildCartStorageKey(scope: {
  projectId: string
  dataset: string
  workspace: string
  userId: string
}): string {
  return `sanity-plugin-batch-publish:cart:${scope.projectId}:${scope.dataset}:${scope.workspace}:${scope.userId}`
}

/**
 * Reads the cart from localStorage at the given scoped key.
 *
 * SSR-guarded: returns `[]` when `globalThis.localStorage` is unavailable (e.g. Node/SSR).
 * Also returns `[]` on parse errors or non-array payloads. Drops individual malformed entries
 * that are missing the required `publishedId` or `draftId` string fields.
 *
 * @public
 */
export function readCart(key: string): CartItem[] {
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
    return []
  }

  const rawValue = globalThis.localStorage.getItem(key)
  return safeParseCart(rawValue)
}

/**
 * Writes the cart to localStorage at the given scoped key.
 *
 * SSR-guarded: silently does nothing when `globalThis.localStorage` is unavailable.
 * Errors (quota exceeded, security errors) are caught and swallowed so they never
 * propagate into React render paths.
 *
 * @public
 */
export function writeCart(key: string, cart: CartItem[]): void {
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
    return
  }

  try {
    globalThis.localStorage.setItem(key, JSON.stringify(cart))
  } catch {
    // Swallow quota/security errors - cart write is best-effort
  }
}

/**
 * Subscribes to cross-tab cart changes via the `storage` event.
 *
 * SSR-guarded: returns a no-op unsubscribe when `window` is unavailable.
 * Only fires `onChange` for events matching the given key; ignores all other storage events.
 * Treats a `null` newValue (key cleared) as an empty cart.
 *
 * Returns a cleanup function that removes the event listener.
 *
 * @public
 */
export function subscribeToCartStorage(
  key: string,
  onChange: (cart: CartItem[]) => void,
): () => void {
  if (typeof window === 'undefined' || window === null) {
    return function noOpUnsubscribe() {
      // no-op: no window available in this environment
    }
  }

  function handleStorageEvent(event: StorageEvent): void {
    if (event.key !== key) {
      return
    }
    onChange(safeParseCart(event.newValue))
  }

  window.addEventListener('storage', handleStorageEvent)

  return function unsubscribe(): void {
    window.removeEventListener('storage', handleStorageEvent)
  }
}
