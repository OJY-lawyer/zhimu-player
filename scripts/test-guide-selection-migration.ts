import assert from 'node:assert/strict'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

// All configuration and encrypted material below are synthetic and held in memory.
const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { buildSync } = hostRequire('esbuild') as typeof import('esbuild')
const source = buildSync({
  entryPoints: [path.join(root, 'src/main/configStore.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'es2020',
  external: ['electron'], write: false,
}).outputFiles[0].text
const directory = path.join(root, 'work', 'virtual-guide-selection-migration')
const configPath = path.join(directory, 'config.json')
const files = new Map<string, string>()
let writes = 0
let decryptions = 0
const mockFs = {
  readFileSync(file: string) {
    if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return files.get(file)
  },
  writeFileSync(file: string, content: string) { files.set(file, content); writes++ },
  renameSync(from: string, to: string) { files.set(to, files.get(from)!); files.delete(from) },
}
const syntheticSecret = 'fixture-key'
const ciphertext = Buffer.from('sealed:' + syntheticSecret).toString('base64')
const electron = {
  app: { getPath: () => directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('sealed:' + value),
    decryptString(value: Buffer) {
      decryptions++
      assert.match(value.toString(), /^sealed:/)
      return value.toString().slice('sealed:'.length)
    },
  },
}
const module = { exports: {} as any }
vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Buffer, URL })(
  (name: string) => name === 'electron' ? electron : name === 'node:fs' ? mockFs : hostRequire(name),
  module, module.exports,
)
const store = module.exports
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
const astraPro = { model: 'GPT-6 Astra', reasoning: 'Pro' }
const solPro = { model: 'GPT-5.6 Sol', reasoning: 'Pro' }
const solMedium = { model: 'GPT-5.6 Sol', reasoning: 'Medium' }
const custom = { model: 'Future Chat model', reasoning: 'Custom effort' }
const base = { provider: 'chatgpt-web', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' }
assert.equal(store.loadConfig(), null, 'a new install has no model or Pro selection')

const cases: { name: string; raw: Record<string, unknown>; expected: unknown }[] = [
  { name: 'no saved choice', raw: {}, expected: null },
  { name: 'Plus is not an assumed Pro choice', raw: { chatGptTier: 'plus' }, expected: null },
  { name: 'old Pro choice retains its intended model and level', raw: { chatGptTier: 'pro' }, expected: astraPro },
  { name: 'explicit clear wins over old Pro choice', raw: { chatGptTier: 'pro', chatGptSelection: null }, expected: null },
  { name: 'invalid explicit choice does not fall back to Pro', raw: { chatGptTier: 'pro', chatGptSelection: { model: 'Sol', reasoning: '' } }, expected: null },
  { name: 'explicit Medium wins over old Pro choice', raw: { chatGptTier: 'pro', chatGptSelection: solMedium }, expected: solMedium },
  { name: 'Sol Pro remains Sol Pro', raw: { chatGptTier: 'pro', chatGptSelection: solPro }, expected: solPro },
  { name: 'Astra Pro remains Astra Pro', raw: { chatGptSelection: astraPro }, expected: astraPro },
  { name: 'rc.9 model alias migrates to Astra Pro', raw: { chatGptTier: 'plus', chatGptSelection: { model: 'GPT-6 Pro', reasoning: null } }, expected: astraPro },
  { name: 'unknown labels remain usable', raw: { chatGptTier: 'pro', chatGptSelection: custom }, expected: custom },
  { name: 'an unknown no-level model remains usable', raw: { chatGptSelection: { model: 'Future model without levels', reasoning: null } }, expected: { model: 'Future model without levels', reasoning: null } },
  { name: 'only the exact old representation is migrated', raw: { chatGptSelection: { model: 'GPT-6 Pro', reasoning: 'Custom effort' } }, expected: { model: 'GPT-6 Pro', reasoning: 'Custom effort' } },
]
for (const test of cases) {
  const original = JSON.stringify({ ...base, ...test.raw, apiKeyEncrypted: ciphertext })
  files.set(configPath, original)
  const writesBefore = writes
  const decryptionsBefore = decryptions
  const loaded = store.loadConfig()
  assert.deepEqual(plain(loaded.chatGptSelection), test.expected, test.name)
  assert.equal(loaded.apiKey, '', 'renderer config does not contain a key')
  assert.equal(loaded.apiKeyEncrypted, undefined, 'renderer config does not contain the ciphertext')
  assert.equal(loaded.hasApiKey, true)
  assert.equal(files.get(configPath), original, 'reading preferences does not rewrite them: ' + test.name)
  assert.equal(writes, writesBefore)
  assert.equal(decryptions, decryptionsBefore, 'model migration does not decrypt a saved API key')
}

files.set(configPath, JSON.stringify({ ...base, chatGptTier: 'pro', apiKeyEncrypted: ciphertext, chatGptProject: 'Original project' }))
store.saveGuideLanguage('en')
assert.deepEqual(plain(store.loadConfig().chatGptSelection), astraPro, 'guide-language changes retain legacy model semantics')
assert.equal(JSON.parse(files.get(configPath)!).apiKeyEncrypted, ciphertext)
const loadedLegacy = store.loadConfig()
store.saveConfig({ ...loadedLegacy, provider: 'compatible-api' })
assert.deepEqual(plain(store.loadConfig().chatGptSelection), astraPro, 'changing providers retains the model selection')
assert.equal(JSON.parse(files.get(configPath)!).apiKeyEncrypted, ciphertext)
assert.equal(store.loadConfig().chatGptProject, 'Original project')

store.saveConfig({ ...store.loadConfig(), provider: 'chatgpt-web', chatGptSelection: solPro })
assert.deepEqual(plain(store.loadConfig().chatGptSelection), solPro, 'saved Sol Pro is independent from Astra Pro')
store.saveConfig({ ...store.loadConfig(), chatGptSelection: { model: 'GPT-6 Pro', reasoning: null } })
assert.deepEqual(JSON.parse(files.get(configPath)!).chatGptSelection, astraPro, 'new saves use the canonical family and level')
store.saveConfig({ ...store.loadConfig(), chatGptSelection: null })
assert.equal(store.loadConfig().chatGptSelection, null, 'saving a cleared selection does not restore the legacy Pro choice')
store.saveConfig({ ...store.loadConfig(), chatGptSelection: custom })
assert.deepEqual(plain(store.loadConfig().chatGptSelection), custom, 'future website labels survive a save/reload')
const beforeInvalid = files.get(configPath)
assert.throws(() => store.saveConfig({ ...store.loadConfig(), chatGptSelection: { model: 'Sol', reasoning: '' } }), /Invalid ChatGPT/)
assert.equal(files.get(configPath), beforeInvalid, 'invalid choices cannot overwrite stored preferences')

console.log('guide-selection-migration: 12 read-only migrations, distinct Sol/Astra Pro, explicit choice preservation, provider/language round trips, canonical saves and encrypted-key isolation passed; in-memory fixtures only')
