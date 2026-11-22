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

// 시험용 PDF (가로 16:9, n쪽) — 'PPT 그림으로 가져오기'의 변환 결과 대신 씀
function makePdf(n = 2) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  for (let i = 0; i < n; i++) {
    const pg = 3 + i * 2, ct = pg + 1, body = `0.2 0.3 0.5 rg 0 0 960 540 re f 1 1 1 rg 100 100 ${200 + i * 100} 200 re f`;
    kids.push(`${pg} 0 R`);
    objs[pg - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${ct} 0 R >>`;
    objs[ct - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const TEST_PDF = path.join(DATA, '..', path.basename(DATA) + '-ppt.pdf');

async function main() {
  console.log(`\n예배송출 자동 점검 — 시험 서버 ${BASE}, 시험 자료 ${DATA}\n`);
  fs.writeFileSync(TEST_PDF, makePdf(2));   // 실제 리브레오피스·키노트·파워포인트는 켜지 않음
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), WC_DATA_DIR: DATA, NO_OPEN: '1', WC_TEST_PPT_PDF: TEST_PDF }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await check('PPT 그림으로 가져오기(서버): PDF로 바꿔 돌려줌 · 이상한 파일·이름만 PPT인 파일은 막음 · 매크로는 실행 안 함 · 폴더 항목 든 .pptx 다시 묶기 · 맥은 리브레오피스→이음오피스→키노트, 윈도우는 파워포인트→리브레오피스 · 없으면 PDF로 넣으라는 안내 · 키노트가 못 여는 파일이면 키노트를 끄고 리브레오피스 설치 안내 · 맥은 이음오피스도 씀(키노트보다 먼저)', async () => {
    const JSZip = require(path.join(ROOT, 'node_modules', 'jszip'));
    const z = new JSZip(); z.folder('ppt'); z.file('ppt/presentation.xml', '<p/>'); z.file('[Content_Types].xml', '<Types/>');
    const pptx = await z.generateAsync({ type: 'nodebuffer' });
    const fd = new FormData(); fd.append('file', new Blob([pptx]), '강의.pptx');
    const r = await fetch(BASE + '/api/pptx-pdf', { method: 'POST', headers: { Origin: BASE }, body: fd });
    const buf = Buffer.from(await r.arrayBuffer());
    ok(r.ok && buf.slice(0, 5).toString() === '%PDF-', 'PDF가 오지 않음: ' + r.status + ' ' + buf.slice(0, 80));
    const fd2 = new FormData(); fd2.append('file', new Blob(['x']), 'a.exe');
    const r2 = await fetch(BASE + '/api/pptx-pdf', { method: 'POST', headers: { Origin: BASE }, body: fd2 });
    ok(r2.status === 400, '.exe 를 막지 않음: ' + r2.status);
    const fd3 = new FormData(); fd3.append('file', new Blob(['<html>not ppt</html>']), '가짜.pptx');
    const r3 = await fetch(BASE + '/api/pptx-pdf', { method: 'POST', headers: { Origin: BASE }, body: fd3 });
    ok(r3.status === 400, '이름만 .pptx 인 가짜 파일을 막지 않음: ' + r3.status);
    const conv = require(path.join(ROOT, 'lib', 'ppt-convert'));
    const tmp = path.join(DATA, 'repack.pptx'); fs.writeFileSync(tmp, pptx);
    ok(await conv.repackPptx(tmp), '폴더 항목이 있는데 다시 묶지 않음');
    const z2 = await JSZip.loadAsync(fs.readFileSync(tmp)), names = Object.keys(z2.files);
    ok(!names.some(n => z2.files[n].dir) && names[0] === '[Content_Types].xml' && names.includes('ppt/presentation.xml'), '다시 묶은 순서·내용: ' + names.join(','));
    const has = list => p => list.some(x => p.includes(x));
    ok(conv.converters('darwin', has(['LibreOffice.app', 'Keynote.app'])).map(c => c.name).join() === '리브레오피스,키노트', '맥 순서');
    ok(conv.converters('darwin', has(['Keynote.app'])).map(c => c.name).join() === '키노트', '맥 키노트만');
    ok(conv.converters('darwin', has(['LibreOffice.app', 'IeumOffice.app', 'Keynote.app'])).map(c => c.name).join() === '리브레오피스,이음오피스,키노트', '맥에 이음오피스가 있으면 리브레오피스 다음, 키노트 앞에 씀');
    ok(conv.converters('win32', has(['IeumOffice.app'])).every(c => c.name !== '이음오피스'), '윈도우에 맥용 이음오피스 경로를 씀');
    await conv.converters('darwin', has(['IeumOffice.app']))[0].run('/x/a.key', '/x/a.pdf').then(() => ok(false, '이음오피스로 .key 를 바꾸려 함'), e => ok(/pptx/.test(e.message), e.message));
    ok(conv.converters('darwin', () => false).length === 0, '맥에 아무것도 없을 때');
    ok(conv.converters('win32', has(['LibreOffice'])).map(c => c.name).join() === '파워포인트,리브레오피스', '윈도우 순서');
    ok(/front document/.test(conv.KEYNOTE_SCRIPT) && !/set d to open/.test(conv.KEYNOTE_SCRIPT), "키노트 14는 'set d to open' 문서를 내보내면 죽음 → 맨 앞 문서로");
    ok(/SaveAs\(\$out, 32\)/.test(conv.POWERPOINT_PS1) && /Presentations\.Open\(\$in, -1, 0, 0\)/.test(conv.POWERPOINT_PS1), '파워포인트: 창 없이 읽기 전용으로 열어 PDF(32)로');
    ok(/AutomationSecurity = 3/.test(conv.POWERPOINT_PS1), '파워포인트에서 매크로를 막지 않음');
    ok(/on error[\s\S]*if not wasRunning then do shell script "killall Keynote/.test(conv.KEYNOTE_SCRIPT), '키노트가 못 여는 파일일 때 오류 창 뜬 키노트를 그대로 둠');
    ok(/리브레오피스\(libreoffice\.org\)/.test(conv.failMessage(['키노트: 못 엶'], false, 'darwin')) && !/libreoffice\.org/.test(conv.failMessage(['리브레오피스: x'], true, 'darwin')), '바꾸지 못했을 때 리브레오피스 설치 안내가 없음(또는 이미 있는데 권함)');
    if (process.platform === 'darwin') {
      const out = path.join(DATA, 'kn.scpt');
      require('child_process').execFileSync('osacompile', ['-o', out, '-e', conv.KEYNOTE_SCRIPT]);   // 문법만 확인 (실행하지 않음)
    }
    const save = process.env.WC_TEST_PPT_PDF; process.env.WC_TEST_PPT_PDF = '';
    try { await conv.pptToPdf(tmp, '.pptx'); ok(false, '변환 프로그램이 없는데 성공함'); }
    catch (e) { ok(e.code === 'NO_CONVERTER' && /PDF·악보/.test(e.message), '안내 문구: ' + e.message); }
    finally { if (save === undefined) delete process.env.WC_TEST_PPT_PDF; else process.env.WC_TEST_PPT_PDF = save; }
  });
  await check("PPT 방송: 글자로 가져온 PPT 슬라이드도 방송(OBS)에는 자막 글자가 아니라 PPT 화면 그대로 (그림 보내기 '사람 원'·'화면 일부'가 적용됨)", async () => {
    const it = await api('POST', '/api/items', { type: 'ppt', title: '방송점검 PPT', slides: [{ text: '제목 글자', ppt: true, elements: [{ id: 'e1', type: 'text', x: 5, y: 5, w: 90, h: 20, text: '제목 글자', size: 40 }] }] });
    const r = fs.readFileSync(path.join(ROOT, 'public', 'render.js'), 'utf8');
    ok(/const isVisual = s => [^\n]*s\.ppt/.test(r), "PPT 슬라이드(s.ppt)를 그림으로 보지 않음");
    ok((await api('GET', '/api/state')).items.find(i => i.id === it.id).slides[0].ppt === true, "PPT 표시(ppt)가 저장되지 않음");
    await api('DELETE', '/api/items/' + it.id);
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
  await check('📜 전체 이어 보기: 켜면 자료 끝에서 다음 자료로(빈 자료는 건너뜀)·처음에서 앞 자료 끝으로·다음 미리보기, 끄면 지금처럼 자료 안에서 멈춤', async () => {
    const before = (await api('GET', '/api/state')).currentServiceId;
    await api('POST', '/api/services', { name: '이어 보기 점검' });
    const mk = (title, texts) => api('POST', '/api/items', { type: 'text', title, slides: texts.map(text => ({ text })), place: true });
    const A = await mk('이어A', ['A1', 'A2']), E = await mk('이어빈', []), B = await mk('이어B', ['B1']);
    try {
      let s = await api('POST', '/api/live', { itemId: A.id, index: 1 });
      ok(s.next === null, '꺼져 있을 때 마지막 장의 다음이 있음: ' + JSON.stringify(s.next));
      s = await api('POST', '/api/live', { step: 1 }); ok(s.live.itemId === A.id && s.live.index === 1, '꺼져 있는데 다음 자료로 넘어감');
      await api('PUT', '/api/settings', { continuous: true });
      s = await api('POST', '/api/live', { itemId: A.id, index: 1 }); ok(s.next?.text === 'B1', '다음 미리보기가 다음 자료 첫 장이 아님: ' + JSON.stringify(s.next));
      s = await api('POST', '/api/live', { step: 1 }); ok(s.live.itemId === B.id && s.live.index === 0 && s.slide?.text === 'B1', '다음 자료로 안 넘어감(빈 자료를 건너뛰어야 함): ' + JSON.stringify(s.live));
      s = await api('POST', '/api/live', { step: 1 }); ok(s.live.itemId === B.id && s.live.index === 0, '마지막 자료 끝에서 더 넘어감');
      s = await api('POST', '/api/live', { step: -1 }); ok(s.live.itemId === A.id && s.live.index === 1, '앞 자료 마지막 장으로 안 돌아감: ' + JSON.stringify(s.live));
      s = await api('POST', '/api/live', { step: -1 }); ok(s.live.itemId === A.id && s.live.index === 0, '자료 안에서 이전이 안 됨');
    } finally {
      await api('PUT', '/api/settings', { continuous: false });
      await api('PUT', '/api/current-service', { id: before });
      await api('POST', '/api/live', { reset: true });
    }
    ok(E.id, '빈 자료가 안 만들어짐');
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
  await check('찬송가: 제목 없는 "N장" 줄 · 한 곡 한 파일(파일 이름 번호) · 여러 파일 한꺼번에 · EUC-KR · 못 읽은 파일 알림', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['990장\n1. 제목 없는 곡\n둘째 줄\n']), 'many.txt');                       // 제목 없이 'N장'만
    fd.append('file', new Blob(['1. 파일 이름 번호 곡\n둘째 줄\n\n후렴\n아멘\n']), '991장.txt');            // 안에 번호 없음 → 파일 이름
    fd.append('file', new Blob(['제992장 (통405) 옛 번호 붙은 곡\n1. 가사\n']), 'x.txt');                    // '제N장' · (통N) 빼기
    fd.append('file', new Blob([Buffer.from([0x31, 0x2e, 0x20, 0xc7, 0xd1, 0xb1, 0xdb, 0x0a])]), '993.txt');   // EUC-KR '1. 한글'
    fd.append('file', new Blob(['번호가 어디에도 없는 글\n']), '주보.txt');
    const r = await api('POST', '/api/hymns/upload', fd);
    ok(r.count === 4 && r.failed?.length === 1 && r.failed[0] === '주보.txt', JSON.stringify(r));
    const h = n => api('GET', '/api/hymns/' + n);
    ok((await h(990)).title === '찬송가 990장 제목 없는 곡', '제목 없는 곡: ' + (await h(990)).title);
    const h991 = await h(991); ok(h991.title === '찬송가 991장 파일 이름 번호 곡' && h991.arr.join(',') === '1절,후렴', JSON.stringify(h991));
    ok((await h(992)).title === '찬송가 992장 옛 번호 붙은 곡', '제N장: ' + (await h(992)).title);
    ok((await h(993)).lyrics.includes('한글'), 'EUC-KR: ' + (await h(993)).lyrics);
    const bad = new FormData(); bad.append('file', new Blob(['아무 번호 없음']), '가사.txt');
    ok((await api('POST', '/api/hymns/upload', bad, { allowFail: true })).status === 400, '못 읽는 파일을 받아들임');
  });
  await check('예배 순서 복제: 바로 아래에 따로 떨어진 사본 (고쳐도 원본 그대로)', async () => {
    const svc = await api('POST', '/api/services', { name: '복제 점검 예배' });
    const a = await api('POST', '/api/items', { type: 'notice', title: '복제 원본', theme: 'notice', slides: [{ text: '원본 글' }, { text: '둘째' }], place: true });
    const b = await api('POST', '/api/items', { type: 'notice', title: '다음 순서', slides: [{ text: '다음' }], place: true });
    await api('PUT', '/api/services/' + svc.id, { itemIds: [a.id, b.id] });
    const cp = await api('POST', `/api/items/${a.id}/copy`, { serviceId: svc.id });
    ok(cp.id !== a.id && cp.title === '복제 원본 (복사)' && cp.theme === 'notice' && cp.slides.length === 2 && cp.slides[0].id !== a.slides[0].id, JSON.stringify(cp));
    let st = await api('GET', '/api/state');
    ok(st.services.find(x => x.id === svc.id).itemIds.join() === [a.id, cp.id, b.id].join(), '바로 아래에 들어가지 않음');
    await api('PUT', '/api/items/' + cp.id, { slides: [{ text: '사본만 고침' }] });
    st = await api('GET', '/api/state');
    ok(st.items.find(i => i.id === a.id).slides[0].text === '원본 글', '사본을 고쳤더니 원본도 바뀜');
    ok((await api('POST', '/api/items/nope/copy', {}, { allowFail: true })).status === 404, '없는 자료를 복제함');
    await api('DELETE', '/api/services/' + svc.id).catch(() => {});
  });
  await check('🎨 내 모양: 저장(이상한 값 걸러짐) · 새로 넣을 때 기본 모양 · 지우면 그 모양을 쓰던 자료는 기본으로 · 백업에 들어감', async () => {
    const r = await api('PUT', '/api/themes/my_testa', { name: '우리 말씀', base: 'word', bg: '#3a1f0f', color: 'red;}', font: "x</style>", size: 99, bgImg: 'http://evil/x.png', motion: 'water', bold: false, evil: 1 });
    ok(r.theme.bg === '#3a1f0f' && !r.theme.color && !r.theme.font && r.theme.size === 30 && !r.theme.bgImg && r.theme.motion === 'water' && r.theme.bold === false && !('evil' in r.theme), JSON.stringify(r.theme));
    ok((await api('PUT', '/api/themes/word', { name: 'x' }, { allowFail: true })).status === 400, '기본 모양 이름표로 저장됨');
    await api('PUT', '/api/settings', { themeDefaults: { bible: 'my_testa', notice: 'my_nothere', song: '' } });
    let st = await api('GET', '/api/state');
    ok(st.settings.themes.my_testa?.name === '우리 말씀' && st.settings.themeDefaults.bible === 'my_testa' && !('notice' in st.settings.themeDefaults), JSON.stringify(st.settings.themeDefaults));
    ok(st.live.themes?.my_testa, '송출 화면에 내 모양이 안 감');
    const it = await api('POST', '/api/items', { type: 'bible', title: '모양 점검', theme: 'my_testa', slides: [{ text: '말씀' }] });
    ok(it.theme === 'my_testa', '자료에 내 모양이 안 붙음');
    // 백업 → 지우기 → 되살리기 하면 내 모양이 돌아옴
    const zip = await (await fetch(BASE + '/api/backup')).arrayBuffer();
    await api('DELETE', '/api/themes/my_testa');
    st = await api('GET', '/api/state');
    ok(!st.settings.themes.my_testa && st.items.find(i => i.id === it.id).theme === '' && !st.settings.themeDefaults.bible, '지운 모양이 남음');
    const fd = new FormData(); fd.append('file', new Blob([zip]), 'b.zip'); await api('POST', '/api/restore', fd);
    st = await api('GET', '/api/state');
    ok(st.settings.themes.my_testa?.bg === '#3a1f0f' && st.settings.themeDefaults.bible === 'my_testa', '백업에서 내 모양이 안 돌아옴');
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
  await check("가사 찾기: 사이트가 막거나 느리면 '인터넷 끊김'이라고 하지 않음, 정말 끊겼을 때만 인터넷 안내 · 벅스가 막으면 [벅스에서 찾기] 안내", async () => {
    const http = require('http');
    // 가짜 가사 사이트: LRCLIB 는 처음 한 번 500 뒤 결과, 벅스는 늘 429 (자동 검색 막음)
    let lrcHits = 0, mode = 'retry-ok';
    const mock = http.createServer((req, res) => {
      if (req.url.startsWith('/api/search')) {
        lrcHits++;
        if (mode === 'down' || (mode === 'retry-ok' && lrcHits === 1)) { res.writeHead(500); return res.end('err'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ trackName: '점검 찬양', artistName: '점검', plainLyrics: '첫 줄\n둘째 줄' }]));
      }
      res.writeHead(429, { 'Retry-After': '1' }); res.end('잠시만 기다려 주세요');
    });
    await new Promise(r => mock.listen(0, r));
    const MB = `http://localhost:${mock.address().port}`;
    // 열려 있지 않은 곳 = 연결 불가 (빈 번호를 잠깐 잡았다 놓음)
    const freePort = await new Promise(r => { const t = http.createServer(); t.listen(0, () => { const p = t.address().port; t.close(() => r(p)); }); });
    const dead = `http://127.0.0.1:${freePort}`;
    const run = async (env, fn) => {
      const D = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-lyr-')), P = PORT + 50, B = `http://localhost:${P}`;
      const s2 = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(P), WC_DATA_DIR: D, NO_OPEN: '1', ...env }, stdio: 'ignore' });
      try {
        for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/me'); break; } catch { await sleep(200); } }
        const r = await fetch(B + '/api/lyrics?q=' + encodeURIComponent('점검'), { headers: { Origin: B } });
        return await fn(r.status, await r.json(), r.headers);
      } finally { s2.kill(); await sleep(300); fs.rmSync(D, { recursive: true, force: true }); }
    };
    try {
      // 1) LRCLIB 가 한 번 실패해도 다시 물어 찾음, 벅스가 막혀도 결과는 나옴
      await run({ WC_LYRICS_LRCLIB: MB, WC_LYRICS_BUGS: MB }, (st, j, h) => {
        ok(st === 200 && Array.isArray(j) && j[0]?.title === '점검 찬양', `다시 묻기가 안 됨: ${st} ${JSON.stringify(j).slice(0, 120)}`);
        ok(h.get('x-wc-bugs') === 'blocked', '벅스가 막혔다는 표시가 화면에 안 감');
        ok(lrcHits === 2, 'LRCLIB 에 다시 묻지 않음: ' + lrcHits);
      });
      // 2) 둘 다 사이트 문제(500·429) → 인터넷이 아니라 '사이트가 대답하지 않음'
      mode = 'down';
      await run({ WC_LYRICS_LRCLIB: MB, WC_LYRICS_BUGS: MB }, (st, j) => {
        ok(st === 502 && j.code === 'busy' && !/인터넷에 연결/.test(j.error) && /벅스/.test(j.error), `사이트 문제를 인터넷 끊김으로 알림(또는 벅스 안내 없음): ${JSON.stringify(j)}`);
      });
      // 3) 정말 연결이 안 되면 인터넷 안내
      await run({ WC_LYRICS_LRCLIB: dead, WC_LYRICS_BUGS: dead }, (st, j, h) => {
        ok(st === 502 && j.code === 'offline' && /인터넷/.test(j.error), `연결 불가인데 인터넷 안내가 없음: ${JSON.stringify(j)}`);
        ok(!h.get('x-wc-bugs'), '인터넷이 끊겼는데 벅스가 막았다고 함');
      });
    } finally { mock.close(); }
  });
  await check('설정: 언어·화면 비율·스타일 저장', async () => {
    await api('PUT', '/api/style', { main: { aspect: '4:3', size: 7 } });
    const st = await api('GET', '/api/state'); ok(st.style.main.aspect === '4:3' && st.style.main.size === 7, '스타일 저장 안 됨');
    await api('PUT', '/api/style', { main: { aspect: '16:9' } });
  });

  await check('🎨 자막 스타일 종류별(서버): 광고만 따로 저장 · 이상한 값·화면 비율은 걸러짐 · 전체 글자 크기를 바꿔도 종류별 값은 남음 · 백업에 들어감', async () => {
    const r = await api('PUT', '/api/style', { main: {}, overlay: {}, byType: { notice: { main: { bg: '#123456', color: 'red;}', aspect: '4:3', size: 99 }, overlay: { box: '#aa0000', position: 'top' } }, ppt: { main: { bg: '#ffffff' } }, song: { main: {}, overlay: {} } } });
    ok(r.byType?.notice?.main?.bg === '#123456' && !r.byType.notice.main.color && !('aspect' in r.byType.notice.main) && r.byType.notice.main.size === 30, JSON.stringify(r.byType));
    ok(r.byType.notice.overlay.position === 'top' && !r.byType.ppt && !r.byType.song, '빈 종류·없는 종류가 남음: ' + JSON.stringify(r.byType));
    await api('PUT', '/api/style', { main: { size: 6.4 } });   // 운영 화면 글자 －＋ 처럼 byType 없이 보냄
    let st = await api('GET', '/api/state');
    ok(st.style.byType?.notice?.overlay?.box === '#aa0000' && st.style.main.size === 6.4, '전체를 바꾸면 종류별 값이 사라짐');
    const zip = await (await fetch(BASE + '/api/backup')).arrayBuffer();
    await api('PUT', '/api/style', { byType: {} });
    ok(!(await api('GET', '/api/state')).style.byType, '되돌리기(빈 값)가 안 됨');
    const fd = new FormData(); fd.append('file', new Blob([zip]), 'b.zip'); await api('POST', '/api/restore', fd);
    st = await api('GET', '/api/state');
    ok(st.style.byType?.notice?.main?.bg === '#123456', '백업에서 종류별 스타일이 안 돌아옴');
    await api('PUT', '/api/style', { byType: {} });
  });

  await check('미디어 여러 개 한 번에 지우기(서버): 고른 것만 지움 · 지금 배경이면 끔 · 자료 폴더 밖 파일은 못 지움', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); ['mdel_a.png', 'mdel_b.png', 'mdel_c.png'].forEach(n => fd.append('files', new Blob([png]), n));
    const up = await api('POST', '/api/media', fd);
    ok(up.length === 3, '올리기 실패: ' + JSON.stringify(up));
    await api('POST', '/api/live', { mediaBg: up[0].url });
    fs.writeFileSync(path.join(DATA, 'keep-me.txt'), 'x');
    const r = await api('POST', '/api/media/delete', { names: [up[0].name, up[1].name, '../keep-me.txt', '..'] });
    const left = (await api('GET', '/api/media')).map(m => m.name);
    ok(!left.includes(up[0].name) && !left.includes(up[1].name) && left.includes(up[2].name), '고른 것만 지워지지 않음: ' + left.join(','));
    ok(fs.existsSync(path.join(DATA, 'keep-me.txt')), '자료 폴더 밖 파일이 지워짐');
    ok(!(await api('GET', '/api/state')).live.mediaBg, '지운 파일이 배경으로 남음');
    await api('POST', '/api/media/delete', { names: [up[2].name] });
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
  await check('예배 순서 ⧉ 복제 단추 · ⌘C/⌘V 붙여넣기 (⌘C 가 모두 끄기(C)를 누르지 않음)', async () => {
    const svc = await api('POST', '/api/services', { name: '복사 점검 예배' });
    const mk = t => api('POST', '/api/items', { title: t, type: 'phrase', slides: [{ text: t }] });
    const a = await mk('복사 가'), b = await mk('복사 나');
    await api('PUT', '/api/services/' + svc.id, { itemIds: [a.id, b.id] });
    await api('POST', '/api/live', { itemId: b.id, index: 0 });
    await openControl(); c.errors.splice(0);
    const order = async () => { const st = await api('GET', '/api/state'); return st.services.find(x => x.id === svc.id).itemIds.map(id => st.items.find(i => i.id === id)?.title).join('|'); };
    await c.eval(`(document.querySelector('#serviceList li [data-a=copy]').click(), 1)`); await sleep(800);
    ok(await order() === '복사 가|복사 가 (복사)|복사 나', '⧉ 단추: ' + await order());
    // ⌘C 로 '복사 나' 를 복사하고 맨 위 '복사 가' 를 고른 뒤 ⌘V → 그 아래에
    await c.eval(`(document.activeElement.blur(), select(${JSON.stringify(b.id)}), dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true })), 1)`); await sleep(300);
    ok(!(await api('GET', '/api/state')).live.live.clear, '⌘C 가 글자 지우기(C)를 눌렀음');
    await c.eval(`(select(${JSON.stringify(a.id)}), dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true })), 1)`); await sleep(900);
    ok(await order() === '복사 가|복사 나 (복사)|복사 가 (복사)|복사 나', '⌘V: ' + await order());
    noErr();
    await api('POST', '/api/live', { reset: true });
    await api('DELETE', '/api/services/' + svc.id).catch(() => {});
  });
  await check('🎨 내 모양: 설정 창에서 만들기 · 예배당 화면에 글꼴·배경 색·배경 사진 · OBS 는 자막 바 그대로', async () => {
    await openControl(); c.errors.splice(0);
    await c.eval(`(openSettings(), document.querySelector('#stThemeNew').click(), 1)`); await sleep(400);
    await c.eval(`(() => { const b = document.querySelector('#dlgBody'); b.querySelector('#tmName').value = '화면 점검 모양'; b.querySelector('#tmBg').value = '#3a1f0f';
      b.querySelector('#tmFont').value = "'Nanum Myeongjo', serif"; b.querySelector('#tmBg').dispatchEvent(new Event('input')); b.querySelector('#tmSave').click(); return 1; })()`); await sleep(900);
    const st = await api('GET', '/api/state');
    const [key] = Object.entries(st.settings.themes).find(([, t]) => t.name === '화면 점검 모양') || [];
    ok(key, '새 모양이 저장되지 않음');
    ok(await c.eval(`!!document.querySelector('#stMyThemes [data-te=${key}] .wc-screen *')`), '설정 창에 내 모양 미리보기가 없음');
    ok(await c.eval(`[...document.querySelectorAll('#eTheme option, #stThemeDefs option')].some(o => o.value === ${JSON.stringify(key)})`), '모양 목록에 내 모양이 없음');
    noErr(); await c.eval(`(closeDlg(), 1)`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); fd.append('files', new Blob([png]), 'theme_bg.png');
    const [m] = await api('POST', '/api/media', fd);
    const it = await api('POST', '/api/items', { type: 'bible', title: '모양 화면 점검', theme: key, slides: [{ text: '여호와는 나의 목자시니', ref: '시 23:1' }], place: true });
    await api('POST', '/api/live', { itemId: it.id, index: 0 });
    await c.go(BASE + '/output?nohint', 2000);
    const look = () => c.eval(`(() => { const L = [...document.querySelectorAll('#screen > .wc-layer')].pop(), t = L?.querySelector('.wc-text-main');
      return { bg: L && getComputedStyle(L).backgroundColor, font: t && getComputedStyle(t).fontFamily, img: (document.querySelector('#screen > .wc-sbg .wc-bg') || L?.querySelector('.wc-bg'))?.style.backgroundImage || '', under: !!document.querySelector('#screen > .wc-sbg + .wc-layer, #screen > .wc-sbg ~ .wc-layer') }; })()`);
    let v = await look();
    ok(v.bg === 'rgb(58, 31, 15)' && /Nanum Myeongjo/.test(v.font), JSON.stringify(v));
    await api('PUT', '/api/themes/' + key, { ...st.settings.themes[key], bgImg: m.url }); await sleep(1000);
    v = await look(); ok(v.img.includes(m.url) && v.under && /Nanum Myeongjo/.test(v.font), '배경 사진이 글자 뒤에 안 깔림: ' + JSON.stringify(v));
    noErr();
    await c.go(BASE + '/overlay', 1500);
    ok(await c.eval(`!document.querySelector('.wc-bg') && (document.querySelector('.wc-ov-text')?.innerText || '').includes('목자')`), 'OBS 자막이 바뀜');
    noErr();
    await api('POST', '/api/live', { reset: true });
    await openControl(); c.errors.splice(0);   // 다음 점검은 운영 화면에서
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
  await check('🎨 자막 스타일 종류별(화면): 광고 탭에서 바꾸면 광고만 바뀜(모양(테마)보다 먼저) · 찬양·전체는 그대로 · 탭에 • 표시 · 되돌리기', async () => {
    c.errors.splice(0);
    const html = await c.eval(`(() => {
      const style = { main: { ...S.style.main, bg: '#000000' }, overlay: { ...S.style.overlay, box: '#0b1d3a', position: 'bottom' },
        byType: { notice: { main: { bg: '#123456', font: 'serif' }, overlay: { box: '#aa0000', position: 'top' } } } };
      const out = {};
      for (const [k, type, theme] of [['n', 'notice', 'notice'], ['s', 'song', '']]) {
        const m = document.createElement('div'), o = document.createElement('div'); m.className = o.className = 'wc-screen'; document.body.append(m, o);
        const snap = { slide: { text: '교회 소식\\n내용' }, style, live: {}, item: { type, theme } };
        WC.render(m, snap, 'main', { fade: false, still: true }); WC.render(o, snap, 'overlay', { fade: false, still: true });
        out[k] = { main: m.innerHTML, ov: o.innerHTML }; m.remove(); o.remove();
      }
      return JSON.stringify(out);
    })()`);
    const h = JSON.parse(html);
    ok(/#123456|rgb\(18, 52, 86\)/i.test(h.n.main) && /serif/.test(h.n.main), '광고 예배당 화면에 광고 값이 안 들어감(모양보다 먼저여야 함)');
    ok(/170,0,0/.test(h.n.ov.replace(/\s/g, '')) && /top:4cqh/.test(h.n.ov), '광고 방송 자막에 광고 값이 안 들어감: ' + h.n.ov.slice(0, 200));
    ok(!/#123456/i.test(h.s.main) && !/170,0,0/.test(h.s.ov.replace(/\s/g, '')) && /bottom:5cqh/.test(h.s.ov), '찬양까지 광고 값으로 바뀜');
    // 창: 광고 탭 → 배경색 바꾸기 → 탭에 • → 적용하면 광고에만 저장
    await c.eval(`(document.querySelector('#dlg')?.open && closeDlg(), document.querySelector('#styleBtn').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('[data-tab="notice"]').click(), 1)`); await sleep(300);
    ok(await c.eval(`document.querySelector('[data-tab="notice"]').classList.contains('primary') && document.querySelector('#m_aspect').disabled`), '광고 탭이 안 골라짐(또는 화면 비율이 잠기지 않음)');
    await c.eval(`(() => { const e = document.querySelector('#m_bg'); e.value = '#224466'; e.dispatchEvent(new Event('input')); return 1; })()`);
    await c.eval(`(document.querySelector('[data-tab=""]').click(), 1)`); await sleep(300);
    ok(await c.eval(`document.querySelector('[data-tab="notice"]').innerText.includes('•') && document.querySelector('#m_bg').value !== '#224466'`), '전체 탭에 광고 값이 보이거나 • 표시가 없음');
    await c.eval(`(document.querySelector('#sSave').click(), 1)`); await sleep(600);
    let st = await api('GET', '/api/state');
    ok(st.style.byType?.notice?.main?.bg === '#224466' && st.style.main.bg !== '#224466', '광고만 저장되지 않음: ' + JSON.stringify(st.style.byType));
    await c.eval(`(document.querySelector('#styleBtn').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('[data-tab="notice"]').click(), 1)`); await sleep(300);
    await c.eval(`(document.querySelector('#sTypeReset').click(), 1)`); await sleep(300);
    await c.eval(`(document.querySelector('#sSave').click(), 1)`); await sleep(600);
    st = await api('GET', '/api/state');
    ok(!st.style.byType, '되돌리기가 안 됨: ' + JSON.stringify(st.style.byType));
    noErr();
  });
  await check('＋ 빈 슬라이드: 운영 화면은 지금 나가는 슬라이드 바로 뒤에(안 나가면 맨 끝에) · 편집 창은 슬라이드마다 그 뒤에', async () => {
    c.errors.splice(0);
    const it = await api('POST', '/api/items', { type: 'song', title: '빈칸 점검곡', slides: [{ text: '가' }, { text: '나' }, { text: '다' }] });
    await sleep(500);
    await c.eval(`(document.querySelector('#dlg')?.open && closeDlg(), select(${JSON.stringify(it.id)}), 1)`); await sleep(400);
    ok(await c.eval(`!document.querySelector('#addBlank').disabled`), '자료를 골랐는데 단추가 꺼져 있음');
    await api('POST', '/api/live', { itemId: it.id, index: 0 }); await sleep(500);
    await c.eval(`(document.querySelector('#addBlank').click(), 1)`); await sleep(700);
    let sl = (await api('GET', '/api/state')).items.find(i => i.id === it.id).slides.map(x => x.text);
    ok(JSON.stringify(sl) === JSON.stringify(['가', '', '나', '다']), '지금 슬라이드 뒤에 안 들어감: ' + JSON.stringify(sl));
    await api('POST', '/api/live', { reset: true }); await sleep(500);
    await c.eval(`(document.querySelector('#addBlank').click(), 1)`); await sleep(700);
    sl = (await api('GET', '/api/state')).items.find(i => i.id === it.id).slides.map(x => x.text);
    ok(JSON.stringify(sl) === JSON.stringify(['가', '', '나', '다', '']), '맨 끝에 안 들어감: ' + JSON.stringify(sl));
    // 편집 창: '다'(4번째) 뒤에 ＋
    await c.eval(`(openItemEditor(${JSON.stringify(it.id)}), 1)`); await sleep(600);
    await c.eval(`(document.querySelectorAll('#eSlides .slide-edit')[3].querySelector('[data-a="blank"]').click(), 1)`); await sleep(300);
    ok((await c.eval(`document.querySelectorAll('#eSlides .slide-edit').length`)) === 6, '편집 창에 빈 슬라이드가 안 생김');
    await c.eval(`(document.querySelector('#eSave').click(), 1)`); await sleep(800);
    sl = (await api('GET', '/api/state')).items.find(i => i.id === it.id).slides.map(x => x.text);
    ok(JSON.stringify(sl) === JSON.stringify(['가', '', '나', '다', '', '']), '편집 창에서 넣은 자리가 다름: ' + JSON.stringify(sl));
    await api('DELETE', '/api/items/' + it.id);
    noErr();
  });
  await check('넘길 때: 잔상 없음(옛 글자는 바로 숨김) · 같은 슬라이드 배경(영상)은 다시 시작하지 않고 이어짐 · 미디어 배경보다 위 · 다른 배경이면 바뀜', async () => {
    c.errors.splice(0);
    const r = JSON.parse(await c.eval(`(async () => {
      const box = document.createElement('div'); box.className = 'wc-screen'; document.body.append(box);
      const snap = (text, bg, extra = {}) => ({ slide: { text, bg }, style: S.style, live: { ...extra }, item: { type: 'song', theme: '' } });
      WC.render(box, snap('첫째', '/media/bgA.mp4'), 'main', { fade: true });
      const v1 = box.querySelector('.wc-sbg video');
      WC.render(box, snap('둘째', '/media/bgA.mp4'), 'main', { fade: true });
      const v2 = box.querySelector('.wc-sbg video');
      const layers = [...box.querySelectorAll(':scope > .wc-layer')];
      const oldText = layers[0].querySelector('.wc-textwrap');
      const out = { same: !!v1 && v1 === v2, oldHidden: layers.length === 2 && oldText && oldText.style.visibility === 'hidden',
        newText: (layers[layers.length - 1].innerText || '').includes('둘째'), bgInLayer: !!layers[layers.length - 1].querySelector('.wc-bg') };
      WC.render(box, snap('셋째', '/media/bgB.jpg', { mediaBg: '/media/m.jpg' }), 'main', { fade: false });
      const kids = [...box.children].map(k => k.className);
      out.changed = !box.querySelector(':scope > .wc-sbg video') && /bgB/.test(box.querySelector(':scope > .wc-sbg')?.innerHTML || '');
      out.order = kids.indexOf('wc-mlayer') < kids.indexOf('wc-sbg') && kids.indexOf('wc-sbg') < kids.lastIndexOf('wc-layer');
      out.kids = kids.join(',');
      WC.render(box, { slide: null, style: S.style, live: { black: true }, item: null }, 'main', { fade: false });
      out.blackOff = !box.querySelector(':scope > .wc-sbg');
      box.remove(); return JSON.stringify(out);
    })()`));
    ok(r.same, '같은 배경 영상인데 슬라이드를 넘기면 새로 만들어짐(처음부터 다시 시작)');
    ok(r.oldHidden && r.newText, '옛 슬라이드 글자가 남아 잔상이 생김');
    ok(!r.bgInLayer, '배경이 슬라이드 층 안에 그대로 있음');
    ok(r.changed, '다른 배경으로 안 바뀜');
    ok(r.order, '층 순서가 다름(미디어 배경 < 슬라이드 배경 < 글자): ' + r.kids);
    ok(r.blackOff, '검은 화면인데 슬라이드 배경이 남음');
    noErr();
  });
  await check('가사 찾기: [벅스]·[멜론]·[구글]·[네이버] 단추가 그 사이트 검색 화면을 곡 제목으로 엶', async () => {
    c.errors.splice(0);
    await c.eval(`(document.querySelector('#dlg')?.open && closeDlg(), document.querySelector('#newSong').click(), 1)`); await sleep(600);
    const urls = JSON.parse(await c.eval(`(() => { const got = [], o = window.open; window.open = u => { got.push(u); return null; };
      document.querySelector('#eLyQ').value = '주의 은혜';
      ['#eFindB', '#eFindM', '#eFindG', '#eFindN'].forEach(s => document.querySelector(s).click());
      window.open = o; return JSON.stringify(got); })()`));
    const t = encodeURIComponent('주의 은혜');
    ok(urls[0] === 'https://music.bugs.co.kr/search/track?q=' + t && urls[1] === 'https://www.melon.com/search/song/index.htm?q=' + t, '벅스·멜론 주소가 다름: ' + JSON.stringify(urls));
    ok(/google\.com/.test(urls[2]) && /naver\.com/.test(urls[3]) && urls[3].includes(encodeURIComponent('주의 은혜 가사')), '구글·네이버가 안 됨: ' + JSON.stringify(urls));
    await c.eval(`(closeDlg(), 1)`); noErr();
  });
  await check('미디어 배경 ☑ 고르기: 누르기·Shift 사이 전부·빈 곳에서 끌어 네모로 고르기 → 한 번에 지우기 · 고르기 중에는 눌러도 배경으로 안 나감 · 그만', async () => {
    c.errors.splice(0);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); ['mpick_1.png', 'mpick_2.png', 'mpick_3.png', 'mpick_4.png'].forEach(n => fd.append('files', new Blob([png]), n));
    const up = await api('POST', '/api/media', fd);
    await openControl(); await c.eval(`(document.querySelector('.mbin')?.classList.remove('fold'), loadMediaBin()).then(() => 1)`); await sleep(500);
    const sel = u => `document.querySelector('#mbGrid .mb-item[data-url="${u}"]')`;
    await c.eval(`(document.querySelector('#mbPick').click(), 1)`);
    await c.eval(`(${sel(up[0].url)}.click(), ${sel(up[2].url)}.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })), 1)`);
    let n = await c.eval(`[...mbSel].filter(u => u.includes('mpick_')).length`);
    ok(n === 3, 'Shift 로 사이 전부가 안 골라짐: ' + n);
    ok(!(await api('GET', '/api/state')).live.mediaBg, '고르기 중에 눌렀는데 배경으로 나감');
    await c.eval(`(document.querySelector('#mbDone').click(), 1)`);
    ok(await c.eval(`!mbPick && !mbSel.size && document.querySelector('#mbBar').classList.contains('hidden')`), '그만이 안 됨');
    // 고르기가 꺼진 채 빈 곳에서 끌기 → 고르기가 켜지고 네모 안이 골라짐
    const dragged = await c.eval(`(() => {
      const g = document.querySelector('#mbGrid'), r = g.getBoundingClientRect();
      g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + 2, clientY: r.top + 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.right - 2, clientY: r.bottom - 2 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return mbPick && [...mbSel].filter(u => u.includes('mpick_')).length;
    })()`);
    ok(dragged === 4, '끌어서 고르기가 안 됨: ' + dragged);
    // 지우기: mpick 만 남기고 고른 뒤 지움
    await c.eval(`(mbSel.clear(), ${JSON.stringify(up.map(x => x.url))}.forEach(u => mbSel.add(u)), mbMark(), window.confirm = () => true, document.querySelector('#mbDel').click(), 1)`); await sleep(900);
    const left = (await api('GET', '/api/media')).map(m => m.name);
    ok(!left.some(x => /mpick_/.test(x)) && left.length >= 1, '한 번에 지우기가 안 됨: ' + left.join(','));
    ok(await c.eval(`!mbPick && !document.querySelector('#mbGrid .mb-item[data-url*="mpick_"]')`), '지운 뒤 화면에 남음');
    noErr();
  });
  await check('＋ 빈 문구(예배 순서에 들어감) · ＋ 새 곡(찬양 자료실에만): 고르기 창 없이 빈 편집 창이 바로 열림', async () => {
    c.errors.splice(0);
    await c.eval(`(document.querySelector('#dlg')?.open && closeDlg(), document.querySelector('#newBlankText').click(), 1)`); await sleep(600);
    ok(await c.eval(`document.querySelector('#eType').value === 'text' && document.querySelectorAll('#eSlides .slide-edit').length === 1 && document.querySelector('#eSlides [data-text]').value === ''`), '빈 문구 편집 창이 아님');
    await c.eval(`(() => { document.querySelector('#eTitle').value = '빈문구 점검'; const t = document.querySelector('#eSlides [data-text]'); t.value = '직접 쓴 문구'; t.dispatchEvent(new Event('input')); document.querySelector('#eSave').click(); return 1; })()`); await sleep(900);
    let st = await api('GET', '/api/state');
    const a = st.items.find(i => i.title === '빈문구 점검');
    ok(a && a.type === 'text' && a.slides[0].text === '직접 쓴 문구', '빈 문구가 저장되지 않음: ' + JSON.stringify(a));
    ok(st.services.find(x => x.id === st.currentServiceId)?.itemIds.includes(a.id), '빈 문구가 예배 순서에 안 들어감');
    await c.eval(`(document.querySelector('#libNewSong').click(), 1)`); await sleep(600);
    ok(await c.eval(`document.querySelector('#eType').value === 'song' && document.querySelectorAll('#eSlides .slide-edit').length === 1`), '새 곡 편집 창이 아님');
    await c.eval(`(() => { document.querySelector('#eTitle').value = '자료실 새곡 점검'; const t = document.querySelector('#eSlides [data-text]'); t.value = '첫 줄 가사'; t.dispatchEvent(new Event('input')); document.querySelector('#eSave').click(); return 1; })()`); await sleep(900);
    st = await api('GET', '/api/state');
    const b = st.items.find(i => i.title === '자료실 새곡 점검');
    ok(b && b.type === 'song' && b.slides[0].text === '첫 줄 가사' && !('_lib' in b), '새 곡이 저장되지 않음: ' + JSON.stringify(b));
    ok(!st.services.some(x => x.itemIds.includes(b.id)), '새 곡이 예배 순서에 들어감 (자료실에만 들어가야 함)');
    await api('DELETE', '/api/items/' + a.id); await api('DELETE', '/api/items/' + b.id);
    noErr();
  });
  await check('새 찬양: 제목 칸에 보이는 이름으로 저장 (\'새 찬양\'으로 저장되지 않음)', async () => {
    await c.eval(`(closeDlg(), document.querySelector('#newSong').click(), 1)`); await sleep(600);
    // 가사 찾기에서 곡을 고를 때처럼 제목 칸만 바꿈 (입력 이벤트 없이)
    await c.eval(`(document.querySelector('#eTitle').value = '제목 점검곡', document.querySelector('#ePaste').value = '가\\n나', document.querySelector('#eSplit').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('#eSave').click(), 1)`); await sleep(800);
    const st = await api('GET', '/api/state');
    ok(st.items.some(i => i.title === '제목 점검곡'), '저장된 제목: ' + st.items.map(i => i.title).filter(t => /찬양|점검/.test(t)).join(', '));
    noErr();
  });
  await check('같은 자료 안내: 자료실에 똑같은 제목(띄어쓰기 무시)의 찬양을 새로 만들면 묻고 [취소]면 안 넣음 · 곡 파일 가져오기는 어떤 곡을 건너뛰었는지 알림', async () => {
    const n0 = (await api('GET', '/api/state')).items.filter(i => i.title.replace(/\s/g, '') === '제목점검곡').length;
    await c.eval(`(window.__asked = [], window.confirm = m => (window.__asked.push(m), false), window.alert = m => window.__asked.push(m), 1)`);
    await c.eval(`(closeDlg(), document.querySelector('#newSong').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('#eTitle').value = '제목  점검곡', document.querySelector('#ePaste').value = '가\\n나', document.querySelector('#eSplit').click(), 1)`); await sleep(600);
    await c.eval(`(document.querySelector('#eSave').click(), 1)`); await sleep(800);
    let asked = await c.eval(`window.__asked.join(' | ')`);
    ok(/똑같은 자료/.test(asked), '묻지 않음: ' + asked);
    ok(await c.eval(`document.querySelector('#dlg').open`), '[취소]했는데 창이 닫힘');
    let n1 = (await api('GET', '/api/state')).items.filter(i => i.title.replace(/\s/g, '') === '제목점검곡').length;
    ok(n1 === n0, '[취소]했는데 들어감');
    await c.eval(`(window.confirm = m => (window.__asked.push(m), true), document.querySelector('#eSave').click(), 1)`); await sleep(800);
    n1 = (await api('GET', '/api/state')).items.filter(i => i.title.replace(/\s/g, '') === '제목점검곡').length;
    ok(n1 === n0 + 1, '[확인]했는데 안 들어감');
    await c.eval(`(window.__asked = [], 1)`);
    await c.eval(`(importSongs([new File(['가\\n나'], '제목 점검곡.txt'), new File(['다\\n라'], '새로운 점검곡.txt')]), 1)`); await sleep(1500);
    asked = await c.eval(`window.__asked.join(' | ')`);
    ok(/제목 점검곡/.test(asked) && /똑같은 자료/.test(asked) && !/새로운 점검곡/.test(asked.split('넣지 않은 곡')[1] || ''), '건너뛴 곡 안내: ' + asked);
    ok((await api('GET', '/api/state')).items.some(i => i.title === '새로운 점검곡'), '새 곡은 들어가야 함');
    await c.eval(`(delete window.confirm, delete window.alert, 1)`);
    noErr();
  });
  await check('☑ 찬양 자료실 여러 곡 골라 한 번에 지우기: 검색 → 모두 → 지우기 (검색 안 된 곡과 예배 순서의 다른 자료는 그대로)', async () => {
    const mk = t => api('POST', '/api/items', { type: 'song', title: t, slides: [{ text: t }] });
    const a = await mk('지움점검 하나'), b = await mk('지움점검 둘'), keep = await mk('남김점검 셋');
    await openControl();
    await c.eval(`(document.querySelector('#libPick').click(), 1)`); await sleep(200);
    ok(await c.eval(`!document.querySelector('#libBar').classList.contains('hidden') && !!document.querySelector('#libList li.pick input[type=checkbox]')`), '고르기 칸이 안 나옴');
    await c.eval(`(() => { const s = document.querySelector('#search'); s.value = '지움점검'; s.dispatchEvent(new Event('input')); return 1; })()`); await sleep(200);
    ok(await c.eval(`document.querySelectorAll('#libList li.pick').length`) === 2, '검색 결과가 2곡이 아님');
    await c.eval(`(document.querySelector('#libAll').click(), 1)`); await sleep(200);
    const cnt = await c.eval(`document.querySelector('#libCnt').textContent`);
    ok(cnt === '2/2곡', '고른 수: ' + cnt);
    await c.eval(`(window.confirm = () => true, document.querySelector('#libDel').click(), 1)`); await sleep(900);
    const st = await api('GET', '/api/state');
    ok(!st.items.some(i => i.id === a.id || i.id === b.id), '고른 곡이 안 지워짐');
    ok(st.items.some(i => i.id === keep.id), '검색 안 된 곡까지 지워짐');
    ok(await c.eval(`document.querySelector('#libBar').classList.contains('hidden')`), '지운 뒤 고르기가 안 끝남');
    const r = await api('POST', '/api/items/delete', { ids: [] }, { allowFail: true });
    ok(r.status === 400, '빈 목록을 막지 않음');
    await c.eval(`(delete window.confirm, (() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); })(), 1)`);
    await api('DELETE', '/api/items/' + keep.id);
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
  await check('📜 전체 이어 보기 단추: 예배 순서 전체가 자료마다 제목 줄로 · 슬라이드 누르면 송출 · → 로 다음 자료 · 접기 · 끄면 한 자료만', async () => {
    await openControl();
    const n = await c.eval(`service().itemIds.filter(id => item(id)).length`);
    await c.eval(`(document.querySelector('#allView').click(), 1)`); await sleep(700);
    ok(await c.eval(`document.querySelector('#allView').classList.contains('on') && S.settings.continuous === true`), '단추가 켜지지 않음');
    const secs = await c.eval(`document.querySelectorAll('#slides .allsec').length`);
    ok(secs === n, `제목 줄 ${secs}개, 예배 순서 ${n}개`);
    const ids = await c.eval(`service().itemIds.filter(id => item(id) && WC.seq(item(id)).length)`);
    const a = ids[ids.length - 2], b = ids[ids.length - 1];
    const lastA = await c.eval(`WC.seq(item(${JSON.stringify(a)})).length - 1`);
    await c.eval(`(document.querySelector('#slides .slide[data-item=${JSON.stringify(a)}][data-i="${lastA}"]').click(), 1)`); await sleep(600);
    ok(await c.eval(`snap.live.itemId === ${JSON.stringify(a)} && snap.live.index === ${lastA}`), '슬라이드를 눌러도 안 나감');
    ok(await c.eval(`!!document.querySelector('#slides .slide.live[data-item=${JSON.stringify(a)}]')`), '나가는 슬라이드 표시가 없음');
    await c.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })), 1)`); await sleep(600);
    ok(await c.eval(`snap.live.itemId === ${JSON.stringify(b)} && snap.live.index === 0`), '→ 로 다음 자료로 안 넘어감');
    ok(await c.eval(`selId === ${JSON.stringify(b)} && !!document.querySelector('#slides .slide.live[data-item=${JSON.stringify(b)}]')`), '왼쪽 순서·표시가 따라오지 않음');
    await c.eval(`(document.querySelector('#slides .allsec .fold').click(), 1)`); await sleep(400);
    ok(await c.eval(`!document.querySelector('#slides .allsec').querySelector('.grid')`), '접기가 안 됨');
    await c.eval(`(document.querySelector('#slides .allsec .fold').click(), 1)`); await sleep(400);
    await c.eval(`(document.querySelector('#allView').click(), 1)`); await sleep(700);
    ok(await c.eval(`!document.querySelector('#slides .allsec') && document.querySelector('#slides').classList.contains('grid') && S.settings.continuous === false`), '끄면 한 자료 보기로 안 돌아감');
    await c.eval(`(goLive({ reset: true }), 1)`); await sleep(300); noErr();
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
  await check('화면 칸이 없을 때 1초 타이머(WC.tick)가 오류를 내지 않음 (운영 화면이 열리는 순간 가끔 나던 오류)', async () => {
    await openControl();
    const r = await c.eval(`(() => { try { WC.tick(null, { live: {} }, 'main'); return 'ok'; } catch (e) { return String(e); } })()`);
    ok(r === 'ok', r);
  });
  await check("⭕ PPT(글자로 가져온 것)도 '사람 원'이면 방송에 PPT 화면 + 동그란 카메라 자리 (자막 글자로 나가지 않음)", async () => {
    const it = await api('POST', '/api/items', { type: 'ppt', title: 'PPT 원 점검', place: true, slides: [{ text: '슬라이드 제목', ppt: true, ptH: 540, elements: [{ id: 'e1', type: 'text', x: 5, y: 5, w: 90, h: 20, text: '슬라이드 제목', size: 40, color: '#ffffff' }] }] });
    await api('PUT', '/api/style', { overlay: { imgMode: 'circle' } });
    await api('POST', '/api/live', { itemId: it.id, index: 0, camOnly: false });
    await c.go(BASE + '/overlay', 1500);
    const r = await c.eval(`({ circ: !!document.querySelector('#screen .wc-circ'), bar: !!document.querySelector('#screen .wc-ov-bar, #screen .wc-bar') })`);
    await api('PUT', '/api/style', { overlay: { imgMode: 'full' } });
    await api('POST', '/api/live', { reset: true });
    ok(r.circ, 'PPT가 사람 원으로 나가지 않음: ' + JSON.stringify(r));
    noErr();
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
  await check('PDF·악보 나누기: 세로 악보는 위·아래로 나누고, 가로 사진·그림(가로가 더 긴 것)은 나누지 않음 · 사진(세로 포스터 포함)은 언제나 한 장 그대로 · 고른 나누기 방식을 기억', async () => {
    await openControl();
    const r = await c.eval(`(() => { const mk = (w, h) => { const x = document.createElement('canvas'); x.width = w; x.height = h; return x; };
      return [sliceCanvas(mk(1600, 900), 2).length, sliceCanvas(mk(1000, 1000), 3).length, sliceCanvas(mk(900, 1600), 2).length, sliceCanvas(mk(900, 1600), 1).length].join(','); })()`);
    ok(r === '1,1,2,1', '나눈 장 수(가로·정사각·세로2칸·안 나눔) 기대 1,1,2,1 실제 ' + r);
    await c.eval(`(document.querySelector('#newScore').click(), 1)`); await sleep(300);
    await c.eval(`(() => { const s = document.querySelector('#scSplit'); s.value = '1'; s.dispatchEvent(new Event('change')); closeDlg(); document.querySelector('#newScore').click(); return 1; })()`); await sleep(300);
    const kept = await c.eval(`document.querySelector('#scSplit').value`);
    await c.eval(`(localStorage.removeItem('wc-score-split'), closeDlg(), 1)`);
    ok(kept === '1', "'나누지 않음'을 고른 것을 다음에 기억하지 않음: " + kept);
    // 세로로 긴 사진(포스터)은 '위·아래 2칸'이 골라져 있어도 한 장 그대로 (사용자 요청)
    await c.eval(`(async () => { closeDlg(); document.querySelector('#newScore').click(); await new Promise(r => setTimeout(r, 200));
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 1400; const g = cv.getContext('2d'); g.fillStyle = '#246'; g.fillRect(0, 0, 600, 1400);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], '세로포스터.png', { type: 'image/png' }));
      document.querySelector('#scFiles').files = dt.files; document.querySelector('#scSplit').value = '2'; document.querySelector('#scGo').click(); })(), 1`);
    let poster = null;
    for (let i = 0; i < 30 && !poster; i++) { await sleep(300); poster = (await api('GET', '/api/state')).items.find(x => x.title === '세로포스터'); }
    ok(poster && poster.slides.length === 1, '세로 사진이 나뉨: ' + (poster ? poster.slides.length + '장' : '안 들어감'));
  });
  await check('＋ PPT 그림으로 가져오기(화면): 방식 고르는 창(언제나 그림으로가 먼저) · 원본 모양 그대로 장마다 그림 슬라이드(PPT 자료) · 방송에는 그림으로 · 글자로 가져오기도 남아 있음', async () => {
    await openControl();
    const before = (await api('GET', '/api/state')).items.length;
    // 예전에 '글자로'를 골라 둔 컴퓨터에서도 언제나 '그림으로'가 먼저 골라져 있음 (사용자 요청)
    await c.eval(`(localStorage.setItem('wc-ppt-mode', 'text'), document.querySelector('#newPpt').click(), 1)`); await sleep(300);
    ok(await c.eval(`!!document.querySelector('#pptIn') && document.querySelectorAll('[name=pptMode]').length === 2 && document.querySelector('[name=pptMode][value=image]').checked`), '방식 고르는 창이 없거나 기본이 그림이 아님 (예전에 글자로를 골랐던 경우)');
    await c.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([80,75,3,4])], '강의자료.pptx')); const i = document.querySelector('#pptIn'); i.files = dt.files; document.querySelector('#pptGo').click(); return 1; })()`);
    let it = null;
    for (let i = 0; i < 40 && !it; i++) { await sleep(300); const st = await api('GET', '/api/state'); if (st.items.length > before) it = st.items.find(x => x.title === '강의자료'); }
    ok(it, '자료가 만들어지지 않음: ' + await c.eval(`document.querySelector('#pptProg')?.textContent || ''`));
    ok(it.type === 'ppt' && it.slides.length === 2, '종류·장 수: ' + it.type + ' ' + it.slides.length);
    ok(it.slides.every(s => /^\/media\/ppt_.+\.jpg$/.test(s.bg) && !s.text && s.fit === 'contain'), '그림 슬라이드가 아님: ' + JSON.stringify(it.slides[0]));
    const media = await api('GET', '/api/media');
    ok(!media.some(m => m.url.startsWith('/media/ppt_')), 'PPT 그림이 미디어 자료실에 섞여 나옴');
    const svc = (await api('GET', '/api/state')).services.find(s => s.itemIds.includes(it.id));
    ok(svc, '예배 순서에 들어가지 않음');
    await api('POST', '/api/live', { itemId: it.id, index: 0 }); await sleep(400);
    await c.go(BASE + '/output?nohint', 1200);
    ok(await c.eval(`!!document.querySelector('#screen img, #screen .wc-bg, #screen [style*="ppt_"]')`), '예배당 화면에 그림이 안 나옴');
    await api('POST', '/api/live', { reset: true }).catch(() => {});
    await openControl();
    await c.eval(`(document.querySelector('#newPpt').click(), document.querySelector('[name=pptMode][value=text]').click(), 1)`); await sleep(200);
    ok(await c.eval(`document.querySelector('[name=pptMode][value=text]').checked`), '글자로 가져오기를 고를 수 없음');
    await c.eval(`(document.querySelector('[name=pptMode][value=image]').click(), document.querySelector('#dlg [data-x]').click(), 1)`);
    try { await c.eval(`localStorage.removeItem('wc-ppt-mode')`); } catch {}
    noErr();
  });
  await check('📁 내 영상 틀기: 영상 파일을 인터넷 없이 예배당에서 재생·멈춤·이동, 끝나면 빠짐, 이상한 주소는 막음', async () => {
    const vid = (await api('GET', '/api/media')).find(m => /\.mp4$/i.test(m.url));
    ok(vid, '시험할 영상이 없음');
    // 미디어 밖 파일·없는 파일·영상이 아닌 파일은 받지 않음
    for (const bad of ['/media/../db.json', '/media/없는영상.mp4', 'https://evil.example/a.mp4', '/media/a.jpg']) {
      const r = await api('POST', '/api/live', { yt: { file: bad } });
      ok(!r.live.yt, '이상한 주소를 받아들임: ' + bad);
    }
    // 운영 화면에서 골라 틀기
    await openControl(); c.errors.splice(0);
    await c.eval(`(document.querySelector('#ytBox').open = true, 1)`); await sleep(800);
    ok(await c.eval(`[...document.querySelector('#ytFile').options].some(o => o.value === ${JSON.stringify(vid.url)})`), '내 영상 목록에 파일이 없음');
    await c.eval(`(document.querySelector('#ytFile').value = ${JSON.stringify(vid.url)}, document.querySelector('#ytFileOpen').click(), 1)`); await sleep(1000);
    let y = (await api('GET', '/api/state')).live.live.yt;
    ok(y?.file === vid.url && y.playing && y.tv, '틀기 안 됨: ' + JSON.stringify(y));
    ok((await c.eval(`document.querySelector('#ytTitle').textContent`)).startsWith('📁'), '조작판에 내 영상 표시가 없음');
    noErr();
    // 예배당 화면: <video> 로 재생, 소리는 예배당
    await c.go(BASE + '/output?nohint', 1500);
    let v = null;
    for (let i = 0; i < 20; i++) { v = await c.eval(`(() => { const v = document.querySelector('#screen > .wc-yt video.wc-yt-v'); return v && { paused: v.paused, t: v.currentTime, src: decodeURIComponent(v.src) }; })()`); if (v && !v.paused && v.t > 0.3) break; await sleep(250); }
    ok(v && v.src.endsWith(decodeURIComponent(vid.url)) && !v.paused, '예배당 화면에서 재생 안 됨: ' + JSON.stringify(v));
    // 길이를 서버에 알림 → 멈춤·이동이 화면에 맞춰짐
    for (let i = 0; i < 10 && !((await api('GET', '/api/state')).live.live.yt.dur > 0); i++) await sleep(300);
    ok((await api('GET', '/api/state')).live.live.yt.dur > 0, '영상 길이를 모름');
    await api('POST', '/api/live', { yt: { playing: false } }); await api('POST', '/api/live', { yt: { seek: 2 } }); await sleep(1200);
    v = await c.eval(`(() => { const v = document.querySelector('#screen > .wc-yt video.wc-yt-v'); return { paused: v.paused, t: v.currentTime }; })()`);
    ok(v.paused && Math.abs(v.t - 2) < 0.6, '멈춤·이동이 화면에 안 맞음: ' + JSON.stringify(v));
    // 방송(OBS) 끄면 방송 화면엔 안 나옴 (녹화본에 넣지 않기)
    await api('POST', '/api/live', { yt: { obs: false } });
    await c.go(BASE + '/overlay', 1200);
    ok(!(await c.eval(`!!document.querySelector('#screen > .wc-yt')`)), '방송을 껐는데 방송 화면에 나옴');
    // 끝까지 가면 저절로 빠짐
    await c.go(BASE + '/output?nohint', 1500);
    const dur = (await api('GET', '/api/state')).live.live.yt.dur;
    await api('POST', '/api/live', { yt: { seek: Math.max(0, dur - 1.5) } }); await api('POST', '/api/live', { yt: { playing: true } });
    for (let i = 0; i < 20 && !(await api('GET', '/api/state')).live.live.yt?.ended; i++) await sleep(300);
    ok((await api('GET', '/api/state')).live.live.yt?.ended, '끝났는데 빠지지 않음');
    await api('POST', '/api/live', { yt: null });
    noErr();
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
  try { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(TEST_PDF, { force: true }); } catch {}
  const bad = results.filter(r => !r[0]);
  console.log(`\n${bad.length ? '✗' : '✓'} ${results.length - bad.length}/${results.length} 통과${bad.length ? ' — 실패: ' + bad.map(r => r[1]).join(', ') : ''}\n`);
  process.exit(bad.length ? 1 : 0);
});
