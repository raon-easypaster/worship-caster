// 예배송출 자동 점검 (하네스) — 업데이트 때 '되던 기능이 안 되는' 일을 막기 위해
//   node tests/run.js         → 빈 자료로 시험 서버를 따로 띄워 기능을 하나씩 눌러 봄 (실제 자료·5300번은 건드리지 않음)
//   하나라도 실패하면 끝 코드 1 → build-dist.sh 가 배포 파일을 만들지 않음
// 새 기능을 넣거나 버그를 고치면 여기에 점검을 하나씩 더해 주세요.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep, findChrome } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const PORT = 5390 + Math.floor(Math.random() * 9);
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'));
const results = [];
let srv, chrome;

async function check(name, fn) {
  try { await fn(); results.push([true, name]); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { results.push([false, name, e.message]); process.stdout.write(`  ✗ ${name}\n      → ${e.message}\n`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
async function api(method, url, body, extra = {}) {
  const opt = { method, headers: { Origin: BASE, ...extra.headers } };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(BASE + url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !extra.allowFail) throw new Error(`${method} ${url} → ${r.status} ${j.error || ''}`);
  return extra.allowFail ? { status: r.status, ...j } : j;
}

async function main() {
  console.log(`\n예배송출 자동 점검 — 시험 서버 ${BASE}, 시험 자료 ${DATA}\n`);
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), WC_DATA_DIR: DATA, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => (log += d)); srv.stderr.on('data', d => (log += d));
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await sleep(200); } }

  console.log('[서버]');
  let S;
  await check('처음 실행: 예시 자료·기본 배경 영상 5개', async () => {
    S = await api('GET', '/api/state');
    ok(S.items.length > 0 && S.services.length > 0, '예시 자료가 없음');
    const media = await api('GET', '/api/media');
    ok(media.filter(m => /^배경-/.test(m.name.normalize('NFC'))).length === 5, '기본 배경 영상이 5개가 아님: ' + media.length);
  });
  await check('맥 독 앱: 본체를 켜는 명령이 독 앱을 붙잡지 않음', async () => {
    const as = fs.readFileSync(path.join(ROOT, 'assets', 'mac-app.applescript'), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).map(l => l.replace(/\s--\s.*$/, '')).join('\n');   // 설명 줄은 빼고
    ok(!/"\s*&&\s*WC_DATA_DIR/.test(as), "'cd … && 본체 &' 꼴이면 독 앱이 멈춤 (v0.12.0~0.12.2 버그)");
    ok(!/display alert/.test(as), '알림 창(display alert)은 독 앱을 붙잡음');
    ok(/on reopen[\s\S]*startServer/.test(as), '꺼진 뒤 독 아이콘으로 다시 켜기가 없음');
  });
  await check("운영 컴퓨터 이름: 맥은 '랩탑', 윈도우는 '노트북' (화면에 '맥'이 나오지 않음)", async () => {
    const me = await api('GET', '/api/me');
    const want = process.platform === 'win32' ? '노트북' : '랩탑';
    ok(me.pc === want, `/api/me pc 기대 ${want}, 실제 ${me.pc}`);
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    ok(/PC_NAME = process\.platform === 'win32' \? '노트북' : '랩탑'/.test(src), '윈도우에서 노트북으로 부르는 부분이 없음');
    const strip = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['public/app.html', 'public/app.js', 'server.js']) {
      const t = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      ok(!/운영 맥|이 맥은|맥 방화벽/.test(t), `${f} 에 아직 '맥' 문구가 있음`);
    }
    const i18n = fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8');
    for (const k of ['운영 랩탑에서 정한 PIN', '운영 노트북에서 정한 PIN', '이 랩탑은 같은 공유기', '이 노트북은 같은 공유기', '운영 노트북에서만 가능'])
      ok(i18n.includes(k), `영어 사전에 '${k}' 가 없음`);
  });
  await check('맥 독 아이콘: 운영 화면(앱 창)을 창 이름으로 찾아 앞으로 (크롬 창 목록에는 앱 창이 없음)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const m = src.match(/const RAISE_SCRIPT = (\[[\s\S]*?\])\.join\('\\n'\);/);
    ok(m, 'RAISE_SCRIPT 가 없음');
    const script = eval(m[1]).join('\n');
    ok(/System Events/.test(script) && /AXRaise/.test(script), '창 이름으로 올리는 방식이 아님');
    const title = (fs.readFileSync(path.join(ROOT, 'public', 'app.html'), 'utf8').match(/<title>([^<]*)<\/title>/) || [])[1];
    ok(title && script.includes(`name is "${title}"`), `운영 화면 제목(${title})과 찾는 이름이 다름`);
    ok(!/repeat with w in windows/.test(src.slice(src.indexOf('function showUI'), src.indexOf('function showUI') + 2500)), '크롬 창 목록으로 찾는 옛 방식 (앱 창을 못 찾음, v0.14.1까지의 버그)');
    const as = fs.readFileSync(path.join(ROOT, 'assets', 'mac-app.applescript'), 'utf8');
    ok(/on raiseUI\(\)[\s\S]*AXRaise/.test(as) && as.includes(`name is "${title}"`), '독 앱이 직접 창을 올리지 않음 (맥 권한은 독 앱에 주어짐)');
    ok(/with timeout of \d+ seconds/.test(as.slice(as.indexOf('on raiseUI'))), '창 올리기가 독 앱을 오래 붙잡을 수 있음');
    if (process.platform === 'darwin') {
      const out = path.join(DATA, 'raise.scpt');
      require('child_process').execFileSync('osacompile', ['-o', out, '-e', script]);   // 문법만 확인 (실행하지 않음)
      ok(fs.existsSync(out), '애플스크립트 문법 오류');
    }
  });
  await check('다른 사이트에서 온 요청은 막힘', async () => {
    const r = await fetch(BASE + '/api/live', { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    ok(r.status === 403, '막히지 않음: ' + r.status);
  });
  await check('가사 나누기 (빈 줄·#후렴 이름)', async () => {
    const sl = await api('POST', '/api/split', { text: '#1절\n가\n나\n다\n\n#후렴\n라', lines: 2 });
    ok(sl.length === 3 && sl[0].label === '1절' && sl[2].label === '후렴', JSON.stringify(sl));
  });
  let song;
  await check('찬양 만들기·고치기 (콘티 키·BPM·메모)', async () => {
    song = await api('POST', '/api/items', { type: 'song', title: '점검 찬양', slides: [{ text: '첫 줄\n둘째 줄' }, { text: '셋째' }], key: 'G', bpm: 72, memo: '후렴 2번', place: true });
    const u = await api('PUT', '/api/items/' + song.id, { key: 'A', bpm: 999 });
    ok(u.key === 'A' && u.bpm === 300 && u.memo === '후렴 2번', JSON.stringify(u));
  });
  await check('송출: 다음·이전·모두 끄기·검은 화면', async () => {
    let s = await api('POST', '/api/live', { itemId: song.id, index: 0 });
    ok(s.slide?.text === '첫 줄\n둘째 줄', '첫 슬라이드가 아님');
    s = await api('POST', '/api/live', { step: 1 }); ok(s.live.index === 1, '다음이 안 됨');
    s = await api('POST', '/api/live', { reset: true }); ok(s.live.clear && !s.live.black && !s.live.mediaBg, '모두 끄기 상태가 다름');
    s = await api('POST', '/api/live', { black: true }); ok(s.live.black, '검은 화면이 안 됨');
    await api('POST', '/api/live', { black: false });
  });
  await check('로고: 검은 바탕 / 배경 위에 로고만', async () => {
    const media = await api('GET', '/api/media');
    await api('PUT', '/api/settings', { logoStyle: { screenBg: 'black' } });
    let s = await api('POST', '/api/live', { logo: true }); ok(s.live.logo && s.live.black, '검은 바탕 로고가 아님');
    await api('POST', '/api/live', { logo: false });
    await api('PUT', '/api/settings', { logoStyle: { screenBg: 'over' } });
    await api('POST', '/api/live', { mediaBg: media[0].url });
    s = await api('POST', '/api/live', { logo: true }); ok(s.live.logo && !s.live.black && s.live.mediaBg, '배경 위 로고가 아님');
    s = await api('POST', '/api/live', { itemId: song.id, index: 0 }); ok(!s.live.logo, '슬라이드를 눌러도 로고가 안 꺼짐');
    await api('POST', '/api/live', { reset: true });
  });
  await check('화면 위 그림: 띄우고 빼도 배경·슬라이드는 그대로', async () => {
    const media = await api('GET', '/api/media');
    await api('POST', '/api/live', { itemId: song.id, index: 0 });
    await api('POST', '/api/live', { mediaBg: media[0].url });
    let s = await api('POST', '/api/live', { mediaTop: media[1].url }); ok(s.live.mediaTop, '위에 안 뜸');
    s = await api('POST', '/api/live', { mediaTop: null }); ok(!s.live.mediaTop && s.live.mediaBg && s.live.itemId === song.id, '그림을 빼자 다른 것도 바뀜');
    await api('POST', '/api/live', { reset: true });
  });
  await check('찬송가: 파일 가져와 번호로 찾기 (1절·후렴 순서)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['999장 점검 찬송\n1. 가\n나\n\n2. 다\n라\n\n후렴\n마\n']), 'hymn.txt');
    const r = await api('POST', '/api/hymns/upload', fd); ok(r.count === 1, JSON.stringify(r));
    const h = await api('GET', '/api/hymns/999');
    ok(h.title === '찬송가 999장 점검 찬송' && h.arr.join(',') === '1절,후렴,2절,후렴', JSON.stringify(h));
  });
  await check('찬송가: 제목·가사로 찾기, 인터넷에서 넣은 곡 번호 기억', async () => {
    const byTitle = await api('GET', '/api/hymns-search?q=' + encodeURIComponent('점검 찬송'));
    const byLine = await api('GET', '/api/hymns-search?q=' + encodeURIComponent('가나'));
    ok(byTitle[0]?.num === 999 && byLine[0]?.num === 999, JSON.stringify([byTitle, byLine]));
    const l = await api('POST', '/api/hymns/learn', { num: 555, title: '기억 점검곡', lyrics: '#1절\n하나\n\n#후렴\n둘' });
    ok(l.title === '찬송가 555장 기억 점검곡' && l.arr.join(',') === '1절,후렴', JSON.stringify(l));
    const again = await api('GET', '/api/hymns/555'); ok(again.title === l.title, '번호로 다시 안 나옴');
  });
  await check('웹 편집기(PIN)에서는 기억된 찬송가를 덮어쓸 수 없음', async () => {
    const ip = Object.values(os.networkInterfaces()).flat().find(n => n && n.family === 'IPv4' && !n.internal)?.address;
    if (!ip) return;   // 네트워크가 없으면 건너뜀
    const R = `http://${ip}:${PORT}`, st = await api('GET', '/api/state');
    const lg = await fetch(R + '/api/login', { method: 'POST', headers: { Origin: R, 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: st.settings.pin }) });
    const cookie = (lg.headers.get('set-cookie') || '').split(';')[0]; ok(cookie, 'PIN 로그인이 안 됨');
    const post = num => fetch(R + '/api/hymns/learn', { method: 'POST', headers: { Origin: R, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ num, title: '덮어쓰기', lyrics: '가' }) });
    ok((await post(555)).status === 403, '이미 있는 555장을 덮어씀');
    ok((await post(556)).status === 200, '새 번호는 기억해야 함');
  });
  await check('백업 받기 → 되살리기 (이상한 값은 걸러짐)', async () => {
    const r = await fetch(BASE + '/api/backup'); ok(r.ok, '백업 실패'); const zip = await r.arrayBuffer();
    const fd = new FormData(); fd.append('file', new Blob([zip]), 'b.zip');
    const rr = await api('POST', '/api/restore', fd); ok(rr.ok && rr.items >= 1, JSON.stringify(rr));
    const bad = new FormData(); bad.append('file', new Blob(['x']), 'x.zip');
    const b = await api('POST', '/api/restore', bad, { allowFail: true }); ok(b.status === 400, '깨진 파일을 받아들임');
  });
  await check('백업에 찬송가·교독문도 들어가고, 되살리면 돌아옴', async () => {
    const up = (url, name, text) => { const fd = new FormData(); fd.append('file', new Blob([text]), name); return api('POST', url, fd); };
    await up('/api/hymns/upload', '찬송가.txt', '999장 백업 점검 찬송\n1. 첫 줄\n둘째 줄\n');
    await up('/api/readings/upload', '교독문.txt', '1. 백업 점검 교독문\n가 줄\n나 줄\n');
    const before = await api('GET', '/api/state');
    const r = await fetch(BASE + '/api/backup'); const buf = Buffer.from(await r.arrayBuffer());
    const zip = await require(path.join(ROOT, 'node_modules', 'jszip')).loadAsync(buf);
    ok(zip.file('data/hymns.json') && zip.file('data/readings.json'), '백업에 찬송가·교독문이 없음: ' + Object.keys(zip.files).filter(n => !n.startsWith('media/')).join(', '));
    await api('DELETE', '/api/hymns'); await api('DELETE', '/api/readings');
    let st = await api('GET', '/api/state'); ok(st.hymnCount === 0 && st.readingCount === 0, '지우기가 안 됨');
    const fd = new FormData(); fd.append('file', new Blob([buf]), 'b.zip');
    await api('POST', '/api/restore', fd);
    st = await api('GET', '/api/state');
    ok(st.hymnCount === before.hymnCount && st.readingCount === before.readingCount, `되살린 뒤 찬송가 ${st.hymnCount}/${before.hymnCount} · 교독문 ${st.readingCount}/${before.readingCount}`);
    ok((await api('GET', '/api/readings/1?lines=2')).slides?.length >= 1, '되살린 교독문을 못 찾음');
  });
  await check('날마다 자동 보관본: 저장하면 backups/db-오늘.json 이 생김 (최근 14개)', async () => {
    await api('PUT', '/api/style', { main: { size: 6.3 } }); await sleep(400);
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const f = path.join(DATA, 'backups', `db-${day}.json`);
    ok(fs.existsSync(f), '오늘 보관본이 없음');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); ok(Array.isArray(j.items) && j.items.length > 0, '보관본이 자료가 아님');
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'store.js'), 'utf8'); ok(/KEEP_DAYS = 14/.test(src), '보관 개수 규칙이 바뀜');
  });
  await check('자료 파일이 깨지면 예시 자료로 덮어쓰지 않고, 깨진 파일은 남기고 최근 보관본으로 되살림', async () => {
    const run = async (setup) => {
      const D = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-broken-')), P = PORT + 40, B = `http://localhost:${P}`;
      setup(D);
      const s2 = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(P), WC_DATA_DIR: D, NO_OPEN: '1' }, stdio: 'ignore' });
      try {
        for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/me'); break; } catch { await sleep(200); } }
        const st = await (await fetch(B + '/api/state', { headers: { Origin: B } })).json();
        await sleep(400);
        return { st, files: fs.readdirSync(D), db: (() => { try { return JSON.parse(fs.readFileSync(path.join(D, 'db.json'), 'utf8')); } catch { return null; } })() };
      } finally { s2.kill(); await sleep(300); fs.rmSync(D, { recursive: true, force: true }); }
    };
    const good = { items: [{ id: 'aaaaaaaaaaaa', title: '보관본 찬양', type: 'song', slides: [{ text: '가' }] }], services: [], settings: { pin: '123456' } };
    // 1) 보관본이 있으면 그것으로
    let r = await run(D => {
      fs.writeFileSync(path.join(D, 'db.json'), '{ "items": [ 깨진');
      fs.mkdirSync(path.join(D, 'backups')); fs.writeFileSync(path.join(D, 'backups', 'db-2026-01-01.json'), JSON.stringify(good));
    });
    ok(r.st.items?.some(i => i.title === '보관본 찬양'), '보관본으로 되살리지 않음: ' + (r.st.items || []).map(i => i.title).slice(0, 3).join(', '));
    ok(r.st.recovered?.from === 'backups/db-2026-01-01.json', '운영 화면 알림 정보가 없음: ' + JSON.stringify(r.st.recovered));
    ok(r.files.some(f => /^db\.broken-\d+\.json$/.test(f)), '깨진 파일을 남기지 않음: ' + r.files.join(', '));
    ok(r.db?.items?.some(i => i.title === '보관본 찬양'), 'db.json 이 되살린 자료로 다시 쓰이지 않음');
    // 2) 보관본이 없으면 예시 자료로 시작하되 깨진 파일은 남김
    r = await run(D => fs.writeFileSync(path.join(D, 'db.json'), 'xx'));
    ok(r.st.items?.length > 0 && r.st.recovered && !r.st.recovered.from, '예시 자료·알림이 없음');
    ok(r.files.some(f => /^db\.broken-\d+\.json$/.test(f)), '깨진 파일을 남기지 않음(보관본 없음)');
  });
  await check('설정: 언어·화면 비율·스타일 저장', async () => {
    await api('PUT', '/api/style', { main: { aspect: '4:3', size: 7 } });
    const st = await api('GET', '/api/state'); ok(st.style.main.aspect === '4:3' && st.style.main.size === 7, '스타일 저장 안 됨');
    await api('PUT', '/api/style', { main: { aspect: '16:9' } });
  });

  // ── 화면 (헤드리스 크롬) ──
  if (!findChrome()) { console.log('\n[화면] 크롬이 없어 화면 점검은 건너뜀'); return; }
  console.log('\n[화면]');
  chrome = await launch(fs.mkdtempSync(path.join(os.tmpdir(), 'wc-chrome-')));
  const c = chrome;
  // 운영 화면 열기 (앞 페이지 연결이 늦게 끊겨 '이미 열려 있음'이 뜨면 '이 창에서 계속')
  const openControl = async () => {
    await c.go(BASE + '/control', 2500); await c.eval(`(document.querySelector('#wnTake')?.click(), 1)`); await sleep(300);
    // 자료(S)를 다 받을 때까지 기다림 (늦으면 다음 점검이 빈 화면을 보게 됨)
    for (let i = 0; i < 40 && !(await c.eval(`typeof S !== 'undefined' && !!S`)); i++) await sleep(250);
    if (!(await c.eval(`typeof S !== 'undefined' && !!S`))) console.log('      (운영 화면 자료가 안 옴:', await c.eval(`fetch('/api/state').then(r => r.status + ' ' + r.statusText).catch(e => String(e))`), ')');
  };
  const noErr = () => { const e = c.errors.splice(0); ok(!e.length, '화면 오류: ' + e.join(' | ')); };
  await check('유튜브 영상: 주소 알아보기·일시정지·10초·끄기·모두 끄기', async () => {
    let r = await api('POST', '/api/live', { yt: { open: 'https://youtu.be/aqz-KE-bpKQ?t=1m30s' } });
    ok(r.live.yt?.id === 'aqz-KE-bpKQ' && r.live.yt.pos === 90 && r.live.yt.playing && r.live.yt.tv && !r.live.yt.obs, JSON.stringify(r.live.yt));
    await sleep(1200);
    r = await api('POST', '/api/live', { yt: { playing: false } });
    ok(!r.live.yt.playing && r.live.yt.pos >= 91 && r.live.yt.pos < 93, '일시정지 위치 ' + r.live.yt.pos);
    r = await api('POST', '/api/live', { yt: { step: -10 } }); ok(Math.abs(r.live.yt.pos - 81.5) < 2, '10초 뒤로 ' + r.live.yt.pos);
    r = await api('POST', '/api/live', { yt: { obs: true, sound: 'both' } }); ok(r.live.yt.obs && r.live.yt.sound === 'both', JSON.stringify(r.live.yt));
    r = await api('POST', '/api/live', { yt: { open: 'https://evil.example/watch?v=aqz-KE-bpKQ' } }); ok(r.live.yt?.id === 'aqz-KE-bpKQ', '이상한 주소가 영상을 바꿈');
    r = await api('POST', '/api/live', { yt: null }); ok(r.live.yt === null, '끄기 안 됨');
    await api('POST', '/api/live', { yt: { open: 'aqz-KE-bpKQ' } });
    r = await api('POST', '/api/live', { reset: true }); ok(r.live.yt === null, '모두 끄기에 영상이 남음');
  });
  await check('교독문: 파일 가져와 번호·제목으로 찾기 (다같이 따로)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['98.점검 교독문\n가 줄\n나 줄\n다 줄&#160;\n(다같이)\n라 줄\n\n99. 시편 23편\n여호와는 나의 목자시니\n']), '교독문.txt');
    const r = await api('POST', '/api/readings/upload', fd); ok(r.count === 2, JSON.stringify(r));
    const g = await api('GET', '/api/readings/98?lines=2');
    ok(g.slides.map(s => s.text).join('|') === '가 줄\n나 줄|다 줄|(다같이)\n라 줄' && g.slides[0].ref === '교독문 98 점검 교독문', JSON.stringify(g.slides));
    const s = await api('GET', '/api/readings-search?q=' + encodeURIComponent('시편 23'));
    ok(s.length === 1 && s[0].num === 99, JSON.stringify(s));
  });
  await openControl();
  await check('운영 화면이 오류 없이 열림', async () => { ok(await c.eval(`!!document.querySelector('#slides')`), '운영 화면이 안 그려짐'); noErr(); });
  await check('찬양마다 배경 영상: 자료실 영상을 슬라이드 칸에 끌어다 놓으면 저장·예배당 화면 뒤에 깔림·✕로 빼기', async () => {
    const vid = (await api('GET', '/api/media')).find(m => /\.(mp4|mov|webm)$/i.test(m.url));
    ok(vid, '시험할 영상이 없음');
    const it = await api('POST', '/api/items', { title: '영상 점검곡', type: 'song', slides: [{ text: '가사 한 줄' }, { text: '가사 두 줄' }] });
    // 엉뚱한 주소는 저장하지 않음
    for (const bad of ['/media/../db.json', '/media/a.jpg', 'https://evil.example/a.mp4']) {
      const r = await api('PUT', '/api/items/' + it.id, { motionVideo: bad });
      ok(r.motionVideo === '', `잘못된 주소가 저장됨: ${bad}`);
    }
    c.errors.splice(0);
    await c.eval(`(select(${JSON.stringify(it.id)}), 1)`); await sleep(300);
    ok(await c.eval(`document.querySelector('#itemVid').classList.contains('hidden')`), '영상이 없는데 표시가 보임');
    // 끌어다 놓기 (자료실 칸 → 슬라이드 칸)
    await c.eval(`(() => { const dt = new DataTransfer(); dt.setData('application/x-wc-media', ${JSON.stringify(vid.url)});
      const box = document.querySelector('#slides');
      box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(800);
    let st = await api('GET', '/api/state'), saved = st.items.find(x => x.id === it.id);
    ok(saved.motionVideo === vid.url, `저장 안 됨: ${saved.motionVideo}`);
    ok(saved.slides.length === 2 && saved.slides[0].text === '가사 한 줄' && !saved.slides.some(s => s.bg), '슬라이드가 바뀜');
    ok(!(await c.eval(`document.querySelector('#itemVid').classList.contains('hidden')`)), '머리줄에 영상 표시가 없음');
    // 송출하면 예배당 화면 정보에 영상이 실리고, 화면 그리기에서 그 영상이 글자 뒤에 깔림
    const r = await api('POST', '/api/live', { itemId: it.id, index: 0 });
    ok(r.item?.motionVideo === vid.url, '송출 정보에 영상이 없음');
    const html = await c.eval(`(() => { const d = document.createElement('div'); WC.render(d, { slide: { text: '가' }, style: S.style, live: {}, item: { motionVideo: ${JSON.stringify(vid.url)} } }, 'main', { fade: false }); return d.innerHTML; })()`);
    ok(html.includes('m-video') && html.includes(vid.url), '예배당 화면에 영상이 안 깔림');
    // 미디어 배경(누르기)을 따로 내보내면 그것이 먼저 (기존 동작 유지)
    const html2 = await c.eval(`(() => { const d = document.createElement('div'); WC.render(d, { slide: { text: '가' }, style: S.style, live: { mediaBg: ${JSON.stringify(vid.url)} }, item: { motionVideo: ${JSON.stringify(vid.url)} } }, 'main', { fade: false }); return d.querySelectorAll('.m-video').length; })()`);
    ok(html2 === 0, '미디어 배경을 내보냈는데 찬양 영상도 함께 깔림');
    // ✕ 로 빼기
    await c.eval(`(document.querySelector('#itemVidOff').click(), 1)`); await sleep(700);
    st = await api('GET', '/api/state'); saved = st.items.find(x => x.id === it.id);
    ok(saved.motionVideo === '', '빼기가 안 됨');
    for (let i = 0; i < 15 && !(await c.eval(`document.querySelector('#itemVid').classList.contains('hidden')`)); i++) await sleep(200);   // 바쁠 때 화면이 늦게 바뀜
    ok(await c.eval(`document.querySelector('#itemVid').classList.contains('hidden')`), '빼도 표시가 남음');
    await api('POST', '/api/live', { reset: true });
    await api('DELETE', '/api/items/' + it.id);
    noErr();
  });
  await check('예배 순서: 끌어서 옮기기 (아래로·위로) + ↑↓ 화살표 그대로', async () => {
    const mk = t => api('POST', '/api/items', { title: t, type: 'phrase', slides: [{ text: t }] });
    const a = await mk('끌기 가'), b = await mk('끌기 나'), d = await mk('끌기 다');
    const svc = await api('POST', '/api/services', { name: '끌기 점검 예배' });
    await api('PUT', '/api/services/' + svc.id, { itemIds: [a.id, b.id, d.id] });
    await openControl(); c.errors.splice(0);
    const order = async () => (await api('GET', '/api/state')).services.find(x => x.id === svc.id).itemIds.map(id => [a, b, d].find(x => x.id === id).title.slice(-1)).join('');
    // from 번째를 to 번째 칸의 위(half=0)·아래(half=1)에 놓기
    const drag = (from, to, half) => c.eval(`(() => {
      const li = [...document.querySelectorAll('#serviceList li')], dt = new DataTransfer();
      li[${from}].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const r = li[${to}].getBoundingClientRect(), y = r.top + r.height * (${half} ? 0.8 : 0.2);
      li[${to}].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: y }));
      li[${to}].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: y }));
      li[${from}].dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })); return 1; })()`);
    ok(await c.eval(`document.querySelector('#serviceList li').draggable`), '순서 칸을 끌 수 없음');
    await drag(0, 2, 1); await sleep(600); ok(await order() === '나다가', '맨 위를 맨 아래로: ' + await order());
    await drag(2, 0, 0); await sleep(600); ok(await order() === '가나다', '맨 아래를 맨 위로: ' + await order());
    await drag(0, 1, 1); await sleep(600); ok(await order() === '나가다', '한 칸 아래로: ' + await order());
    await drag(1, 1, 0); await sleep(600); ok(await order() === '나가다', '제자리에 놓았는데 바뀜: ' + await order());
    await c.eval(`(document.querySelectorAll('#serviceList li')[1].querySelector('[data-a=up]').click(), 1)`); await sleep(600);
    ok(await order() === '가나다', '↑ 화살표가 안 됨: ' + await order());
    noErr();
    await api('DELETE', '/api/services/' + svc.id).catch(() => {});
  });
  // 맨 위·왼쪽 단추를 실제로 눌러 창이 열리는지 (v0.4.0~0.11.0 자막 스타일 단추 버그 같은 것 방지)
  for (const [sel, name] of [['#styleBtn', '🎨 자막 스타일'], ['#settingsBtn', '⚙︎ 설정'], ['#obsBtn', '🎥 OBS 자막 주소'], ['#mediaBtn', '🖼 미디어'],
    ['#newSong', '＋ 찬양'], ['#newBible', '＋ 성경'], ['#newHymn', '＋ 찬송가'], ['#newReading', '＋ 교독문'], ['#newPhrase', '＋ 문구·성찬'], ['#newNotice', '＋ 광고'],
    ['#newScore', '＋ PDF·악보'], ['#newHtml', '＋ HTML'], ['#svcConti', '📋 콘티']]) {
    await check(`단추 ${name} → 창이 열림`, async () => {
      c.errors.splice(0);   // 앞 점검의 오류가 넘어오지 않게
      await c.eval(`(document.querySelector('#dlg')?.open && closeDlg(), document.querySelector(${JSON.stringify(sel)}).click(), 1)`);
      await sleep(700);
      ok(await c.eval(`document.querySelector('#dlg').open`), '창이 안 열림');
      noErr();
      await c.eval(`(closeDlg(), 1)`); await sleep(150);
    });
  }
  await check('새 찬양: 제목 칸에 보이는 이름으로 저장 (\'새 찬양\'으로 저장되지 않음)', async () => {
    await c.eval(`(closeDlg(), document.querySelector('#newSong').click(), 1)`); await sleep(600);
    // 가사 찾기에서 곡을 고를 때처럼 제목 칸만 바꿈 (입력 이벤트 없이)
    await c.eval(`(document.querySelector('#eTitle').value = '제목 점검곡', document.querySelector('#ePaste').value = '가\\n나', document.querySelector('#eSplit').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('#eSave').click(), 1)`); await sleep(800);
    const st = await api('GET', '/api/state');
    ok(st.items.some(i => i.title === '제목 점검곡'), '저장된 제목: ' + st.items.map(i => i.title).filter(t => /찬양|점검/.test(t)).join(', '));
    noErr();
  });
  await check('＋ 찬송가: 번호 Enter면 바로, 제목으로 찾으면 목록', async () => {
    await c.eval(`(closeDlg(), document.querySelector('#newHymn').click(), 1)`); await sleep(500);
    await c.eval(`(() => { const i = document.querySelector('#hNum'); i.value = '555'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return 1; })()`); await sleep(1500);
    const st = await api('GET', '/api/state');
    ok(st.items.some(i => i.title === '찬송가 555장 기억 점검곡'), '번호로 안 들어감');
    await c.eval(`(() => { const i = document.querySelector('#hNum'); i.value = '점검 찬송'; document.querySelector('#hGo').click(); return 1; })()`);
    let found = false;   // 인터넷 찾기가 함께 돌아 늦을 수 있어 20초까지 기다림
    for (let i = 0; i < 40 && !found; i++) { await sleep(500); found = await c.eval(`!!document.querySelector('#hRes [data-mine]')`); }
    ok(found, '제목으로 찾은 목록이 없음');
    noErr(); await c.eval(`(closeDlg(), 1)`);
  });
  await check('＋ 찬송가: 1줄·2줄·3줄·4줄씩 골라 넣기 (자료실에 있는 곡도 다시 나눔)', async () => {
    // 같은 절이 2줄씩 빈 줄로 미리 나뉜 파일도 3·4줄로 나뉘어야 함 (새찬송가 파일 모양)
    await api('POST', '/api/hymns/learn', { num: 444, title: '줄 점검곡', lyrics: '1. 가\n나\n\n다\n라\n\n2. 마\n바\n\n사\n아' });
    // 같은 찬송가가 자료실에 둘 있어도 모두 바뀌어야 함
    const dupSlides = await api('POST', '/api/split', { text: '가\n나', lines: 2 });
    await api('POST', '/api/items', { type: 'song', title: '찬송가 444장 줄 점검곡', slides: dupSlides });
    await api('POST', '/api/items', { type: 'song', title: '찬송가 444장 줄 점검곡', slides: dupSlides });
    const add = async n => {
      await c.eval(`(closeDlg(), document.querySelector('#newHymn').click(), 1)`); await sleep(500);
      await c.eval(`(() => { const s = document.querySelector('#hLines'); s.value = '${n}'; s.dispatchEvent(new Event('change')); const i = document.querySelector('#hNum'); i.value = '444'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return 1; })()`);
      await sleep(1500);
      const st = await api('GET', '/api/state');
      return st.items.filter(i => i.title === '찬송가 444장 줄 점검곡').map(it => Math.max(...it.slides.map(s => s.text.split('\n').length)));
    };
    const one = await add(1), three = await add(3), four = await add(4);
    ok(one.every(n => n === 1) && three.every(n => n === 3) && four.every(n => n === 4) && four.length === 2, `1줄 → ${one}, 3줄 → ${three}, 4줄 → ${four} (같은 곡 ${four.length}개)`);
    await c.eval(`(document.querySelector('#hLines').value = '2', document.querySelector('#hLines').dispatchEvent(new Event('change')), closeDlg(), 1)`);
    noErr();
  });
  await check('＋ 교독문: 번호 Enter면 바로 예배 순서에, 줄 수대로', async () => {
    await c.eval(`(closeDlg(), document.querySelector('#newReading').click(), 1)`); await sleep(500);
    await c.eval(`(() => { const s = document.querySelector('#rdLines'); s.value = '1'; s.dispatchEvent(new Event('change')); const i = document.querySelector('#rdQ'); i.value = '98'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return 1; })()`);
    await sleep(1500);
    const st = await api('GET', '/api/state');
    const it = st.items.find(i => i.title === '교독문 98 점검 교독문');
    ok(it && it.type === 'bible' && it.slides.map(s => s.text).join('|') === '가 줄|나 줄|다 줄|(다같이)\n라 줄', it ? JSON.stringify(it.slides.map(s => s.text)) : '안 들어감');
    await c.eval(`(() => { const i = document.querySelector('#rdQ'); i.value = '목자'; document.querySelector('#rdGo').click(); return 1; })()`); await sleep(700);
    ok(await c.eval(`!!document.querySelector('#rdRes [data-rd]')`), '본문으로 찾은 목록이 없음');
    await c.eval(`(document.querySelector('#rdLines').value = '2', document.querySelector('#rdLines').dispatchEvent(new Event('change')), closeDlg(), 1)`);
    noErr();
  });
  await check('＋ 성경: 번역본 이름 보이기를 끄면 구절만 (다음에도 기억), 켜면 (번역본)', async () => {
    const fd = new FormData(); fd.append('file', new Blob(['창 3:16 점검 본문 하나\n창 3:17 점검 본문 둘\n']), '점검역.txt'); fd.append('name', '점검역');
    const up = await api('POST', '/api/bible/upload', fd); ok(up.ok, JSON.stringify(up));
    await openControl();
    const make = async (show, q) => {
      await c.eval(`(closeDlg(), document.querySelector('#newBible').click(), 1)`); await sleep(500);
      await c.eval(`(() => { const v = document.querySelector('#bV'); v.value = '점검역'; const b = document.querySelector('#bShowV'); b.checked = ${show};
        const i = document.querySelector('#bQ'); i.value = '${q}'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return 1; })()`);
      await sleep(800); await c.eval(`(document.querySelector('#bMake').click(), 1)`); await sleep(900);
    };
    await make(false, '창 3:16');
    let st = await api('GET', '/api/state');
    let it = st.items.filter(i => i.type === 'bible' && i.slides[0]?.text === '점검 본문 하나').pop();
    ok(it && it.slides[0].ref === '창세기 3:16', '끄면: ' + JSON.stringify(it?.slides[0]));
    ok(st.settings.bibleNoVer === true, '설정이 기억되지 않음');
    await c.eval(`(closeDlg(), document.querySelector('#newBible').click(), 1)`); await sleep(500);
    ok(await c.eval(`document.querySelector('#bShowV').checked === false`), '다시 열면 꺼진 채로 나와야 함');
    await make(true, '창 3:17');
    st = await api('GET', '/api/state');
    it = st.items.filter(i => i.type === 'bible' && i.slides[0]?.text === '점검 본문 둘').pop();
    ok(it && it.slides[0].ref === '창세기 3:17 (점검역)', '켜면: ' + JSON.stringify(it?.slides[0]));
    ok(st.settings.bibleNoVer === false, '다시 켠 설정이 기억되지 않음');
    await c.eval(`(closeDlg(), 1)`); noErr();
  });
  await check('자료 ✎ 편집 → 배경·추가 그림 따로', async () => {
    await c.eval(`(select(S.items.find(i => i.title === '점검 찬양').id), 1)`); await sleep(400);
    await c.eval(`(document.querySelector('#editItem').click(), 1)`); await sleep(700);
    ok(await c.eval(`!!document.querySelector('#eSlides [data-m="bg"]') && !!document.querySelector('#eSlides [data-m="img"]')`), '배경·추가 그림 단추가 없음');
    noErr(); await c.eval(`(closeDlg(), 1)`);
  });
  await check('송출 단추: 다음 ▶ · 모두 끄기', async () => {
    await c.eval(`(goLive({ itemId: S.items.find(i => i.title === '점검 찬양').id, index: 0 }), 1)`); await sleep(500);
    await c.eval(`(document.querySelector('#next').click(), 1)`); await sleep(500);
    ok(await c.eval(`snap.live.index === 1`), '다음 ▶ 이 안 됨');
    await c.eval(`(document.querySelector('#reset').click(), 1)`); await sleep(500);
    ok(await c.eval(`snap.live.clear === true`), '모두 끄기가 안 됨'); noErr();
  });
  await check('예배당 화면: 모두 끄기는 검은 화면 (흰 바탕이 남지 않음)', async () => {
    const it = await api('POST', '/api/items', { type: 'notice', title: '밝은 광고', theme: 'notice_bright', slides: [{ text: '흰 바탕', bgColor: '#ffffff' }], place: true });
    await api('POST', '/api/live', { itemId: it.id, index: 0 });
    await api('POST', '/api/live', { reset: true });
    await c.go(BASE + '/output?nohint', 2000);
    const bg = await c.eval(`getComputedStyle([...document.querySelectorAll('#screen > .wc-layer')].pop()).backgroundColor`);
    ok(bg === 'rgb(0, 0, 0)', '바탕이 ' + bg); noErr();
  });
  await check('예배당 화면: 슬라이드 글자가 나옴', async () => {
    await api('POST', '/api/live', { itemId: song.id, index: 0 }); await sleep(800);
    const t = await c.eval(`document.querySelector('.wc-text-main')?.innerText || ''`);
    ok(t.includes('첫 줄'), '글자: ' + t); noErr();
  });
  await check('방송 자막(OBS): 투명 바탕에 자막 바', async () => {
    await c.go(BASE + '/overlay', 2000);
    const r = await c.eval(`({ bg: getComputedStyle(document.documentElement).backgroundColor, bar: !!document.querySelector('.wc-ov') })`);
    ok(r.bar && /rgba\(0, 0, 0, 0\)|transparent/.test(r.bg), JSON.stringify(r)); noErr();
  });
  await check('프롬프터가 열림', async () => { await c.go(BASE + '/stage', 1500); ok(await c.eval(`!!document.querySelector('.wc-st-cur')`), '프롬프터가 안 그려짐'); noErr(); });
  await check('다국어 자막 글꼴 (태국어·미얀마어·베트남어)', async () => {
    const it = await api('POST', '/api/items', { type: 'song', title: '다국어', slides: [{ text: 'พระเจ้า ဘုရား Chúa yêu' }], place: true });
    await api('POST', '/api/live', { itemId: it.id, index: 0 });
    await c.go(BASE + '/output?nohint', 2500);
    const fams = await c.eval(`document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))`);
    ok(['Noto Sans Thai', 'Noto Sans Myanmar'].every(f => fams.includes(f)), '글꼴: ' + fams.join(','));
  });
  await check('영어 메뉴: 바꾸면 영어로, 되돌리면 한국어로', async () => {
    await api('PUT', '/api/settings', { lang: 'en' });
    await openControl();
    ok((await c.eval(`document.querySelector('#styleBtn').innerText`)).includes('Caption Style'), '영어가 아님');
    await c.eval(`(document.querySelector('#settingsBtn').click(), 1)`); await sleep(600); noErr(); await c.eval(`(closeDlg(), 1)`);
    await api('PUT', '/api/settings', { lang: 'ko' });
    await openControl();
    ok((await c.eval(`document.querySelector('#styleBtn').innerText`)).includes('자막 스타일'), '한국어로 안 돌아옴'); noErr();
  });
  await check('곡 구성 네비게이터: 후렴 단추를 누르면 후렴으로', async () => {
    const sl = await api('POST', '/api/split', { text: '#1절\n가\n\n#후렴\n나\n\n#2절\n다', lines: 2 });
    const it = await api('POST', '/api/items', { type: 'song', title: '구성 점검', slides: sl, arr: ['1절', '후렴', '2절', '후렴'], place: true });
    await openControl();
    await c.eval(`(select(${JSON.stringify(it.id)}), 1)`); await sleep(400);
    const labels = await c.eval(`[...document.querySelectorAll('#secNav .secbtn')].map(b => b.textContent)`);
    ok(labels.join(',') === '1절,후렴,2절,후렴', '단추: ' + labels.join(','));
    await c.eval(`(document.querySelectorAll('#secNav .secbtn')[3].click(), 1)`); await sleep(600);
    ok(await c.eval(`snap.live.itemId === ${JSON.stringify(it.id)} && snap.live.index === 3`), '두 번째 후렴으로 안 넘어감');
    ok(await c.eval(`document.querySelectorAll('#secNav .secbtn')[3].classList.contains('on')`), '지금 부분 표시가 안 됨'); noErr();
  });
  await check('타이머: 0이 되면 예배당 화면에서 사라짐', async () => {
    await api('POST', '/api/live', { timer: { min: 0.05, label: '시작까지', tv: 'big' } });
    await c.go(BASE + '/output?nohint', 1200);
    const before = await c.eval(`!!document.querySelector('.wc-tm')`);
    await sleep(3500);
    const after = await c.eval(`!!document.querySelector('.wc-tm')`);
    ok(before && !after, `처음 ${before}, 0 뒤 ${after}`);
    await api('POST', '/api/live', { timer: null });
  });
  await check('👤 사람 화면(P): 그림이 나갈 때 유튜브에는 카메라만', async () => {
    const media = await api('GET', '/api/media');
    const img = media.find(m => /\.(png|jpe?g)$/i.test(m.name)) || media[0];
    const it = await api('POST', '/api/items', { type: 'score', title: '그림 점검', slides: [{ bg: img.url, fit: 'contain' }], place: true });
    await api('POST', '/api/live', { itemId: it.id, index: 0, camOnly: false });
    await c.go(BASE + '/overlay', 1500);
    const before = await c.eval(`!!document.querySelector('#screen .wc-layer .wc-bg, #screen .wc-layer video, #screen .wc-layer .wc-part')`);
    await api('POST', '/api/live', { camOnly: true }); await sleep(900);
    const after = await c.eval(`!!document.querySelector('#screen > .wc-layer:last-of-type .wc-bg, #screen > .wc-layer:last-of-type video')`);
    ok(before && !after, `켜기 전 그림 ${before}, 켠 뒤 그림 ${after}`);
    await api('POST', '/api/live', { camOnly: false });
  });
  await check('⭕ 화면 가득 + 사람 원: 방송 그림에 동그란 구멍(카메라 자리), 다른 방식은 그대로', async () => {
    const media = await api('GET', '/api/media');
    const img = media.find(m => /\.(png|jpe?g)$/i.test(m.name)) || media[0];
    const it = await api('POST', '/api/items', { type: 'score', title: '원 점검', slides: [{ bg: img.url, fit: 'contain' }], place: true });
    await api('PUT', '/api/style', { overlay: { imgMode: 'circle', circSize: 999, circPos: 'zz' } });
    let st = await api('GET', '/api/state');
    ok(st.style.overlay.imgMode === 'circle' && st.style.overlay.circSize === 60 && st.style.overlay.circPos !== 'zz', '원 설정 저장·검증: ' + JSON.stringify(st.style.overlay));
    await api('PUT', '/api/style', { overlay: { circSize: 30, circPos: 'br' } });
    await api('POST', '/api/live', { itemId: it.id, index: 0, camOnly: false });
    await c.go(BASE + '/overlay', 1500);
    const r = await c.eval(`(() => { const m = document.querySelector('#screen .wc-circ-img'), ring = document.querySelector('#screen .wc-circ');
      const b = ring && ring.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      return { img: !!(m && m.querySelector('.wc-bg, img, video')), mask: m ? (getComputedStyle(m).maskImage || getComputedStyle(m).webkitMaskImage) : '',
        round: ring ? getComputedStyle(ring).borderRadius : '', w: b ? b.width / H : 0, right: b ? b.right / W : 0, bottom: b ? b.bottom / H : 0, ph: !!document.querySelector('.wc-circ-ph') }; })()`);
    ok(r.img && /radial-gradient/.test(r.mask) && r.round === '50%' && Math.abs(r.w - 0.3) < 0.03 && r.right > 0.9 && r.bottom > 0.9 && !r.ph, '원: ' + JSON.stringify(r));
    await api('PUT', '/api/style', { overlay: { imgMode: 'full' } }); await sleep(900);
    const back = await c.eval(`!document.querySelector('#screen .wc-circ') && !!document.querySelector('#screen .wc-layer .wc-bg, #screen .wc-layer img')`);
    ok(back, '화면 가득으로 돌아오지 않음'); noErr();
  });
  await check('🖼 TV 그림 끄기(I): 예배당 화면에서 그림만 빠짐', async () => {
    const media = await api('GET', '/api/media');
    const it = await api('POST', '/api/items', { type: 'score', title: 'TV 그림 점검', slides: [{ bg: media[0].url, fit: 'contain' }, { text: '글자', img: media[1].url }], place: true });
    await api('POST', '/api/live', { itemId: it.id, index: 0, tvNoImg: false });
    await c.go(BASE + '/output?nohint', 1500);
    const pic = () => c.eval(`!!document.querySelector('#screen > .wc-layer:last-of-type .wc-bg, #screen > .wc-layer:last-of-type .wc-img')`);
    const a = await pic();
    await api('POST', '/api/live', { tvNoImg: true }); await sleep(900);
    const b = await pic();
    await api('POST', '/api/live', { index: 1 }); await sleep(900);
    const c2 = await c.eval(`({ img: !!document.querySelector('#screen > .wc-layer:last-of-type .wc-img'), text: document.querySelector('#screen > .wc-layer:last-of-type .wc-text-main')?.innerText })`);
    ok(a && !b && !c2.img && c2.text === '글자', JSON.stringify({ a, b, c2 }));
    await api('POST', '/api/live', { tvNoImg: false });
  });
  await check('예배 시간: 정하면 \'예배 시작까지\' 타이머가 바로 시작', async () => {
    const s = await api('POST', '/api/services', { name: '시간 점검 예배', template: 'wednesday' });
    ok(s.time === '19:30', '수요 예배 템플릿 기본 시각이 아님: ' + s.time);
    await openControl();
    await c.eval(`(() => { const i = document.querySelector('#tmSvcTime'); i.value = '23:59'; i.dispatchEvent(new Event('change')); return 1; })()`); await sleep(900);
    const t = await c.eval(`snap.live.timer`);
    ok(t && t.clock && t.label === '예배 시작까지' && t.end > Date.now(), JSON.stringify(t));
    const st = await api('GET', '/api/state');
    ok(st.services.find(x => x.id === st.currentServiceId)?.time === '23:59', '예배 순서에 시각이 저장 안 됨');
    await api('POST', '/api/live', { timer: null }); noErr();
  });
  await check('타이머: 시각만 정하고 [시작]을 눌러도 그 시각까지 (5분이 되지 않음)', async () => {
    await openControl();
    await c.eval(`(() => { const u = document.querySelector('#tmUntil'); u.value = '23:58'; u.dispatchEvent(new Event('input')); document.querySelector('#tmGo').click(); return 1; })()`); await sleep(800);
    const t = await c.eval(`snap.live.timer`);
    ok(t && t.clock, '시각 타이머가 아님: ' + JSON.stringify(t));
    await c.eval(`(() => { const m = document.querySelector('#tmMin'); m.value = '3'; m.dispatchEvent(new Event('input')); document.querySelector('#tmGo').click(); return 1; })()`); await sleep(800);
    const t2 = await c.eval(`snap.live.timer`);
    ok(t2 && !t2.clock && Math.abs(t2.end - Date.now() - 180000) < 5000, '3분 타이머가 아님: ' + JSON.stringify(t2));
    ok(await c.eval(`(() => { const b = document.querySelector('#tmUntilGo').getBoundingClientRect(), p = document.querySelector('#tools').getBoundingClientRect(); return b.right <= p.right + 1; })()`), '[까지 시작] 단추가 칸 밖으로 잘림');
    await api('POST', '/api/live', { timer: null }); noErr();
  });
  await check('타이머: 배경 위에 타이머만(로고처럼) + 유튜브에도, 0이 되면 슬라이드로', async () => {
    const media = await api('GET', '/api/media');
    await api('POST', '/api/live', { itemId: song.id, index: 0 });
    await api('POST', '/api/live', { mediaBg: media.find(m => /mp4$/i.test(m.name)).url });
    await api('POST', '/api/live', { timer: { min: 0.08, label: '예배 시작까지', tv: 'over', obs: true } });
    await c.go(BASE + '/output?nohint', 1500);
    const tv = await c.eval(`({ tm: !!document.querySelector('.wc-tm-over'), text: document.querySelector('#screen > .wc-layer:last-of-type .wc-text-main')?.innerText || '', bg: !!document.querySelector('.wc-mlayer video') })`);
    ok(tv.tm && !tv.text && tv.bg, '예배당: ' + JSON.stringify(tv));
    await c.go(BASE + '/overlay', 1500);
    const ob = await c.eval(`({ tm: !!document.querySelector('.wc-tm-over'), bar: !!document.querySelector('.wc-ov') })`);
    ok(ob.tm && !ob.bar, '유튜브: ' + JSON.stringify(ob));
    await c.go(BASE + '/output?nohint', 800);
    let back = false;
    for (let i = 0; i < 16 && !back; i++) { await sleep(500); back = await c.eval(`!document.querySelector('.wc-tm-over') && (document.querySelector('#screen > .wc-layer:last-of-type .wc-text-main')?.innerText || '').includes('첫 줄')`); }
    ok(back, '0이 된 뒤 슬라이드로 안 돌아옴');
    await api('POST', '/api/live', { timer: null, reset: true }); noErr();
  });
  await check('▶ 유튜브 영상: 운영 화면에서 띄우고 예배당·프롬프터에 나오고 끄기', async () => {
    await openControl();
    await c.eval(`(document.querySelector('#ytBox').open = true, document.querySelector('#ytUrl').value = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', document.querySelector('#ytOpen').click(), 1)`);
    await sleep(1000);
    let st = await api('GET', '/api/state');
    ok(st.live.live.yt?.id === 'aqz-KE-bpKQ' && st.live.live.yt.playing, '띄우기 안 됨: ' + JSON.stringify(st.live.live.yt));
    ok(await c.eval(`!document.querySelector('#ytCtl').classList.contains('hidden') && !!document.querySelector('#pvMain > .wc-yt')`), '조작판·미리보기가 안 보임');
    await c.eval(`(document.querySelector('#ytPlay').click(), 1)`); await sleep(600);
    st = await api('GET', '/api/state'); ok(!st.live.live.yt.playing, '⏸ 일시정지 안 됨');
    await c.eval(`(document.querySelector('#ytStage').click(), 1)`); await sleep(400);   // 프롬프터에서 빼기
    st = await api('GET', '/api/state'); ok(st.live.live.yt.stage === false, '프롬프터 끄기 안 됨');
    await c.go(BASE + '/output?nohint', 1500);
    ok(await c.eval(`!!document.querySelector('#screen > .wc-yt .wc-yt-in')`), '예배당 화면에 영상 자리가 없음');
    await c.go(BASE + '/stage', 1200);
    ok(!(await c.eval(`!!document.querySelector('#screen > .wc-yt')`)), '프롬프터에서 뺐는데 나옴');
    await api('POST', '/api/live', { yt: { stage: true } }); await sleep(600);
    ok(await c.eval(`!!document.querySelector('#screen > .wc-yt')`), '프롬프터에 다시 안 나옴');
    await openControl();
    await c.eval(`(document.querySelector('#ytStop').click(), 1)`); await sleep(600);
    st = await api('GET', '/api/state'); ok(st.live.live.yt === null, '⏹ 끄기 안 됨');
    ok(await c.eval(`document.querySelector('#ytCtl').classList.contains('hidden')`), '끈 뒤에도 조작판이 보임');
  });
  await check('휴대폰 리모컨: 허용·PIN 화면', async () => {
    await api('PUT', '/api/settings', { remote: true });
    await c.go(BASE + '/remote', 1500);
    ok(await c.eval(`!!document.querySelector('.big') || !!document.querySelector('#pin')`), '리모컨이 안 그려짐'); noErr();
  });

  // ── 자동 업데이트: 가짜 배포(이 컴퓨터 안)에서 받아 확인값 대조 → 자료 폴더에 설치 → 새 버전으로 다시 켜짐 ──
  await check('🔔 자동 업데이트: 안내 창·확인값 틀리면 거절·서명이 틀리면 거절·설치 뒤 새 버전으로 다시 켜짐·자료 그대로·받아 둔 파일이 바뀌면 실행 안 함·서명이 없으면 자동 설치 안 함', async () => {
    const updater = require('../lib/updater');
    ok((() => { try { updater.unpack(require('zlib').gzipSync(Buffer.concat([Buffer.from('WCU1'), (b => (b.writeUInt32BE(JSON.stringify({ version: '1.0.0', files: [['../evil.js', 1]] }).length), b))(Buffer.alloc(4)), Buffer.from(JSON.stringify({ version: '1.0.0', files: [['../evil.js', 1]] })), Buffer.from('x')]))); return false; } catch { return true; } })(), '묶음 밖 경로(../)를 막지 않음');
    // 가짜 새 버전 99.0.0 (부품 node_modules 는 위 폴더의 것을 씀 → 시험 자료 폴더를 저장소 안 임시 폴더로)
    const D2 = fs.mkdtempSync(path.join(ROOT, 'tests', '.upd-'));
    const NEW = path.join(D2, 'src');
    try {
      for (const f of ['server.js', 'package.json', 'lib', 'public']) fs.cpSync(path.join(ROOT, f), path.join(NEW, f), { recursive: true, filter: x => !x.includes(path.join('public', 'samples')) });
      const pj = JSON.parse(fs.readFileSync(path.join(NEW, 'package.json'))); pj.version = '99.0.0'; fs.writeFileSync(path.join(NEW, 'package.json'), JSON.stringify(pj));
      const pkg = updater.pack(NEW);
      // 시험용 서명 열쇠 (실제 열쇠는 쓰지 않음). 앱에는 WC_UPDATE_PUBKEY 로 시험용 공개 열쇠를 알려 줌 (가짜 배포를 쓸 때만 통함)
      const crypto = require('crypto');
      const key = crypto.generateKeyPairSync('ed25519'), other = crypto.generateKeyPairSync('ed25519');
      const signWith = (k, d) => crypto.sign(null, Buffer.from(d), k.privateKey).toString('base64');
      ok(!updater.verifySig('가', signWith(key, '가')), '시험용 공개 열쇠 없이도 서명이 맞다고 함');
      let sums = '0'.repeat(64) + '  WorshipCaster-update.wcu\n';   // 처음엔 틀린 확인값
      let sig = signWith(key, sums), noSig = false;
      const http = require('http');
      const mock = http.createServer((q, r) => {
        const M = `http://localhost:${mock.address().port}`;
        if (q.url === '/release') return r.end(JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com/x', body: '## 예배송출 v99.0.0\n\n### 새로 생긴 것\n- **점검용 새 기능**\n\n### 받기\n| 표 |',
          assets: [{ name: 'WorshipCaster-update.wcu', browser_download_url: M + '/pkg' }, { name: 'SHA256SUMS.txt', browser_download_url: M + '/sums' },
            ...(noSig ? [] : [{ name: 'SHA256SUMS.txt.sig', browser_download_url: M + '/sig' }])] }));
        if (q.url === '/pkg') return r.end(pkg);
        if (q.url === '/sums') return r.end(sums);
        if (q.url === '/sig') return r.end(sig);
        r.statusCode = 404; r.end();
      }).listen(0);
      await sleep(200);
      const P2 = PORT + 30, B2 = `http://localhost:${P2}`;
      const DATA2 = path.join(D2, 'data');
      const env2 = { ...process.env, WC_DATA_DIR: DATA2, NO_OPEN: '1', WC_UPDATE_API: `http://localhost:${mock.address().port}/release`, WC_UPDATE_PUBKEY: updater.publicKeyText(key.publicKey) };
      const s2 = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...env2, PORT: String(P2) }, stdio: 'ignore' });
      let s3;
      const get = async u => (await fetch(B2 + u, { headers: { Origin: B2 } })).json();
      const post = async (u, b) => (await fetch(B2 + u, { method: 'POST', headers: { Origin: B2, 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
      try {
        for (let i = 0; i < 50; i++) { try { await fetch(B2 + '/api/me'); break; } catch { await sleep(200); } }
        const item = await post('/api/items', { type: 'song', title: '업데이트 전 찬양', slides: [{ text: '가' }] });
        const u = await get('/api/update');
        ok(u.newer && u.latest === '99.0.0' && u.canInstall, '새 버전을 못 찾음: ' + JSON.stringify(u));
        ok(u.notes.includes('점검용 새 기능') && !u.notes.includes('받기'), '업데이트 내용이 이상함: ' + u.notes);
        // 운영 화면에 안내 창이 저절로 뜸
        await c.go(B2 + '/control', 2500);
        const dl = await c.eval(`({ open: !!document.querySelector('#updDlg')?.open, t: document.querySelector('#updDlg')?.innerText || '', btn: !!document.querySelector('#updBtn') })`);
        ok(dl.open && dl.t.includes('v99.0.0') && dl.t.includes('점검용 새 기능') && dl.t.includes('지금 업데이트') && dl.btn, '안내 창: ' + JSON.stringify(dl));
        await c.eval(`(document.querySelector('#updDlg .upd-later').click(), 1)`);
        // 확인값이 틀리면 설치하지 않음
        const bad = await post('/api/update/install');
        ok(/확인값/.test(bad.error || '') && !fs.existsSync(path.join(DATA2, 'app-update', 'current.json')), '틀린 확인값인데 설치함: ' + JSON.stringify(bad));
        // 확인값은 맞아도 서명이 다른 열쇠로 되어 있으면 설치하지 않음 (깃허브 계정을 빼앗겨 바꿔치기한 경우)
        sums = updater.sha256(pkg) + '  WorshipCaster-update.wcu\n';
        sig = signWith(other, sums);
        const forged = await post('/api/update/install');
        ok(/서명/.test(forged.error || '') && forged.manual && !fs.existsSync(path.join(DATA2, 'app-update', 'current.json')), '서명이 틀린데 설치함: ' + JSON.stringify(forged));
        sig = signWith(key, sums);
        const boot0 = (await get('/api/boot')).boot;
        const r = await post('/api/update/install');
        ok(r.ok && r.version === '99.0.0' && r.restart, '설치 실패: ' + JSON.stringify(r));
        let now = null;
        for (let i = 0; i < 60; i++) { await sleep(300); try { const b = await get('/api/boot'); if (b.boot !== boot0) { now = await get('/api/update'); break; } } catch {} }
        ok(now && now.current === '99.0.0', '다시 켜진 뒤 새 버전이 아님: ' + JSON.stringify(now));
        const st = await get('/api/state');
        ok(st.items.some(i => i.id === item.id && i.title === '업데이트 전 찬양'), '업데이트 뒤 자료가 사라짐');
        ok(fs.existsSync(path.join(DATA2, 'db-before-v99.0.0.json')), '업데이트 전 자료 한 벌이 없음');
        await post('/api/quit');
        await sleep(800);
        // 받아 둔 프로그램 파일을 누가 바꾸면, 켤 때 확인해서 실행하지 않고 앱에 든 버전으로 켬
        const V = path.join(DATA2, 'app-update', '99.0.0');
        ok(fs.existsSync(path.join(V, '.SHA256SUMS.txt.sig')), '설치 때 서명을 남겨 두지 않음');
        fs.appendFileSync(path.join(V, 'lib', 'updater.js'), '\n// 바꿔치기\n');
        // 이번 배포에는 서명 파일이 없음 → 자동 설치 대신 [받는 곳 열기]
        noSig = true;
        const P3 = P2 + 1, B3 = `http://localhost:${P3}`;
        s3 = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...env2, PORT: String(P3) }, stdio: 'ignore' });
        for (let i = 0; i < 50; i++) { try { await fetch(B3 + '/api/me'); break; } catch { await sleep(200); } }
        const g3 = async u => (await fetch(B3 + u, { headers: { Origin: B3 } })).json();
        const u3 = await g3('/api/update');
        ok(u3.current === require('../package.json').version, '바뀐 파일이 있는데 받아 둔 버전으로 켜짐: ' + JSON.stringify(u3));
        ok(!fs.existsSync(V) && fs.readdirSync(path.join(DATA2, 'app-update', 'bad')).some(f => /^99\.0\.0/.test(f)), '바뀐 받아 둔 버전을 치우지 않음');
        ok(u3.newer && !u3.canInstall, '서명 파일이 없는데 자동 설치를 하겠다고 함: ' + JSON.stringify(u3));
        const ns = await (await fetch(B3 + '/api/update/install', { method: 'POST', headers: { Origin: B3, 'Content-Type': 'application/json' }, body: '{}' })).json();
        ok(ns.manual && /서명/.test(ns.error || '') && !fs.existsSync(path.join(DATA2, 'app-update', 'current.json')), '서명 파일이 없는데 설치함: ' + JSON.stringify(ns));
        await c.go(B3 + '/control', 2500);
        const d3 = await c.eval(`({ open: !!document.querySelector('#updDlg')?.open, go: document.querySelector('#updDlg .upd-go')?.textContent || '' })`);
        ok(d3.open && d3.go.includes('받는 곳 열기'), '서명이 없을 때 안내 창 단추: ' + JSON.stringify(d3));
        await c.eval(`(document.querySelector('#updDlg .upd-later').click(), 1)`);
        await fetch(B3 + '/api/quit', { method: 'POST', headers: { Origin: B3 } }).catch(() => {});
      } finally { s2.kill(); s3?.kill(); mock.close(); try { await fetch(B2 + '/api/quit', { method: 'POST', headers: { Origin: B2 } }); } catch {} }
      await sleep(500);
    } finally { fs.rmSync(D2, { recursive: true, force: true }); }
  });
}

main().catch(e => { results.push([false, '점검 도중 멈춤', e.stack]); console.log(e); }).finally(async () => {
  chrome?.close(); srv?.kill();
  await sleep(300);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  const bad = results.filter(r => !r[0]);
  console.log(`\n${bad.length ? '✗' : '✓'} ${results.length - bad.length}/${results.length} 통과${bad.length ? ' — 실패: ' + bad.map(r => r[1]).join(', ') : ''}\n`);
  process.exit(bad.length ? 1 : 0);
});
