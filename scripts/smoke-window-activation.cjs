// Node supervises a hidden Windows launch of real Electron. All data belongs to this fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = process.env.ZHIMU_WINDOW_ACTIVATION_STAGE;
const output = path.resolve(process.env.ZHIMU_QA_OUTPUT || path.join(root, 'outputs', 'desktop-verification'));
const resultFile = path.join(output, 'window-activation.json');
const entry = path.resolve(process.env.ZHIMU_SMOKE_ENTRY || path.join(root, 'dist', 'main', 'index.js'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return; await pause(50); }
  throw new Error('Timed out: ' + label);
}

function nativeState(window) {
  const handle = window.getNativeWindowHandle();
  const value = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
  assert.match(value, /^\d+$/);
  const source = 'using System; using System.Runtime.InteropServices; public static class FixtureWindow { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }';
  const command = `Add-Type -TypeDefinition '${source}'; $fixtureHandle = [IntPtr]::new([long]${value}); @{ visible = [FixtureWindow]::IsWindowVisible($fixtureHandle); minimized = [FixtureWindow]::IsIconic($fixtureHandle) } | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 10000,
  }).trim());
}

if (!stage) {
  if (process.versions.electron) throw new Error('Run this check with Node: node scripts/smoke-window-activation.cjs');
  if (process.platform !== 'win32') throw new Error('This hidden-launch regression checks Windows startup behavior.');
  if (!fs.existsSync(entry)) throw new Error('Run npm run build:app first.');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(root, 'work', 'window-activation-'));
  const profile = path.join(scratch, 'video-player');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'locale.json'), JSON.stringify({ language: 'en' }));
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ setupCompleted: true, provider: 'chatgpt-web', chatGptTier: 'pro' }));
  const electronPath = require('electron');
  assert.equal(typeof electronPath, 'string');
  const env = { ...process.env, ZHIMU_WINDOW_ACTIVATION_STAGE: 'primary',
    ZHIMU_WINDOW_ACTIVATION_PROFILE: scratch, ZHIMU_QA_OUTPUT: output, ZHIMU_SMOKE_ENTRY: entry };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  // Literal PowerShell strings preserve spaces and never interpret embedded $, backticks or commands.
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `$ErrorActionPreference = 'Stop'; $fixtureProcess = Start-Process -FilePath ${literal(electronPath)} -ArgumentList ${literal('"' + __filename + '"')} -WorkingDirectory ${literal(root)} -WindowStyle Hidden -PassThru -Wait; exit $fixtureProcess.ExitCode`;
  const launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: root, env, windowsHide: true, stdio: 'inherit',
  });
  launcher.on('error', error => {
    fs.writeFileSync(resultFile, JSON.stringify({ passed: false, error: error.message, isolatedAppData: true }, null, 2));
    process.exitCode = 1;
  });
  launcher.on('exit', code => {
    let result;
    try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch {}
    const current = result && result.scratch === scratch;
    if (code !== 0 || !current || !result.passed) {
      if (!current) fs.writeFileSync(resultFile, JSON.stringify({ passed: false, error: 'Hidden Electron launch did not finish this fixture', code, scratch }, null, 2));
      console.error('Window activation check failed:', resultFile);
      process.exitCode = 1;
    } else console.log('Window activation passed: real hidden startup and real second-instance restoration; no user profile or cloud service used.');
  });
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  if (!app) throw new Error('Fixture child must run under Electron.');
  const scratch = path.resolve(process.env.ZHIMU_WINDOW_ACTIVATION_PROFILE || '');
  assert.equal(path.dirname(scratch), path.join(root, 'work'), 'fixture profile stays under this project work directory');
  assert(path.basename(scratch).startsWith('window-activation-'));
  const profile = path.join(scratch, 'video-player');
  app.disableHardwareAcceleration();
  app.setPath('appData', scratch);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  if (stage === 'secondary') {
    // The production single-instance lock must terminate this process. No event is simulated.
    const guard = setTimeout(() => app.exit(2), 10000);
    guard.unref();
    app.on('browser-window-created', () => app.exit(2));
    require(entry);
  } else {
    assert.equal(stage, 'primary');
    const checks = [], windowEvents = [], rendererErrors = [];
    const secondaryProcesses = new Set();
    let window, createdHidden = false, readyObserved = false, secondInstances = 0;
    let blockedNetworkRequests = 0, cloudAttempts = 0, finished = false;
    app.on('web-contents-created', (_event, contents) => {
      contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
        blockedNetworkRequests++; callback({ cancel: true });
      });
    });
    app.on('browser-window-created', (_event, candidate) => {
      assert.equal(window, undefined, 'the primary process creates only one application window');
      window = candidate;
      createdHidden = !candidate.isVisible();
      candidate.once('ready-to-show', () => { readyObserved = true; windowEvents.push('ready-to-show'); });
      for (const event of ['show', 'hide', 'minimize', 'restore']) candidate.on(event, () => windowEvents.push(event));
      candidate.webContents.on('did-finish-load', () => windowEvents.push('did-finish-load'));
      candidate.webContents.on('did-fail-load', (_event, code, description) => rendererErrors.push({ code, description }));
      candidate.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(details));
    });
    app.on('second-instance', () => { secondInstances++; });
    const guard = setTimeout(() => finish(false, 'Window activation test timed out'), 45000);
    function finish(passed, error) {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      for (const child of secondaryProcesses) { if (child.exitCode === null) child.kill(); }
      let finalWindow = null;
      try {
        if (window && !window.isDestroyed()) finalWindow = { createdHidden, readyObserved, visible: window.isVisible(), minimized: window.isMinimized(),
          loading: window.webContents.isLoading(), url: window.webContents.getURL(), native: nativeState(window) };
      } catch (inspectionError) { finalWindow = { inspectionError: String(inspectionError) }; }
      fs.writeFileSync(resultFile, JSON.stringify({
        passed, error, version: require('../package.json').version, entry, scratch,
        primaryPid: process.pid, hiddenWindowsLaunch: true, isolatedAppData: true,
        realSecondInstanceProcesses: true, realCloudCalls: false, blockedNetworkRequests, cloudAttempts,
        secondInstanceEvents: secondInstances, checks, windowEvents, rendererErrors, finalWindow,
      }, null, 2));
      // Exit only this fixture process. Its profile is synthetic; user app and accounts are untouched.
      app.exit(passed ? 0 : 1);
    }
    require(entry);
    assert.equal(app.getPath('userData'), profile);
    assert.equal(app.getPath('sessionData'), profile);
    for (const channel of ['chatgpt-login', 'chatgpt-probe', 'asr-login', 'asr-probe', 'asr-start', 'api-guide', 'api-models', 'chatgpt-generate-guide']) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async () => { cloudAttempts++; throw new Error('Account and cloud work is forbidden in this fixture'); });
    }
    async function launchSecondInstance(label) {
      const expectedEvents = secondInstances + 1;
      const child = spawn(process.execPath, [__filename, '--activation-case=' + label], {
        cwd: root, env: { ...process.env, ZHIMU_WINDOW_ACTIVATION_STAGE: 'secondary' }, windowsHide: true, stdio: 'ignore',
      });
      secondaryProcesses.add(child);
      const ended = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => { secondaryProcesses.delete(child); resolve({ code, signal }); });
      });
      // Observe child failures immediately even while waiting for the window activation event.
      void ended.catch(() => {});
      await until(() => secondInstances === expectedEvents && window.isVisible() && !window.isMinimized(), label + ' restoration');
      const status = await ended;
      assert.equal(status.code, 0, 'production single-instance lock exits the secondary process successfully');
      assert.equal(status.signal, null);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      const native = nativeState(window);
      assert.equal(native.visible, true, 'Win32 confirms the restored fixture window is visible');
      assert.equal(native.minimized, false, 'Win32 confirms the restored fixture window is not minimized');
      checks.push({ case: label, passed: true, secondaryPid: child.pid, secondaryExitCode: status.code,
        secondInstanceEvents: secondInstances, visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), native });
    }
    (async () => {
      await app.whenReady();
      await until(() => window && readyObserved && window.isVisible(), 'hidden startup explicitly shows its window');
      assert.equal(createdHidden, true, 'the production window starts hidden before ready-to-show');
      assert.equal(window.isMinimized(), false);
      const native = nativeState(window);
      assert.equal(native.visible, true, 'Win32 confirms the application overcame STARTUPINFO SW_HIDE');
      checks.push({ case: 'startup-with-SW_HIDE', passed: true, constructedHidden: createdHidden,
        readyToShowObserved: readyObserved, visible: window.isVisible(), minimized: window.isMinimized(), native });
      window.hide();
      await until(() => !window.isVisible(), 'fixture window hides');
      await launchSecondInstance('second-instance-while-hidden');
      window.minimize();
      await until(() => window.isMinimized(), 'fixture window minimizes');
      await launchSecondInstance('second-instance-while-minimized');
      assert.equal(secondInstances, 2);
      assert.equal(cloudAttempts, 0);
      assert.equal(blockedNetworkRequests, 0, 'startup and activation need no remote requests');
      finish(true);
    })().catch(error => finish(false, error.stack || String(error)));
  }
}
