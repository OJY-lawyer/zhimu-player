import assert from 'node:assert/strict'
import {
  CHATGPT_GUIDE_LABEL,
  cleanGuideMarkdown,
  CHATGPT_WEB_PRESETS,
  chatGptModelPolicy,
  chatGptTarget,
  chatGptGuideVersionLabel,
  guideProviderLabel,
  normalizeChatGptSelection,
  normalizeGuideProvider,
  validateGuideMarkdown,
} from '../src/shared/guideGeneration'

assert.equal(normalizeGuideProvider(undefined), 'chatgpt-web')
assert.equal(normalizeGuideProvider('deepseek-reasoner'), 'chatgpt-web')
assert.equal(normalizeGuideProvider('compatible-api'), 'compatible-api')
assert.equal(guideProviderLabel('chatgpt-web', 'deepseek-reasoner'), CHATGPT_GUIDE_LABEL)
assert.equal(guideProviderLabel('compatible-api', 'deepseek-v4-flash'), 'API · deepseek-v4-flash')
const solMedium = { model: 'GPT-5.6 Sol', reasoning: 'Medium' }
assert.equal(guideProviderLabel('chatgpt-web', 'unused-api-model', solMedium), 'ChatGPT · GPT-5.6 Sol · Medium')
assert.deepEqual(normalizeChatGptSelection({ model: ' Custom web model ', reasoning: ' Custom level ' }), { model: 'Custom web model', reasoning: 'Custom level' })
assert.equal(normalizeChatGptSelection({ model: 'Sol', reasoning: '' }), null, 'an unfinished choice is not executable')
assert.equal(normalizeChatGptSelection({ model: 'Sol' }), null, 'missing level differs from an explicit no-level model')
assert.equal(normalizeChatGptSelection({ model: 'Sol\nPro', reasoning: null }), null)
assert.equal(normalizeChatGptSelection('pro'), null, 'a subscription must never act as a model selection')
assert.equal(chatGptTarget(null).model, '', 'missing selection must not default to Pro')
assert.deepEqual(CHATGPT_WEB_PRESETS.find(model => model.model === 'GPT-5.6 Sol')?.reasoningOptions, ['Instant', 'Medium', 'High', 'Extra High', 'Pro'])
assert.deepEqual(CHATGPT_WEB_PRESETS.find(model => model.model === 'GPT-6 Astra')?.reasoningOptions, ['Pro'])
assert(!CHATGPT_WEB_PRESETS.some(model => model.model === 'GPT-6 Pro'), 'Pro is a level, not a separate model family')
const solPro = { model: 'GPT-5.6 Sol', reasoning: 'Pro' }
const astraPro = { model: 'GPT-6 Astra', reasoning: 'Pro' }
const rc9Pro = { model: 'GPT-6 Pro', reasoning: null }
assert.deepEqual(normalizeChatGptSelection(rc9Pro), astraPro, 'the known rc.9 representation retains its Astra Pro meaning')
assert.deepEqual(normalizeChatGptSelection({ model: ' GPT-6 Pro ', reasoning: null }), astraPro)
assert.deepEqual(normalizeChatGptSelection(astraPro), astraPro, 'migration is idempotent')
assert.deepEqual(normalizeChatGptSelection(solPro), solPro, 'Sol Pro must never become Astra Pro')
assert.deepEqual(normalizeChatGptSelection(solMedium), solMedium, 'an explicit non-Pro level remains selected')
assert.deepEqual(normalizeChatGptSelection({ model: 'GPT-6 Pro', reasoning: 'Custom level' }), { model: 'GPT-6 Pro', reasoning: 'Custom level' }, 'unknown explicit model/level pairs are not aliases')
assert.deepEqual(normalizeChatGptSelection({ model: 'Future family', reasoning: null }), { model: 'Future family', reasoning: null }, 'a future no-level model remains supported')
assert.equal(chatGptTarget(solPro).label, 'ChatGPT · GPT-5.6 Sol · Pro')
assert.equal(chatGptTarget(astraPro).label, 'ChatGPT · GPT-6 Astra · Pro')
assert.deepEqual(chatGptTarget(rc9Pro), chatGptTarget(astraPro))
assert.deepEqual(chatGptModelPolicy(rc9Pro), chatGptModelPolicy(astraPro))
assert(!new RegExp(chatGptModelPolicy(solPro).model, 'i').test(astraPro.model), 'the two Pro choices target different model families')
assert(new RegExp(chatGptModelPolicy(solPro).effort!, 'i').test('Pro'))
assert(new RegExp(chatGptModelPolicy(astraPro).effort!, 'i').test('Pro'))
assert(!new RegExp(chatGptModelPolicy(astraPro).effort!, 'i').test('Extra High'), 'Pro cannot silently downgrade to another level')
assert.equal(chatGptGuideVersionLabel(solPro), 'Guide.ChatGPT-GPT-5.6-Sol-Pro')
assert.equal(chatGptGuideVersionLabel(astraPro), 'Guide.ChatGPT-GPT-6-Astra-Pro')
assert.equal(chatGptGuideVersionLabel(rc9Pro), chatGptGuideVersionLabel(astraPro))
const escaped = chatGptModelPolicy({ model: 'Model [A]+', reasoning: 'Level (1)' })
assert(new RegExp(escaped.model).test('Model [A]+'))
assert(!new RegExp(escaped.model).test('Model AAA'))
assert(!new RegExp(chatGptModelPolicy(solMedium).model, 'i').test('Previous GPT-5.6 Sol output'))
assert.equal(chatGptGuideVersionLabel(solMedium), 'Guide.ChatGPT-GPT-5.6-Sol-Medium')
assert(!/[<>:"/\\|?*]/.test(chatGptGuideVersionLabel({ model: 'a/b:c', reasoning: 'x|y' })))

const fenced = '```markdown\n# 导读\n\n### 话题 [P1-00:02:03]\n内容\n```'
assert.equal(cleanGuideMarkdown(fenced), '# 导读\n\n### 话题 [P1-00:02:03]\n内容')
assert.equal(validateGuideMarkdown(fenced, 1), null)
assert.match(validateGuideMarkdown('### 话题 [P1-02:03]\n内容', 1) || '', /严格/)
assert.match(validateGuideMarkdown('### 话题 [P2-00:02:03]\n内容', 1) || '', /不存在/)

console.log('guide-generation: ok')
