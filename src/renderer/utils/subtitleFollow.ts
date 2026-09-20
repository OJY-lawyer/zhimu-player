import type { Subtitle } from './srtParser'

interface SubtitleStart {
  startTime: number
  sourceIndex: number
}

/** Keep display/edit order intact even when an imported SRT is not chronological. */
export function buildSubtitleFollowTimeline(subtitles: readonly Subtitle[]): SubtitleStart[] {
  return subtitles.map((subtitle, sourceIndex) => ({ startTime: subtitle.startTime, sourceIndex }))
    .filter(subtitle => Number.isFinite(subtitle.startTime))
    .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex)
}

/** Sidebar position: a cue remains current until the next cue starts, including gaps. */
export function findSubtitleFollowIndex(timeline: readonly SubtitleStart[], time: number): number {
  if (!Number.isFinite(time)) return -1
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timeline[middle].startTime <= time) low = middle + 1
    else high = middle
  }
  return low > 0 ? timeline[low - 1].sourceIndex : -1
}
