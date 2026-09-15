import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDroppedMediaPath } from '../src/main/mediaFiles'

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'video-player-folder-drop-'))

  try {
    const firstVideo = path.join(fixture, 'P2.mp4')
    const secondVideo = path.join(fixture, 'P10.mkv')
    await Promise.all([
      writeFile(firstVideo, ''),
      writeFile(secondVideo, ''),
      writeFile(path.join(fixture, '说明.txt'), ''),
    ])

    const folderDrop = await resolveDroppedMediaPath(fixture)
    assert.equal(folderDrop?.sourceKind, 'folder')
    assert.deepEqual(folderDrop?.files.map((file) => file.name), ['P2.mp4', 'P10.mkv'])

    const videoDrop = await resolveDroppedMediaPath(firstVideo)
    assert.equal(videoDrop?.sourceKind, 'single-video')
    assert.deepEqual(videoDrop?.files.map((file) => file.name), ['P2.mp4'])

    const unsupportedDrop = await resolveDroppedMediaPath(path.join(fixture, '说明.txt'))
    assert.equal(unsupportedDrop, null)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }

  console.log('folder-drop: ok')
}

void main()
