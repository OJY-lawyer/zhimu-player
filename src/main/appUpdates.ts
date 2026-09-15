import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { NsisUpdater } from 'electron-updater'
import type { AppUpdateState, AppUpdateError } from '../shared/updateTypes'

// No account credentials, media, or renderer-provided URLs enter this service.
export const UPDATE_REPOSITORY = { provider: 'github' as const, owner: 'OJY-lawyer', repo: 'zhimu-player' }

type UpdaterPort = Pick<NsisUpdater, 'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' | 'disableDifferentialDownload' | 'disableWebInstaller' | 'installDirectory' | 'logger' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'on'>
type Environment = {
  version: string
  unsupportedReason?: AppUpdateState['unsupportedReason']
  installDirectory: string
  requestClose(): boolean
  allWindowsClosed(): boolean
  installFailed(): void
  publish(state: AppUpdateState): void
}

function releaseVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.length < 100 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) ? value : undefined
}
function errorCode(error: unknown, downloading: boolean): AppUpdateError {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  if (/CHECKSUM|SIGNATURE|SHA|DIGEST/.test(code)) return 'integrity'
  if (/LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED_VERSIONS/.test(code) || /\b404\b/.test(message)) return 'not-published'
  return downloading ? 'download' : 'network'
}

/** State and lifecycle are separate so update installation cannot bypass draft saving. */
export class AppUpdateController {
  private state: AppUpdateState
  private operation: 'check' | 'download' | null = null
  private installRequested = false
  private saveConfirmed = false
  private installStarted = false

  constructor(private updater: UpdaterPort, private environment: Environment) {
    this.state = { phase: environment.unsupportedReason ? 'unsupported' : 'idle',
      currentVersion: environment.version, channel: environment.version.includes('-') ? 'preview' : 'stable',
      ...(environment.unsupportedReason ? { unsupportedReason: environment.unsupportedReason } : {}) }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.allowPrerelease = this.state.channel === 'preview'
    updater.disableDifferentialDownload = false
    updater.disableWebInstaller = true
    updater.installDirectory = environment.installDirectory
    // Keep raw server responses and local cache paths out of product diagnostics.
    updater.logger = {
      info: () => {}, debug: () => {}, warn: () => {},
      error: (message: unknown) => {
        if (this.operation === 'download' && typeof message === 'string' && message.includes('fallback to full download')) {
          this.set({ downloadMode: 'full' })
        }
      },
    }
    updater.on('update-available', info => {
      if (this.operation !== 'check') return
      const version = releaseVersion(info.version)
      if (!version) { this.set({ phase: 'error', error: 'invalid-release' }); return }
      this.set({ phase: 'available', version, error: undefined })
    })
    updater.on('download-progress', progress => {
      if (this.operation !== 'download') return
      this.set({ phase: 'downloading', percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0,
        totalBytes: Number.isSafeInteger(progress.total) && progress.total >= 0 ? progress.total : undefined,
        transferredBytes: Number.isSafeInteger(progress.transferred) && progress.transferred >= 0 ? progress.transferred : undefined })
    })
    updater.on('update-downloaded', info => {
      if (this.operation !== 'download') return
      if (releaseVersion(info.version) !== this.state.version) { this.set({ phase: 'error', error: 'invalid-release' }); return }
      this.set({ phase: 'downloaded', percent: 100, error: undefined })
    })
    updater.on('error', error => {
      // checkForUpdates emits and rejects with the same error. Handle it in
      // check(), which can try the preview channel after a missing stable one.
      if (this.operation === 'check') return
      const installing = this.installStarted
      this.installRequested = false
      this.saveConfirmed = false
      this.set({ phase: 'error', error: installing ? 'install' : errorCode(error, this.operation === 'download') })
      if (installing) environment.installFailed()
    })
  }

  getState(): AppUpdateState { return { ...this.state } }
  private set(patch: Partial<AppUpdateState>) { this.state = { ...this.state, ...patch }; this.environment.publish(this.getState()) }

  async check(): Promise<AppUpdateState> {
    if (this.state.phase === 'unsupported' || this.operation || this.state.phase === 'downloaded' || this.state.phase === 'installing') return this.getState()
    this.operation = 'check'
    this.set({ phase: 'checking', version: undefined, error: undefined, percent: undefined, totalBytes: undefined, transferredBytes: undefined, downloadMode: undefined })
    try {
      // electron-updater 6's custom rc channel does not promote to stable by
      // itself. Prefer a newer stable release, then check the current preview
      // channel if there is no stable upgrade (including the first release).
      const channels = this.state.channel === 'preview' ? [false, true] : [false]
      let completedCheck = false
      let failure: unknown
      for (const prerelease of channels) {
        this.updater.allowPrerelease = prerelease
        try {
          const result = await this.updater.checkForUpdates()
          completedCheck = result != null
          failure = undefined
          if (this.getState().phase === 'available' || this.state.error === 'invalid-release') break
        } catch (error) { completedCheck = false; failure = error }
      }
      if (this.getState().phase !== 'available' && this.state.error !== 'invalid-release') {
        this.set(completedCheck ? { phase: 'current', error: undefined } : { phase: 'error', error: failure ? errorCode(failure, false) : 'not-published' })
      }
    } catch (error) { this.set({ phase: 'error', error: errorCode(error, false) }) }
    finally { this.operation = null; this.updater.allowPrerelease = this.state.channel === 'preview' }
    return this.getState()
  }

  async download(): Promise<AppUpdateState> {
    if (this.operation || this.state.phase !== 'available') return this.getState()
    this.operation = 'download'
    this.set({ phase: 'downloading', percent: 0, error: undefined, downloadMode: 'differential' })
    try {
      await this.updater.downloadUpdate()
      if (this.getState().phase === 'downloading') this.set({ phase: 'error', error: 'download' })
    } catch (error) { this.set({ phase: 'error', error: errorCode(error, true) }) }
    finally { this.operation = null }
    return this.getState()
  }

  requestInstall(): AppUpdateState {
    if (this.state.phase !== 'downloaded' || this.operation) return this.getState()
    this.installRequested = true
    this.saveConfirmed = false
    this.set({ phase: 'installing', error: undefined })
    try { if (!this.environment.requestClose()) this.cancelPendingInstall() }
    catch { this.cancelPendingInstall() }
    return this.getState()
  }

  // Called by main only after complete-close has successfully flushed all writes.
  // autoInstallOnAppQuit intentionally remains false: v6 only registers its quit
  // listener during download, and that listener also does not restart the app.
  armInstallOnQuit(): void { if (this.installRequested) this.saveConfirmed = true }

  cancelPendingInstall(): void {
    this.installRequested = false
    this.saveConfirmed = false
    if (this.state.phase === 'installing' && !this.installStarted) this.set({ phase: 'downloaded', error: 'save' })
  }

  installAfterAllWindowsClosed(): boolean {
    if (!this.installRequested || !this.saveConfirmed || this.installStarted || !this.environment.allWindowsClosed()) return false
    this.installStarted = true
    this.installRequested = false
    this.saveConfirmed = false
    // The installer is launched only after the normal save-and-close lifecycle.
    // NSIS's --updated /D=... preserves the chosen directory and user data.
    try { this.updater.quitAndInstall(true, true); return true }
    catch { this.set({ phase: 'error', error: 'install' }); return false }
  }
}

export function registerAppUpdates(getWindow: () => BrowserWindow | null): AppUpdateController {
  // Instantiate here, after configureRuntimeIdentity(), never at module load.
  const installDirectory = path.dirname(app.getPath('exe'))
  const unsupportedReason = !app.isPackaged || process.platform !== 'win32' ? 'development' as const
    : process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' as const
      : !existsSync(path.join(installDirectory, 'Uninstall Zhimu Player.exe')) ? 'not-installed' as const : undefined
  const updater = new NsisUpdater(UPDATE_REPOSITORY)
  const controller = new AppUpdateController(updater, {
    version: app.getVersion(), installDirectory, unsupportedReason,
    publish: state => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('app-update-state', state) },
    requestClose: () => { const window = getWindow(); if (!window || window.isDestroyed()) return false; window.close(); return true },
    allWindowsClosed: () => BrowserWindow.getAllWindows().length === 0,
    installFailed: () => { if (BrowserWindow.getAllWindows().length === 0) app.quit() },
  })
  // OS session shutdown must never initiate an update installation.
  app.on('browser-window-created', (_event, window) => { window.on('session-end', () => controller.cancelPendingInstall()) })
  ipcMain.handle('app-update-get-state', () => controller.getState())
  ipcMain.handle('app-update-check', () => controller.check())
  ipcMain.handle('app-update-download', () => controller.download())
  ipcMain.handle('app-update-install', () => controller.requestInstall())
  return controller
}
