// Run with Node 22.18+; all application I/O is replaced with local fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = process.cwd()

function loadSource(relativePath: string, overrides: Record<string, unknown>, localRequire = require) {
  const filename = path.join(root, relativePath)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: localRequire, process, console, ...overrides }, { filename })
  return exports as any
}

function createHookRuntime() {
  const states: any[] = []
  const refs: any[] = []
  let stateCursor = 0
  let refCursor = 0
  return {
    reset() { stateCursor = 0; refCursor = 0 },
    react: {
      useState(initial: any) {
        const index = stateCursor++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], (value: any) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value
        }]
      },
      useRef(initial: any) {
        const index = refCursor++
        if (!(index in refs)) refs[index] = { current: initial }
        return refs[index]
      },
      useCallback(callback: any) { return callback },
      useMemo(factory: any) { return factory() },
      useEffect() {},
    },
  }
}

function deferred() {
  let resolve!: (value?: any) => void
  const promise = new Promise<any>((done) => { resolve = done })
  return { promise, resolve }
}

function playlist(id: string) {
  return { id, displayName: id, items: [{ path: 'D:/' + id + '/' + id + '.mp4', name: id + '.mp4', stem: id }] }
}

function guideHarness() {
  const runtime = createHookRuntime()
  const files = new Map([
    ['D:/A/A.导读.20260101-000000.md', 'A original'],
    ['D:/A/A.导读.20260102-000000.md', 'A second'],
    ['D:/B/B.导读.20260101-000000.md', 'B original'],
  ])
  const api: any = {
    readDir: async (directory: string) => [...files.keys()]
      .filter((file) => path.posix.dirname(file) === directory).map((file) => path.posix.basename(file)),
    readFile: async (file: string) => files.get(file) || '',
    writeFile: async (file: string, content: string) => { files.set(file, content); return true },
  }
  const source = loadSource('src/renderer/hooks/useGuideLibrary.ts', {
    window: { electronAPI: api, setTimeout, clearTimeout },
  }, (name: string) => name === 'react' ? runtime.react
    : name.endsWith('guideManifest') ? loadSource('src/shared/guideManifest.ts', {}) : require(name))
  return {
    files, api,
    render(id: string, preferred?: string) {
      runtime.reset()
      return source.useGuideLibrary(playlist(id), preferred)
    },
  }
}

async function testSaveFailurePreservesDraft() {
  const harness = guideHarness()
  await harness.render('A').refresh('D:/A/A.导读.20260101-000000.md')
  harness.render('A').updateContent('A unsaved edit')
  harness.api.writeFile = async () => false
  await harness.render('A').selectVersion('D:/A/A.导读.20260102-000000.md')
  assert.equal(harness.render('A').content, 'A unsaved edit')
  assert.equal(harness.render('A').activeVersion.path, 'D:/A/A.导读.20260101-000000.md')
  await harness.render('B').refresh(undefined, true)
  assert.equal(harness.render('B').content, 'B original')
  await harness.render('A').refresh('D:/A/A.导读.20260101-000000.md', true)
  assert.equal(harness.render('A').content, 'A unsaved edit')
  harness.api.writeFile = async (file: string, content: string) => { harness.files.set(file, content); return true }
  assert.equal(await harness.render('A').flushDirty(), true)
  assert.equal(harness.files.get('D:/A/A.导读.20260101-000000.md'), 'A unsaved edit')
}

async function testStaleReadsCannotReplaceNewPlaylist() {
  const harness = guideHarness()
  const started = deferred()
  const released = deferred()
  const normalRead = harness.api.readFile
  harness.api.readFile = async (file: string) => {
    if (file.startsWith('D:/A/')) { started.resolve(); await released.promise }
    return normalRead(file)
  }
  const oldRead = harness.render('A').refresh()
  await started.promise
  await harness.render('B').refresh()
  released.resolve()
  await oldRead
  const current = harness.render('B')
  assert.equal(current.ownerPlaylistId, 'B')
  assert.equal(current.content, 'B original')
  assert.ok(current.activeVersion.path.startsWith('D:/B/'))
}

async function testGeneratedVersionKeepsOriginalDestination() {
  const harness = guideHarness()
  await harness.render('A').refresh()
  const started = deferred()
  const released = deferred()
  harness.api.writeFile = async (file: string, content: string) => {
    started.resolve()
    await released.promise
    harness.files.set(file, content)
    return true
  }
  const generation = harness.render('A').createVersion('A generated guide')
  await started.promise
  await harness.render('B').refresh()
  released.resolve()
  const savedPath = await generation
  assert.ok(savedPath.startsWith('D:/A/'))
  const manifest = loadSource('src/shared/guideManifest.ts', {})
  assert.equal(manifest.parseGuideDocument(harness.files.get(savedPath)).body, 'A generated guide')
  assert.equal(manifest.parseGuideDocument(harness.files.get(savedPath)).manifest.parts[0], 'A.mp4')
  assert.equal(harness.render('B').content, 'B original')
}

async function testNewestEditSurvivesAnOlderSaveCompletion() {
  const harness = guideHarness()
  await harness.render('A').refresh()
  harness.render('A').updateContent('first edit')
  const started = deferred()
  const released = deferred()
  harness.api.writeFile = async (file: string, content: string) => {
    started.resolve()
    await released.promise
    harness.files.set(file, content)
    return true
  }
  const olderSave = harness.render('A').flushDirty()
  await started.promise
  harness.render('A').updateContent('newer edit')
  released.resolve()
  assert.equal(await olderSave, false)
  assert.equal(await harness.render('A').flushDirty(), true)
  const current = harness.render('A')
  assert.equal(harness.files.get(current.activeVersion.path), 'newer edit')
}

async function testManifestSurvivesPlainTextEditing() {
  const harness = guideHarness()
  const savedPath = await harness.render('A').createVersion('### First topic [P1-00:00:01]\nOriginal')
  harness.render('A').updateContent('### Edited topic [P1-00:00:01]\nEdited')
  assert.equal(await harness.render('A').flushDirty(), true)
  const manifest = loadSource('src/shared/guideManifest.ts', {})
  const document = manifest.parseGuideDocument(harness.files.get(savedPath))
  assert.equal(document.manifest.parts[0], 'A.mp4')
  assert.equal(document.body, '### Edited topic [P1-00:00:01]\nEdited')
}

async function testSubtitleRevisionIsSortedWithoutOverwritingSource() {
  const runtime = createHookRuntime()
  const written: any[] = []
  const media = { path: 'D:/fixture/P1.mp4', name: 'P1.mp4', stem: 'P1', url: 'fixture', extension: 'mp4' }
  const api = {
    selectVideoFolder: async () => ({ folderPath: 'D:/fixture', folderName: 'fixture', files: [media] }),
    readDir: async () => [],
    savePlayerState: async () => {},
    writeFile: async (file: string, content: string) => { written.push({ file, content }); return true },
  }
  const parsers = loadSource('src/renderer/utils/srtParser.ts', {})
  const source = loadSource('src/renderer/hooks/usePlayerSession.ts', {
    window: { electronAPI: api, clearTimeout },
  }, (name: string) => name === 'react' ? runtime.react : name.endsWith('srtParser') ? parsers : require(name))
  const hook = source.usePlayerSession()
  await hook.openFolder()
  const cues = [
    { index: 1, startTime: 10, endTime: 11, text: 'first' },
    { index: 2, startTime: 20, endTime: 21, text: 'second' },
    { index: 3, startTime: 0, endTime: 2, text: 'moved earlier' },
  ]
  assert.equal(await hook.saveSubtitleRevision(cues), true)
  const parsed = parsers.parseSRT(written[0].content)
  assert.equal(parsers.findSubtitleIndex(parsed, 1), 0)
  assert.equal(parsed[0].text, 'moved earlier')
  assert.equal(parsed[0].index, 1)
  assert.equal(cues[0].startTime, 10)
  assert.notEqual(written[0].file, 'D:/fixture/P1.srt')
  runtime.reset()
  assert.equal(source.usePlayerSession().playlist.items[0].subtitles[0].text, 'moved earlier')
  assert.equal(await hook.saveSubtitleRevision([{ index: 1, startTime: -1, endTime: 2, text: 'invalid' }]), false)
  assert.equal(written.length, 1)
}

async function testProgressFlushBeforeReactRerender() {
  const runtime = createHookRuntime()
  const saved: any[] = []
  const media = { path: 'D:/fixture/P1.mp4', name: 'P1.mp4', stem: 'P1', url: 'fixture', extension: 'mp4' }
  const api = {
    selectVideoFolder: async () => ({ folderPath: 'D:/fixture', folderName: 'fixture', files: [media] }),
    readDir: async () => [],
    savePlayerState: async (state: any) => { saved.push(state) },
  }
  const parsers = loadSource('src/renderer/utils/srtParser.ts', {})
  const source = loadSource('src/renderer/hooks/usePlayerSession.ts', {
    window: { electronAPI: api, clearTimeout },
  }, (name: string) => name === 'react' ? runtime.react : name.endsWith('srtParser') ? parsers : require(name))
  const hook = source.usePlayerSession()
  await hook.openFolder()
  hook.updateProgress(17, 100)
  await hook.persistNow()
  const state = saved[saved.length - 1]
  assert.equal(state.playlists[state.activePlaylistId].videos[0].lastPosition, 17)
}

async function testAtomicPlayerStateWriteAndRecovery() {
  const workRoot = path.resolve(process.env.VIDEO_PLAYER_TEST_WORK || path.join(process.cwd(), 'work'))
  await fs.promises.mkdir(workRoot, { recursive: true })
  const directory = await fs.promises.mkdtemp(path.join(workRoot, 'guide-state-test-'))
  try {
    const fixtureFs = { ...fs.promises }
    const store = loadSource('src/main/playerStateStore.ts', {}, (name: string) => {
      if (name === 'electron') return { app: { getPath: () => directory }, ipcMain: { handle() {} } }
      if (name === 'fs') return { promises: fixtureFs }
      return require(name)
    })
    await store.savePlayerState({ version: 1, position: 1 })
    const normalRename = fixtureFs.rename
    fixtureFs.rename = async () => { throw new Error('synthetic rename failure') }
    await assert.rejects(store.savePlayerState({ version: 1, position: 2 }), /synthetic rename failure/)
    assert.equal((await store.loadPlayerState()).position, 1)
    fixtureFs.rename = normalRename
    await Promise.all([
      store.savePlayerState({ version: 1, position: 3 }),
      store.savePlayerState({ version: 1, position: 4 }),
      store.flushPendingPlayerStateWrites(),
    ])
    assert.equal((await store.loadPlayerState()).position, 4)
    assert.deepEqual(await fs.promises.readdir(directory), ['player-state.json'])
  } finally {
    assert.equal(path.dirname(directory), workRoot)
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}

async function main() {
  await testSaveFailurePreservesDraft()
  await testStaleReadsCannotReplaceNewPlaylist()
  await testGeneratedVersionKeepsOriginalDestination()
  await testNewestEditSurvivesAnOlderSaveCompletion()
  await testManifestSurvivesPlainTextEditing()
  await testSubtitleRevisionIsSortedWithoutOverwritingSource()
  await testProgressFlushBeforeReactRerender()
  await testAtomicPlayerStateWriteAndRecovery()
  console.log('guide-library-state: 8 offline regression checks passed')
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
