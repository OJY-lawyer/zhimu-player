import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const options = { folder: '', output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--folder') options.folder = argv[++index] || ''
    if (value === '--output') options.output = argv[++index] || ''
  }
  if (!options.folder || !options.output) {
    throw new Error('Usage: node scripts/prepare-guide-input.mjs --folder <video-folder> --output <markdown-file>')
  }
  return options
}

function parseSrt(content) {
  return content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n\s*\r?\n/)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const timingIndex = lines.findIndex((line) => line.includes('-->'))
      if (timingIndex < 0 || timingIndex === lines.length - 1) return []
      const start = lines[timingIndex].match(/^(\d{2}):(\d{2}):(\d{2})[,.]\d{3}/)
      if (!start) return []
      return [{
        time: `${start[1]}:${start[2]}:${start[3]}`,
        text: lines.slice(timingIndex + 1).join(' ').replace(/\s+/g, ' ').trim(),
      }]
    })
    .filter((cue) => cue.text)
}

function buildTask(folderName, parts) {
  const mapping = parts.map((part, index) => `- P${index + 1}: ${part.stem}`).join('\n')
  const transcript = parts.map((part, index) => [
    `## P${index + 1} ${part.stem}`,
    ...part.cues.map((cue) => `[P${index + 1}-${cue.time}] ${cue.text}`),
  ].join('\n')).join('\n\n')

  return [
    '# 视频内容导读生成任务',
    '',
    `播放列表：${folderName}`,
    `Part 数量：${parts.length}`,
    '',
    '## 输出要求',
    '',
    '1. 据实还原字幕中出现的话题，不替用户判断什么有价值，不删除闲聊、案例、问答或生活趣事。',
    '2. 以话题为轴组织内容。Part 只是同一场录像的文件切分，不按 Part 或固定时间段机械分块。',
    '3. 每个话题必须使用“### 话题标题 [P1-00:00:00]”格式。时间戳指向话题首次引入或发生转换的起点，不能放在话题中段。',
    '4. 同一个话题在不同时间重新出现时，分别保留各次实际讨论段的入口。',
    '5. 每个条目写详细、忠实的内容概述，不增加字幕中没有的事实、评价或结论。',
    '6. 开头先写一级标题和一段整套录像概览，随后直接进入话题条目。',
    '7. 只输出 Markdown 导读正文，不写执行说明、校验说明或免责声明。',
    '',
    '## Part 映射',
    '',
    mapping,
    '',
    '## 完整字幕',
    '',
    transcript,
    '',
  ].join('\n')
}

async function main() {
  const { folder, output } = parseArgs(process.argv.slice(2))
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  const names = (await readdir(folder))
    .filter((name) => name.toLocaleLowerCase().endsWith('.srt'))
    .sort((left, right) => collator.compare(left, right))
  if (names.length === 0) throw new Error('No SRT files found in the selected folder.')

  const parts = []
  for (const name of names) {
    const content = await readFile(path.join(folder, name), 'utf8')
    const cues = parseSrt(content)
    if (cues.length === 0) throw new Error(`No subtitle cues found in ${name}`)
    parts.push({ name, stem: name.replace(/\.srt$/i, ''), cues })
  }

  const task = buildTask(path.basename(path.resolve(folder)), parts)
  await mkdir(path.dirname(path.resolve(output)), { recursive: true })
  await writeFile(output, task, 'utf8')
  process.stdout.write(JSON.stringify({
    output: path.resolve(output),
    parts: parts.length,
    cues: parts.reduce((total, part) => total + part.cues.length, 0),
    characters: task.length,
  }))
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
