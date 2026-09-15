import { app, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import type { PlayerState } from '../shared/contracts'

function getPlayerStatePath(): string {
  return path.join(app.getPath('userData'), 'player-state.json')
}

let pendingWrite: Promise<void> = Promise.resolve()

export async function loadPlayerState(): Promise<PlayerState | null> {
  try {
    const content = await fs.readFile(getPlayerStatePath(), 'utf-8')
    return JSON.parse(content) as PlayerState
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

export async function savePlayerState(state: PlayerState): Promise<void> {
  const content = JSON.stringify(state, null, 2)
  pendingWrite = pendingWrite.catch(() => undefined).then(async () => {
    const statePath = getPlayerStatePath()
    const temporaryPath = statePath + '.' + process.pid + '.tmp'
    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true })
      await fs.writeFile(temporaryPath, content, 'utf-8')
      await fs.rename(temporaryPath, statePath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  })
  await pendingWrite
}

export async function flushPendingPlayerStateWrites(): Promise<void> {
  let pending: Promise<void>
  do {
    pending = pendingWrite
    await pending
  } while (pending !== pendingWrite)
}

export function registerPlayerStateIpc(): void {
  ipcMain.handle('load-player-state', loadPlayerState)
  ipcMain.handle('save-player-state', (_event, state: PlayerState) => savePlayerState(state))
}
