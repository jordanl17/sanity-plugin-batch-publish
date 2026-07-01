import {CloseIcon} from '@sanity/icons'
import {Badge, Box, Button, Card, Flex, Popover, Stack, Text, Tooltip} from '@sanity/ui'
import React, {useState} from 'react'
// Preview is @internal-tagged in sanity but is exported from the main entry and consumed
// by structure, vision, and other first-party plugins - it is stable in practice.
import {Preview, useSchema} from 'sanity'
import {useIntentLink} from 'sanity/router'

import {formatAddedAt} from './formatAddedAt'
import type {CartItem} from './types'

interface CartItemRowProps {
  item: CartItem
  onRemove: (publishedId: string) => void
}

/**
 * Compact one-line row for a single cart item. Renders a clickable Preview that navigates
 * to the document editor, alongside addedAt time, New/Updated and optional caution badges,
 * and an isolated confirm-to-remove control.
 *
 * @internal
 */
export function CartItemRow({item, onRemove}: CartItemRowProps): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const schema = useSchema()
  const schemaType = schema.get(item.documentType)

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
        {item.documentType}
      </Text>
    )

  const popoverContent = (
    <Stack padding={3} space={3}>
      <Text size={1}>
        Remove from batch? The draft is kept unchanged. You can re-add it by editing the document.
      </Text>
      <Flex gap={2}>
        <Button text="Remove" tone="critical" onClick={handleConfirmRemove} />
        <Button text="Cancel" mode="ghost" onClick={handleCancelRemove} />
      </Flex>
    </Stack>
  )

  return (
    <Card padding={3} borderBottom>
      <Stack space={2}>
        <Flex align="center" gap={3}>
          {/* Anchor wraps ONLY the Preview — badges, addedAt, and the remove button are siblings */}
          <Box
            flex={1}
            as="a"
            href={href}
            onClick={intentOnClick}
            style={{textDecoration: 'none', display: 'block'}}
          >
            {previewContent}
          </Box>

          <Text size={1} muted>
            {formatAddedAt(item.addedAt)}
          </Text>

          <Badge tone={item.isNew ? 'positive' : 'primary'}>{item.isNew ? 'New' : 'Updated'}</Badge>

          {item.changedUnderneath ? <Badge tone="caution">Changed</Badge> : null}

          <Popover open={confirmOpen} content={popoverContent} portal>
            <Tooltip content={<Text size={1}>Remove from batch</Text>} portal placement="top">
              <Button
                icon={CloseIcon}
                mode="ghost"
                onClick={handleRemoveButtonClick}
                aria-label="Remove from batch"
              />
            </Tooltip>
          </Popover>
        </Flex>

        {item.changedUnderneath ? (
          <Text size={1} muted>
            Someone edited this since you added it - review or remove.
          </Text>
        ) : null}
      </Stack>
    </Card>
  )
}
