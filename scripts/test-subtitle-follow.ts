import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SubtitleBrowser } from '../src/renderer/components/SubtitleBrowser'
import { buildSubtitleFollowTimeline, findSubtitleFollowIndex } from '../src/renderer/utils/subtitleFollow'
import { findSubtitleIndex, parseSRT, type Subtitle } from '../src/renderer/utils/srtParser'

const cues: Subtitle[] = [
  { index: 1, startTime: 2, endTime: 3, text: 'First cue' },
  { index: 2, startTime: 8, endTime: 9, text: 'Second cue' },
  { index: 3, startTime: 12, endTime: 13, text: 'Last cue' },
]
const timeline = buildSubtitleFollowTimeline(cues)
for (const [time, expected] of [[0, -1], [1.999, -1], [2, 0], [3, 0], [5, 0], [7.999, 0], [8, 1],
  [10, 1], [12, 2], [100, 2], [10, 1], [5, 0], [0, -1], [5, 0], [5, 0]]) {
  assert.equal(findSubtitleFollowIndex(timeline, time), expected, 'forward/backward seeks and repeated paused time ' + time)
}
assert.equal(findSubtitleFollowIndex([], 100), -1)
assert.equal(findSubtitleFollowIndex(timeline, Number.NaN), -1)
assert.equal(findSubtitleIndex(cues, 5), -1, 'video overlay still ends at the original end time')
assert.equal(findSubtitleIndex(cues, 100), -1, 'last sidebar highlight does not extend the video overlay')
assert.equal(findSubtitleIndex(cues, 2.5), 0)

// parseSRT preserves source order, so the sidebar index must handle unsorted input itself.
const unsorted = parseSRT('1\n00:00:12,000 --> 00:00:13,000\nLast\n\n2\n00:00:02,000 --> 00:00:03,000\nFirst\n\n3\n00:00:08,000 --> 00:00:09,000\nMiddle')
const original = JSON.stringify(unsorted)
const unorderedTimeline = buildSubtitleFollowTimeline(unsorted)
assert.equal(findSubtitleFollowIndex(unorderedTimeline, 5), 1)
assert.equal(findSubtitleFollowIndex(unorderedTimeline, 10), 2)
assert.equal(findSubtitleFollowIndex(unorderedTimeline, 100), 0)
assert.equal(JSON.stringify(unsorted), original, 'timeline creation must not reorder display, editing or click targets')
const tied = buildSubtitleFollowTimeline([cues[0], { ...cues[1], startTime: 2 }, cues[2]])
assert.equal(findSubtitleFollowIndex(tied, 2), 1, 'simultaneous starts select the last cue in source order')
assert.equal(findSubtitleFollowIndex(buildSubtitleFollowTimeline([{ ...cues[0], endTime: 20 }, cues[1]]), 8), 1, 'newer cue wins during overlapping durations')

function activeText(currentTime: number, subtitleOffset = 0, subtitles = cues): string | null {
  const html = renderToStaticMarkup(createElement(SubtitleBrowser, { subtitles, currentTime, subtitleOffset,
    subtitleSource: 'sidecar', onSeek() {}, onExport() {}, onSaveRevision: async () => true }))
  const active = [...html.matchAll(/<button[^>]+class="subtitle-item is-active"[^>]*>[\s\S]*?<span>([^<]*)<\/span><\/button>/g)]
  assert(active.length <= 1, 'only one sidebar row can be current')
  return active[0]?.[1] ?? null
}
assert.equal(activeText(5), 'First cue', 'the actual component uses the new gap-follow rule')
assert.equal(activeText(5), 'First cue', 'paused render keeps the same highlight')
assert.equal(activeText(8), 'Second cue')
assert.equal(activeText(100), 'Last cue')
assert.equal(activeText(0), null)
assert.equal(activeText(6, 2), 'Second cue', 'positive subtitle offset advances the sidebar position')
assert.equal(activeText(8, -2), 'First cue', 'negative subtitle offset delays the sidebar position')
assert.equal(activeText(1, -2), null)
assert.equal(activeText(10, 0, unsorted), 'Middle')
assert.equal(activeText(5, 0, []), null, 'switching to a video without subtitles clears the highlight')
console.log('subtitle-follow: real component render, gaps, pause, bidirectional seek, offsets, boundaries, unsorted/overlapping cues and unchanged overlay intervals passed')
