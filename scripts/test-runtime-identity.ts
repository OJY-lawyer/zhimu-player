import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureRuntimeIdentity, LEGACY_APP_ID } from '../src/main/runtimeIdentity'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'player-identity-'))
try {
  const legacy = path.join(root, 'video-player')
  fs.mkdirSync(path.join(legacy, 'Partitions', 'tingwu'), { recursive: true })
  const sentinel = Buffer.from('existing-settings-fixture')
  fs.writeFileSync(path.join(legacy, 'config.json'), sentinel)
  const state: Record<string, string> = { appData: root, userData: path.join(root, 'new-name'), sessionData: path.join(root, 'new-name') }
  const calls: string[] = []
  let appId = ''
  const host = {
    userAgentFallback: 'Mozilla/5.0 Chrome/152.0.0.0 知幕ZhimuPlayer/1.2.0 Electron/44.3.0',
    getPath: (name: string) => state[name],
    setPath: (name: string, value: string) => { calls.push(name); state[name] = value },
    setAppUserModelId: (value: string) => { appId = value },
  }
  assert.equal(configureRuntimeIdentity(host), legacy)
  assert.equal(host.userAgentFallback, 'Mozilla/5.0 Chrome/152.0.0.0 ZhimuPlayer/1.2.0 Electron/44.3.0')
  assert.equal(state.userData, legacy)
  assert.equal(state.sessionData, legacy)
  assert.deepEqual(calls, ['userData', 'sessionData'])
  assert.equal(appId, LEGACY_APP_ID)
  assert(fs.readFileSync(path.join(legacy, 'config.json')).equals(sentinel), 'existing settings are not rewritten or copied')
  assert(fs.existsSync(path.join(legacy, 'Partitions', 'tingwu')), 'the existing session root is reused')
  assert(!fs.existsSync(path.join(root, 'new-name')), 'a new display name must not create a second account root')
  const freshAppData = path.join(root, 'fresh')
  state.appData = freshAppData
  assert.equal(configureRuntimeIdentity(host), path.join(freshAppData, 'video-player'))
  assert(fs.existsSync(state.userData))
  const entry = fs.readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf8')
  assert(entry.indexOf('configureRuntimeIdentity(app)') < entry.indexOf('app.requestSingleInstanceLock()'), 'storage identity must be configured before acquiring the profile lock')
  console.log('runtime-identity: renamed and fresh installs reuse stable app identity; isolated fixtures only')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
