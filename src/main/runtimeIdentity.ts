import fs from 'node:fs'
import path from 'node:path'
import type { App } from 'electron'

// These identifiers outlive display names so upgrades keep the same accounts and state.
export const LEGACY_APP_ID = 'com.videoplayer.app'
export const LEGACY_DATA_DIRECTORY = 'video-player'

export function configureRuntimeIdentity(host: Pick<App, 'getPath' | 'setPath' | 'setAppUserModelId' | 'userAgentFallback'>): string {
  // Native window.open uses this fallback for its first navigation before a
  // per-window override can take effect. Display names remain unchanged.
  host.userAgentFallback = host.userAgentFallback.replace(/[^\x20-\x7e]/g, '')
  const directory = path.join(host.getPath('appData'), LEGACY_DATA_DIRECTORY)
  fs.mkdirSync(directory, { recursive: true })
  host.setPath('userData', directory)
  host.setPath('sessionData', directory)
  host.setAppUserModelId(LEGACY_APP_ID)
  return directory
}
