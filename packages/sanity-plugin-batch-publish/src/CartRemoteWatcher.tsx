import React from 'react'
import type {LayoutProps} from 'sanity'

import type {BatchPublishPluginConfig} from './types'

export {clearCartStoreRegistry} from './CartDocumentObserver'

/**
 * Stub — implementation will be added in the GREEN commit.
 *
 * @public
 */
export function makeCartRemoteWatcher(_config?: BatchPublishPluginConfig) {
  function CartRemoteWatcherComponent(props: LayoutProps): React.JSX.Element {
    return props.renderDefault(props)
  }
  return CartRemoteWatcherComponent
}

/**
 * Zero-config convenience export.
 *
 * @public
 */
export const CartRemoteWatcher = makeCartRemoteWatcher()
