export interface Subtitle {
  index: number
  startTime: number  // seconds
  endTime: number    // seconds
  text: string
}

function parseTime(timeStr: string): number {
  // Format: HH:MM:SS,mmm
  const parts = timeStr.replace(',', '.').split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return hours * 3600 + minutes * 60 + seconds
}

export function parseSRT(content: string): Subtitle[] {
  const subtitles: Subtitle[] = []
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length < 3) continue

    const index = parseInt(lines[0], 10)
    const timeLine = lines[1]
    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/)
    if (!timeMatch) continue

    const startTime = parseTime(timeMatch[1])
    const endTime = parseTime(timeMatch[2])
    const text = lines.slice(2).join('\n')

    subtitles.push({ index, startTime, endTime, text })
  }

  return subtitles
}

function formatSRTTime(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const milliseconds = totalMilliseconds % 1000
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const secs = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`
}

export function serializeSRT(subtitles: Subtitle[]): string {
  return subtitles.map((subtitle, index) => [
    String(index + 1),
    `${formatSRTTime(subtitle.startTime)} --> ${formatSRTTime(subtitle.endTime)}`,
    subtitle.text.trim(),
  ].join('\r\n')).join('\r\n\r\n') + '\r\n'
}

export function findSubtitleIndex(subtitles: Subtitle[], time: number): number {
  let low = 0
  let high = subtitles.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const subtitle = subtitles[middle]
    if (time < subtitle.startTime) {
      high = middle - 1
    } else if (time > subtitle.endTime) {
      low = middle + 1
    } else {
      return middle
    }
  }
  return -1
}

export function findNearestSubtitle(subtitles: Subtitle[], time: number): Subtitle | null {
  if (subtitles.length === 0) return null
  let low = 0
  let high = subtitles.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (subtitles[middle].startTime < time) low = middle + 1
    else high = middle - 1
  }
  const before = subtitles[Math.max(0, high)]
  const after = subtitles[Math.min(subtitles.length - 1, low)]
  return Math.abs(before.startTime - time) <= Math.abs(after.startTime - time) ? before : after
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
