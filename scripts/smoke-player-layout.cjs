// Run with Node after build:app. It supervises real Electron and cleans its own isolated fixture.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (typeof electron === 'string') {
  const { spawn } = require('node:child_process');
  const root = path.resolve(__dirname, '..');
  const work = path.join(root, 'work');
  const output = path.resolve(process.env.ZHIMU_QA_OUTPUT || path.join(root, 'outputs', 'layout-verification'));
  const prefix = process.argv.includes('--expect-failure') ? 'player-layout-before' : 'player-layout';
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(work, 'player-layout-'));
  const env = { ...process.env, ZHIMU_LAYOUT_SCRATCH: scratch };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const child = spawn(electron, [__filename, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('close', async code => {
    let cleanupError;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        assert.equal(path.dirname(path.resolve(scratch)), work);
        assert(path.basename(scratch).startsWith('player-layout-'));
        if (fs.existsSync(scratch)) {
          assert.equal(fs.realpathSync(scratch), scratch, 'cleanup cannot follow a redirected fixture root');
          fs.rmSync(scratch, { recursive: true, force: true });
        }
        cleanupError = undefined; break;
      } catch (error) { cleanupError = String(error); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const reportPath = path.join(output, prefix + '.json');
    let report;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch {}
    if (!report || report.scratch !== scratch) report = { passed: false, fatal: 'Electron did not finish this layout fixture', scratch };
    report.cleanup = { removed: !fs.existsSync(scratch), error: cleanupError, afterElectronExit: true };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.exitCode = code === 0 && !cleanupError && report.cleanup.removed ? 0 : 1;
  });
  return;
}
const { app, BrowserWindow, ipcMain } = electron;
if (!app) throw new Error('Run with Node: node scripts/smoke-player-layout.cjs');
const root = path.resolve(__dirname, '..');
const expectFailure = process.argv.includes('--expect-failure');
const output = path.resolve(process.env.ZHIMU_QA_OUTPUT || path.join(root, 'outputs', 'layout-verification'));
const prefix = expectFailure ? 'player-layout-before' : 'player-layout';
const entry = process.env.ZHIMU_SMOKE_ENTRY || path.join(root, 'dist/main/index.js');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const scratch = path.resolve(process.env.ZHIMU_LAYOUT_SCRATCH || '');
assert.equal(path.dirname(scratch), path.join(root, 'work'), 'the Node supervisor owns this fixture directory');
assert(path.basename(scratch).startsWith('player-layout-'));
const profile = path.join(scratch, 'video-player');
const mediaDirectory = path.join(scratch, 'synthetic-media');
fs.mkdirSync(profile); fs.mkdirSync(mediaDirectory);
app.disableHardwareAcceleration();
app.setPath('appData', scratch); app.setPath('userData', profile); app.setPath('sessionData', profile);
// Four-second H.264 fixture with no audio track. No external media tools are needed.
const landscapeVideo = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQjbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAD6AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA010cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAA+gAAAQAAABAAAAAALFbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAoABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACcG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAjBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UKN+TARAAADAAEAAAMACg8SJZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAACCAAAAAAAAAAGHN0dHMAAAAAAAAAAQAAABQAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACoY3R0cwAAAAAAAAATAAAAAQAAEAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACAAAAAAAgAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALqAAAAEAAAAA0AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAADwAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAABRzdGNvAAAAAAAAAAEAAARTAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAABBhtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA1ZYiEABT//uzafgU2x645wRdyETtyupp6Ymdi5vpKRwBhXtTLANYHwKaOp7myBIwAECA2ceEAAAAMQZokbEE//rUqgB4wAAAACUGeQniCHwAg4QAAAAkBnmF0Q/8ASUAAAAAJAZ5jakP/AElBAAAAEkGaaEmoQWiZTAgn//61KoAeMQAAAAtBnoZFESwQ/wAg4QAAAAkBnqV0Q/8ASUEAAAAJAZ6nakP/AElAAAAAEkGarEmoQWyZTAgn//61KoAeMAAAAAtBnspFFSwQ/wAg4QAAAAkBnul0Q/8ASUAAAAAJAZ7rakP/AElAAAAAEkGa8EmoQWyZTAgl//61KoAeMQAAAAtBnw5FFSwQ/wAg4QAAAAkBny10Q/8ASUEAAAAJAZ8vakP/AElAAAAAEkGbM0moQWyZTAh///6plgDmgAAAAAtBn1FFFSwQ/wAg4QAAAAkBn3JqQ/8ASUA=', 'base64');
const portraitVideo = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQjbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAD6AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA010cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAFoAAACgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAA+gAAAQAAABAAAAAALFbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAoABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACcG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAjBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAFoAoABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UYV5PARAAADAAEAAAMACg8SJZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAACB4AAAAAAAAAGHN0dHMAAAAAAAAAAQAAABQAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACoY3R0cwAAAAAAAAATAAAAAQAAEAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACAAAAAAAgAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALpAAAAEAAAAA0AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAADwAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAABRzdGNvAAAAAAAAAAEAAARTAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAABBdtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTUgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA0ZYiEABT//uzafgU2waV5kX/M7q3K6mnpiZ2LmpZnXTCkRszwvxT+OoOimfADrBKzGrUSQQAAAAxBmiRsQT/+tSqAHjAAAAAJQZ5CeIIfACDhAAAACQGeYXRD/wBJQAAAAAkBnmNqQ/8ASUEAAAASQZpoSahBaJlMCCf//rUqgB4xAAAAC0GehkURLBD/ACDhAAAACQGepXRD/wBJQQAAAAkBnqdqQ/8ASUAAAAASQZqsSahBbJlMCCf//rUqgB4wAAAAC0GeykUVLBD/ACDhAAAACQGe6XRD/wBJQAAAAAkBnutqQ/8ASUAAAAASQZrwSahBbJlMCCX//rUqgB4xAAAAC0GfDkUVLBD/ACDhAAAACQGfLXRD/wBJQQAAAAkBny9qQ/8ASUAAAAASQZszSahBbJlMCH///qmWAOaAAAAAC0GfUUUVLBD/ACDhAAAACQGfcmpD/wBJQA==', 'base64');
const filenames = Array.from({ length: 48 }, (_, i) => `Part-${String(i + 1).padStart(2, '0')}-Synthetic-learning-片段.mp4`);
const timestamp = seconds => '00:' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') + ',000';
const subtitles = Array.from({ length: 100 }, (_, i) => `${i + 1}\n${timestamp(i * 2)} --> ${timestamp(i * 2 + 1)}\nSynthetic subtitle ${i + 1}. Long learning material stays in this internal list. 这是较长的合成字幕，用来检查内容是否只在侧栏内部滚动。\n`).join('\n');
for (const filename of filenames) {
  fs.writeFileSync(path.join(mediaDirectory, filename), filename === filenames[1] ? portraitVideo : landscapeVideo);
  fs.writeFileSync(path.join(mediaDirectory, filename.replace(/\.mp4$/, '.srt')), subtitles);
}
const guidePath = path.join(mediaDirectory, 'Synthetic.Guide.Layout.en.20260915-120000.md');
const guideText = '<!-- ai-video-player-guide:' + JSON.stringify({ version: 1, parts: filenames }) + ' -->\n\n'
  + Array.from({ length: 60 }, (_, i) => `### Topic ${i + 1} 合成导读 [P1-00:00:01]\nA detailed learning paragraph checks layout with long content. `
    + 'The video and playback controls must stay in the available workspace while the guide scrolls independently. '.repeat(3)
    + '长导读只应在内部滚动，不应改变视频区域高度。\n').join('\n');
fs.writeFileSync(guidePath, guideText);
fs.writeFileSync(path.join(profile, 'locale.json'), JSON.stringify({ language: 'en' }));
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ setupCompleted: true, provider: 'chatgpt-web', chatGptTier: 'pro', guideLanguage: 'en' }));
const playlistId = 'folder:' + mediaDirectory.replaceAll('\\', '/').toLowerCase();
fs.writeFileSync(path.join(profile, 'player-state.json'), JSON.stringify({ version: 1, activePlaylistId: playlistId,
  volume: 0, muted: true, autoplayNext: false, alwaysOnTop: false, drawer: { pinned: true, width: 405 },
  subtitleStyle: { visible: true, size: 22, verticalPosition: 10, backgroundOpacity: .58 },
  playlists: { [playlistId]: { id: playlistId, sourcePath: mediaDirectory, sourceKind: 'folder', displayName: 'Synthetic layout fixture',
    activeVideoPath: path.join(mediaDirectory, filenames[0]), activeDrawerTab: 'playlist', activeGuidePath: guidePath,
    playbackRate: 1, videos: filenames.map((filename, order) => ({ videoPath: path.join(mediaDirectory, filename), order,
      lastPosition: 0, duration: 4, subtitleOffset: 0, completed: false, isNew: false })) } }, updatedAt: new Date().toISOString(),
}));
const cases = [], issues = [], rendererErrors = [], resizeEvents = [];
let cloudAttempts = 0, blockedNetworkRequests = 0, finished = false;
app.on('web-contents-created', (_event, contents) => contents.session.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => { blockedNetworkRequests++; callback({ cancel: true }); }));
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('render-process-gone', (_e, details) => rendererErrors.push(details));
  window.webContents.on('did-fail-load', (_e, code, description) => rendererErrors.push({ code, description }));
});
require(entry);
assert.equal(app.getPath('userData'), profile);
assert.equal(app.getPath('sessionData'), profile);
for (const channel of ['chatgpt-login', 'chatgpt-probe', 'chatgpt-generate-guide', 'asr-login', 'asr-probe', 'asr-start', 'api-guide', 'api-models']) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async () => { cloudAttempts++; throw new Error('No cloud or account calls in the layout fixture'); });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const guard = setTimeout(() => finish('Layout fixture timed out'), 120000);
function finish(fatal) {
  if (finished) return; finished = true; clearTimeout(guard);
  const passed = !fatal && issues.length === 0 && cloudAttempts === 0 && blockedNetworkRequests === 0 && rendererErrors.length === 0;
  const reproduced = expectFailure && !fatal && issues.length > 0;
  const report = { passed, expectFailure, expectedFailureConfirmed: reproduced,
    fatal, sourceVersion: require('../package.json').version, entry, loadedEntrySha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(entry)).digest('hex'), scratch, isolatedAppData: true, realCloudCalls: false,
    cloudAttempts, blockedNetworkRequests, rendererErrors, fixture: { videos: filenames.length, subtitleEntries: 100, guideSections: 60, audioTrack: false, landscape: [160, 90], portrait: [90, 160] },
    cases, issues, resizeEvents, normalWindowClose: false,
  };
  const writeReport = () => fs.writeFileSync(path.join(output, prefix + '.json'), JSON.stringify(report, null, 2));
  writeReport();
  console.log((passed ? 'PASS' : reproduced ? 'REPRODUCED' : 'FAIL') + ': ' + prefix + ' (' + cases.length + ' cases, ' + issues.length + ' layout issues)');
  const closeGuard = setTimeout(() => { report.fatal = 'The fixture window did not close normally'; writeReport(); app.exit(1); }, 8000);
  app.once('will-quit', event => {
    clearTimeout(closeGuard); event.preventDefault();
    report.normalWindowClose = BrowserWindow.getAllWindows().length === 0;
    writeReport(); app.exit((expectFailure ? reproduced : passed) && report.normalWindowClose ? 0 : 1);
  });
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) app.quit(); else for (const window of windows) window.close();
}
async function main() {
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0]; assert(win);
  // The test chooses window sizes itself. Prevent unrelated pointer activity from resizing this
  // visible synthetic window while app-level sidebar dragging and all renderer controls stay real.
  win.setResizable(false); win.setMaximizable(false); win.setMovable(false); win.setSkipTaskbar(true);
  const js = code => win.webContents.executeJavaScript(code, true);
  async function waitFor(code, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await js(code)) return; await pause(80); }
    throw new Error('Timed out: ' + label);
  }
  await waitFor(`document.querySelectorAll('.playlist-item').length === 48 && document.querySelector('video')?.readyState >= 1`, 'synthetic playlist and decoded video');
  await js(`document.querySelector('video').muted=true;document.querySelector('video').volume=0;document.querySelector('video').pause()`);
  const click = selector => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click()})()`);
  const tab = async index => { await js(`document.querySelectorAll('.drawer-tab')[${index}].click()`); await pause(250); };
  async function language(value) {
    await js(`(()=>{const b=[...document.querySelectorAll('.title-bar-controls button')].find(b=>/Settings|设置/.test(b.title));if(!b)throw Error('Missing settings');b.click()})()`);
    await waitFor(`!!document.querySelector('.setup-dialog')`, 'settings dialog');
    await click('[data-ui-language="' + value + '"]');
    await click('.setup-dialog .modal-close');
    await waitFor(`document.documentElement.lang === '${value}' && !document.querySelector('.setup-dialog')`, 'language change');
  }
  async function pinned(value) {
    win.focus();
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 30, y: 180 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: win.getContentSize()[0] - 1, y: 180 });
    await pause(200);
    const current = await js(`document.querySelector('.right-drawer').classList.contains('is-pinned')`);
    if (current !== value) await click('.drawer-pin');
    await pause(230);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: win.getContentSize()[0] - 20, y: 100 });
    await pause(170);
  }
  async function resizeDrawer(width) {
    win.focus();
    await pause(80);
    const size = win.getContentSize();
    // Use the handle's inner edge, away from the neighboring video/grid boundary and header controls.
    const rect = await js(`(()=>{const r=document.querySelector('.drawer-resize-handle').getBoundingClientRect();const x=Math.floor(r.right-1),y=Math.round(r.y+Math.min(180,r.height/2));return {x,y,hit:document.elementFromPoint(x,y)?.className,before:document.querySelector('.right-drawer').getBoundingClientRect().width}})()`);
    assert.equal(rect.hit, 'drawer-resize-handle', 'the real pointer must hit the resize handle: ' + JSON.stringify(rect));
    win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    await pause(35);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: rect.x, y: rect.y });
    await pause(80);
    const resizing = await js(`document.querySelector('.right-drawer').classList.contains('is-resizing')`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: size[0] - width, y: rect.y, modifiers: ['leftButtonDown'] });
    await pause(100);
    const during = await js(`document.querySelector('.right-drawer').getBoundingClientRect().width`);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: size[0] - width, y: rect.y });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: size[0] - 20, y: 100 });
    await pause(250);
    resizeEvents.push({ viewport: size, requested: width, before: rect.before, pointerHit: rect.hit, focused: win.isFocused(), resizing, during,
      after: await js(`document.querySelector('.right-drawer').getBoundingClientRect().width`) });
  }
  const measure = async selector => js(`(()=>{
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const stage=document.querySelector('.video-stage'),video=document.querySelector('video'),controls=document.querySelector('.player-controls'),drawer=document.querySelector('.right-drawer');
    const scroller=document.querySelector(${JSON.stringify(selector)});
    let scrolling=null;if(scroller){const old=scroller.scrollTop;scroller.scrollTo({top:Math.min(200,scroller.scrollHeight-scroller.clientHeight),behavior:'instant'});scrolling={clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,scrollTop:scroller.scrollTop,overflowY:getComputedStyle(scroller).overflowY,rect:rect(scroller)};scroller.scrollTo({top:old,behavior:'instant'})}
    const interactive=[...controls.querySelectorAll('button,input,select,.time-display')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}).map(el=>({label:el.title||el.getAttribute('aria-label')||el.className,rect:rect(el)}));
    return {viewport:{x:0,y:0,width:innerWidth,height:innerHeight,right:innerWidth,bottom:innerHeight},workspace:rect(document.querySelector('.playback-workspace')),stage:rect(stage),video:rect(video),intrinsicVideo:[video.videoWidth,video.videoHeight],objectFit:getComputedStyle(video).objectFit,controls:rect(controls),controlsOpacity:Number(getComputedStyle(controls).opacity),drawer:rect(drawer),drawerOpen:drawer.classList.contains('is-open'),drawerPinned:drawer.classList.contains('is-pinned'),scrolling,interactive,muted:video.muted,volume:video.volume,paused:video.paused,subtitleCount:document.querySelectorAll('.subtitle-item').length,guideSections:document.querySelectorAll('.guide-document h3').length,bodyScrollHeight:document.body.scrollHeight};
  })()`);
  const contains = (outer, inner) => outer && inner && inner.x >= outer.x - 2 && inner.y >= outer.y - 2 && inner.right <= outer.right + 2 && inner.bottom <= outer.bottom + 2;
  const stable = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 2);
  async function sample(name, selector, baseline, requested) {
    await js(`document.querySelector('.video-stage').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:30,clientY:100}))`);
    await pause(220);
    const geometry = await measure(selector);
    const found = [];
    if (geometry.viewport.width !== requested.width || geometry.viewport.height !== requested.height) found.push('viewport-size');
    if (Math.abs(geometry.drawer.width - requested.drawerWidth) > 2 || geometry.drawerPinned !== requested.pinned) found.push('drawer-resize-or-mode-not-applied');
    if (geometry.objectFit !== 'contain' || geometry.intrinsicVideo.join('x') !== (requested.portrait ? '90x160' : '160x90')) found.push('video-intrinsic-size-or-aspect-ratio');
    for (const key of ['workspace', 'stage', 'video', 'controls', 'drawer']) if (!contains(geometry.viewport, geometry[key])) found.push(key + '-outside-viewport');
    for (const key of ['stage', 'video', 'controls', 'drawer']) if (!contains(geometry.workspace, geometry[key])) found.push(key + '-outside-workspace');
    if (!contains(geometry.stage, geometry.video) || !contains(geometry.stage, geometry.controls)) found.push('video-or-controls-outside-stage');
    if (geometry.controlsOpacity < .99) found.push('playback-controls-not-visible');
    for (const control of geometry.interactive) if (!contains(geometry.viewport, control.rect) || !contains(geometry.stage, control.rect)) found.push('control-outside:' + control.label);
    if (baseline) for (const key of ['stage', 'video', 'controls']) if (!stable(baseline[key], geometry[key])) found.push('tab-changed-' + key);
    if (!geometry.scrolling || geometry.scrolling.scrollHeight <= geometry.scrolling.clientHeight + 1 || geometry.scrolling.scrollTop <= 0 || !/auto|scroll/.test(geometry.scrolling.overflowY)) found.push('long-content-does-not-scroll-internally');
    if (!geometry.drawerOpen) found.push('drawer-not-open');
    if (!geometry.muted || geometry.volume !== 0 || !geometry.paused) found.push('fixture-not-silent-and-paused');
    const screenshot = prefix + '-' + name + '.png';
    fs.writeFileSync(path.join(output, screenshot), (await win.webContents.capturePage()).toPNG());
    cases.push({ name, requested, geometry, issues: found, screenshot });
    issues.push(...found.map(issue => ({ case: name, issue })));
    return geometry;
  }
  const sizes = expectFailure ? [[900, 600]] : [[900, 600], [1440, 1000]];
  for (const [width, height] of sizes) {
    win.setContentSize(width, height); await pause(300);
    for (const locale of expectFailure ? ['en'] : ['en', 'zh-CN']) {
      await language(locale);
      for (const fixed of expectFailure ? [true] : [true, false]) {
        await pinned(fixed);
        for (const drawerWidth of expectFailure ? [405] : [300, Math.floor(width * .45)]) {
          await resizeDrawer(drawerWidth);
          const name = `${width}x${height}-${locale}-${fixed ? 'pinned' : 'floating'}-${drawerWidth}`;
          const requested = { width, height, locale, pinned: fixed, drawerWidth };
          await tab(0);
          const baseline = await sample(name + '-playlist', '.playlist-list', null, requested);
          await tab(1); await waitFor(`document.querySelectorAll('.subtitle-item').length===100`, 'long subtitles');
          await sample(name + '-subtitles', '.subtitle-list', baseline, requested);
          await tab(2); await waitFor(`document.querySelectorAll('.guide-document h3').length===60`, 'long guide');
          await sample(name + '-guide', '.guide-content', baseline, requested);
          if (!expectFailure) {
            await click('.guide-version-row .text-button');
            await waitFor(`!!document.querySelector('.guide-editor')`, 'guide edit mode');
            await js(`(()=>{const el=document.querySelector('.guide-editor');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,el.value+'\\nLayout edit fixture.');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
            await sample(name + '-guide-edit', '.guide-editor', baseline, requested);
            await click('.guide-version-row .text-button');
          }
        }
      }
    }
  }
  if (!expectFailure) {
    win.setContentSize(900, 600); await pause(250);
    await language('zh-CN'); await pinned(true); await resizeDrawer(405); await tab(0);
    await js(`document.querySelectorAll('.playlist-item')[1].click()`);
    await waitFor(`document.querySelector('video')?.videoWidth===90 && document.querySelector('video')?.videoHeight===160`, 'real portrait video metadata');
    await js(`document.querySelector('video').muted=true;document.querySelector('video').volume=0;document.querySelector('video').pause()`);
    const requested = { width: 900, height: 600, locale: 'zh-CN', pinned: true, drawerWidth: 405, portrait: true };
    const name = '900x600-zh-CN-pinned-405-portrait';
    const baseline = await sample(name + '-playlist', '.playlist-list', null, requested);
    await tab(1); await sample(name + '-subtitles', '.subtitle-list', baseline, requested);
    await tab(2); await sample(name + '-guide', '.guide-content', baseline, requested);
    await click('.guide-version-row .text-button');
    await sample(name + '-guide-edit', '.guide-editor', baseline, requested);
    await click('.guide-version-row .text-button');
  }
  if (!expectFailure) { await pause(600); assert(fs.readFileSync(guidePath, 'utf8').includes('Layout edit fixture.'), 'guide edits use the real local save path'); }
  assert.equal(cloudAttempts, 0); assert.equal(blockedNetworkRequests, 0); assert.deepEqual(rendererErrors, []);
  finish();
}
main().catch(error => finish(error.stack || String(error)));
