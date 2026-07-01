import {CloseIcon} from '@sanity/icons'
import {Badge, Box, Button, Card, Flex, Popover, Stack, Text, Tooltip} from '@sanity/ui'
import React, {useState} from 'react'
// Preview is @internal-tagged in sanity but is exported from the main entry and consumed
// by structure, vision, and other first-party plugins - it is stable in practice.
import {Preview, useSchema} from 'sanity'
import {useIntentLink} from 'sanity/router'

import {CART_TABLE_GRID_TEMPLATE} from './cartTableColumns'
import {formatAddedAt} from './formatAddedAt'
import type {CartItem} from './types'

interface CartItemRowProps {
  item: CartItem
  onRemove: (publishedId: string) => void
}

const truncateStyle: React.CSSProperties = {
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const rowGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: CART_TABLE_GRID_TEMPLATE,
  alignItems: 'center',
}

/**
 * One table row for a single cart item, laid out across the shared column template:
 * a Status badge (New/Updated, plus a caution "Changed" badge when the item was changed
 * underneath), the document type, a clickable Preview that navigates to the editor, the
 * relative time it was added, and an isolated confirm-to-remove control.
 *
 * @internal
 */
export function CartItemRow({item, onRemove}: CartItemRowProps): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const schema = useSchema()
  const schemaType = schema.get(item.documentType)
  const typeTitle = schemaType?.title ?? item.documentType

  const {onClick: intentOnClick, href} = useIntentLink({
    intent: 'edit',
    params: {id: item.publishedId, type: item.documentType},
  })

  function handleRemoveButtonClick(event: React.MouseEvent): void {
    // Isolate the remove button click from the anchor so navigation never fires on removal.
    event.stopPropagation()
    setConfirmOpen(true)
  }

  function handleConfirmRemove(event: React.MouseEvent): void {
    event.stopPropagation()
    onRemove(item.publishedId)
    setConfirmOpen(false)
  }

  function handleCancelRemove(event: React.MouseEvent): void {
    event.stopPropagation()
    setConfirmOpen(false)
  }

  const previewContent =
    schemaType !== undefined ? (
      <Preview value={{_id: item.draftId}} schemaType={schemaType} layout="default" />
    ) : (
      <Text size={1} muted>
        <span style={truncateStyle}>{item.documentType}</span>
      </Text>
    )

  const popoverContent = (
    <Stack padding={3} space={3} style={{maxWidth: 260}}>
      <Text size={1}>
        Remove from batch? The draft is kept unchanged. You can re-add it by editing the document.
      </Text>
      <Flex gap={2}>
        <Button text="Remove" tone="critical" onClick={handleConfirmRemove} />
        <Button text="Cancel" mode="ghost" onClick={handleCancelRemove} />
      </Flex>
    </Stack>
  )

  const changedBadge = item.changedUnderneath ? (
    <Tooltip
      content={<Text size={1}>Someone edited this since you added it - review or remove.</Text>}
      portal
      placement="top"
    >
      <Badge radius={2} tone="caution">
        Changed
      </Badge>
    </Tooltip>
  ) : null

  return (
    <Card borderBottom>
      <Box style={rowGridStyle}>
        <Flex align="center" gap={2} paddingX={2} paddingY={3} wrap="wrap">
          <Badge radius={2} tone={item.isNew ? 'positive' : 'primary'}>
            {item.isNew ? 'New' : 'Updated'}
          </Badge>
          {changedBadge}
        </Flex>

        <Box paddingX={2} style={{minWidth: 0}}>
          <Text size={1} muted>
            <span style={truncateStyle}>{typeTitle}</span>
          </Text>
        </Box>

        {/* Anchor wraps ONLY the Preview cell — every other cell is a grid sibling */}
        <Box
          as="a"
          href={href}
          onClick={intentOnClick}
          padding={1}
          paddingRight={2}
          style={{textDecoration: 'none', color: 'inherit', display: 'block', minWidth: 0}}
        >
          {previewContent}
        </Box>

        <Box paddingX={2}>
          <Text size={1} muted>
            <span style={truncateStyle}>{formatAddedAt(item.addedAt)}</span>
          </Text>
        </Box>

        <Flex align="center" justify="center" paddingRight={2}>
          <Popover open={confirmOpen} content={popoverContent} portal placement="bottom-end">
            <Tooltip content={<Text size={1}>Remove from batch</Text>} portal placement="top">
              <Button
                icon={CloseIcon}
                mode="bleed"
                onClick={handleRemoveButtonClick}
                aria-label="Remove from batch"
              />
            </Tooltip>
          </Popover>
        </Flex>
      </Box>
    </Card>
  )
}
