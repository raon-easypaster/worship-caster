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
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });
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
    // 페이지가 다 열릴 때까지(최대 15초) 기다린 뒤 ms 만큼 더 기다림 — 컴퓨터가 바쁠 때 빈 화면을 점검하지 않게
    async go(url, ms = 1500) {
      await send('Page.navigate', { url });
      await sleep(100);
      for (let i = 0; i < 75; i++) {
        // 이동 중에는 대답이 없을 수 있어 1초만 기다림 (멈추지 않게)
        const r = await Promise.race([send('Runtime.evaluate', { expression: 'location.href + "|" + document.readyState', returnByValue: true }).catch(() => null), sleep(1000).then(() => null)]);
        const v = String(r?.result?.value || '');
        if (v.endsWith('|complete') && !v.startsWith('about:blank')) break;
        await sleep(200);
      }
      await sleep(ms);
    },
    async eval(expr) {
      // 20초 안에 대답이 없으면 실패로 (점검 전체가 멈추지 않게)
      const r = await Promise.race([send('Runtime.evaluate', { expression: `(async () => { return (${expr}); })()`, awaitPromise: true, returnByValue: true }),
        sleep(20000).then(() => { throw new Error('화면이 20초 동안 대답하지 않음: ' + String(expr).slice(0, 80)); })]);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
      return r.result.value;
    },
    // 화면 크기 바꾸기 (휴대폰·태블릿 점검용). 인자 없이 부르면 처음 크기(1440×900)로
    viewport(width = 1440, height = 900, mobile = false) { return send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
module.exports = { launch, sleep, findChrome };
