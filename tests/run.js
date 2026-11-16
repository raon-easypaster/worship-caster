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
  const openControl = async () => { await c.go(BASE + '/control', 2500); await c.eval(`(document.querySelector('#wnTake')?.click(), 1)`); await sleep(300); };
  const noErr = () => { const e = c.errors.splice(0); ok(!e.length, '화면 오류: ' + e.join(' | ')); };
  await openControl();
  await check('운영 화면이 오류 없이 열림', async () => { ok(await c.eval(`!!document.querySelector('#slides')`), '운영 화면이 안 그려짐'); noErr(); });
  // 맨 위·왼쪽 단추를 실제로 눌러 창이 열리는지 (v0.4.0~0.11.0 자막 스타일 단추 버그 같은 것 방지)
  for (const [sel, name] of [['#styleBtn', '🎨 자막 스타일'], ['#settingsBtn', '⚙︎ 설정'], ['#obsBtn', '🎥 OBS 자막 주소'], ['#mediaBtn', '🖼 미디어'],
    ['#newSong', '＋ 찬양'], ['#newBible', '＋ 성경'], ['#newHymn', '＋ 찬송가'], ['#newPhrase', '＋ 문구·성찬'], ['#newNotice', '＋ 광고'],
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
  await check('휴대폰 리모컨: 허용·PIN 화면', async () => {
    await api('PUT', '/api/settings', { remote: true });
    await c.go(BASE + '/remote', 1500);
    ok(await c.eval(`!!document.querySelector('.big') || !!document.querySelector('#pin')`), '리모컨이 안 그려짐'); noErr();
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
