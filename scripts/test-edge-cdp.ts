import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  conversationBelongsToProject,
  extractProjectIdFromResourceUrls,
  parseChatGptCookies,
  probeEdgeUrl,
} from '../src/main/chatgptEdgeWorker'

async function removeProfile(profile: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

async function main() {
  const cookies = parseChatGptCookies(JSON.stringify([
    { name: 'session', value: 'secret', domain: '.chatgpt.com', path: '/', secure: true, httpOnly: true },
    { name: 'unrelated', value: 'ignored', domain: '.example.com', path: '/' },
  ]))
  assert.equal(cookies.length, 1)
  assert.equal(cookies[0].domain, '.chatgpt.com')

  const projectId = 'g-p-project123'
  assert.equal(extractProjectIdFromResourceUrls([
    'https://chatgpt.com/backend-api/gizmos/g-p-project123/conversations?cursor=0',
  ]), projectId)
  assert.equal(extractProjectIdFromResourceUrls(['https://chatgpt.com/backend-api/conversations']), null)
  assert.equal(conversationBelongsToProject({ gizmo_id: projectId }, projectId), true)
  assert.equal(conversationBelongsToProject({ gizmo_id: null }, projectId), false)

  const profile = await mkdtemp(path.join(tmpdir(), 'video-player-edge-probe-'))
  try {
    const url = 'data:text/html,<title>Player browser connection</title><p>Local fixture</p>'
    const result = await probeEdgeUrl(profile, url, 'background-window')
    assert.equal(result.title, 'Player browser connection')
    assert.equal(new URL(result.url).protocol, 'data:')
    console.log('edge-cdp: real Edge startup, loopback connection, local navigation and shutdown passed; no account or cloud requests')
  } finally {
    await removeProfile(profile)
  }
}

void main()
