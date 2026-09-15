import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { attachGuideManifest, buildGuideNavigation, parseGuideDocument, replaceGuideBody } from '../src/shared/guideManifest'
import { GuidePanel } from '../src/renderer/components/GuidePanel'

const body = '### 内容入口 [P1-00:00:01]\n内容概述'
const document = attachGuideManifest(body, ['P2.mp4', 'P10.mp4'])
assert.deepEqual(parseGuideDocument(document).manifest?.parts, ['P2.mp4', 'P10.mp4'])
assert.equal(parseGuideDocument(document).body, body)
assert.deepEqual(buildGuideNavigation(document, ['P10.mp4', 'P2.mp4']).partMap, [1, 0])
assert.deepEqual(buildGuideNavigation(document, ['new.mp4', 'P10.mp4']).partMap, [null, 1])
assert.deepEqual(buildGuideNavigation(document, ['P2.mp4', 'p2.MP4', 'P10.mp4']).partMap, [null, 2])
assert.throws(() => attachGuideManifest(body, ['D:/private/P2.mp4']), /文件名/)
assert.throws(() => attachGuideManifest(body, ['P2.mp4', 'p2.MP4']), /文件名/)
assert.ok(!document.includes('D:'))

const edited = replaceGuideBody(document, '### 修改后 [P2-00:00:02]\n正文')
assert.deepEqual(parseGuideDocument(edited).manifest?.parts, ['P2.mp4', 'P10.mp4'])
assert.equal(parseGuideDocument(edited).body, '### 修改后 [P2-00:00:02]\n正文')
const corrupt = '<!-- ai-video-player-guide:{invalid} -->\n\n' + body
assert.equal(buildGuideNavigation(corrupt, ['P2.mp4']).partMap.length, 0)
assert.equal(parseGuideDocument(replaceGuideBody(corrupt, 'Edited')).hasManifest, true)
assert.equal(buildGuideNavigation('<!-- ai-video-player-guide:{broken}\n' + body, ['P2.mp4']).partMap.length, 0)

const oldMulti = buildGuideNavigation(body, ['P2.mp4', 'P10.mp4'])
assert.equal(oldMulti.partMap.length, 0)
assert.match(oldMulti.warning || '', /未记录/)
assert.deepEqual(buildGuideNavigation(body, ['P2.mp4']).partMap, [0])

const playlist = { items: [{ name: 'P10.mp4' }, { name: 'P2.mp4' }] } as any
const props = {
  versions: [], activeVersion: null, content: document, isLoading: false, error: null,
  missingSubtitleNames: [], isGenerating: false, providerLabel: 'API', playlist,
  onSelectVersion() {}, onContentChange() {}, onGenerate() {}, onCancel() {}, onOpenSettings() {}, onNavigate() {},
}
const rendered = renderToStaticMarkup(React.createElement(GuidePanel, props))
assert.ok(!rendered.includes('ai-video-player-guide'))
assert.ok(rendered.includes('跳转至当前播放列表 P2'))
const legacyRendered = renderToStaticMarkup(React.createElement(GuidePanel, { ...props, content: body }))
assert.match(legacyRendered, /class="timestamp-button"[^>]*disabled=""/)
assert.ok(legacyRendered.includes('未记录 Part'))

console.log('guide-manifest: reorder, missing/ambiguous files, editing, legacy handling and hidden metadata passed')
