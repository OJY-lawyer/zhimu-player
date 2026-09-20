// Isolated renderer QA from current source. No application config, account or cloud call is used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const qaRoot = path.join(root, 'work', 'setup-connection-ui-qa');
if (typeof electron === 'string') {
  const { buildSync } = require('esbuild');
  const { spawn } = require('node:child_process');
  fs.mkdirSync(qaRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(qaRoot, 'run-'));
  const entry = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import './src/renderer/styles/global.css';
    import {SetupDialog} from './src/renderer/components/SetupDialog';
    import {setLanguage} from './src/renderer/i18n';
    window.__qaImports=[];
    window.electronAPI={
      setUiLanguage:async()=>{},
      loginChatGpt:async()=>({success:true,authenticated:false,authStatus:'unknown',projectVisible:false,message:'Fixture browser login opened'}),
      probeChatGpt:async()=>({success:false,authenticated:false,authStatus:'unknown',projectVisible:false,message:'Fixture specific cookie verification failed; previous state was restored.'}),
      importChatGptCookies:async(source,raw)=>{window.__qaImports.push({source,length:raw?.length||0});return {success:false,authenticated:false,authStatus:'unknown',projectVisible:false,message:'Fixture specific cookie verification failed; previous state was restored.'}},
      listChatGptModels:async()=>({success:true,models:[{model:'GPT-5.6 Sol',reasoningOptions:['Medium','High','Pro']},{model:'GPT-6 Astra',reasoningOptions:['Medium','High','Pro']}],message:'Fixture menu read'})
    };
    const config={provider:'chatgpt-web',baseUrl:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',apiKey:'',chatGptSelection:{model:'GPT-6 Astra',reasoning:'Pro'},chatGptProject:''};
    const mount=createRoot(document.getElementById('root'));
    window.__showFixture=(language,onboarding=false)=>{setLanguage(language);mount.render(<SetupDialog key={language+onboarding} config={config} onboarding={onboarding} onSave={async()=>{}} onClose={()=>{}} onAbout={()=>{}} onRestartSetup={()=>{}}/>)};
    window.__showFixture('zh-CN');
  `;
  const bundle = buildSync({ stdin: { contents: entry, resolveDir: root, sourcefile: 'settings-fixture.tsx', loader: 'tsx' }, bundle: true, write: false,
    outfile: path.join(scratch, 'bundle.js'), platform: 'browser', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
  for (const output of bundle.outputFiles) fs.writeFileSync(output.path, output.contents);
  fs.writeFileSync(path.join(scratch, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const env = { ...process.env, ZHIMU_SETTINGS_QA_SCRATCH: scratch };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const child = spawn(electron, [__filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('error', error => { console.error(error); process.exitCode = 1 });
  child.once('exit', code => { process.exitCode = code || 0; console.log('Renderer QA evidence: ' + scratch); });
  return;
}
const { app, BrowserWindow } = electron;
const scratch = path.resolve(process.env.ZHIMU_SETTINGS_QA_SCRATCH || '');
assert.equal(path.dirname(scratch), qaRoot); assert(path.basename(scratch).startsWith('run-'));
const profile = path.join(scratch, 'profile'); fs.mkdirSync(profile);
app.disableHardwareAcceleration(); app.setPath('userData', profile); app.setPath('sessionData', profile);
const report = { passed: false, realCloudCalls: false, isolatedRenderer: true, cases: [], errors: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
async function finish(error) {
  if (error) report.error = String(error.stack || error);
  else report.passed = true;
  fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(report, null, 2));
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(error ? 1 : 0);
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1180, height: 900, show: false, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') report.errors.push(details.message); });
  await win.loadFile(path.join(scratch, 'index.html')); await pause(150);
  const js = code => win.webContents.executeJavaScript(code, true);
  const click = label => js(`(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing fixture control');button.click()})()`);
  const screenshot = async name => { await pause(80); fs.writeFileSync(path.join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  for (const [width,height] of [[1180,900],[900,600]]) {
    win.setContentSize(width,height);
    for (const language of ['zh-CN','en']) {
      await js(`window.__showFixture(${JSON.stringify(language)})`); await pause(100);
      const geometry = await js(`(()=>{
        const content=document.querySelector('.setup-content'), area=content.getBoundingClientRect();
        const buttons=[...document.querySelectorAll('.setup-chat-actions button')].map(node=>{const r=node.getBoundingClientRect();return {text:node.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,visible:r.top>=area.top&&r.bottom<=area.bottom}});
        return {buttons,overflow:content.scrollWidth>content.clientWidth+1,model:document.querySelector('#chat-model').value,reasoning:document.querySelector('#chat-reasoning').value,hasMigration:document.body.innerText.includes('旧设置')||document.body.innerText.includes('Previous setting')};
      })()`);
      assert.equal(geometry.buttons.length,3); assert(geometry.buttons.every(button=>button.visible&&button.height>=40), 'connection actions should be visible without scrolling');
      assert.equal(geometry.overflow,false); assert.equal(geometry.hasMigration,false); assert.equal(geometry.model,'GPT-6 Astra'); assert.equal(geometry.reasoning,'Pro');
      await screenshot(`settings-${language}-${width}x${height}`);
      await click(language==='en'?'Import cookies':'导入 Cookie'); await pause(40);
      await click(language==='en'?'Paste JSON':'粘贴 JSON'); await pause(40);
      const form = await js(`(()=>{const textarea=document.querySelector('#chat-cookie-json'),content=document.querySelector('.setup-content'),field=textarea.getBoundingClientRect(),area=content.getBoundingClientRect();return {empty:textarea.value==='',focused:document.activeElement===textarea,visible:field.top>=area.top&&field.bottom<=area.bottom,spellcheck:textarea.spellcheck,autocomplete:textarea.autocomplete,overflow:content.scrollWidth>content.clientWidth+1}})()`);
      assert.equal(form.empty,true); assert.equal(form.focused,true); assert.equal(form.visible,true); assert.equal(form.spellcheck,false); assert.equal(form.autocomplete,'off'); assert.equal(form.overflow,false);
      await screenshot(`paste-${language}-${width}x${height}`);
      await js(`(()=>{const field=document.querySelector('#chat-cookie-json');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'[]');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await pause(40); await click(language==='en'?'Import pasted JSON':'导入粘贴内容'); await pause(60);
      assert.equal(await js(`!!document.querySelector('#chat-cookie-json')`),false);
      assert((await js(`document.querySelector('.setup-chat-status').innerText`)).includes('specific cookie verification failed'));
      report.cases.push({language,width,height,geometry,paste:form});
    }
  }
  const calls = await js('window.__qaImports');
  assert.equal(calls.length,4); assert(calls.every(call=>call.source==='paste'&&call.length===2));
  report.pasteImportCalls=calls;
  assert.deepEqual(report.errors,[]);
  await finish();
}).catch(finish);
