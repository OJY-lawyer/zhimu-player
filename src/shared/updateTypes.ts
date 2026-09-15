export type AppUpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type AppUpdateError = 'not-published' | 'network' | 'download' | 'integrity' | 'save' | 'install' | 'invalid-release'
export interface AppUpdateState {
  phase: AppUpdatePhase
  currentVersion: string
  version?: string
  percent?: number
  totalBytes?: number
  transferredBytes?: number
  error?: AppUpdateError
  unsupportedReason?: 'development' | 'portable' | 'not-installed'
  channel: 'stable' | 'preview'
  downloadMode?: 'differential' | 'full'
}

export interface AppUpdateAPI {
  getAppUpdateState(): Promise<AppUpdateState>
  checkAppUpdates(): Promise<AppUpdateState>
  downloadAppUpdate(): Promise<AppUpdateState>
  installAppUpdate(): Promise<AppUpdateState>
  onAppUpdateState(callback: (state: AppUpdateState) => void): () => void
}
