// Run with the project's Electron after build:app. Every account and service result is synthetic.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!app) throw new Error('Run this check with Electron, not Node.');
const root = path.resolve(__dirname, '..');
const mode = process.env.ZHIMU_SMOKE_MODE || 'upgrade';
if (!['fresh', 'upgrade'].includes(mode)) throw new Error('Unknown smoke mode');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, 'work', 'desktop-smoke-'));
const profile = path.join(scratch, 'video-player'); fs.mkdirSync(profile);
const output = path.resolve(process.env.ZHIMU_QA_OUTPUT || path.join(root, 'outputs', 'desktop-verification'));
fs.mkdirSync(output, { recursive: true });
app.disableHardwareAcceleration();
// Set appData, not just userData: production startup pins both data roots for rename compatibility.
app.setPath('appData', scratch);
app.setPath('userData', profile); app.setPath('sessionData', profile);
fs.writeFileSync(path.join(profile, 'locale.json'), JSON.stringify({ language: 'en' }));
const media = path.join(scratch, 'sample.mp4');
fs.writeFileSync(media, Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQibW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAD6AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA0x0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAA+gAAAQAAABAAAAAALEbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAoABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACb21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAi9zdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UlsBEAAAAMAQAAAAwKDxIllgAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAHrAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAFAAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAKhjdHRzAAAAAAAAABMAAAABAAAQAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAIAAAAAACAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAFAAAAAEAAABkc3RzegAAAAAAAAAAAAAAFAAAAs0AAAANAAAADAAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAAFHN0Y28AAAAAAAAAAQAABFIAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMgAAAAhmcmVlAAAD3m1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABhliIQAFP/+7Np+BTceHbfEcjbcrj4CWfEAAAAJQZokbEE//rXAAAAACEGeQniCHzUhAAAACAGeYXRD/0RAAAAACAGeY2pD/0RBAAAAD0GaaEmoQWiZTAgn//61wQAAAApBnoZFESwQ/zUhAAAACAGepXRD/0RBAAAACAGep2pD/0RAAAAAD0GarEmoQWyZTAgn//61wAAAAApBnspFFSwQ/zUhAAAACAGe6XRD/0RAAAAACAGe62pD/0RAAAAAD0Ga8EmoQWyZTAgl//61wQAAAApBnw5FFSwQ/zUhAAAACAGfLXRD/0RBAAAACAGfL2pD/0RAAAAAD0GbM0moQWyZTAh///6rgAAAAApBn1FFFSwQ/zUhAAAACAGfcmpD/0RA', 'base64'));
fs.writeFileSync(path.join(scratch, 'sample.srt'), '1\n00:00:00,000 --> 00:00:03,000\nExisting subtitle fixture 原始字幕\n');
const guidePath = path.join(scratch, 'sample.Guide.ChatGPT-Astra-Pro.en.20260914-120000.md');
const guideText = '<!-- ai-video-player-guide:{"version":1,"parts":["sample.mp4"]} -->\n\n### Existing topic [P1-00:00:01]\nExisting guide fixture 原始导读\n';
const playlistId = 'single-video:' + media.replaceAll('\\', '/').toLowerCase();
if (mode === 'upgrade') {
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ provider: 'chatgpt-web', chatGptTier: 'pro', chatGptProject: '', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'fixture-manual-model', apiKey: 'fixture-upgrade-key', setupCompleted: true, guideLanguage: 'en', asrLanguage: 'en' }));
  fs.writeFileSync(guidePath, guideText);
  fs.writeFileSync(path.join(profile, 'player-state.json'), JSON.stringify({ version: 1, activePlaylistId: playlistId, volume: 0, muted: true, autoplayNext: false, alwaysOnTop: false, drawer: { pinned: true, width: 420 }, subtitleStyle: { visible: true, size: 22, verticalPosition: 10, backgroundOpacity: .58 }, playlists: { [playlistId]: { id: playlistId, sourcePath: media, sourceKind: 'single-video', displayName: 'Sample fixture', activeVideoPath: media, activeDrawerTab: 'guide', activeGuidePath: guidePath, playbackRate: 1.5, videos: [{ videoPath: media, order: 0, lastPosition: 2, duration: 4, subtitleOffset: .25, completed: false, isNew: false }] } }, updatedAt: new Date().toISOString() }));
}
const errors = [];
let cloudAttempts = 0, listCalls = 0;
app.on('browser-window-created', (_event, window) => {
  window.hide();
  window.webContents.on('console-message', (_e, details) => { if (details.level === 'error') errors.push(details.message); });
});
require(process.env.ZHIMU_SMOKE_ENTRY || path.join(root, 'dist/main/index.js'));
assert.equal(app.getPath('userData'), profile);
assert.equal(app.getPath('sessionData'), profile);
for (const name of ['chatgpt-login', 'chatgpt-probe', 'asr-login', 'asr-probe', 'asr-start', 'api-guide', 'chatgpt-generate-guide']) {
  ipcMain.removeHandler(name);
  ipcMain.handle(name, async () => { cloudAttempts++; throw new Error('Real cloud calls are forbidden in this local fixture'); });
}
ipcMain.removeHandler('api-models');
ipcMain.handle('api-models', async () => { listCalls++; return { source: 'live', models: ['deepseek-flash', 'fixture-manual-model'], fetchedAt: new Date().toISOString() }; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => finish(false, 'desktop test timed out'), 30000);
function finish(passed, error) {
  clearTimeout(timeout);
  fs.writeFileSync(path.join(output, mode + '-desktop.json'), JSON.stringify({ passed, error, mode, version: require('../package.json').version, packagedEntry: !!process.env.ZHIMU_SMOKE_ENTRY, isolatedAppData: true, stableUserDataAndSessionData: true, legacyStateFixture: mode === 'upgrade', cloudAttempts, realCloudCalls: false, simulatedModelListCalls: listCalls, consoleErrors: errors }, null, 2));
  app.exit(passed ? 0 : 1);
}
async function main() {
  await app.whenReady(); await pause(900);
  const win = BrowserWindow.getAllWindows()[0]; assert(win); win.showInactive(); await pause(150);
  const js = code => win.webContents.executeJavaScript(code, true);
  const click = label => js(`(()=>{const el=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('Missing button: '+${JSON.stringify(label)});el.click()})()`);
  const switchLanguage = language => js(`document.querySelector('[data-ui-language="${language}"]').click()`);
  const shot = async name => { await pause(120); fs.writeFileSync(path.join(output, mode + '-' + name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const body = () => js('document.body.innerText');
  assert.equal(await js('document.title'), '知幕 Zhimu Player');
  if (mode === 'fresh') {
    assert.match(await body(), /Zhimu Player/);
    assert(await js(`!!document.querySelector('.setup-dialog')`));
    await shot('welcome-English');
    await switchLanguage('zh-CN'); await pause(100); assert.match(await body(), /知幕/); await shot('welcome-Chinese');
    await switchLanguage('en'); await pause(50); await click('Skip for now'); await pause(200);
    assert.match(await body(), /Find your way through long videos/);
  } else {
    assert(!await js(`!!document.querySelector('.setup-dialog')`), 'an existing setup must not be reset');
    assert.match(await body(), /Existing guide fixture 原始导读/);
    assert(!await js(`document.querySelector('.guide-document').innerText.includes('ai-video-player-guide:')`));
    assert.equal(await js(`document.querySelector('.guide-language-control select').value`), 'en');
    assert.equal(await js(`document.querySelector('video').playbackRate`), 1.5);
    assert(Math.abs(await js(`document.querySelector('video').currentTime`) - 2) < .3);
    const stored = JSON.parse(fs.readFileSync(path.join(profile, 'config.json')));
    assert(stored.apiKeyEncrypted && !stored.apiKey, 'the synthetic legacy key migrates to native encryption');
    await shot('existing-guide');
  }
  await js(`document.querySelector('.title-bar-controls button[title="Settings & about"]').click()`); await pause(100);
  assert.match(await body(), /Zhimu Player/);
  if (mode === 'upgrade') {
    assert.equal(await js(`document.querySelector('#chat-tier').value`), 'pro');
    assert.equal(await js(`document.querySelector('#asr-language').value`), 'en');
    await js(`document.querySelectorAll('.setup-source')[1].click()`); await pause(350);
    assert.equal(await js(`document.querySelector('#api-key').value`), '');
    assert.equal(await js(`document.querySelector('#api-model').value`), 'fixture-manual-model');
    assert.equal(listCalls, 1);
    await shot('models-English');
  }
  await switchLanguage('zh-CN'); await pause(100); assert.match(await body(), /知幕/);
  win.setContentSize(900, 600); await shot('settings-Chinese-900x600');
  assert(await js(`document.querySelector('.setup-dialog').scrollWidth <= document.querySelector('.setup-dialog').clientWidth + 1`));
  await switchLanguage('en'); await pause(80);
  await click('About & support'); await pause(100);
  assert.match(await body(), /Zhimu Player/); assert((await body()).includes(require('../package.json').version)); assert.match(await body(), /Release candidate/);
  assert.match(await js(`document.querySelector('.about-contact-card img').alt`), /OJY/);
  await shot('about-English');
  await js(`document.querySelector('.about-contact-card').click()`); await pause(80);
  assert.match(await js(`document.querySelector('.about-wechat-full').alt`), /OJY/);
  await shot('contact-OJY'); await click('Back to about'); await pause(60);
  await click('Support development'); await pause(80); await shot('support-English');
  win.reload(); await pause(750);
  assert.equal(app.getPath('userData'), profile);
  assert.equal(await js('document.documentElement.lang'), 'en');
  if (mode === 'upgrade') {
    assert.match(await body(), /Existing guide fixture 原始导读/);
    assert.equal(fs.readFileSync(guidePath, 'utf8'), guideText, 'renaming preserves the existing guide bytes');
    assert.equal((await js('window.electronAPI.loadConfig()')).apiKey, '');
  }
  assert.equal(cloudAttempts, 0); assert.deepEqual(errors, []);
  finish(true);
}
main().catch(error => finish(false, error.stack));
