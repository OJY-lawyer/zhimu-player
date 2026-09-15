import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { detectAppLanguage, normalizeGuideLanguage, guideLanguageInstruction } from '../src/shared/language'
import { buildGuidePrompt } from '../src/shared/guidePrompt'
import { chatGptModelPolicy, chatGptTarget, validateGuideMarkdown } from '../src/shared/guideGeneration'
import { translateRuntimeMessage } from '../src/shared/runtimeMessages'
import { setLanguage, t } from '../src/renderer/i18n'
import { GuidePanel } from '../src/renderer/components/GuidePanel'

assert.equal(detectAppLanguage('zh-Hans-CN'), 'zh-CN')
assert.equal(detectAppLanguage('en-US'), 'en')
assert.equal(detectAppLanguage('de-DE'), 'en')
assert.equal(normalizeGuideLanguage(undefined), 'zh-CN', 'old configurations keep their existing Chinese guide behavior')
assert.equal(normalizeGuideLanguage('source'), 'source')
for (const language of ['zh-CN', 'en', 'source'] as const) {
  const prompt = buildGuidePrompt('Original title 原标题', 2, '[P1-00:00:01] Original transcript 原字幕', language)
  assert(prompt.includes(guideLanguageInstruction(language)))
  assert(prompt.includes('Original title 原标题'))
  assert(prompt.includes('[P1-00:00:01] Original transcript 原字幕'))
  assert(prompt.includes('Part count: 2'))
}
assert.match(buildGuidePrompt('Example', 1, 'Text', 'en'), /headings, and descriptions in English/)
assert.match(buildGuidePrompt('Example', 1, 'Text', 'source'), /predominant language of the transcript/)
assert.equal(validateGuideMarkdown('### Introduction [P1-00:00:01]\nEnglish description.', 1), null)
for (const tier of ['plus', 'pro'] as const) {
  const policy = chatGptModelPolicy(tier)
  assert(new RegExp(policy.model, 'i').test('GPT-6 Astra'))
  assert(!new RegExp(policy.model, 'i').test('GPT-5.6 Sol'))
  assert.equal(chatGptTarget(tier).model, 'GPT-6 Astra')
}
assert(new RegExp(chatGptModelPolicy('pro').effort, 'i').test('Pro'))
assert(!new RegExp(chatGptModelPolicy('pro').effort, 'i').test('xhigh'))
assert(new RegExp(chatGptModelPolicy('plus').effort, 'i').test('Extra high'))
assert(!new RegExp(chatGptModelPolicy('plus').effort, 'i').test('Pro'))
assert.equal(translateRuntimeMessage('API Key 无效或已过期，请在设置中更新。', 'zh-CN'), 'API Key 无效或已过期，请在设置中更新。')
assert(!/\p{Script=Han}/u.test(translateRuntimeMessage('API Key 无效或已过期，请在设置中更新。', 'en')))
const userDetail = 'Unknown provider details 未知服务信息'
assert.equal(translateRuntimeMessage(userDetail, 'en'), 'Additional details: ' + userDetail)
assert(translateRuntimeMessage('导读尚未保存，编辑内容仍保留在播放器中：C:/课程/notes.md', 'en').includes('C:/课程/notes.md'))

const props = {
  versions: [], activeVersion: null, content: '### User heading [P1-00:00:01]\nUser text 用户正文',
  isLoading: false, error: null, missingSubtitleNames: [], isGenerating: false,
  providerLabel: 'ChatGPT · Astra · Pro', playlist: { items: [{ name: 'Original 原视频.mp4' }] } as any,
  guideLanguage: 'en' as const, onGuideLanguageChange() {}, onSelectVersion() {}, onContentChange() {},
  onGenerate() {}, onCancel() {}, onOpenSettings() {}, onNavigate() {},
}
setLanguage('en')
assert.equal(t('设置', 'Settings'), 'Settings')
const english = renderToStaticMarkup(React.createElement(GuidePanel, props))
assert(english.includes('Guide output language'))
assert(english.includes('Match subtitles'))
assert(english.includes('User text 用户正文'), 'UI translation must never replace content')
assert(!english.includes('内容导读'))
const running = renderToStaticMarkup(React.createElement(GuidePanel, { ...props, isGenerating: true }))
assert.match(running, /<select[^>]*disabled=""[^>]*aria-label="Guide output language"/)
setLanguage('zh-CN')
const chinese = renderToStaticMarkup(React.createElement(GuidePanel, props))
assert(chinese.includes('导读输出语言'))
assert(chinese.includes('User text 用户正文'))
console.log('languages: locale selection, guide prompts, original content, runtime messages, output selector and Astra plan policies passed')
