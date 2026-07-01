/**
 * Shared CSS grid column template for the batch-publish table. Applied identically to the
 * header row and every {@link CartItemRow} so the columns line up: since each row is a
 * full-width grid in the same container, the fixed tracks and the single flexible Document
 * track resolve to the same widths across the header and all rows.
 *
 * Columns: Status | Type | Document | Added | Remove.
 *
 * @internal
 */
export const CART_TABLE_GRID_TEMPLATE = '132px 148px minmax(0, 1fr) 116px 48px'
