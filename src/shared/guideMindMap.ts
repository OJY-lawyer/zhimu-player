export interface GuideMindMapNode {
  id: string
  text: string
  kind: 'heading' | 'point' | 'paragraph'
  children: GuideMindMapNode[]
}

export interface GuideMindMapTimestamp {
  label: string
  partIndex: number
  time: number
}

/** Read only explicit timestamps. Playlist resolution belongs to guideManifest. */
export function getMindMapTimestamps(text: string): GuideMindMapTimestamp[] {
  const pattern = /\[(?:P(\d+)-)?(\d{1,3}):(\d{2})(?::(\d{2}))?\]/gi
  const timestamps: GuideMindMapTimestamp[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const hasHours = match[4] !== undefined
    const first = Number(match[2])
    const second = Number(match[3])
    const third = Number(match[4] || 0)
    if (second > 59 || third > 59 || (match[1] && Number(match[1]) < 1)) continue
    timestamps.push({
      label: match[0],
      partIndex: match[1] ? Number(match[1]) - 1 : 0,
      time: hasHours ? first * 3600 + second * 60 + third : first * 60 + second,
    })
  }
  return timestamps
}

export function mindMapPlainText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\[(?:P\d+-)?\d{1,3}:\d{2}(?::\d{2})?\]/gi, '')
    .trim()
}

/** A small, lossless outline reader; it does not execute Markdown or HTML. */
export function parseGuideMindMap(markdown: string): GuideMindMapNode[] {
  const roots: GuideMindMapNode[] = []
  const headings: { level: number; node: GuideMindMapNode }[] = []
  const points: { indent: number; node: GuideMindMapNode }[] = []
  let paragraph: GuideMindMapNode | null = null
  let fence: string | null = null
  // Comments include the hidden manifest if this helper is used independently.
  const lines = markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/)

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) { paragraph = null; return }
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fence === fenceMatch[1][0]) fence = null
      paragraph = null
      return
    }
    if (!fence && /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { paragraph = null; return }
    const heading = !fence && line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    const point = !fence && line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/)
    const node: GuideMindMapNode = {
      id: `guide-node-${index}`,
      text: heading ? heading[2] : point ? point[2] : trimmed.replace(/^>\s?/, ''),
      kind: heading ? 'heading' : point ? 'point' : 'paragraph',
      children: [],
    }
    if (heading) {
      const level = heading[1].length
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop()
      ;(headings.length ? headings[headings.length - 1].node.children : roots).push(node)
      headings.push({ level, node })
      points.length = 0
      paragraph = null
      return
    }
    if (point) {
      const indent = point[1].replace(/\t/g, '    ').length
      while (points.length && points[points.length - 1].indent >= indent) points.pop()
      const parent = points[points.length - 1]?.node || headings[headings.length - 1]?.node
      ;(parent ? parent.children : roots).push(node)
      points.push({ indent, node })
      paragraph = null
      return
    }
    // Wrapped paragraphs stay in one node, preserving their full text.
    if (paragraph) { paragraph.text += '\n' + node.text; return }
    const indent = line.match(/^\s*/)?.[0].replace(/\t/g, '    ').length || 0
    while (points.length && points[points.length - 1].indent >= indent) points.pop()
    const parent = points[points.length - 1]?.node || headings[headings.length - 1]?.node
    ;(parent ? parent.children : roots).push(node)
    paragraph = node
  })
  return roots
}
