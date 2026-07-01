import {Box, Card, Flex, Stack, Text} from '@sanity/ui'
import React, {useEffect, useRef, useState} from 'react'
import type {Tool} from 'sanity'

import {CART_TABLE_GRID_TEMPLATE} from './cartTableColumns'
import {CartItemRow} from './CartItemRow'
import {useCart} from './useCart'

interface BatchPublishCartToolProps {
  tool: Tool
}

const tableCardStyle: React.CSSProperties = {
  maxWidth: '960px',
  width: '100%',
  margin: '0 auto',
}

const headerGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: CART_TABLE_GRID_TEMPLATE,
  alignItems: 'center',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current
    }
    current = current.parentElement
  }
  return null
}

/**
 * Tracks whether the tool's scroll container has been scrolled off the top. The sticky header
 * only earns its raised styling once the list actually overflows and the user scrolls - a
 * short list that fits the viewport never scrolls, so the header stays flat.
 */
function useScrolledPastTop(itemCount: number): {
  anchorRef: React.RefObject<HTMLDivElement | null>
  scrolled: boolean
} {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const scrollParent = findScrollParent(anchorRef.current)
    if (scrollParent === null) {
      return undefined
    }

    function handleScroll(): void {
      setScrolled(scrollParent!.scrollTop > 0)
    }

    handleScroll()
    scrollParent.addEventListener('scroll', handleScroll, {passive: true})
    return () => scrollParent.removeEventListener('scroll', handleScroll)
  }, [itemCount])

  return {anchorRef, scrolled}
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

function CartTableHeader({scrolled}: {scrolled: boolean}): React.JSX.Element {
  return (
    <Card borderBottom tone="default" shadow={scrolled ? 1 : 0} style={headerGridStyle}>
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
 * table with a sticky Status/Type/Document/Added header and one CartItemRow per item.
 *
 * @public
 */
export function BatchPublishCartTool(_props: BatchPublishCartToolProps): React.JSX.Element {
  const {items, remove} = useCart()

  const sortedItems = [...items].sort(
    (itemA, itemB) => new Date(itemB.addedAt).getTime() - new Date(itemA.addedAt).getTime(),
  )

  const {anchorRef, scrolled} = useScrolledPastTop(sortedItems.length)

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
    <Box padding={4}>
      <div ref={anchorRef} />
      <Card radius={2} border style={tableCardStyle}>
        <CartTableHeader scrolled={scrolled} />
        {sortedItems.map((item) => (
          <CartItemRow key={item.publishedId} item={item} onRemove={remove} />
        ))}
      </Card>
    </Box>
  )
}

export default BatchPublishCartTool
