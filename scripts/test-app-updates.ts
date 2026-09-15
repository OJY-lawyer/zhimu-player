import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createServer, request } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { HttpExecutor, CancellationToken } from 'builder-util-runtime'
import { GenericDifferentialDownloader } from 'electron-updater/out/differentialDownloader/GenericDifferentialDownloader'
import { AppUpdater } from 'electron-updater'
import { AppUpdateController, UPDATE_REPOSITORY } from '../src/main/appUpdates'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowDowngrade = true
  allowPrerelease = false
  disableDifferentialDownload = true
  disableWebInstaller = false
  installDirectory = ''
  logger: any
  checks = 0
  downloads = 0
  installs: boolean[][] = []
  checkImpl = async () => {
    this.emit('update-available', { version: '1.2.0-rc.4', releaseNotes: '<script>private untrusted notes</script>' })
    return { updateInfo: { version: '1.2.0-rc.4' } }
  }
  downloadImpl = async () => {
    this.emit('download-progress', { percent: 55.5, total: 100, transferred: 55 })
    this.emit('update-downloaded', { version: '1.2.0-rc.4', downloadedFile: 'C:\\private\\installer.exe' })
    return ['C:\\private\\installer.exe']
  }
  async checkForUpdates() { this.checks++; return this.checkImpl() }
  async downloadUpdate() { this.downloads++; return this.downloadImpl() }
  quitAndInstall(silent: boolean, restart: boolean) { this.installs.push([silent, restart]) }
}

function fixture(options: { unsupportedReason?: 'portable' | 'development'; version?: string } = {}) {
  const updater = new FakeUpdater()
  let closeRequests = 0
  let closed = false
  let closeAllowed = true
  const events: unknown[] = []
  const controller = new AppUpdateController(updater as any, {
    version: options.version || '1.2.0-rc.3', unsupportedReason: options.unsupportedReason,
    installDirectory: 'D:\\My chosen folder\\Zhimu', publish: state => events.push(state),
    requestClose: () => { closeRequests++; return closeAllowed },
    allWindowsClosed: () => closed,
    installFailed: () => {},
  })
  return { updater, controller, events, closeRequests: () => closeRequests,
    setClosed: (value: boolean) => { closed = value }, setCloseAllowed: (value: boolean) => { closeAllowed = value } }
}

async function verifyDifferentialTransport() {
  // Tiny synthetic files exercise electron-updater's real range/copy/checksum
  // implementation. The only HTTP listener is loopback; no release is published.
  class LocalExecutor extends HttpExecutor<any> {
    createRequest(options: any, callback: any) {
      assert.equal(options.hostname, '127.0.0.1')
      return request(options, callback)
    }
  }
  const oldBytes = Buffer.from('AAAABBBBCCCC')
  const newBytes = Buffer.from('AAAAXXXXCCCC')
  const makeMap = (buffer: Buffer) => ({ version: '2', files: [{ name: 'file', offset: 0, sizes: [4, 4, 4],
    checksums: [0, 4, 8].map(start => createHash('sha256').update(buffer.subarray(start, start + 4)).digest('base64')) }] })
  const ranges: string[] = []
  let bytesSent = 0
  const server = createServer((incoming, response) => {
    const range = incoming.headers.range || ''
    ranges.push(range)
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (!match) { response.writeHead(400).end(); return }
    const start = Number(match[1]); const end = Number(match[2])
    const bytes = newBytes.subarray(start, end + 1)
    bytesSent += bytes.length
    response.writeHead(206, { 'Content-Length': bytes.length, 'Content-Range': `bytes ${start}-${end}/${newBytes.length}`, 'Accept-Ranges': 'bytes' })
    response.end(bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  // The test runner already owns and removes this exact per-run directory.
  const scratchParent = path.dirname(process.argv[1])
  assert.match(path.basename(scratchParent), /^test-run-/)
  const scratch = await mkdtemp(path.join(scratchParent, 'differential-'))
  await mkdir(scratch, { recursive: true })
  const oldFile = path.join(scratch, 'old.bin'); const newFile = path.join(scratch, 'new.bin')
  await writeFile(oldFile, oldBytes)
  const logger = { info() {}, warn() {}, debug() {}, error() {} }
  try {
    const downloader = new GenericDifferentialDownloader({ size: newBytes.length, sha512: createHash('sha512').update(newBytes).digest('base64') }, new LocalExecutor(), {
      oldFile, newFile, newUrl: new URL(`http://127.0.0.1:${address.port}/new.bin`), logger,
      requestHeaders: null, isUseMultipleRangeRequest: false, cancellationToken: new CancellationToken(),
    })
    await downloader.download(makeMap(oldBytes), makeMap(newBytes))
    assert.deepEqual(await readFile(newFile), newBytes)
    assert.deepEqual(ranges, ['bytes=4-7'])
    assert.equal(bytesSent, 4, 'only changed bytes transferred; unchanged bytes copied from cached old file')
    const badDigest = new GenericDifferentialDownloader({ size: newBytes.length, sha512: createHash('sha512').update('wrong').digest('base64') }, new LocalExecutor(), {
      oldFile, newFile: path.join(scratch, 'invalid.bin'), newUrl: new URL(`http://127.0.0.1:${address.port}/new.bin`), logger,
      requestHeaders: null, isUseMultipleRangeRequest: false, cancellationToken: new CancellationToken(),
    })
    await assert.rejects(badDigest.download(makeMap(oldBytes), makeMap(newBytes)), /checksum mismatch/i)
    let fallbackLogged = false
    const fallback = await (AppUpdater.prototype as any).differentialDownloadInstaller.call({
      _testOnlyOptions: null,
      _logger: { error: (message: string) => { fallbackLogged = message.includes('fallback to full download') } },
    }, { url: new URL('http://127.0.0.1/fixture.exe') }, { updateInfoAndProvider: {
      provider: { getBlockMapFiles: async () => { throw new Error('fixture: old release blockmap missing') } }, info: { version: '2.0.0' },
    } }, 'unused', null, 'unused')
    assert.equal(fallback, true, 'real updater requests full download when differential metadata is unavailable')
    assert.equal(fallbackLogged, true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function main() {
  const f = fixture()
  assert.equal(f.updater.checks, 0, 'opening About does not contact GitHub automatically')
  assert.equal(f.updater.autoDownload, false)
  assert.equal(f.updater.autoInstallOnAppQuit, false)
  assert.equal(f.updater.allowDowngrade, false)
  assert.equal(f.updater.allowPrerelease, true)
  assert.equal(f.updater.disableDifferentialDownload, false)
  assert.equal(f.updater.disableWebInstaller, true)
  assert.equal(f.updater.installDirectory, 'D:\\My chosen folder\\Zhimu')
  assert.equal(fixture({ version: '1.2.0' }).updater.allowPrerelease, false)
  assert.equal((await f.controller.check()).phase, 'available')
  assert.equal(f.updater.downloads, 0, 'checking must not start a download')
  assert.equal((await f.controller.download()).phase, 'downloaded')
  assert.equal(f.updater.installs.length, 0, 'download alone must not install')
  assert.equal(JSON.stringify(f.events).includes('private'), false, 'do not expose remote notes or downloaded paths')
  assert.equal(f.controller.installAfterAllWindowsClosed(), false)
  f.controller.requestInstall()
  assert.equal(f.closeRequests(), 1)
  assert.equal(f.updater.autoInstallOnAppQuit, false)
  f.setClosed(true)
  assert.equal(f.controller.installAfterAllWindowsClosed(), false, 'all windows closed is insufficient without successful save handshake')
  f.controller.armInstallOnQuit()
  f.setClosed(false)
  assert.equal(f.controller.installAfterAllWindowsClosed(), false, 'successful save cannot install while another window remains')
  f.setClosed(true)
  assert.equal(f.controller.installAfterAllWindowsClosed(), true)
  assert.deepEqual(f.updater.installs, [[true, true]], 'silent in-place install and restart')
  assert.equal(f.controller.installAfterAllWindowsClosed(), false, 'single install per explicit request')

  const cancelled = fixture()
  await cancelled.controller.check(); await cancelled.controller.download()
  cancelled.controller.requestInstall(); cancelled.controller.armInstallOnQuit()
  cancelled.controller.cancelPendingInstall(); cancelled.setClosed(true)
  assert.equal(cancelled.controller.installAfterAllWindowsClosed(), false)
  assert.equal(cancelled.controller.getState().phase, 'downloaded')
  assert.equal(cancelled.controller.getState().error, 'save')
  assert.equal(cancelled.updater.autoInstallOnAppQuit, false)
  cancelled.setCloseAllowed(false)
  cancelled.controller.requestInstall()
  assert.equal(cancelled.controller.getState().phase, 'downloaded', 'refused close retains update')

  for (const unsupportedReason of ['portable', 'development'] as const) {
    const unsupported = fixture({ unsupportedReason })
    await unsupported.controller.check(); await unsupported.controller.download(); unsupported.controller.requestInstall()
    assert.equal(unsupported.updater.checks, 0)
    assert.equal(unsupported.updater.downloads, 0)
    assert.equal(unsupported.closeRequests(), 0)
  }

  const absent = fixture()
  absent.updater.checkImpl = async () => { throw Object.assign(new Error('404 Authorization: secret'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }) }
  assert.equal((await absent.controller.check()).error, 'not-published')
  assert.equal(JSON.stringify(absent.events).includes('secret'), false)

  const fallback = fixture()
  await fallback.controller.check()
  fallback.updater.downloadImpl = async () => {
    fallback.updater.logger.error('Cannot download differentially, fallback to full download: private paths')
    fallback.updater.emit('download-progress', { percent: 120, total: -1, transferred: NaN })
    assert.equal(fallback.controller.getState().percent, 100)
    assert.equal(fallback.controller.getState().totalBytes, undefined)
    fallback.updater.emit('update-downloaded', { version: '1.2.0-rc.4' })
    return []
  }
  assert.equal((await fallback.controller.download()).downloadMode, 'full')

  const badHash = fixture()
  await badHash.controller.check()
  badHash.updater.downloadImpl = async () => { throw Object.assign(new Error('private path'), { code: 'ERR_CHECKSUM_MISMATCH' }) }
  assert.equal((await badHash.controller.download()).error, 'integrity')
  badHash.controller.requestInstall(); badHash.controller.armInstallOnQuit(); badHash.setClosed(true)
  assert.equal(badHash.controller.installAfterAllWindowsClosed(), false)

  const malformed = fixture()
  malformed.updater.checkImpl = async () => {
    malformed.updater.emit('update-available', { version: '../../untrusted' })
    return { updateInfo: { version: '../../untrusted' } }
  }
  assert.equal((await malformed.controller.check()).error, 'invalid-release')
  await malformed.controller.download()
  assert.equal(malformed.updater.downloads, 0)

  const raced = fixture({ version: '1.2.0' })
  let finish!: () => void
  raced.updater.checkImpl = async () => {
    await new Promise<void>(resolve => { finish = resolve })
    raced.updater.emit('update-not-available', { version: '1.2.0-rc.3' })
    return { updateInfo: { version: '1.2.0-rc.3' } }
  }
  const checking = raced.controller.check()
  await raced.controller.check(); await raced.controller.download()
  assert.equal(raced.updater.checks, 1)
  assert.equal(raced.updater.downloads, 0)
  finish(); assert.equal((await checking).phase, 'current')

  const preview = fixture()
  const previewAttempts: boolean[] = []
  preview.updater.checkImpl = async () => {
    previewAttempts.push(preview.updater.allowPrerelease)
    if (!preview.updater.allowPrerelease) throw Object.assign(new Error('first release'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' })
    preview.updater.emit('update-available', { version: '1.2.0-rc.4' })
    return { updateInfo: { version: '1.2.0-rc.4' } }
  }
  assert.equal((await preview.controller.check()).version, '1.2.0-rc.4')
  assert.deepEqual(previewAttempts, [false, true])
  const promoted = fixture()
  promoted.updater.checkImpl = async () => {
    assert.equal(promoted.updater.allowPrerelease, false)
    promoted.updater.emit('update-available', { version: '1.2.0' })
    return { updateInfo: { version: '1.2.0' } }
  }
  assert.equal((await promoted.controller.check()).version, '1.2.0')
  assert.equal(promoted.updater.checks, 1, 'release candidates promote to stable when it is newer')

  const root = process.cwd()
  const build = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.deepEqual(build.publish, UPDATE_REPOSITORY)
  assert.equal(build.appId, 'com.videoplayer.app')
  assert.equal(build.nsis.deleteAppDataOnUninstall, false)
  assert.equal(build.nsis.differentialPackage, true)
  assert.ok(pkg.scripts.build.includes('--publish never'))
  assert.ok(pkg.dependencies['electron-updater'])
  await verifyDifferentialTransport()
  console.log('App updates: manual check/download, differential fallback, integrity errors, preview channel, data-preserving save/close gate passed (offline fixtures).')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
