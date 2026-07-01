import {Box, Card, Flex, Stack, Text} from '@sanity/ui'
import React from 'react'
import type {Tool} from 'sanity'

import {CartItemRow} from './CartItemRow'
import {useCart} from './useCart'

interface BatchPublishCartToolProps {
  tool: Tool
}

/**
 * Studio tool that lists the current cart items newest-first. Shows a friendly empty state
 * when no items are tracked; otherwise renders a scrollable list of CartItemRow entries.
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
    <Box paddingY={4} style={{maxWidth: '860px', margin: '0 auto'}}>
      <Card>
        {sortedItems.map((item) => (
          <CartItemRow key={item.publishedId} item={item} onRemove={remove} />
        ))}
      </Card>
    </Box>
  )
}

export default BatchPublishCartTool
