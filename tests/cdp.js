// 아주 작은 크롬 원격 조종 도구 (DevTools Protocol) — 자동 점검용
const { spawn } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const findChrome = () => CHROMES.find(p => fs.existsSync(p));

async function launch(dir, port = 9339) {
  const chrome = findChrome();
  if (!chrome) return null;
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 150; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find(t => t.type === 'page')) break; } catch {}
    await sleep(200);
  }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once('open', r));
  let id = 0; const wait = new Map();
  const errors = [];   // 페이지에서 난 오류 (점검에서 '오류 없음' 확인용)
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && wait.has(d.id)) { const { res, rej } = wait.get(d.id); wait.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // 알림 창(alert·confirm)은 자동으로 '확인'
  ws.on('message', m => { const d = JSON.parse(m); if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });

  const api = {
    errors,
    async go(url, ms = 1500) { await send('Page.navigate', { url }); await sleep(ms); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { return (${expr}); })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
      return r.result.value;
    },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
module.exports = { launch, sleep, findChrome };
