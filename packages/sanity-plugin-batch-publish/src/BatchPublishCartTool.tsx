import {Box, Card, Flex, Stack, Text} from '@sanity/ui'
import React from 'react'
import type {Tool} from 'sanity'

import {CART_TABLE_GRID_TEMPLATE} from './cartTableColumns'
import {CartItemRow} from './CartItemRow'
import {useCart} from './useCart'

interface BatchPublishCartToolProps {
  tool: Tool
}

const headerGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: CART_TABLE_GRID_TEMPLATE,
  alignItems: 'center',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

function HeaderLabel({text}: {text: string}): React.JSX.Element {
  return (
    <Box padding={2}>
      <Text muted size={1} weight="medium">
        {text}
      </Text>
    </Box>
  )
}

function CartTableHeader(): React.JSX.Element {
  return (
    <Card borderBottom tone="transparent" style={headerGridStyle}>
      <HeaderLabel text="Status" />
      <HeaderLabel text="Type" />
      <HeaderLabel text="Document" />
      <HeaderLabel text="Added" />
      <Box />
    </Card>
  )
}

/**
 * Studio tool that lists the current cart items newest-first as a compact table. Shows a
 * friendly empty state when no items are tracked; otherwise renders a bordered, column-aligned
 * table with a Status/Type/Document/Added header and one CartItemRow per item.
 *
 * @public
 */
export function BatchPublishCartTool(_props: BatchPublishCartToolProps): React.JSX.Element {
  const {items, remove} = useCart()

  const sortedItems = [...items].sort(
    (itemA, itemB) => new Date(itemB.addedAt).getTime() - new Date(itemA.addedAt).getTime(),
  )

  if (sortedItems.length === 0) {
    return (
      <Flex align="center" justify="center" height="fill" padding={6}>
        <Stack space={3} style={{textAlign: 'center'}}>
          <Text size={2} muted>
            No documents in your batch yet.
          </Text>
          <Text size={1} muted>
            Documents you edit this session will appear here automatically.
          </Text>
        </Stack>
      </Flex>
    )
  }

  return (
    <Box padding={4} style={{height: '100%', overflow: 'auto'}}>
      <Card radius={2} border style={{maxWidth: '960px', margin: '0 auto'}}>
        <CartTableHeader />
        {sortedItems.map((item) => (
          <CartItemRow key={item.publishedId} item={item} onRemove={remove} />
        ))}
      </Card>
    </Box>
  )
}

export default BatchPublishCartTool
