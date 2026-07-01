import React from 'react'
import type {LayoutProps} from 'sanity'

import {makeCartBootRevalidator} from './CartBootRevalidator'
import {makeCartRemoteWatcher} from './CartRemoteWatcher'
import type {BatchPublishPluginConfig} from './types'

/**
 * Composes the boot-revalidation sweep and the remote-snapshot watcher into a single
 * `studio.components.layout` component. Only one component can occupy that slot, so this
 * factory wraps both into one render function that runs both behaviours on mount.
 *
 * The chain: `BootRevalidator` runs the boot-sweep side-effect and delegates its render
 * to `RemoteWatcher`, which runs the remote-watcher side-effect and then delegates to the
 * original `renderDefault` to produce the actual Studio content.
 *
 * @internal
 */
export function makeCartStudioLayout(config?: BatchPublishPluginConfig) {
  const BootRevalidator = makeCartBootRevalidator(config)
  const RemoteWatcher = makeCartRemoteWatcher(config)

  function CartStudioLayout(props: LayoutProps): React.JSX.Element {
    return (
      <BootRevalidator
        {...props}
        renderDefault={(bootProps) => (
          <RemoteWatcher {...bootProps} renderDefault={props.renderDefault} />
        )}
      />
    )
  }

  return CartStudioLayout
}
