import type {CartItem} from './types'

/**
 * Returns true when an entry with the given publishedId exists in the cart.
 *
 * @public
 */
export function hasItem(cart: CartItem[], publishedId: string): boolean {
  return cart.some((item) => item.publishedId === publishedId)
}

/**
 * Idempotent upsert of a CartItem into the cart, keyed by publishedId.
 *
 * When the publishedId is already present, the existing entry's addedAt is kept frozen
 * (first-add timestamp is preserved) while addedRev, draftId, documentType, and isNew
 * are advanced to the incoming item's values.
 *
 * When the publishedId is absent, the item is appended as-is.
 *
 * Always returns a new array; the input cart is never mutated.
 *
 * @public
 */
export function addItem(cart: CartItem[], item: CartItem, _now: string): CartItem[] {
  const alreadyPresent = hasItem(cart, item.publishedId)

  if (alreadyPresent) {
    return cart.map((existing) => {
      if (existing.publishedId === item.publishedId) {
        return {
          ...item,
          addedAt: existing.addedAt,
        }
      }
      return existing
    })
  }

  return [...cart, item]
}

/**
 * Returns a new cart with any entry matching the given publishedId removed.
 *
 * Idempotent: removing an absent id returns an equivalent array without modification.
 * Always returns a new array; the input cart is never mutated.
 *
 * @public
 */
export function removeItem(cart: CartItem[], publishedId: string): CartItem[] {
  return cart.filter((item) => item.publishedId !== publishedId)
}
