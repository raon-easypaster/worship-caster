// 예배송출 (Worship Caster) — 로컬 서버
// 만든 사람: 쉬운목사 이광복
// 예배당 화면(/output), OBS 투명 자막(/overlay), 프롬프터(/stage), 운영(/control), 웹 편집기(/editor)

// 자동 업데이트로 받아 둔 새 프로그램이 있으면 그것을 실행 (앱 안 파일은 그대로, 자료 폴더/app-update)
if (!process.env.WC_BUNDLE_DIR) {
  process.env.WC_BUNDLE_DIR = __dirname;
  const updater = require('./lib/updater');
  const next = updater.pick(__dirname);
  if (next) {
    try { require(next); return; }   // eslint-disable-line no-unreachable
    catch (e) { console.error('받아 둔 새 버전을 켜지 못해 앱에 든 버전으로 켭니다:', e); updater.markBad(next, e); }
  }
}
const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const store = require('./lib/store');
const bible = require('./lib/bible');
const hymns = require('./lib/hymns');
const readings = require('./lib/readings');
const { importPptx } = require('./lib/pptx');
const { pptToPdf } = require('./lib/ppt-convert');
const templates = require('./lib/templates');

const PORT = +process.env.PORT || 5300;
const MEDIA_DIR = path.join(store.DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = store.load();
bible.loadAll(db.settings.bibleFolders);
hymns.load();
readings.load();

// 기본 배경 영상 (직접 만든 반복 영상, 저작권 걱정 없음) — 처음 한 번만 미디어 칸에 넣음.
// 사용자가 지운 영상은 다시 생기지 않음. 새 영상을 더 넣으면 SAMPLES_VER 를 올림
const SAMPLES_VER = 1;
if ((db.settings.samplesAdded || 0) < SAMPLES_VER) {
  const src = path.join(__dirname, 'public', 'samples');
  try {
    for (const f of fs.readdirSync(src)) {
      const to = path.join(MEDIA_DIR, f.normalize('NFC'));
      if (/\.mp4$/i.test(f) && !fs.existsSync(to)) fs.copyFileSync(path.join(src, f), to);
    }
    db.settings.samplesAdded = SAMPLES_VER;
    store.save();
  } catch (e) { console.log('  기본 배경 영상을 넣지 못했습니다:', e.message); }
}

// ── 자료 정리 규칙 ─────────────────────────────────
// 자료실에는 찬양(가사·악보)만 남김. 말씀·광고·문구·PPT·HTML 은 예배 순서에 딸린 자료라
// 어느 예배 순서에도 없으면 지움
const ITEM_TYPES = ['song', 'score', 'bible', 'notice', 'text', 'ppt', 'html'];
const SLIDES_DIR = path.join(store.DATA_DIR, 'slides');   // 가져온 HTML 파일(여러 장짜리 발표 자료)
fs.mkdirSync(SLIDES_DIR, { recursive: true });
const KEEP_TYPES = new Set(['song', 'score']);
function pruneOrphans() {
  const used = new Set(db.services.flatMap(s => s.itemIds));
  const gone = db.items.filter(i => !KEEP_TYPES.has(i.type) && !i.kept && !used.has(i.id));   // 보관(kept)한 자료는 남김
  if (!gone.length) return 0;
  db.items = db.items.filter(i => !gone.includes(i));
  // PPT에서 뽑아낸 그림(ppt_…)은 다른 자료가 쓰지 않으면 같이 지움
  const still = JSON.stringify(db.items);
  for (const f of JSON.stringify(gone).match(/\/media\/ppt_[^"\\]+/g) || []) {
    if (!still.includes(f)) fs.rm(path.join(MEDIA_DIR, path.basename(f)), { force: true }, () => {});
  }
  for (const f of JSON.stringify(gone).match(/\/slides\/[a-f0-9]{12}\.html/g) || []) {
    if (!still.includes(f)) fs.rm(path.join(SLIDES_DIR, path.basename(f)), { force: true }, () => {});
  }
  return gone.length;
}
if (pruneOrphans()) store.save();

// 새 자료를 지금 예배 순서에 넣기 (after: 이 자료 다음에, 없으면 맨 끝)
function placeInService(id, after) {
  let svc = db.services.find(s => s.id === db.currentServiceId);
  if (!svc) {
    svc = { id: store.uid(), name: '예배', date: new Date().toISOString().slice(0, 10), itemIds: [] };
    db.services.push(svc); db.currentServiceId = svc.id;
  }
  const at = after ? svc.itemIds.indexOf(after) : -1;
  if (at >= 0) svc.itemIds.splice(at + 1, 0, id); else svc.itemIds.push(id);
}
const THEME_RE = /^[a-z0-9_]{0,30}$/;
// 교회가 만든 '내 모양' (⚙︎ 설정 → 🎨 모양): 기본 모양 위에 글꼴·색·배경을 바꿔 이름 붙여 저장
const MY_THEME_RE = /^my_[a-z0-9]{4,20}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const THEME_MOTIONS = ['none', 'galaxy', 'water', 'rays', 'bokeh', 'aurora', 'dawn', 'embers'];
function cleanTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  const out = { name: String(t.name ?? '').trim().slice(0, 30) || '내 모양' };
  const hex = k => { if (HEX_RE.test(String(t[k] ?? ''))) out[k] = String(t[k]).toLowerCase(); };
  const n = (k, lo, hi) => { const v = +t[k]; if (t[k] !== '' && t[k] != null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v)); };
  if (THEME_RE.test(String(t.base ?? '')) && !MY_THEME_RE.test(String(t.base ?? ''))) out.base = String(t.base ?? '');
  if (/^[\w\s',\-가-힣]{1,120}$/.test(String(t.font ?? ''))) out.font = String(t.font);
  ['color', 'bg', 'headColor', 'refColor'].forEach(hex);
  n('size', 1, 30); n('lineHeight', 0.8, 3);
  if (THEME_MOTIONS.includes(t.motion)) out.motion = t.motion;
  if (LOGO_RE.test(String(t.bgImg ?? ''))) out.bgImg = String(t.bgImg);   // 배경 사진·영상 (미디어)
  for (const k of ['headline', 'bold', 'shadow']) if (t[k] !== undefined && t[k] !== null && t[k] !== '') out[k] = !!t[k];
  return out;
}
function cleanThemes(o) {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 60)) if (MY_THEME_RE.test(k)) out[k] = cleanTheme(v);
  return out;
}
// 새로 넣을 때 처음부터 쓸 모양: 성경·교독문·광고·새 찬양
const THEME_DEF_KINDS = ['bible', 'reading', 'notice', 'song'];
function cleanThemeDefaults(o, themes) {
  const out = {};
  if (o && typeof o === 'object') for (const k of THEME_DEF_KINDS) {
    const v = String(o[k] ?? '');
    if (o[k] != null && THEME_RE.test(v) && (!MY_THEME_RE.test(v) || themes[v])) out[k] = v;
  }
  return out;
}
const MV_RE = /^\/media\/[^\"'<>()\\\s]+\.(mp4|mov|m4v|webm)$/i;
function itemFields(b, it = {}) {
  return {
    title: String(b.title ?? it.title ?? '새 자료').slice(0, 200),
    type: ITEM_TYPES.includes(b.type) ? b.type : (it.type || 'song'),
    // 슬라이드 이름(곡 구성)은 짧은 글자만
    slides: Array.isArray(b.slides) ? b.slides.filter(x => x && typeof x === 'object').map(x => {
      if (x.label == null || x.label === '') { const { label, ...rest } = x; return rest; }
      return { ...x, label: String(x.label).trim().slice(0, 20) };
    }) : (it.slides || []),
    noBroadcast: b.noBroadcast !== undefined ? !!b.noBroadcast : !!it.noBroadcast,
    bcFull: b.bcFull !== undefined ? !!b.bcFull : !!it.bcFull,
    // 곡 구성 순서 (예: ['1절','후렴','2절','후렴'])
    arr: Array.isArray(b.arr) ? b.arr.map(x => String(x).trim().slice(0, 20)).filter(Boolean).slice(0, 60) : (it.arr || []),
    // 찬양마다 저장해 두는 움직이는 배경 영상 (자료실 영상을 가사 칸에 끌어다 놓음). '' = 없음
    motionVideo: b.motionVideo !== undefined ? (MV_RE.test(String(b.motionVideo || '')) ? String(b.motionVideo) : '') : (it.motionVideo || ''),
    theme: THEME_RE.test(b.theme ?? '') ? (b.theme ?? it.theme ?? '') : (it.theme || ''),
    // 콘티: 키·빠르기(BPM)·흐름 메모
    key: b.key !== undefined ? String(b.key ?? '').trim().slice(0, 10) : (it.key || ''),
    bpm: b.bpm !== undefined ? (Number.isFinite(+b.bpm) && +b.bpm > 0 ? Math.min(300, Math.round(+b.bpm)) : 0) : (it.bpm || 0),
    memo: b.memo !== undefined ? String(b.memo ?? '').slice(0, 200) : (it.memo || ''),
    // 보관: 예배 순서에서 빼도 지우지 않고 자료실에 남김 (문구·말씀·광고도) — 전체 이어 보기의 '순서에서 빼기'
    kept: b.kept !== undefined ? !!b.kept : !!it.kept,
  };
}
function addItem(b) {
  const it = { id: store.uid(), ...itemFields(b), updatedAt: Date.now() };
  it.slides.forEach(s => (s.id ||= store.uid()));
  db.items.push(it);
  if (b.place || !KEEP_TYPES.has(it.type)) placeInService(it.id, b.after);
  return it;
}

// ── 송출 상태 (메모리) ─────────────────────────────
// overlayOff: 방송(OBS) 자막만 끔 — 예배당 TV에는 그대로 나감
// pip: 방송에 그림을 보낼 때 오른쪽 아래에 사람(카메라) 화면 — OBS 장면 전환으로
// mediaBg: 미디어 칸에서 고른 배경(사진·영상) — 슬라이드가 바뀌어도 예배당 화면 뒤에 계속 나옴
// mediaObs: 미디어 배경을 방송(OBS)에도 / mediaFit: auto · cover · contain · small
const live = { itemId: null, index: 0, black: false, clear: false, logo: false, overlayOff: false, pip: true, camOnly: false, tvNoImg: false, mediaBg: null, mediaObs: false, mediaFit: 'auto', obsMain: false, cam: null,
  msg: '', timer: null, prop: null, auto: null, yt: null, rev: 0 };
let obsStatus = null;  // OBS 브라우저 소스가 알려 준 상태 (권한·장면 목록)

const isLocal = req => {
  const a = (req.socket || req.connection).remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

// ── 웹 편집기 인증 (PIN) ───────────────────────────
const sessions = new Set();
const cookieToken = req => (req.headers.cookie || '').match(/wc_session=([a-f0-9]+)/)?.[1];
const authed = req => isLocal(req) || sessions.has(cookieToken(req));
const needAuth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'PIN 로그인이 필요합니다' });
// 운영 컴퓨터를 부르는 말: 맥은 '랩탑', 윈도우는 '노트북' (목사님 요청)
const PC_NAME = process.platform === 'win32' ? '노트북' : '랩탑';
const needLocal = (req, res, next) => isLocal(req) ? next() : res.status(403).json({ error: `송출 제어는 운영 ${PC_NAME}에서만 가능합니다` });
// 송출 조작: 운영 컴퓨터, 또는 '휴대폰 리모컨'을 켜 두었을 때 PIN으로 들어온 기기
const canControl = req => isLocal(req) || (!!db.settings.remote && authed(req));
const needControl = (req, res, next) => canControl(req) ? next() : res.status(403).json({ error: '송출 조작은 운영 컴퓨터에서만 됩니다 (⚙︎ 설정에서 휴대폰 리모컨을 켜면 휴대폰에서도 됨)' });

// 이 컴퓨터의 이름 주소 (예: Easyui-MacBookAir.local) — 공유기가 다시 켜져 숫자 주소가 바뀌어도 그대로
function hostName() {
  const hn = os.hostname().replace(/\.local$/i, '');
  return /^[A-Za-z0-9-]{1,63}$/.test(hn) && hn.toLowerCase() !== 'localhost' ? hn + '.local' : '';
}
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

// 전체 이어 보기: 예배 순서에서 이 자료의 앞·뒤 자료 (슬라이드가 없는 자료는 건너뜀)
function neighborItem(id, dir) {
  const svc = [db.services.find(s => s.id === db.currentServiceId), ...db.services].find(s => s && s.itemIds.includes(id));
  if (!svc) return null;
  for (let k = svc.itemIds.indexOf(id) + dir; k >= 0 && k < svc.itemIds.length; k += dir) {
    const it = db.items.find(i => i.id === svc.itemIds[k]);
    if (it && store.seq(it).length) return it;
  }
  return null;
}
function snapshot() {
  const item = db.items.find(i => i.id === live.itemId);
  const sl = item ? store.seq(item) : [];
  const slide = sl[live.index] || null;
  let next = sl[live.index + 1] || null;
  if (!next && item && db.settings.continuous) { const n = neighborItem(item.id, 1); if (n) next = store.seq(n)[0] || null; }   // 이어 보기: 다음 자료 첫 장
  const prop = live.prop ? db.props.find(p => p.id === live.prop) || null : null;
  return {
    type: 'live', live: { ...live }, style: db.style, now: Date.now(), prop,
    logo: { url: db.settings.logo, ...db.settings.logoStyle }, obs: db.settings.obsScenes, themes: db.settings.themes || {},
    item: item ? { id: item.id, title: item.title, type: item.type, count: sl.length, noBroadcast: !!item.noBroadcast, bcFull: !!item.bcFull, theme: item.theme || '', motionVideo: item.motionVideo || '' } : null,
    slide, next,
  };
}

// ── 자동 넘김 (광고 반복 등): 몇 초마다 다음 슬라이드, 끝나면 처음부터(반복) 또는 멈춤 ──
let autoTimer = null;
function setAuto(a) {
  clearInterval(autoTimer); autoTimer = null;
  live.auto = a && a.sec ? { sec: Math.min(600, Math.max(2, Math.round(+a.sec) || 8)), loop: a.loop !== false } : null;
  if (!live.auto) return;
  autoTimer = setInterval(() => {
    const it = db.items.find(i => i.id === live.itemId), n = it ? store.seq(it).length : 0;
    if (!n) { setAuto(null); pushLive(); return; }
    if (live.index + 1 < n) live.index++;
    else if (live.auto.loop) live.index = 0;
    else { setAuto(null); pushLive(); return; }
    live.clear = false; live.black = false;
    pushLive();
  }, live.auto.sec * 1000);
}
// 타이머: 몇 분 뒤 또는 정한 시각까지
function makeTimer(t) {
  if (!t) return null;
  let end = null;
  if (t.min != null && Number.isFinite(+t.min)) end = Date.now() + Math.min(600, Math.max(0, +t.min)) * 60000;
  else if (/^\d{1,2}:\d{2}$/.test(String(t.until || ''))) {
    const [h, m] = t.until.split(':').map(Number), d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1);   // 이미 지난 시각이면 내일
    end = d.getTime();
  }
  if (!end) return null;
  return { end, label: String(t.label || '').slice(0, 60), tv: ['none', 'corner', 'big', 'over'].includes(t.tv) ? t.tv : 'none', obs: !!t.obs, clock: t.min == null };   // clock: '몇 시까지' 타이머 · obs: 유튜브에도 · over: 배경 위에 타이머만(로고처럼)
}

// ── 앱 ─────────────────────────────────────────────
const app = express();

// ── 보안: 다른 사이트가 이 서버를 조종하지 못하게 ─────────────
// 1) Host 헤더가 이 맥의 이름/주소일 때만 응답 (DNS 리바인딩 차단)
// 2) 바꾸는 요청(POST/PUT/DELETE)은 같은 출처에서 온 것만 허용 (CSRF 차단)
function allowedHosts() {
  const hn = os.hostname().toLowerCase().replace(/\.local$/, '');
  return new Set(['localhost', '127.0.0.1', '[::1]', hn, hn + '.local', ...lanAddresses()]);
}
const hostOk = h => !!h && allowedHosts().has(String(h).toLowerCase().replace(/:\d+$/, ''));
function originOk(req) {
  const o = req.headers.origin;
  if (o) { try { return new URL(o).host.toLowerCase() === String(req.headers.host).toLowerCase(); } catch { return false; } }
  return req.headers['sec-fetch-site'] !== 'cross-site';
}
app.use((req, res, next) => {
  if (!hostOk(req.headers.host)) return res.status(403).send('허용되지 않은 주소입니다');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originOk(req)) return res.status(403).json({ error: '다른 사이트에서 온 요청은 막혀 있습니다' });
  next();
});
app.use(express.json({ limit: '20mb' }));
const upload = multer({ dest: path.join(store.DATA_DIR, 'tmp'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
// 브라우저는 파일 이름을 UTF-8 로 보내는데 multer 는 latin1 로 읽음 → 한글 이름이 깨지지 않게 되돌림
const fname = f => { const n = f?.originalname || ''; try { const u = Buffer.from(n, 'latin1').toString('utf8'); return (u.includes('\ufffd') ? n : u).normalize('NFC'); } catch { return n; } };

app.get('/', (req, res) => res.redirect(isLocal(req) ? '/control' : '/editor'));
app.get('/control', (req, res) => isLocal(req) ? res.sendFile(path.join(__dirname, 'public', 'app.html')) : res.redirect('/editor'));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
// 서버가 다시 켜졌는지 송출 화면이 알 수 있게 (켤 때마다 바뀌는 값) → 업데이트 뒤 스스로 새로고침
const BOOT = String(Date.now());
app.get('/api/boot', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ boot: BOOT, lang: db.settings.lang === 'en' ? 'en' : 'ko' }); });
// HTML 파일 자료: 샌드박스(앱과 다른 출처)로만 열림 → 파일 안의 스크립트가 앱을 조종할 수 없음
app.get('/slides/:id([a-f0-9]{12}).html', (req, res) => {
  const file = path.join(SLIDES_DIR, req.params.id + '.html');
  if (!fs.existsSync(file)) return res.status(404).send('슬라이드 파일이 없습니다');
  let html = fs.readFileSync(file, 'utf8');
  const helper = '<script src="/wc-html-slide.js"></script>';   // 맨 앞: '몇 번째 장'을 먼저 읽어야 함
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + helper) : helper + html;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');   // 앱과 다른 출처(opaque)로만 열림
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(html);
});
app.get('/remote', (req, res) => res.sendFile(path.join(__dirname, 'public', 'remote.html')));
for (const p of ['output', 'overlay', 'stage']) app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.use('/media', express.static(MEDIA_DIR, {
  maxAge: '1h',
  setHeaders: res => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
  },
}));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build'), {
  setHeaders: (res, p) => { if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript'); },
}));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource'), { maxAge: '7d' }));
// 내 글꼴: 교회가 가진 글꼴 파일(.ttf·.otf·.woff·.woff2)을 자료 폴더에 두고 모든 화면(예배당·OBS·리모컨)에 내줌
// (글꼴은 저작권·사용 허락이 있어 프로그램에는 넣지 않음). 이름표는 'WCF <id>' — 글꼴 이름 검사(영문·숫자·한글)를 그대로 통과
const FONTS_DIR = path.join(store.DATA_DIR, 'fonts');
fs.mkdirSync(FONTS_DIR, { recursive: true });
const FONT_EXT = /^\.(ttf|otf|woff2?)$/i;
const myFonts = () => (Array.isArray(db.settings.fonts) ? db.settings.fonts : (db.settings.fonts = []));
app.use('/myfonts', express.static(FONTS_DIR, { maxAge: '7d' }));
app.get('/fonts-mine.css', (req, res) => {
  res.type('text/css').set('Cache-Control', 'no-cache')
    .send(myFonts().map(f => `@font-face { font-family: '${f.family}'; src: url('/myfonts/${encodeURIComponent(f.file)}'); font-display: swap; }`).join('\n'));
});
app.use(express.static(path.join(__dirname, 'public')));

const loginFails = new Map(); // ip -> { n, until }
app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: `잠시 후 다시 시도하세요 (${Math.ceil((f.until - Date.now()) / 1000)}초)` });
  const a = Buffer.from(String(req.body?.pin ?? '')), b = Buffer.from(String(db.settings.pin));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; }  // 5번 틀리면 5분 잠금
    loginFails.set(ip, f);
    return res.status(401).json({ error: 'PIN이 맞지 않습니다' });
  }
  loginFails.delete(ip);
  const t = crypto.randomBytes(16).toString('hex');
  sessions.add(t);
  res.setHeader('Set-Cookie', `wc_session=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  res.json({ ok: true });
});
app.post('/api/html', needAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일 없음' });
  if (!/\.html?$/i.test(req.file.originalname) || req.file.size > 30 * 1024 * 1024) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: '30MB 이하의 .html 파일만 가져올 수 있습니다' }); }
  const id = store.uid();
  fs.renameSync(req.file.path, path.join(SLIDES_DIR, id + '.html'));
  res.json({ url: `/slides/${id}.html` });
});
app.get('/api/me', (req, res) => res.json({ authed: authed(req), local: isLocal(req), pc: PC_NAME, lang: db.settings.lang === 'en' ? 'en' : 'ko' }));

app.get('/api/state', needAuth, (req, res) => {
  res.json({
    items: db.items, services: db.services, currentServiceId: db.currentServiceId, phrases: db.phrases, props: db.props, canControl: canControl(req),
    style: db.style, settings: isLocal(req) ? db.settings : { logo: db.settings.logo, titleLogo: db.settings.titleLogo || '', themes: db.settings.themes || {}, themeDefaults: db.settings.themeDefaults || {}, fonts: myFonts() },
    bibleVersions: bible.versionNames(), bibleDefault: bible.defaultVersion(), lan: lanAddresses(), host: hostName(), hymnCount: hymns.count(), readingCount: readings.count(), port: PORT, live: snapshot(),
    recovered: isLocal(req) ? store.recoveredInfo() : null,   // 자료 파일이 깨져 보관본으로 되살렸으면 알림
  });
});

const changed = () => { store.save(); broadcast({ type: 'data' }); };
app.post('/api/recovered/ok', needLocal, (req, res) => { store.clearRecovered(); res.json({ ok: true }); });

// 자료(곡/말씀/광고/PPT)
app.post('/api/items', needAuth, (req, res) => { const it = addItem(req.body || {}); changed(); res.json(it); });
app.put('/api/items/:id', needAuth, (req, res) => {
  const it = db.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: '없음' });
  const liveId = live.itemId === it.id ? store.seq(it)[live.index]?.id : null;   // 지금 나가는 슬라이드
  Object.assign(it, itemFields(req.body || {}, it), { updatedAt: Date.now() });
  it.slides.forEach(s => (s.id ||= store.uid()));
  if (live.itemId === it.id) {
    // 앞 슬라이드를 숨기거나 넣어도 지금 나가는 슬라이드가 그대로 나가게 (없어졌으면 그 자리)
    const ns = store.seq(it), j = liveId ? ns.findIndex(s => s.id === liveId) : -1;
    live.index = j >= 0 ? j : Math.min(live.index, Math.max(0, ns.length - 1)); pushLive();
  }
  changed(); res.json(it);
});
// 복제: 가사·슬라이드·모양·배경 영상까지 그대로 담은 새 자료를 예배 순서에 하나 더 (따로 떨어진 사본)
app.post('/api/items/:id/copy', needAuth, (req, res) => {
  const src = db.items.find(i => i.id === req.params.id);
  if (!src) return res.status(404).json({ error: '복제할 자료가 없습니다' });
  const svc = db.services.find(s => s.id === (req.body?.serviceId || db.currentServiceId));
  if (!svc) return res.status(404).json({ error: '예배 순서가 없습니다' });
  const it = JSON.parse(JSON.stringify(src));
  it.id = store.uid(); it.updatedAt = Date.now();
  it.title = (String(src.title || '').replace(/\s*\(복사(?: \d+)?\)$/, '') + ' (복사)').slice(0, 200);
  (it.slides || []).forEach(s => (s.id = store.uid()));
  db.items.push(it);
  const after = req.body?.after ?? src.id;
  const at = svc.itemIds.indexOf(after);
  if (at >= 0) svc.itemIds.splice(at + 1, 0, it.id); else svc.itemIds.push(it.id);
  changed(); res.json(it);
});
// 찬양 자료실에서 여러 개를 골라 한 번에 지우기
app.post('/api/items/delete', needAuth, (req, res) => {
  const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
  if (!ids.size) return res.status(400).json({ error: '지울 자료를 고르세요' });
  const n = db.items.length;
  db.items = db.items.filter(i => !ids.has(i.id));
  db.services.forEach(s => (s.itemIds = s.itemIds.filter(x => !ids.has(x))));
  changed(); res.json({ ok: true, deleted: n - db.items.length });
});
app.delete('/api/items/:id', needAuth, (req, res) => {
  db.items = db.items.filter(i => i.id !== req.params.id);
  db.services.forEach(s => (s.itemIds = s.itemIds.filter(x => x !== req.params.id)));
  changed(); res.json({ ok: true });
});
app.post('/api/split', needAuth, (req, res) => res.json(store.splitLyrics(req.body.text, Math.max(1, +req.body.lines || 2))));

// 가사 찾기 — 운영자가 버튼을 누를 때만, 공개 가사 모음(LRCLIB)·지니·벅스를 함께 찾아 LRCLIB → 지니 → 벅스 순으로
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
// 가사 사이트 주소 (점검에서만 가짜 사이트로 바꿈)
const LRCLIB = process.env.WC_LYRICS_LRCLIB || 'https://lrclib.net';
const BUGS = process.env.WC_LYRICS_BUGS || 'https://music.bugs.co.kr';
const GENIE = process.env.WC_LYRICS_GENIE || 'https://www.genie.co.kr';
// 정말 인터넷이 안 될 때 나는 오류 (주소를 못 찾음·연결 불가) — 사이트가 느리거나 막은 것과 구분
const OFFLINE = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EADDRNOTAVAIL']);
const isOffline = e => OFFLINE.has(e?.cause?.code || e?.code);
const getText = (url, ms = 7000) => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) })
  .then(r => r.ok ? r.text() : Promise.reject(Object.assign(new Error('HTTP ' + r.status), { status: r.status })));
const unent = s => s.replace(/&(lt|gt|quot|#39|apos|nbsp|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', amp: '&' }[e]));
const lyricTidy = s => unent(String(s || '')).replace(/\r/g, '').replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
async function lrclib(q) {
  // 무료 서버라 가끔 느림 → 12초까지 기다리고, 느리거나 서버 오류면 한 번 더
  const url = LRCLIB + '/api/search?q=' + encodeURIComponent(q);
  const text = await getText(url, 12000).catch(e => (isOffline(e) || (e.status && e.status < 500) ? Promise.reject(e) : getText(url, 12000)));
  const j = JSON.parse(text);
  return (Array.isArray(j) ? j : []).filter(x => x && x.plainLyrics && !x.instrumental).slice(0, 6)
    .map(x => ({ src: 'LRCLIB', title: String(x.trackName || ''), artist: String(x.artistName || ''), text: lyricTidy(x.plainLyrics) }));
}
async function bugs(q) {
  // 벅스는 자동 검색을 막아 둘 때가 있음(429·확인 화면) → 뚫지 않고 바로 건너뜀
  const html = await getText(BUGS + '/search/track?q=' + encodeURIComponent(q), 5000);
  const rows = [], seen = new Set();
  for (const m of html.matchAll(/<tr [^>]*trackId="(\d+)"[^>]*rowType="track"[\s\S]*?<p class="title"[\s\S]*?title="([^"]*)"[\s\S]*?<p class="artist">[\s\S]*?title="([^"]*)"/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    rows.push({ id: m[1], title: unent(m[2]), artist: unent(m[3]) });
    if (rows.length >= 10) break;
  }
  const got = await Promise.all(rows.map(r => getText(BUGS + '/track/' + r.id).then(h => {
    const m = h.match(/class="lyricsContainer">\s*<p><xmp>([\s\S]*?)<\/xmp>/);
    return m ? { src: '벅스', title: r.title, artist: r.artist, text: lyricTidy(m[1]) } : null;
  }).catch(() => null)));
  return got.filter(x => x && x.text);
}
async function genie(q) {
  // 지니: 한국 찬양(CCM)이 많음. 검색 화면에서 곡 번호를 뽑고 곡마다 가사를 읽음 (막으면 건너뜀)
  const search = async t => {
    const html = await getText(GENIE + '/search/searchSong?query=' + encodeURIComponent(t), 6000);
    const rows = [], seen = new Set();
    for (const m of html.matchAll(/<tr[^>]*class="list"[^>]*songid="(\d+)"([\s\S]*?)<\/tr>/g)) {
      if (seen.has(m[1])) continue; seen.add(m[1]);
      const title = m[2].match(/<a[^>]*class="title ellipsis"[^>]*title="([^"]*)"/);
      const artist = m[2].match(/<a[^>]*class="artist ellipsis"[^>]*>([\s\S]*?)<\/a>/);
      rows.push({ id: m[1], title: title ? unent(title[1]).trim() : '', artist: artist ? lyricTidy(artist[1]).replace(/\s+/g, ' ') : '' });
      if (rows.length >= 6) break;
    }
    return rows;
  };
  let rows = await search(q);
  if (!rows.length && /\s/.test(q)) rows = await search(q.replace(/\s+/g, ''));   // 띄어쓰기가 달라 못 찾는 곡
  const got = await Promise.all(rows.map(r => getText(GENIE + '/detail/songInfo?xgnm=' + r.id).then(h => {
    const m = h.match(/<pre id="pLyrics">[\s\S]*?<p>([\s\S]*?)<\/p>/);
    const text = m ? lyricTidy(m[1].replace(/<br\s*\/?>/gi, '\n')).split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : '';
    return text && !/가사\s*정보가\s*없|등록된\s*가사가\s*없/.test(text) ? { src: '지니', title: r.title, artist: r.artist, text } : null;
  }).catch(() => null)));
  return got.filter(Boolean);
}
app.get('/api/lyrics', needAuth, async (req, res) => {
  const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!q) return res.status(400).json({ error: '곡 제목을 넣으세요' });
  const [a, b, g] = await Promise.allSettled([lrclib(q), bugs(q), genie(q)]);
  // 벅스가 자동 검색을 막았거나(429·403 등) 대답하지 않음 → 화면에서 '벅스에서 찾기'로 직접 열도록 알림 (막은 것을 뚫지 않음)
  if (b.status === 'rejected' && !isOffline(b.reason)) res.set('X-WC-Bugs', 'blocked');
  const seen = new Set();   // 같은 가사(편곡만 다른 곡)는 하나만
  const list = [...(a.value || []), ...(g.value || []), ...(b.value || [])].filter(x => { const k = x.text.replace(/\s+/g, '').slice(0, 120); return !seen.has(k) && seen.add(k); });
  if (!list.length && a.status === 'rejected' && b.status === 'rejected' && g.status === 'rejected') {
    // 모두 '연결 불가'일 때만 인터넷 문제라고 알림. 사이트가 느리거나 막았으면 그렇게 알림
    if (isOffline(a.reason) && isOffline(b.reason) && isOffline(g.reason)) return res.status(502).json({ error: '인터넷에 연결할 수 없습니다. 이 컴퓨터의 인터넷 연결을 확인하세요', code: 'offline' });
    console.log('  가사 찾기 실패:', 'LRCLIB', a.reason?.message, '/ 지니', g.reason?.message, '/ 벅스', b.reason?.message);
    return res.status(502).json({ error: '가사 사이트가 지금 대답하지 않습니다 (벅스가 자동 검색을 막았을 수 있습니다). 아래 [벅스]·[멜론]을 눌러 찾은 뒤, 가사를 복사해 📋 버튼으로 넣으세요', code: 'busy' });
  }
  res.json(list);
});

// 예배 순서
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// 광고(교회 소식)는 찬양과 같은 모양으로: 광고 기본 모양을 따로 정했으면 그것, 아니면 새 찬양 기본 모양 (public/app.js 의 defTheme 와 같은 규칙)
const noticeTheme = () => { const d = db.settings.themeDefaults || {}; return d.notice ?? d.song ?? ''; };
app.post('/api/services', needAuth, (req, res) => {
  const tpl = templates.SERVICES[req.body.template];
  const s = { id: store.uid(), name: String(req.body.name || tpl?.name || '새 예배').slice(0, 100), date: String(req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 20), itemIds: [] };
  const tm = TIME_RE.test(req.body.time || '') ? req.body.time : tpl?.time;   // 예배 시작 시각 (타이머 '예배 시작까지'), 없으면 템플릿 기본
  if (tm) s.time = tm;
  db.services.push(s); db.currentServiceId = s.id;
  for (const step of tpl?.steps || []) {
    const b = step === 'COMMUNION' ? templates.communionItem(bible, db.settings.bibleNoVer)
      : { type: 'text', title: step[0].split('\n')[0], theme: step[1] === 'notice' ? noticeTheme() : step[1], slides: [{ text: step[0] }] };
    addItem(b);   // 찬양이 아니므로 지금 예배 순서 끝에 들어감
  }
  changed(); res.json(s);
});
// 템플릿 목록 · 내 문구
app.get('/api/templates', needAuth, (req, res) => res.json({ phrases: templates.PHRASES, services: templates.SERVICE_LIST }));
app.post('/api/templates/communion', needAuth, (req, res) => { const it = addItem({ ...templates.communionItem(bible, db.settings.bibleNoVer), after: req.body?.after }); changed(); res.json(it); });
// 이름 자막 목록
app.put('/api/props', needAuth, (req, res) => {
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  db.props = (Array.isArray(req.body?.props) ? req.body.props : []).slice(0, 50).map(p => ({
    id: /^[a-f0-9]{12}$/.test(p.id) ? p.id : store.uid(), text: t(p.text, 80), sub: t(p.sub, 120),
    where: ['both', 'tv', 'obs'].includes(p.where) ? p.where : 'both', pos: p.pos === 'top' ? 'top' : 'bottom',
  })).filter(p => p.text);
  if (live.prop && !db.props.some(p => p.id === live.prop)) live.prop = null;
  changed(); pushLive(); res.json(db.props);
});
app.put('/api/phrases', needAuth, (req, res) => {
  db.phrases = (Array.isArray(req.body?.phrases) ? req.body.phrases : []).map(x => String(x).slice(0, 500)).filter(x => x.trim()).slice(0, 200);
  changed(); res.json(db.phrases);
});
app.put('/api/services/:id', needAuth, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: '없음' });
  Object.assign(s, { name: req.body.name ?? s.name, date: req.body.date ?? s.date, itemIds: req.body.itemIds ?? s.itemIds });
  if (req.body.note !== undefined) s.note = String(req.body.note ?? '').slice(0, 1000);   // 콘티 인도자 메모
  if (req.body.time !== undefined) { if (TIME_RE.test(req.body.time)) s.time = req.body.time; else delete s.time; }   // 예배 시작 시각
  pruneOrphans(); changed(); res.json(s);
});
app.delete('/api/services/:id', needAuth, (req, res) => {
  db.services = db.services.filter(s => s.id !== req.params.id);
  if (db.currentServiceId === req.params.id) db.currentServiceId = db.services[0]?.id || null;
  pruneOrphans(); changed(); res.json({ ok: true });
});
app.put('/api/current-service', needAuth, (req, res) => { db.currentServiceId = req.body.id; changed(); res.json({ ok: true }); });

// 스타일·설정
// 스타일 값 검증 (색은 #hex, 숫자는 범위, 글꼴은 안전한 문자만)
const STYLE_RULES = {
  color: 'color', stroke: 'color', bg: 'color', box: 'color',
  size: [1, 30], strokeWidth: [0, 10], lineHeight: [0.8, 3], boxOpacity: [0, 1],
  align: ['left', 'center', 'right'], valign: ['top', 'middle', 'bottom'], position: ['top', 'middle', 'bottom'], aspect: ['16:9', '4:3'],
  bold: 'bool', shadow: 'bool', showTitle: 'bool', font: 'font', motionOn: 'bool',
  motion: ['none', 'galaxy', 'water', 'rays', 'bokeh', 'aurora', 'dawn', 'embers', 'video'], motionVideo: 'media',
  imgMode: ['full', 'part', 'circle', 'none'], partSize: [15, 70], partPos: ['tr', 'mr', 'br', 'tl', 'ml', 'bl'],
  circSize: [12, 60], circPos: ['tr', 'mr', 'br', 'tl', 'ml', 'bl'],
};
function cleanStyle(src, base) {
  const out = { ...base };
  for (const [k, v] of Object.entries(src || {})) {
    const r = STYLE_RULES[k];
    if (!r) continue;
    if (r === 'color') { if (/^#[0-9a-f]{3,8}$/i.test(String(v))) out[k] = v; }
    else if (r === 'bool') out[k] = !!v;
    else if (r === 'font') { if (/^[\w\s',\-가-힣]{1,120}$/.test(String(v))) out[k] = v; }
    else if (r === 'media') { if (v === '' || /^\/media\/[^"'<>()\\\s]+$/.test(String(v))) out[k] = v; }
    else if (typeof r[0] === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.min(r[1], Math.max(r[0], n)); }
    else if (r.includes(v)) out[k] = v;
  }
  return out;
}
// 종류별 자막 스타일: 찬양·말씀·문구·광고마다 '따로 바꾼 값'만 저장 (나머지는 전체 스타일을 따름)
const STYLE_TYPES = ['song', 'bible', 'text', 'notice'];
const TYPE_ONLY_SKIP = ['aspect', 'motionOn'];   // 화면 비율·움직이는 배경 켜기는 전체에서만
function cleanByType(src) {
  const out = {};
  for (const t of STYLE_TYPES) {
    const o = src?.[t]; if (!o || typeof o !== 'object') continue;
    const main = cleanStyle(o.main, {}), overlay = cleanStyle(o.overlay, {});
    TYPE_ONLY_SKIP.forEach(k => delete main[k]);
    if (Object.keys(main).length || Object.keys(overlay).length) out[t] = { main, overlay };
  }
  return out;
}
function withByType(main, overlay, byType) {
  const b = cleanByType(byType);
  return Object.keys(b).length ? { main, overlay, byType: b } : { main, overlay };
}
app.put('/api/style', needAuth, (req, res) => {
  db.style = withByType(cleanStyle(req.body.main, db.style.main), cleanStyle(req.body.overlay, db.style.overlay), 'byType' in req.body ? req.body.byType : db.style.byType);
  changed(); pushLive(); res.json(db.style);
});
const LOGO_RE = /^\/media\/[^"'<>()\\\s]+$/;
const TITLE_LOGO_RE = /^\/media\/[^/\\"'<>()\s]+\.(png|jpe?g|gif|webp)$/i;
function cleanLogoStyle(l, cur) {
  const P = ['c', 'tl', 'tc', 'tr', 'bl', 'bc', 'br'];
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  l = l && typeof l === 'object' ? l : {};
  return {
    screenBg: ['black', 'over'].includes(l.screenBg) ? l.screenBg : (cur.screenBg || 'black'),   // 로고 화면 바탕: 검정 / 지금 배경 위에 로고만
    screenPos: P.includes(l.screenPos) ? l.screenPos : cur.screenPos, screenSize: n(l.screenSize, 5, 95, cur.screenSize),
    mark: l.mark !== undefined ? !!l.mark : cur.mark, markPos: P.includes(l.markPos) ? l.markPos : cur.markPos,
    markSize: n(l.markSize, 3, 40, cur.markSize), markOpacity: n(l.markOpacity, 0.1, 1, cur.markOpacity),
    markOverlay: l.markOverlay !== undefined ? !!l.markOverlay : cur.markOverlay,
  };
}
app.put('/api/settings', needLocal, (req, res) => {
  if (req.body.pin != null) {
    const pin = String(req.body.pin).trim();
    if (!/^\w{6,12}$/.test(pin)) return res.status(400).json({ error: 'PIN은 6~12자리 숫자/영문으로 정하세요' });
    db.settings.pin = pin;
  }
  if (req.body.logo != null) db.settings.logo = LOGO_RE.test(req.body.logo) ? req.body.logo : '';
  if (req.body.logoStyle) db.settings.logoStyle = cleanLogoStyle(req.body.logoStyle, db.settings.logoStyle);
  // 운영 화면 맨 위 '예배송출' 앞에 붙는 교회 로고 (비우면 ✝)
  if (req.body.titleLogo != null) db.settings.titleLogo = TITLE_LOGO_RE.test(req.body.titleLogo) ? req.body.titleLogo : '';
  if (req.body.remote !== undefined) db.settings.remote = !!req.body.remote;   // 휴대폰 리모컨 허용
  if (req.body.continuous !== undefined) { db.settings.continuous = !!req.body.continuous; pushLive(); }   // 전체 이어 보기 (자료 끝에서 다음 자료로 이어 넘김)
  if (req.body.updateCheck !== undefined) db.settings.updateCheck = !!req.body.updateCheck;   // 새 버전 알림
  if (req.body.bibleNoVer !== undefined) db.settings.bibleNoVer = !!req.body.bibleNoVer;   // 성경 구절 아래에 번역본 이름(개역개정 등) 안 보이기
  if (req.body.lang !== undefined) {   // 메뉴 언어 — 바뀌면 열린 화면·리모컨도 새로고침
    const l = req.body.lang === 'en' ? 'en' : 'ko';
    if (l !== (db.settings.lang || 'ko')) { db.settings.lang = l; setTimeout(() => broadcast({ type: 'lang', lang: l }), 300); }
  }
  if (req.body.themeDefaults !== undefined) db.settings.themeDefaults = cleanThemeDefaults(req.body.themeDefaults, db.settings.themes || {});
  if (req.body.obsScenes) {
    const o = req.body.obsScenes, t = v => String(v ?? '').slice(0, 100);
    db.settings.obsScenes = { base: t(o.base), pip: t(o.pip), circle: t(o.circle) };
  }
  if (req.body.pin != null) sessions.clear();
  changed(); pushLive(); res.json({ ok: true });
});

// 내 모양 저장·지우기
app.put('/api/themes/:key', needLocal, (req, res) => {
  const key = req.params.key;
  if (!MY_THEME_RE.test(key)) return res.status(400).json({ error: '모양 이름표가 맞지 않습니다' });
  const themes = db.settings.themes ||= {};
  if (!themes[key] && Object.keys(themes).length >= 60) return res.status(400).json({ error: '내 모양은 60개까지 만들 수 있습니다' });
  themes[key] = cleanTheme(req.body);
  changed(); pushLive(); res.json({ key, theme: themes[key] });
});
app.delete('/api/themes/:key', needLocal, (req, res) => {
  const key = req.params.key, themes = db.settings.themes || {};
  if (!themes[key]) return res.status(404).json({ error: '없는 모양' });
  delete themes[key];
  // 이 모양을 쓰던 자료는 바탕 모양으로, 기본 모양으로 정해 둔 곳은 비움
  const was = db.items.filter(i => i.theme === key).length;
  db.items.forEach(i => { if (i.theme === key) i.theme = ''; });
  const d = db.settings.themeDefaults || {};
  for (const k of Object.keys(d)) if (d[k] === key) delete d[k];
  changed(); pushLive(); res.json({ ok: true, items: was });
});

// ── 새 버전 알림·자동 설치: GitHub 배포에서 최신 버전 번호와 설명만 확인 (6시간에 한 번, 이쪽 정보는 보내지 않음) ──
const updater = require('./lib/updater');
const APP_VERSION = require('./package.json').version;
const DOWNLOAD_PAGE = 'https://raon-easypaster.github.io/worship-caster/';
const RELEASE_API = process.env.WC_UPDATE_API || 'https://api.github.com/repos/raon-easypaster/worship-caster/releases/latest';
const UPDATE_ASSET = updater.UPDATE_ASSET;
const upd = { at: 0, latest: null, notes: '', page: '', pkg: '', sums: '', sig: '' };
const isNewer = updater.isNewer;
// 배포 설명에서 '받기' 표 앞까지만 (무엇이 바뀌었는지)
const releaseNotes = body => String(body || '').split(/\n#{2,3}\s*받기/)[0].replace(/^##\s*예배송출 v[\d.]+\s*\n/, '').trim().slice(0, 4000);
// 받는 주소는 깃허브 배포 파일만 (다른 곳으로 받지 않음)
const okAsset = u => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'github.com' && x.pathname.startsWith('/raon-easypaster/worship-caster/releases/download/'); } catch { return false; } };
async function fetchRelease() {
  const r = await fetch(RELEASE_API, { headers: { 'User-Agent': 'worship-caster', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('깃허브 응답 ' + r.status);
  const j = await r.json();
  const tag = String(j.tag_name || '').replace(/^v/, '');
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag)) throw new Error('버전 번호를 읽지 못함');
  const asset = n => (j.assets || []).find(x => x.name === n)?.browser_download_url || '';
  const test = !!process.env.WC_UPDATE_API;   // 자동 점검에서만 다른 주소 허용
  const pick = n => { const u = asset(n); return u && (test || okAsset(u)) ? u : ''; };
  Object.assign(upd, { latest: tag, notes: releaseNotes(j.body), page: String(j.html_url || ''), pkg: pick(UPDATE_ASSET), sums: pick(updater.SUMS), sig: pick(updater.SUMS + '.sig') });
}
app.get('/api/update', needLocal, async (req, res) => {
  if (db.settings.updateCheck === false) return res.json({ current: APP_VERSION, off: true });
  if (Date.now() - upd.at > 6 * 3600e3 || req.query.now === '1' && Date.now() - upd.at > 60e3) {
    upd.at = Date.now();
    try { await fetchRelease(); }
    catch { upd.at = Date.now() - 6 * 3600e3 + 10 * 60e3; }   // 인터넷이 없으면 조용히 넘어감, 10분 뒤 다시
  }
  const newer = !!upd.latest && isNewer(upd.latest, APP_VERSION);
  res.json({ current: APP_VERSION, latest: upd.latest, newer, url: DOWNLOAD_PAGE,
    notes: newer ? upd.notes : '', page: /^https:\/\/github\.com\//.test(upd.page) ? upd.page : '',
    canInstall: newer && !!upd.pkg && !!upd.sums && !!upd.sig, installing: !!updState.busy });
});

// 지금 업데이트: 받기 → 확인값 대조 → 자료 폴더에 풀기 → 다시 켜기
const updState = { busy: false };
async function getBuf(url, max) {
  const r = await fetch(url, { headers: { 'User-Agent': 'worship-caster' }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw new Error('받지 못했습니다 (' + r.status + ')');
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > max) throw new Error('파일이 너무 큽니다');
  return b;
}
app.post('/api/update/install', needLocal, async (req, res) => {
  if (updState.busy) return res.status(409).json({ error: '이미 업데이트하는 중입니다' });
  if (!upd.latest || !isNewer(upd.latest, APP_VERSION) || !upd.pkg || !upd.sums) return res.status(400).json({ error: '설치할 새 버전이 없습니다' });
  if (!upd.sig) return res.status(400).json({ error: '이 배포에는 서명이 없어 자동으로 설치하지 않습니다. 받는 곳에서 새 앱을 받아 바꿔 넣으세요', manual: true });
  updState.busy = true;
  try {
    const sums = (await getBuf(upd.sums, 64 * 1024)).toString('utf8');
    const sig = (await getBuf(upd.sig, 4 * 1024)).toString('utf8');
    // 서명부터 확인 (틀리면 큰 파일은 받지도 않음)
    if (!updater.verifySig(sums, sig)) throw Object.assign(new Error('배포 파일의 서명이 맞지 않아 설치하지 않았습니다. 받는 곳에서 새 앱을 받아 바꿔 넣으세요'), { manual: true });
    if (!updater.sumFor(sums, UPDATE_ASSET)) throw new Error('확인값(SHA256SUMS)에 업데이트 파일이 없습니다');
    const pkg = await getBuf(upd.pkg, 150 * 1024 * 1024);
    store.flush();
    // install 이 서명·확인값을 다시 확인하고 풀어 둠
    const r = updater.install(pkg, { expectVersion: upd.latest, currentVersion: APP_VERSION, sums, sig });
    res.json({ ok: true, version: r.version, restart: process.env.WC_NO_RESTART !== '1' });
    if (process.env.WC_NO_RESTART !== '1') setTimeout(restartSelf, 400);
    else updState.busy = false;
  } catch (e) {
    updState.busy = false;
    res.status(500).json({ error: e.message, manual: !!e.manual });
  }
});

// 다시 켜기: 새 본체를 먼저 띄워 자료를 다 읽게 한 뒤(준비됨 신호) 지금 것을 끔 → 끊기는 시간이 아주 짧음
function restartSelf() {
  const { spawn } = require('child_process');
  const dir = process.env.WC_BUNDLE_DIR || __dirname;
  const env = { ...process.env, WC_RESTARTED: '1' };
  delete env.WC_BUNDLE_DIR;                       // 새 본체가 받아 둔 버전을 다시 고르게
  store.flush();
  const bye = () => {
    broadcast({ type: 'restart' });
    for (const c of wss.clients) try { c.terminate(); } catch {}
    try { server.closeAllConnections?.(); } catch {}
    server.close();
    setTimeout(() => process.exit(0), 150);
  };
  try {
    if (process.platform === 'win32') {
      // 윈도우: 처음처럼 'WorshipCaster' 창을 새로 띄움 (닫으면 꺼지는 창)
      spawn('cmd.exe', ['/c', 'start', '"WorshipCaster (close this window to quit)"', '/min', `"${process.execPath}"`, 'server.js'],
        { cwd: dir, env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      setTimeout(bye, 300);
    } else {
      const child = spawn(process.execPath, ['server.js'], { cwd: dir, env, detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const t = setTimeout(bye, 30000);           // 준비 신호가 안 와도 30초 뒤엔 넘겨 줌
      child.on('message', m => { if (m === 'ready') { clearTimeout(t); child.disconnect(); child.unref(); bye(); } });
      child.on('exit', code => { clearTimeout(t); updState.busy = false; console.error('새 본체가 바로 꺼졌습니다 (코드 ' + code + '). 지금 버전으로 계속합니다'); });
    }
  } catch (e) { updState.busy = false; console.error('다시 켜지 못했습니다:', e); }
}

// 찬송가 (교회가 가진 가사 파일을 가져와 번호로 찾음)
app.get('/api/hymns', needAuth, (req, res) => res.json({ count: hymns.count() }));
app.get('/api/hymns/:n(\\d{1,3})', needAuth, (req, res) => {
  const h = hymns.get(req.params.n);
  if (!h) return res.status(404).json({ error: hymns.count() ? `찬송가 ${+req.params.n}장이 가져온 파일에 없습니다` : '찬송가 가사 파일을 먼저 가져오세요 (⚙︎ 설정 → 찬송가)' });
  res.json(h);
});
app.get('/api/hymns-search', needAuth, (req, res) => res.json(hymns.search(String(req.query.q || '').slice(0, 80))));
app.post('/api/hymns/learn', needAuth, (req, res) => {
  // 웹 편집기(PIN)에서는 새 번호만 기억. 이미 있는 번호를 바꾸는 것은 운영 컴퓨터에서만
  if (!isLocal(req) && hymns.has(req.body?.num)) return res.status(403).json({ error: `찬송가 ${+req.body.num}장은 이미 있습니다. 바꾸려면 운영 컴퓨터에서 하세요` });
  try { res.json(hymns.learn(req.body?.num, req.body?.title, req.body?.lyrics)); } catch (e) { res.status(400).json({ error: e.message }); }
});
// 한 파일에 여러 곡이든, 한 곡에 파일 하나씩(폴더째)이든 한꺼번에
app.post('/api/hymns/upload', needLocal, upload.array('file', 2000), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '파일 없음' });
  try {
    const r = hymns.importFiles(files.map(f => ({ buf: fs.readFileSync(f.path), name: fname(f) })));
    if (!r.count) return res.status(400).json({ error: '찬송가를 하나도 읽지 못했습니다. 파일 안에 "305장" 줄이 있거나, 파일 이름에 장 번호(예: 305장.txt)가 있어야 합니다.' });
    res.json(r);
  } finally { for (const f of files) fs.rm(f.path, { force: true }, () => {}); }
});
app.delete('/api/hymns', needLocal, (req, res) => { hymns.clear(); res.json({ ok: true }); });

// 교독문: 교회가 가진 교독문 파일을 한 번 가져오면 번호·제목·본문으로 바로 찾아 넣음
const NO_READ = '교독문 파일을 먼저 가져오세요 (⚙︎ 설정 → 📖 교독문)';
app.get('/api/readings', needAuth, (req, res) => res.json({ count: readings.count() }));
app.get('/api/readings/:n(\\d{1,3})', needAuth, (req, res) => {
  const r = readings.get(req.params.n);
  if (!r) return res.status(404).json({ error: readings.count() ? `교독문 ${+req.params.n}번이 가져온 파일에 없습니다` : NO_READ });
  res.json({ ...r, slides: readings.slides(req.params.n, req.query.lines) });
});
app.get('/api/readings-search', needAuth, (req, res) => res.json(readings.search(String(req.query.q || '').slice(0, 80))));
app.post('/api/readings/upload', needLocal, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일 없음' });
  try {
    const r = readings.importFile(fs.readFileSync(req.file.path), fname(req.file));
    if (!r.count) return res.status(400).json({ error: '교독문을 하나도 읽지 못했습니다. "1. 시편 1편"처럼 번호와 제목 줄로 시작하는지 확인하세요.' });
    res.json(r);
  } finally { fs.rm(req.file.path, { force: true }, () => {}); }
});
app.delete('/api/readings', needLocal, (req, res) => { readings.clear(); res.json({ ok: true }); });

// 성경
app.get('/api/bible', needAuth, (req, res) => res.json(bible.lookup(req.query.q, req.query.v)));
app.post('/api/bible/upload', needAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일 없음' });
  const name = (req.body.name || fname(req.file)).normalize('NFC').replace(/[^\w가-힣().\- ]/g, '').replace(/\.(txt|tsv)$/i, '') || 'bible';
  fs.renameSync(req.file.path, path.join(bible.BIBLE_DIR, name + '.txt'));
  bible.loadAll(db.settings.bibleFolders);
  const v = bible.versions[name];
  res.json({ ok: !!v, name, books: v ? Object.keys(v.books).length : 0, error: v ? null : '구절을 하나도 읽지 못했습니다. 형식을 확인하세요.' });
  broadcast({ type: 'data' });
});

// 성경 폴더 (옵시디언 마크다운 폴더 등, 원본은 그 자리에서 읽기만 함)
app.put('/api/bible/folders', needLocal, (req, res) => {
  const folders = [...new Set((req.body.folders || []).map(f => String(f).trim().replace(/^~(?=\/)/, os.homedir())).filter(Boolean))];
  const bad = folders.filter(f => !fs.existsSync(f) || !fs.statSync(f).isDirectory());
  if (bad.length) return res.status(400).json({ error: '폴더를 찾을 수 없습니다: ' + bad.join(', ') });
  db.settings.bibleFolders = folders;
  bible.loadAll(folders);
  changed();
  res.json({ ok: true, versions: bible.versionNames() });
});

// 미디어
const mediaExt = /\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm|mp3|m4a|wav|aac)$/i;
// 내 글꼴 올리기·지우기 (운영 컴퓨터에서만). 목록은 /api/state 의 settings.fonts
app.post('/api/fonts', needLocal, upload.array('file', 20), (req, res) => {
  let added = 0;
  for (const f of req.files || []) {
    const ext = path.extname(fname(f)).toLowerCase();
    if (!FONT_EXT.test(ext)) { fs.unlink(f.path, () => {}); continue; }
    const id = store.uid(), file = id + ext;
    fs.renameSync(f.path, path.join(FONTS_DIR, file));
    const name = path.basename(fname(f), path.extname(fname(f))).normalize('NFC').replace(/[<>"'`\\]/g, '').trim().slice(0, 60) || '내 글꼴';
    myFonts().push({ id, family: 'WCF ' + id, file, name });
    added++;
  }
  if (!added) return res.status(400).json({ error: '글꼴 파일(.ttf · .otf · .woff · .woff2)이 없습니다' });
  changed(); res.json({ added, fonts: myFonts() });
});
app.delete('/api/fonts/:id', needLocal, (req, res) => {
  const f = myFonts().find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '없음' });
  db.settings.fonts = myFonts().filter(x => x !== f);
  fs.rm(path.join(FONTS_DIR, path.basename(f.file)), { force: true }, () => {});
  changed(); res.json({ ok: true });
});
app.get('/api/media', needAuth, (req, res) => {
  const files = fs.readdirSync(MEDIA_DIR).filter(f => mediaExt.test(f) && !f.startsWith('ppt_'))
    .map(f => ({ url: '/media/' + f, name: f, size: fs.statSync(path.join(MEDIA_DIR, f)).size }));
  res.json(files);
});
app.post('/api/media', needAuth, upload.array('files', 50), (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    const ext = path.extname(fname(f)).toLowerCase();
    if (!mediaExt.test(ext)) { fs.unlink(f.path, () => {}); continue; }
    const base = path.basename(fname(f), path.extname(fname(f))).replace(/[^\w가-힣\-]/g, '_').slice(0, 40);
    const name = `${base}_${store.uid().slice(0, 4)}${ext}`;
    fs.renameSync(f.path, path.join(MEDIA_DIR, name));
    out.push({ url: '/media/' + name, name });
  }
  res.json(out);
});
// 미디어 파일 하나 지우기: 지금 화면에 쓰는 중이면 먼저 끔
function removeMedia(name) {
  const base = path.basename(String(name || ''));
  if (!base || base.startsWith('.')) return false;
  if (live.mediaBg === '/media/' + base) { live.mediaBg = null; pushLive(); }
  if (live.mediaTop === '/media/' + base) { live.mediaTop = null; pushLive(); }
  if (live.yt?.file && path.basename(decodeURIComponent(live.yt.file)) === base) { live.yt = null; pushLive(); }   // 틀던 내 영상을 지움
  fs.rmSync(path.join(MEDIA_DIR, base), { force: true });
  return true;
}
app.delete('/api/media/:name', needAuth, (req, res) => { removeMedia(req.params.name); res.json({ ok: true }); });
// 여러 파일 한 번에 지우기 (미디어 칸 ☑ 고르기)
app.post('/api/media/delete', needAuth, (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names.slice(0, 1000) : [];
  let n = 0; for (const x of names) if (removeMedia(x)) n++;
  res.json({ ok: true, deleted: n });
});

// ── 백업·복원: 자료 전체(찬양·순서·설정·사진·영상·HTML)를 zip 하나로 ──
// 운영 컴퓨터에서만 (PIN·설정이 들어 있음)
app.get('/api/backup', needLocal, (req, res) => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('db.json', JSON.stringify(db, null, 2));
  zip.file('예배송출-백업.txt', `예배송출 백업 — 가져온 성경·찬송가·교독문이 들어 있을 수 있으니 이 파일은 남에게 나누지 마세요 (${new Date().toLocaleString('ko-KR')})\n⚙︎ 설정 → 백업·복원 → 백업 파일로 되살리기 에서 이 zip 파일을 고르세요.\n`);
  // 가져온 찬송가·교독문 (교회가 가진 파일에서 가져온 것 — 이 컴퓨터 밖에 나누지 않음)
  for (const f of [hymns.FILE, readings.FILE]) if (fs.existsSync(f)) zip.file('data/' + path.basename(f), fs.readFileSync(f));
  for (const [dir, sub] of [[MEDIA_DIR, 'media'], [SLIDES_DIR, 'slides'], [bible.BIBLE_DIR, 'bible'], [FONTS_DIR, 'fonts']]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) zip.file(`${sub}/${f}`, fs.createReadStream(p), { binary: true, compression: 'STORE' });
    }
  }
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="worship-caster-backup-${day}.zip"; filename*=UTF-8''${encodeURIComponent(`예배송출-백업-${day}.zip`)}`);
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } })
    .on('error', e => { console.log('  백업 실패:', e.message); res.destroy(e); })
    .pipe(res);
});
// 백업 파일은 남이 준 것일 수도 있으므로, 평소 API 와 같은 규칙으로 한 칸씩 다시 검사
// PIN·휴대폰 리모컨 허용은 백업에서 가져오지 않고 이 컴퓨터 값을 그대로 둠
function cleanRestore(src) {
  const ID = /^[a-f0-9]{12}$/, arr = (v, n) => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object').slice(0, n);
  const t = (v, n) => String(v ?? '').slice(0, n);
  const items = arr(src.items, 20000).map(x => {
    const it = { id: ID.test(x.id) ? x.id : store.uid(), ...itemFields(x), updatedAt: Number.isFinite(+x.updatedAt) ? +x.updatedAt : Date.now() };
    it.slides.forEach(sl => { if (!ID.test(sl.id)) sl.id = store.uid(); });
    return it;
  });
  const ids = new Set(items.map(i => i.id));
  const services = arr(src.services, 2000).map(s => ({
    id: ID.test(s.id) ? s.id : store.uid(), name: t(s.name, 100), date: t(s.date, 20),
    itemIds: (Array.isArray(s.itemIds) ? s.itemIds : []).filter(i => ids.has(i)), ...(s.note ? { note: t(s.note, 1000) } : {}),
    ...(/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '') ? { time: s.time } : {}),
  }));
  const S0 = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const folders = (Array.isArray(S0.bibleFolders) ? S0.bibleFolders : []).map(f => String(f)).filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
  return {
    items, services,
    currentServiceId: services.some(s => s.id === src.currentServiceId) ? src.currentServiceId : (services[0]?.id || null),
    style: withByType(cleanStyle(src.style?.main, store.DEFAULT_STYLE.main), cleanStyle(src.style?.overlay, store.DEFAULT_STYLE.overlay), src.style?.byType),
    phrases: (Array.isArray(src.phrases) ? src.phrases : []).map(x => t(x, 500)).filter(x => x.trim()).slice(0, 200),
    props: arr(src.props, 50).map(p => ({ id: ID.test(p.id) ? p.id : store.uid(), text: t(p.text, 80).trim(), sub: t(p.sub, 120).trim(),
      where: ['both', 'tv', 'obs'].includes(p.where) ? p.where : 'both', pos: p.pos === 'top' ? 'top' : 'bottom' })).filter(p => p.text),
    settings: {
      ...db.settings,   // PIN·리모컨·창 크기 등 이 컴퓨터 값
      logo: LOGO_RE.test(S0.logo) ? S0.logo : '',
      titleLogo: TITLE_LOGO_RE.test(S0.titleLogo) ? S0.titleLogo : '',
      logoStyle: cleanLogoStyle(S0.logoStyle, store.DEFAULT_LOGO),
      obsScenes: { base: t(S0.obsScenes?.base, 100), pip: t(S0.obsScenes?.pip, 100), circle: t(S0.obsScenes?.circle, 100) },
      bibleFolders: folders,
      themes: cleanThemes(S0.themes),
      themeDefaults: cleanThemeDefaults(S0.themeDefaults, cleanThemes(S0.themes)),
      fonts: cleanFonts([...myFonts(), ...(Array.isArray(S0.fonts) ? S0.fonts : [])]),
    },
  };
}
// 내 글꼴 목록: 이 컴퓨터 것 + 백업 것 (같은 것은 하나만). 글꼴 파일이 실제로 있는 것만
function cleanFonts(list) {
  const seen = new Set(), out = [];
  for (const f of list) {
    if (!f || typeof f !== 'object' || !/^[a-f0-9]{12}$/.test(f.id) || seen.has(f.id)) continue;
    const file = String(f.file || '');
    if (!new RegExp('^' + f.id + '\\.(ttf|otf|woff2?)$', 'i').test(file) || !fs.existsSync(path.join(FONTS_DIR, file))) continue;
    seen.add(f.id);
    out.push({ id: f.id, family: 'WCF ' + f.id, file, name: String(f.name || '').normalize('NFC').replace(/[<>"'`\\]/g, '').trim().slice(0, 60) || '내 글꼴' });
  }
  return out.slice(0, 200);
}
app.post('/api/restore', needLocal, upload.single('file'), async (req, res) => {
  const tmp = req.file?.path;
  try {
    if (!tmp) throw new Error('백업 파일(zip)을 고르세요');
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(tmp)).catch(() => { throw new Error('zip 파일이 아니거나 깨졌습니다'); });
    const dbf = zip.file('db.json');
    if (!dbf) throw new Error('예배송출 백업 파일이 아닙니다 (db.json 없음)');
    const next = JSON.parse(await dbf.async('string'));
    if (!Array.isArray(next?.items) || !Array.isArray(next?.services)) throw new Error('예배송출 백업 파일이 아닙니다');
    // 되살리기 전 지금 자료를 한 벌 남겨 둠
    fs.copyFileSync(store.DB_FILE, store.DB_FILE.replace(/\.json$/, `.before-restore-${Date.now()}.json`));
    let files = 0;
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      const m = name.match(/^(media|slides|bible|fonts)\/([^/\\]+)$/);
      if (!m || m[2].startsWith('.')) continue;
      const base = path.basename(m[2]);   // zip 안 경로로 폴더 밖에 쓰는 것 막기
      if (m[1] === 'media' && !mediaExt.test(base)) continue;
      if (m[1] === 'slides' && !/^[a-f0-9]{12}\.html$/.test(base)) continue;
      if (m[1] === 'bible' && !/\.(txt|tsv)$/i.test(base)) continue;
      if (m[1] === 'fonts' && !/^[a-f0-9]{12}\.(ttf|otf|woff2?)$/i.test(base)) continue;   // 내 글꼴 (프로그램이 붙인 이름만)
      const dir = { media: MEDIA_DIR, slides: SLIDES_DIR, bible: bible.BIBLE_DIR, fonts: FONTS_DIR }[m[1]];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, base), await f.async('nodebuffer'));
      files++;
    }
    // 찬송가·교독문 (예전 백업에는 없음 → 지금 것 그대로)
    for (const [mod, name] of [[hymns, 'hymns.json'], [readings, 'readings.json']]) {
      const f = zip.file('data/' + name);
      if (!f) continue;
      const j = JSON.parse(await f.async('string'));
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(name + ' 이 잘못됨');
      fs.writeFileSync(mod.FILE + '.tmp', JSON.stringify(j)); fs.renameSync(mod.FILE + '.tmp', mod.FILE);
      mod.load(); files++;
    }
    store.replace(cleanRestore(next));
    Object.assign(live, { itemId: null, index: 0, mediaBg: null });
    bible.loadAll(db.settings.bibleFolders);
    changed(); pushLive();
    res.json({ ok: true, items: db.items.length, services: db.services.length, files });
  } catch (e) {
    res.status(400).json({ error: e.message || '되살리지 못했습니다' });
  } finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); }
});

// PPT
app.post('/api/pptx', needAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('파일 없음');
    const buf = fs.readFileSync(req.file.path);
    const it = await importPptx(buf, MEDIA_DIR, path.basename(fname(req.file), path.extname(fname(req.file))));
    it.updatedAt = Date.now();
    db.items.push(it); placeInService(it.id, req.body.after); changed(); res.json(it);
  } catch (e) {
    res.status(400).json({ error: 'PPT 가져오기 실패: ' + e.message });
  } finally { if (req.file) fs.unlink(req.file.path, () => {}); }
});

// PPT를 원본 모양 그대로: 이 컴퓨터의 리브레오피스·키노트(맥)·파워포인트(윈도우)로 PDF로 바꿔 돌려줌 → 운영 화면이 페이지마다 그림으로
app.post('/api/pptx-pdf', needAuth, upload.single('file'), async (req, res) => {
  let dir = null;
  try {
    if (!req.file) throw new Error('파일 없음');
    const ext = path.extname(fname(req.file)).toLowerCase();
    if (!/^\.(pptx|ppt|key|odp)$/.test(ext)) throw new Error('.pptx · .ppt · .key 파일만 됩니다');
    const r = await pptToPdf(req.file.path, ext);
    dir = r.dir;
    res.set('X-Converted-By', encodeURIComponent(r.by));
    res.type('application/pdf').send(fs.readFileSync(r.pdf));
  } catch (e) {
    res.status(400).json({ error: e.message, code: e.code || null });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});

// 송출 제어 (운영 맥 전용)
// 프로그램 종료 (운영 맥에서만)
// 아이콘을 다시 눌렀을 때 (두 번째 실행이 이 주소를 부름)
app.post('/api/show', needLocal, (req, res) => res.json({ result: showUI(req.query.raised === '1') }));   // raised=1: 독 앱이 이미 창을 올림

// 운영 화면 창 크기·위치 기억 (다음에 켤 때 그대로)
app.put('/api/window', needLocal, (req, res) => {
  const n = (v, lo, hi) => (Number.isFinite(+v) ? Math.round(Math.min(hi, Math.max(lo, +v))) : null);
  const w = n(req.body?.w, 800, 8000), h = n(req.body?.h, 500, 5000), x = n(req.body?.x, -10000, 20000), y = n(req.body?.y, -10000, 20000);
  if (w == null || h == null) return res.status(400).json({ error: '잘못된 값' });
  db.settings.win = { w, h, x: x ?? 0, y: y ?? 0 };
  store.save(); res.json({ ok: true });
});

app.post('/api/quit', needLocal, (req, res) => {
  res.json({ ok: true });
  broadcast({ type: 'quit' });
  setTimeout(() => process.exit(0), 300);
});

// ── 유튜브 영상: 예배당 화면·방송(OBS)·프롬프터에서 같은 영상을 같은 자리로 ──
// live.yt = { id, title, pos(초), at(그 pos를 잰 시각), playing, dur, ended, tv, obs, stage, sound: tv|obs|both|none }
// 내 영상(🖼 미디어에 올린 영상 파일)도 같은 조작판으로: file = '/media/…', id = file (인터넷 없이)
function parseYt(v) {
  v = String(v || '').trim().slice(0, 500);
  let id = null, start = 0;
  if (/^[\w-]{11}$/.test(v)) id = v;
  else {
    let u; try { u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v); } catch { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') id = u.pathname.slice(1, 12);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/) || [])[1];
    }
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (m) start = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }
  return id && /^[\w-]{11}$/.test(id) ? { id, start: Math.min(start, 86400) } : null;
}
const ytPos = y => Math.max(0, y.pos + (y.playing ? (Date.now() - y.at) / 1000 : 0));
async function ytTitle(id) {
  try {
    const j = JSON.parse(await getText('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), 5000));
    if (live.yt?.id === id && j?.title) { live.yt.title = String(j.title).slice(0, 120); pushLive(); }
  } catch {}
}
function ytCommand(c) {
  if (c === null || c === false) { live.yt = null; return; }
  if (typeof c !== 'object') return;
  if (c.open !== undefined) {
    const p = parseYt(c.open);
    if (!p) return;
    const old = live.yt || {};
    live.yt = { id: p.id, title: '', pos: p.start, at: Date.now(), playing: c.playing !== false, dur: 0, ended: false,
      tv: old.tv ?? true, obs: old.obs ?? false, stage: old.stage ?? true, sound: old.sound || 'tv' };
    live.black = false;
    ytTitle(p.id);
  } else if (c.file !== undefined) {
    // 내 영상: 미디어 폴더에 있는 영상 파일만
    const f = String(c.file || '');
    const m = f.match(/^\/media\/([^/\\"'<>()\s]+\.(mp4|mov|m4v|webm))$/i);
    if (!m || !fs.existsSync(path.join(MEDIA_DIR, path.basename(decodeURIComponent(m[1]))))) return;
    const old = live.yt || {};
    let name = m[1]; try { name = decodeURIComponent(name); } catch {}
    live.yt = { id: f, file: f, title: name.replace(/_[0-9a-f]{4}(\.\w+)$/i, '$1'), pos: 0, at: Date.now(), playing: c.playing !== false, dur: 0, ended: false,
      tv: old.tv ?? true, obs: old.obs ?? false, stage: old.stage ?? true, sound: old.sound || 'tv' };
    live.black = false;
  }
  const y = live.yt;
  if (!y) return;
  const now = ytPos(y);
  const setPos = v => { y.pos = Math.max(0, y.dur ? Math.min(v, y.dur - 0.5) : v); y.at = Date.now(); y.ended = false; };
  if (c.seek !== undefined && Number.isFinite(+c.seek)) setPos(+c.seek);
  else if (c.step !== undefined && Number.isFinite(+c.step)) setPos(now + +c.step);
  if (c.playing !== undefined && c.open === undefined) {
    if (!c.playing && y.playing) { y.pos = now; y.at = Date.now(); }
    if (c.playing && !y.playing) { if (y.ended) y.pos = 0; y.at = Date.now(); y.ended = false; }
    y.playing = !!c.playing;
  }
  for (const k of ['tv', 'obs', 'stage']) if (c[k] !== undefined) y[k] = !!c[k];
  if (['tv', 'obs', 'both', 'none'].includes(c.sound)) y.sound = c.sound;
}

app.post('/api/live', needControl, (req, res) => {
  const b = req.body || {};
  if (b.itemId !== undefined) {
    if (b.itemId !== live.itemId && b.auto === undefined) setAuto(null);   // 다른 자료로 가면 자동 넘김은 멈춤
    live.itemId = b.itemId; live.index = 0; live.clear = false; live.black = false; live.logo = false;
  }
  if (b.index !== undefined) { live.index = Math.max(0, +b.index); live.clear = false; live.black = false; live.logo = false; }
  if (b.step) {
    const it = db.items.find(i => i.id === live.itemId);
    if (it) {
      const ni = live.index + Math.sign(b.step), n = store.seq(it).length;
      const nb = db.settings.continuous && (ni >= n || ni < 0) ? neighborItem(it.id, Math.sign(b.step)) : null;
      if (nb) {   // 전체 이어 보기: 끝에서 다음 자료 첫 장으로, 처음에서 앞 자료 마지막 장으로
        if (b.auto === undefined) setAuto(null);
        live.itemId = nb.id; live.index = b.step > 0 ? 0 : store.seq(nb).length - 1;
      } else live.index = Math.min(Math.max(0, live.index + b.step), n - 1);
    }
    live.clear = false; live.black = false; live.logo = false;
  }
  for (const k of ['black', 'clear', 'logo', 'overlayOff', 'pip', 'camOnly', 'tvNoImg', 'mediaObs', 'obsMain']) if (b[k] !== undefined) live[k] = !!b[k];
  // 📹 OBS 화면을 예배당 화면에 (OBS 가상 카메라): top 화면 가득 / bg 배경으로(가사는 위에) / null 끄기
  if (b.cam !== undefined) {
    const c = b.cam && typeof b.cam === 'object' ? b.cam : null, str = v => String(v || '').replace(/[\u0000-\u001f]/g, '').slice(0, 200);
    live.cam = c && ['top', 'bg'].includes(c.mode) ? { mode: c.mode, dev: str(c.dev), label: str(c.label) } : null;
    if (live.cam) live.black = false;
  }
  // 로고 단추만 눌렀으면: '검은 바탕'이면 검은 화면도 함께, '배경 위에 로고만'이면 지금 배경(미디어 배경)을 그대로 둠
  if (b.logo !== undefined && b.black === undefined) live.black = !!b.logo && db.settings.logoStyle?.screenBg !== 'over';
  if (b.mediaBg !== undefined) {
    const ok = typeof b.mediaBg === 'string' && /^\/media\/[^/\\"'<>()\s]+\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm)$/i.test(b.mediaBg)
      && fs.existsSync(path.join(MEDIA_DIR, path.basename(b.mediaBg)));
    live.mediaBg = ok ? b.mediaBg : null;
    if (ok) live.black = false;
  }
  // 화면 위에 띄우는 그림 (슬라이드·배경은 그대로 두고 맨 위에 그림만) — ⏹ 그림 끄기로 뺌
  if (b.mediaTop !== undefined) {
    const ok = typeof b.mediaTop === 'string' && /^\/media\/[^/\\"'<>()\s]+\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm)$/i.test(b.mediaTop)
      && fs.existsSync(path.join(MEDIA_DIR, path.basename(b.mediaTop)));
    live.mediaTop = ok ? b.mediaTop : null;
    if (ok) live.black = false;
  }
  if (['auto', 'cover', 'contain', 'small'].includes(b.mediaFit)) live.mediaFit = b.mediaFit;
  if (b.msg !== undefined) live.msg = String(b.msg || '').trim().slice(0, 200);          // 무대 메시지 (프롬프터에만)
  if (b.timer !== undefined) live.timer = makeTimer(b.timer);
  // 타이머 멈춤(⏸)·계속(▶): 멈추면 남은 시간을 붙잡아 두고, 계속하면 그 남은 시간부터 다시
  if (live.timer && b.timerPause !== undefined) {
    if (b.timerPause && live.timer.paused == null) live.timer.paused = live.timer.end - Date.now();
    else if (!b.timerPause && live.timer.paused != null) { live.timer.end = Date.now() + live.timer.paused; delete live.timer.paused; }
  }
  // 타이머 숨기기: 예배당 화면·유튜브에서만 안 보임 (시간은 계속 흐르고 프롬프터에는 보임)
  if (live.timer && b.timerHide !== undefined) live.timer.hidden = !!b.timerHide;
  if (b.prop !== undefined) live.prop = db.props.some(p => p.id === b.prop) ? b.prop : null; // 이름 자막
  if (b.auto !== undefined) setAuto(b.auto);
  if (b.yt !== undefined) ytCommand(b.yt);
  if (b.reset) { Object.assign(live, { black: false, clear: true, logo: false, mediaBg: null, mediaTop: null, prop: null, yt: null, cam: null }); setAuto(null); }
  pushLive(); res.json(snapshot());
});

// ── WebSocket ──────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({
  server, path: '/ws',
  verifyClient: ({ req }) => {
    const ok = hostOk(req.headers.host) && originOk(req);
    if (!ok) console.warn('[보안] 실시간 연결 거부:', req.headers.host, req.headers.origin || '-');
    return ok;
  },
});
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
function pushLive() { live.rev++; broadcast(snapshot()); }
// 운영 화면(창) 관리: 자막을 넘기는 운영 창은 하나만
const controls = new Set();
const sendTo = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
wss.on('connection', (ws, req) => {
  ws.isLocal = isLocal(req);
  ws.send(JSON.stringify(snapshot()));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    // OBS 브라우저 소스(방송 PC)가 알려 주는 상태: 장면 전환 권한, 장면 이름 목록
    if (m.type === 'obsStatus') {
      obsStatus = { level: Math.max(-1, Math.min(9, parseInt(m.level) || 0)), scenes: (Array.isArray(m.scenes) ? m.scenes : []).slice(0, 60).map(x => String(x).slice(0, 100)), at: Date.now() };
      for (const c of controls) sendTo(c, { type: 'obs', ...obsStatus });
      return;
    }
    if (!ws.isLocal) return;
    if (m.type === 'audioBlocked') { for (const c of controls) sendTo(c, { type: 'audioBlocked' }); return; }
    if (m.type === 'camErr') { const msg = String(m.msg || '').slice(0, 300); for (const c of controls) sendTo(c, { type: 'camErr', msg }); return; }   // 예배당 화면이 OBS 화면(카메라)을 못 엶   // 예배당 화면이 소리 재생을 막힘
    // 유튜브 영상: 화면이 알려 주는 길이·끝남
    if (m.type === 'ytInfo' && live.yt && m.id === live.yt.id && +m.dur > 0 && !live.yt.dur) { live.yt.dur = Math.round(+m.dur); pushLive(); return; }
    if (m.type === 'ytEnded' && live.yt && m.id === live.yt.id && live.yt.playing) {
      Object.assign(live.yt, { playing: false, ended: true, pos: live.yt.dur || ytPos(live.yt), at: Date.now() }); pushLive(); return;
    }
    if (m.type === 'hello' && m.role === 'control') {
      const others = [...controls].filter(c => c !== ws && c.readyState === 1);
      controls.add(ws);
      if (others.length) sendTo(ws, { type: 'dup' });       // 이미 다른 운영 창이 있음
      if (obsStatus) sendTo(ws, { type: 'obs', ...obsStatus });
    }
    if (m.type === 'takeover') {                            // "이 창에서 계속"
      for (const c of controls) if (c !== ws) { sendTo(c, { type: 'replaced' }); controls.delete(c); }
      controls.add(ws);
    }
  });
  ws.on('close', () => controls.delete(ws));
});
wss.on('error', () => {}); // 포트 문제는 아래 server.on('error') 에서 처리

// 이미 열린 운영 창이 있으면 그 창을 앞으로, 없을 때만 새 창
// 운영 화면 창(제목 '예배송출', 크롬이 ' - 프로필' 을 붙이기도 함)을 맨 앞으로
const RAISE_SCRIPT = [
  'tell application "System Events"', 'tell process "Google Chrome"',
  'set ws to (every window whose name is "예배송출" or name starts with "예배송출 - " or name is "Worship Caster" or name starts with "Worship Caster - ")',
  'if (count of ws) is 0 then return "none"', 'set w to item 1 of ws',
  'try', 'if value of attribute "AXMinimized" of w then set value of attribute "AXMinimized" of w to false', 'end try',
  'perform action "AXRaise" of w', 'set frontmost to true', 'end tell', 'end tell', 'return "raised"',
].join('\n');
function showUI(raised = false) {
  const open = [...controls].filter(c => c.readyState === 1);
  if (!open.length) { openUI(); return 'opened'; }
  open.forEach(c => sendTo(c, { type: 'focus' }));
  if (raised) return 'focused';
  const { exec } = require('child_process');
  // 맥: 크롬의 여러 창 중 '운영 화면' 창을 맨 앞으로 (그냥 크롬을 앞으로 하면 다른 창이 앞에 올 수 있음)
  // 운영 화면은 주소창 없는 '앱 창'이라 크롬 스크립트의 창 목록에 안 나옴 → 창 이름으로 찾아 올림 (System Events)
  // 처음 한 번 맥이 '손쉬운 사용' 허용을 물음. 허용 전에는 크롬만 앞으로
  if (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app')) {
    const { execFile } = require('child_process');
    execFile('osascript', ['-e', RAISE_SCRIPT], (err, out, errOut) => {
      if (err || String(out).trim() !== 'raised') {
        if (err) console.log('운영 화면 창을 앞으로 가져오지 못해 크롬만 앞으로 가져옵니다 (맥 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → 예배송출 허용):', String(errOut || err.message).trim().split('\n').pop());
        exec('open -a "Google Chrome"');
        if (err && !showUI.hinted) { showUI.hinted = true; open.forEach(c => sendTo(c, { type: 'raiseHint' })); }   // 한 번만 안내
      }
    });
  }
  else if (process.platform === 'win32') exec(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('예배송출')"`);
  return 'focused';
}

// 지난번 운영 화면 창 크기·위치 (없으면 1440×900)
function winArgs() {
  const w = db.settings.win;
  if (!w) return '--window-size=1440,900';
  const i = v => Math.round(+v) || 0;
  return `--window-size=${i(w.w)},${i(w.h)} --window-position=${i(w.x)},${i(w.y)}`;
}

// 운영 화면 열기: 크롬/엣지가 있으면 주소창 없는 '앱 창'으로
function openUI() {
  const url = `http://localhost:${PORT}/control`;
  const { exec } = require('child_process');
  if (process.platform === 'darwin') {
    exec(fs.existsSync('/Applications/Google Chrome.app')
      ? `open -na "Google Chrome" --args --app=${url} ${winArgs()}`
      : `open ${url}`);
  } else if (process.platform === 'win32') {
    exec(`start "" msedge --app=${url} ${winArgs()}`, { shell: 'cmd.exe' }, err => { if (err) exec(`start "" ${url}`, { shell: 'cmd.exe' }); });
  } else exec(`xdg-open ${url}`);
}

// 이미 켜져 있으면(포트 사용 중) 창만 열고 끝냄 → 아이콘을 여러 번 눌러도 안전
let portTries = 0;
server.on('error', e => {
  // 업데이트 뒤 다시 켜는 중: 앞의 본체가 자리를 비울 때까지 잠깐 기다림
  if (e.code === 'EADDRINUSE' && process.env.WC_RESTARTED === '1' && portTries++ < 150) return setTimeout(() => server.listen(PORT), 200);
  if (e.code === 'EADDRINUSE') {
    // 이미 실행 중 → 실행 중인 프로그램에게 "창 보여 줘"라고만 전하고 끝냄 (새 창을 마구 열지 않음)
    console.log('이미 실행 중입니다. 열려 있는 운영 화면을 앞으로 가져옵니다.');
    if (process.env.NO_OPEN === '1') return process.exit(0);
    fetch(`http://localhost:${PORT}/api/show`, { method: 'POST' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(j => console.log('결과:', j.result))
      .catch(() => openUI())                     // 예전 버전이 실행 중이면 그냥 창 열기
      .finally(() => setTimeout(() => process.exit(0), 1000));
  }
  else { console.error(e); process.exit(1); }
});

if (process.env.WC_RESTARTED === '1' && process.send) { try { process.send('ready'); } catch {} }   // 자료를 다 읽었음 → 앞의 본체가 꺼져도 됨
server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('\n  ✝  예배송출 (Worship Caster) 실행 중 — 만든 사람: 쉬운목사 이광복\n');
  console.log(`  자료 저장 위치 ${store.DATA_DIR}`);
  console.log(`  운영 화면     http://localhost:${PORT}/control`);
  console.log(`  예배당 화면   http://localhost:${PORT}/output   (TV로 옮긴 뒤 F 키 = 전체화면)`);
  console.log(`  프롬프터      http://localhost:${PORT}/stage`);
  console.log(`  OBS 자막      http://localhost:${PORT}/overlay   (같은 컴퓨터의 OBS — 바뀌지 않음)`);
  if (hostName()) console.log(`  OBS 자막      http://${hostName()}:${PORT}/overlay   (다른 컴퓨터의 OBS — 공유기가 바뀌어도 그대로)`);
  for (const ip of lan) {
    console.log(`  OBS 자막      http://${ip}:${PORT}/overlay   (숫자 주소 — 공유기가 다시 켜지면 바뀔 수 있음)`);
    console.log(`  웹 편집기     http://${ip}:${PORT}/editor    (PIN: ${db.settings.pin})`);
  }
  console.log('');
  if (process.env.NO_OPEN !== '1' && process.env.WC_RESTARTED !== '1') openUI();   // 업데이트 뒤엔 열려 있던 창이 스스로 새로고침
});
