import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getMindMapTimestamps, mindMapPlainText, parseGuideMindMap } from '../src/shared/guideMindMap'
import { attachGuideManifest, buildGuideNavigation } from '../src/shared/guideManifest'
import { GuideMindMap } from '../src/renderer/components/GuideMindMap'
import { GuidePanel } from '../src/renderer/components/GuidePanel'
import { setLanguage } from '../src/renderer/i18n'

const outline = parseGuideMindMap('# Course\n## First [P2-00:01:10]\n- Main point\n  - Detail\n- Next point\n### Subtopic\nA wrapped\nparagraph.\n## Second\n1. Ordered item')
assert.equal(outline.length, 1)
assert.deepEqual(outline[0].children.map(node => node.text), ['First [P2-00:01:10]', 'Second'])
const first = outline[0].children[0]
assert.equal(first.children[0].children[0].text, 'Detail')
assert.equal(first.children[1].text, 'Next point')
assert.equal(first.children[2].children[0].text, 'A wrapped\nparagraph.')
assert.equal(outline[0].children[1].children[0].text, 'Ordered item')
assert.deepEqual(parseGuideMindMap(' \n<!-- hidden -->\n---'), [])
assert.equal(parseGuideMindMap('No heading\nwrapped paragraph\n\n- Point')[0].text, 'No heading\nwrapped paragraph')
assert.equal(parseGuideMindMap('```md\n# Code, not a heading\n```')[0].kind, 'paragraph')
assert.equal(parseGuideMindMap('###### Skipped levels\n- [x] Done')[0].children[0].text, 'Done')
assert.equal(mindMapPlainText('**Topic** [P2-00:01:10] [reference](https://example.com)'), 'Topic  reference')
assert.deepEqual(getMindMapTimestamps('A [P2-00:01:10] [02:30] [P0-00:00:01] [00:99:00]'), [
  { label: '[P2-00:01:10]', partIndex: 1, time: 70 },
  { label: '[02:30]', partIndex: 0, time: 150 },
])

const body = '# Topic [P1-00:00:10]\n- Detail [P2-00:00:20]'
const document = attachGuideManifest(body, ['first.mp4', 'second.mp4'])
const reordered = buildGuideNavigation(document, ['second.mp4', 'first.mp4'])
const render = (partMap: (number | null)[]) => renderToStaticMarkup(React.createElement(GuideMindMap, {
  content: reordered.body, partMap, onNavigate() {},
}))
const mapped = render(reordered.partMap)
assert.ok(mapped.includes('跳转至当前播放列表 P2'))
assert.ok(mapped.includes('跳转至当前播放列表 P1'))
assert.ok(mapped.includes('aria-expanded="true"'))
assert.ok(!mapped.includes('ai-video-player-guide'))
const unmapped = render(buildGuideNavigation(body, ['first.mp4', 'second.mp4']).partMap)
assert.ok(!unmapped.includes('guide-map-node-link'))
assert.equal((unmapped.match(/disabled=""/g) || []).length, 3) // Expand all and both unresolved timestamps.
const props = {
  versions: [], activeVersion: null, content: ' \n<!-- hidden -->', isLoading: false, error: null,
  missingSubtitleNames: [], isGenerating: false, providerLabel: 'API',
  onSelectVersion() {}, onContentChange() {}, onGenerate() {}, onCancel() {}, onOpenSettings() {}, onNavigate() {},
}
assert.ok(renderToStaticMarkup(React.createElement(GuidePanel, props)).includes('还没有内容导读'))
setLanguage('en')
assert.ok(render(reordered.partMap).includes('Collapse all'))
assert.ok(renderToStaticMarkup(React.createElement(GuidePanel, { ...props, content: body })).includes('Mind map'))
setLanguage('zh-CN')
console.log('guide-mind-map: hierarchy, plain/wrapped text, code, empty guide, timestamps, manifest resolution and bilingual controls passed')
