const MANIFEST_PREFIX = 'ai-video-player-guide:'

export interface GuideManifest {
  version: 1
  parts: string[]
}

export interface ParsedGuide {
  body: string
  manifest: GuideManifest | null
  hasManifest: boolean
}

export interface GuideNavigation {
  body: string
  partMap: (number | null)[]
  warning: string | null
}

function isFilename(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value !== '.' && value !== '..' && !/[\\/:<>"|?*\u0000-\u001f]/.test(value)
}

export function parseGuideDocument(content: string): ParsedGuide {
  const header = content.match(/^\uFEFF?\s*<!--\s*ai-video-player-guide:([\s\S]*?)-->\s*/)
  if (!header) {
    const hasManifest = /^\uFEFF?\s*<!--\s*ai-video-player-guide:/.test(content)
    const firstLineEnd = content.indexOf('\n')
    return {
      body: hasManifest ? firstLineEnd < 0 ? '' : content.slice(firstLineEnd + 1) : content,
      manifest: null,
      hasManifest,
    }
  }
  const body = content.slice(header[0].length)
  try {
    const parsed = JSON.parse(header[1]) as Partial<GuideManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.parts)
      || parsed.parts.length === 0 || !parsed.parts.every(isFilename)) {
      return { body, manifest: null, hasManifest: true }
    }
    const names = parsed.parts.map((name) => name.toLocaleLowerCase())
    if (new Set(names).size !== names.length) return { body, manifest: null, hasManifest: true }
    return { body, manifest: { version: 1, parts: parsed.parts }, hasManifest: true }
  } catch {
    return { body, manifest: null, hasManifest: true }
  }
}

function serializeManifest(body: string, manifest: GuideManifest): string {
  return '<!-- ' + MANIFEST_PREFIX + JSON.stringify(manifest) + ' -->\n\n' + body
}

export function attachGuideManifest(body: string, filenames: string[]): string {
  const manifest: GuideManifest = { version: 1, parts: [...filenames] }
  const serialized = serializeManifest(parseGuideDocument(body).body, manifest)
  if (!parseGuideDocument(serialized).manifest) throw new Error('视频文件名无法生成可靠的导读对应记录。')
  return serialized
}

export function replaceGuideBody(original: string, nextBody: string): string {
  const parsed = parseGuideDocument(original)
  const cleanBody = parseGuideDocument(nextBody).body
  if (parsed.manifest) return serializeManifest(cleanBody, parsed.manifest)
  return parsed.hasManifest ? original.slice(0, original.length - parsed.body.length) + cleanBody : cleanBody
}

export function buildGuideNavigation(content: string, filenames: readonly string[]): GuideNavigation {
  const parsed = parseGuideDocument(content)
  if (!parsed.manifest) {
    if (parsed.hasManifest) {
      return { body: parsed.body, partMap: [], warning: '这份导读的视频对应记录已损坏，跳转已停用。可继续阅读，或重新生成导读。' }
    }
    if (filenames.length === 1) return { body: parsed.body, partMap: [0], warning: null }
    return {
      body: parsed.body,
      partMap: [],
      warning: content.trim()
        ? '这份旧导读未记录 Part 对应的视频，暂不能可靠跳转。可继续阅读、编辑或搜索；重新生成后可恢复跳转。'
        : null,
    }
  }
  const currentNames = filenames.map((name) => name.toLocaleLowerCase())
  const partMap = parsed.manifest.parts.map((name) => {
    const wanted = name.toLocaleLowerCase()
    const matches = currentNames.flatMap((current, index) => current === wanted ? [index] : [])
    return matches.length === 1 ? matches[0] : null
  })
  return {
    body: parsed.body,
    partMap,
    warning: partMap.some((part) => part === null)
      ? '部分视频已移除或更名，对应时间戳暂不能跳转。其余内容仍可使用。'
      : null,
  }
}
