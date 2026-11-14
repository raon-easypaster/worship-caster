// 예배송출 (Worship Caster) — 로컬 서버
// 만든 사람: 쉬운목사 이광복
// 예배당 화면(/output), OBS 투명 자막(/overlay), 프롬프터(/stage), 운영(/control), 웹 편집기(/editor)
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
const { importPptx } = require('./lib/pptx');
const templates = require('./lib/templates');

const PORT = +process.env.PORT || 5300;
const MEDIA_DIR = path.join(store.DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = store.load();
bible.loadAll(db.settings.bibleFolders);

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
  const gone = db.items.filter(i => !KEEP_TYPES.has(i.type) && !used.has(i.id));
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
const THEME_RE = /^[a-z_]{0,30}$/;
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
    theme: THEME_RE.test(b.theme ?? '') ? (b.theme ?? it.theme ?? '') : (it.theme || ''),
    // 콘티: 키·빠르기(BPM)·흐름 메모
    key: b.key !== undefined ? String(b.key ?? '').trim().slice(0, 10) : (it.key || ''),
    bpm: b.bpm !== undefined ? (Number.isFinite(+b.bpm) && +b.bpm > 0 ? Math.min(300, Math.round(+b.bpm)) : 0) : (it.bpm || 0),
    memo: b.memo !== undefined ? String(b.memo ?? '').slice(0, 200) : (it.memo || ''),
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
const live = { itemId: null, index: 0, black: false, clear: false, logo: false, overlayOff: false, pip: true, mediaBg: null, mediaObs: false, mediaFit: 'auto',
  msg: '', timer: null, prop: null, auto: null, rev: 0 };
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
const needLocal = (req, res, next) => isLocal(req) ? next() : res.status(403).json({ error: '송출 제어는 운영 맥에서만 가능합니다' });
// 송출 조작: 운영 컴퓨터, 또는 '휴대폰 리모컨'을 켜 두었을 때 PIN으로 들어온 기기
const canControl = req => isLocal(req) || (!!db.settings.remote && authed(req));
const needControl = (req, res, next) => canControl(req) ? next() : res.status(403).json({ error: '송출 조작은 운영 컴퓨터에서만 됩니다 (⚙︎ 설정에서 휴대폰 리모컨을 켜면 휴대폰에서도 됨)' });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

function snapshot() {
  const item = db.items.find(i => i.id === live.itemId);
  const sl = item ? store.seq(item) : [];
  const slide = sl[live.index] || null;
  const next = sl[live.index + 1] || null;
  const prop = live.prop ? db.props.find(p => p.id === live.prop) || null : null;
  return {
    type: 'live', live: { ...live }, style: db.style, now: Date.now(), prop,
    logo: { url: db.settings.logo, ...db.settings.logoStyle }, obs: db.settings.obsScenes,
    item: item ? { id: item.id, title: item.title, type: item.type, count: sl.length, noBroadcast: !!item.noBroadcast, bcFull: !!item.bcFull, theme: item.theme || '' } : null,
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
  return { end, label: String(t.label || '').slice(0, 60), tv: ['none', 'corner', 'big'].includes(t.tv) ? t.tv : 'none' };
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
app.get('/api/me', (req, res) => res.json({ authed: authed(req), local: isLocal(req), lang: db.settings.lang === 'en' ? 'en' : 'ko' }));

app.get('/api/state', needAuth, (req, res) => {
  res.json({
    items: db.items, services: db.services, currentServiceId: db.currentServiceId, phrases: db.phrases, props: db.props, canControl: canControl(req),
    style: db.style, settings: isLocal(req) ? db.settings : { logo: db.settings.logo, titleLogo: db.settings.titleLogo || '' },
    bibleVersions: bible.versionNames(), bibleDefault: bible.defaultVersion(), lan: lanAddresses(), port: PORT, live: snapshot(),
  });
});

const changed = () => { store.save(); broadcast({ type: 'data' }); };

// 자료(곡/말씀/광고/PPT)
app.post('/api/items', needAuth, (req, res) => { const it = addItem(req.body || {}); changed(); res.json(it); });
app.put('/api/items/:id', needAuth, (req, res) => {
  const it = db.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: '없음' });
  Object.assign(it, itemFields(req.body || {}, it), { updatedAt: Date.now() });
  it.slides.forEach(s => (s.id ||= store.uid()));
  if (live.itemId === it.id) { live.index = Math.min(live.index, Math.max(0, store.seq(it).length - 1)); pushLive(); }
  changed(); res.json(it);
});
app.delete('/api/items/:id', needAuth, (req, res) => {
  db.items = db.items.filter(i => i.id !== req.params.id);
  db.services.forEach(s => (s.itemIds = s.itemIds.filter(x => x !== req.params.id)));
  changed(); res.json({ ok: true });
});
app.post('/api/split', needAuth, (req, res) => res.json(store.splitLyrics(req.body.text, Math.max(1, +req.body.lines || 2))));

// 가사 찾기 — 운영자가 버튼을 누를 때만, 공개 가사 모음(LRCLIB) 먼저, 모자라면 벅스
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const getText = (url, ms = 7000) => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) })
  .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)));
const unent = s => s.replace(/&(lt|gt|quot|#39|apos|nbsp|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', amp: '&' }[e]));
const lyricTidy = s => unent(String(s || '')).replace(/\r/g, '').replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
async function lrclib(q) {
  const j = JSON.parse(await getText('https://lrclib.net/api/search?q=' + encodeURIComponent(q)));
  return (Array.isArray(j) ? j : []).filter(x => x && x.plainLyrics && !x.instrumental).slice(0, 6)
    .map(x => ({ src: 'LRCLIB', title: String(x.trackName || ''), artist: String(x.artistName || ''), text: lyricTidy(x.plainLyrics) }));
}
async function bugs(q) {
  const html = await getText('https://music.bugs.co.kr/search/track?q=' + encodeURIComponent(q));
  const rows = [], seen = new Set();
  for (const m of html.matchAll(/<tr [^>]*trackId="(\d+)"[^>]*rowType="track"[\s\S]*?<p class="title"[\s\S]*?title="([^"]*)"[\s\S]*?<p class="artist">[\s\S]*?title="([^"]*)"/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    rows.push({ id: m[1], title: unent(m[2]), artist: unent(m[3]) });
    if (rows.length >= 10) break;
  }
  const got = await Promise.all(rows.map(r => getText('https://music.bugs.co.kr/track/' + r.id).then(h => {
    const m = h.match(/class="lyricsContainer">\s*<p><xmp>([\s\S]*?)<\/xmp>/);
    return m ? { src: '벅스', title: r.title, artist: r.artist, text: lyricTidy(m[1]) } : null;
  }).catch(() => null)));
  return got.filter(x => x && x.text);
}
app.get('/api/lyrics', needAuth, async (req, res) => {
  const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!q) return res.status(400).json({ error: '곡 제목을 넣으세요' });
  const [a, b] = await Promise.allSettled([lrclib(q), bugs(q)]);
  const seen = new Set();   // 같은 가사(편곡만 다른 곡)는 하나만
  const list = [...(a.value || []), ...(b.value || [])].filter(x => { const k = x.text.replace(/\s+/g, '').slice(0, 120); return !seen.has(k) && seen.add(k); });
  if (!list.length && a.status === 'rejected' && b.status === 'rejected') return res.status(502).json({ error: '인터넷에 연결할 수 없습니다' });
  res.json(list);
});

// 예배 순서
app.post('/api/services', needAuth, (req, res) => {
  const tpl = templates.SERVICES[req.body.template];
  const s = { id: store.uid(), name: String(req.body.name || tpl?.name || '새 예배').slice(0, 100), date: String(req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 20), itemIds: [] };
  db.services.push(s); db.currentServiceId = s.id;
  for (const step of tpl?.steps || []) {
    const b = step === 'COMMUNION' ? templates.communionItem(bible)
      : { type: 'text', title: step[0].split('\n')[0], theme: step[1], slides: [{ text: step[0] }] };
    addItem(b);   // 찬양이 아니므로 지금 예배 순서 끝에 들어감
  }
  changed(); res.json(s);
});
// 템플릿 목록 · 내 문구
app.get('/api/templates', needAuth, (req, res) => res.json({ phrases: templates.PHRASES, services: templates.SERVICE_LIST }));
app.post('/api/templates/communion', needAuth, (req, res) => { const it = addItem({ ...templates.communionItem(bible), after: req.body?.after }); changed(); res.json(it); });
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
  align: ['left', 'center', 'right'], valign: ['top', 'middle', 'bottom'], position: ['top', 'bottom'], aspect: ['16:9', '4:3'],
  bold: 'bool', shadow: 'bool', showTitle: 'bool', font: 'font', motionOn: 'bool',
  motion: ['none', 'galaxy', 'water', 'rays', 'bokeh', 'aurora', 'dawn', 'embers', 'video'], motionVideo: 'media',
  imgMode: ['full', 'part', 'none'], partSize: [15, 70], partPos: ['tr', 'mr', 'br', 'tl', 'ml', 'bl'],
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
app.put('/api/style', needAuth, (req, res) => {
  db.style = { main: cleanStyle(req.body.main, db.style.main), overlay: cleanStyle(req.body.overlay, db.style.overlay) };
  changed(); pushLive(); res.json(db.style);
});
const LOGO_RE = /^\/media\/[^"'<>()\\\s]+$/;
const TITLE_LOGO_RE = /^\/media\/[^/\\"'<>()\s]+\.(png|jpe?g|gif|webp)$/i;
function cleanLogoStyle(l, cur) {
  const P = ['c', 'tl', 'tc', 'tr', 'bl', 'bc', 'br'];
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  l = l && typeof l === 'object' ? l : {};
  return {
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
  if (req.body.updateCheck !== undefined) db.settings.updateCheck = !!req.body.updateCheck;   // 새 버전 알림
  if (req.body.lang !== undefined) {   // 메뉴 언어 — 바뀌면 열린 화면·리모컨도 새로고침
    const l = req.body.lang === 'en' ? 'en' : 'ko';
    if (l !== (db.settings.lang || 'ko')) { db.settings.lang = l; setTimeout(() => broadcast({ type: 'lang', lang: l }), 300); }
  }
  if (req.body.obsScenes) {
    const o = req.body.obsScenes, t = v => String(v ?? '').slice(0, 100);
    db.settings.obsScenes = { base: t(o.base), pip: t(o.pip) };
  }
  if (req.body.pin != null) sessions.clear();
  changed(); pushLive(); res.json({ ok: true });
});

// ── 새 버전 알림: GitHub 에서 최신 버전 번호만 확인 (6시간에 한 번, 이쪽 정보는 보내지 않음) ──
const APP_VERSION = require('./package.json').version;
const DOWNLOAD_PAGE = 'https://raon-easypaster.github.io/worship-caster/';
const upd = { at: 0, latest: null };
const isNewer = (a, b) => {
  const p = s => String(s).split('.').map(n => +n || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
app.get('/api/update', needLocal, async (req, res) => {
  if (db.settings.updateCheck === false) return res.json({ current: APP_VERSION, off: true });
  if (Date.now() - upd.at > 6 * 3600e3) {
    upd.at = Date.now();
    try {
      const r = await fetch('https://api.github.com/repos/raon-easypaster/worship-caster/releases/latest',
        { headers: { 'User-Agent': 'worship-caster', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(6000) });
      const tag = r.ok ? String((await r.json()).tag_name || '').replace(/^v/, '') : '';
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag)) upd.latest = tag;
      else upd.at = Date.now() - 6 * 3600e3 + 10 * 60e3;    // 실패하면 10분 뒤 다시
    } catch { upd.at = Date.now() - 6 * 3600e3 + 10 * 60e3; }   // 인터넷이 없으면 조용히 넘어감
  }
  res.json({ current: APP_VERSION, latest: upd.latest, newer: !!upd.latest && isNewer(upd.latest, APP_VERSION), url: DOWNLOAD_PAGE });
});

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
app.delete('/api/media/:name', needAuth, (req, res) => {
  const p = path.join(MEDIA_DIR, path.basename(req.params.name));
  if (live.mediaBg === '/media/' + path.basename(req.params.name)) { live.mediaBg = null; pushLive(); }
  fs.rm(p, { force: true }, () => res.json({ ok: true }));
});

// ── 백업·복원: 자료 전체(찬양·순서·설정·사진·영상·HTML)를 zip 하나로 ──
// 운영 컴퓨터에서만 (PIN·설정이 들어 있음)
app.get('/api/backup', needLocal, (req, res) => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('db.json', JSON.stringify(db, null, 2));
  zip.file('예배송출-백업.txt', `예배송출 백업 — 가져온 성경 텍스트가 들어 있을 수 있으니 이 파일은 남에게 나누지 마세요 (${new Date().toLocaleString('ko-KR')})\n⚙︎ 설정 → 백업·복원 → 백업 파일로 되살리기 에서 이 zip 파일을 고르세요.\n`);
  for (const [dir, sub] of [[MEDIA_DIR, 'media'], [SLIDES_DIR, 'slides'], [bible.BIBLE_DIR, 'bible']]) {
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
  }));
  const S0 = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const folders = (Array.isArray(S0.bibleFolders) ? S0.bibleFolders : []).map(f => String(f)).filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
  return {
    items, services,
    currentServiceId: services.some(s => s.id === src.currentServiceId) ? src.currentServiceId : (services[0]?.id || null),
    style: { main: cleanStyle(src.style?.main, store.DEFAULT_STYLE.main), overlay: cleanStyle(src.style?.overlay, store.DEFAULT_STYLE.overlay) },
    phrases: (Array.isArray(src.phrases) ? src.phrases : []).map(x => t(x, 500)).filter(x => x.trim()).slice(0, 200),
    props: arr(src.props, 50).map(p => ({ id: ID.test(p.id) ? p.id : store.uid(), text: t(p.text, 80).trim(), sub: t(p.sub, 120).trim(),
      where: ['both', 'tv', 'obs'].includes(p.where) ? p.where : 'both', pos: p.pos === 'top' ? 'top' : 'bottom' })).filter(p => p.text),
    settings: {
      ...db.settings,   // PIN·리모컨·창 크기 등 이 컴퓨터 값
      logo: LOGO_RE.test(S0.logo) ? S0.logo : '',
      titleLogo: TITLE_LOGO_RE.test(S0.titleLogo) ? S0.titleLogo : '',
      logoStyle: cleanLogoStyle(S0.logoStyle, store.DEFAULT_LOGO),
      obsScenes: { base: t(S0.obsScenes?.base, 100), pip: t(S0.obsScenes?.pip, 100) },
      bibleFolders: folders,
    },
  };
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
      const m = name.match(/^(media|slides|bible)\/([^/\\]+)$/);
      if (!m || m[2].startsWith('.')) continue;
      const base = path.basename(m[2]);   // zip 안 경로로 폴더 밖에 쓰는 것 막기
      if (m[1] === 'media' && !mediaExt.test(base)) continue;
      if (m[1] === 'slides' && !/^[a-f0-9]{12}\.html$/.test(base)) continue;
      if (m[1] === 'bible' && !/\.(txt|tsv)$/i.test(base)) continue;
      const dir = { media: MEDIA_DIR, slides: SLIDES_DIR, bible: bible.BIBLE_DIR }[m[1]];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, base), await f.async('nodebuffer'));
      files++;
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

// 송출 제어 (운영 맥 전용)
// 프로그램 종료 (운영 맥에서만)
// 아이콘을 다시 눌렀을 때 (두 번째 실행이 이 주소를 부름)
app.post('/api/show', needLocal, (req, res) => res.json({ result: showUI() }));

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

app.post('/api/live', needControl, (req, res) => {
  const b = req.body || {};
  if (b.itemId !== undefined) {
    if (b.itemId !== live.itemId && b.auto === undefined) setAuto(null);   // 다른 자료로 가면 자동 넘김은 멈춤
    live.itemId = b.itemId; live.index = 0; live.clear = false; live.black = false;
  }
  if (b.index !== undefined) { live.index = Math.max(0, +b.index); live.clear = false; live.black = false; }
  if (b.step) {
    const it = db.items.find(i => i.id === live.itemId);
    if (it) live.index = Math.min(Math.max(0, live.index + b.step), store.seq(it).length - 1);
    live.clear = false; live.black = false;
  }
  for (const k of ['black', 'clear', 'logo', 'overlayOff', 'pip', 'mediaObs']) if (b[k] !== undefined) live[k] = !!b[k];
  if (b.mediaBg !== undefined) {
    const ok = typeof b.mediaBg === 'string' && /^\/media\/[^/\\"'<>()\s]+\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm)$/i.test(b.mediaBg)
      && fs.existsSync(path.join(MEDIA_DIR, path.basename(b.mediaBg)));
    live.mediaBg = ok ? b.mediaBg : null;
    if (ok) live.black = false;
  }
  if (['auto', 'cover', 'contain', 'small'].includes(b.mediaFit)) live.mediaFit = b.mediaFit;
  if (b.msg !== undefined) live.msg = String(b.msg || '').trim().slice(0, 200);          // 무대 메시지 (프롬프터에만)
  if (b.timer !== undefined) live.timer = makeTimer(b.timer);
  if (b.prop !== undefined) live.prop = db.props.some(p => p.id === b.prop) ? b.prop : null; // 이름 자막
  if (b.auto !== undefined) setAuto(b.auto);
  if (b.reset) { Object.assign(live, { black: false, clear: true, logo: false, mediaBg: null, prop: null }); setAuto(null); }
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
    if (m.type === 'audioBlocked') { for (const c of controls) sendTo(c, { type: 'audioBlocked' }); return; }   // 예배당 화면이 소리 재생을 막힘
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
function showUI() {
  const open = [...controls].filter(c => c.readyState === 1);
  if (!open.length) { openUI(); return 'opened'; }
  open.forEach(c => sendTo(c, { type: 'focus' }));
  const { exec } = require('child_process');
  if (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app')) exec('open -a "Google Chrome"');
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
server.on('error', e => {
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

server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('\n  ✝  예배송출 (Worship Caster) 실행 중 — 만든 사람: 쉬운목사 이광복\n');
  console.log(`  자료 저장 위치 ${store.DATA_DIR}`);
  console.log(`  운영 화면     http://localhost:${PORT}/control`);
  console.log(`  예배당 화면   http://localhost:${PORT}/output   (TV로 옮긴 뒤 F 키 = 전체화면)`);
  console.log(`  프롬프터      http://localhost:${PORT}/stage`);
  for (const ip of lan) {
    console.log(`  OBS 자막      http://${ip}:${PORT}/overlay   (OBS 브라우저 소스 1920×1080)`);
    console.log(`  웹 편집기     http://${ip}:${PORT}/editor    (PIN: ${db.settings.pin})`);
  }
  console.log('');
  if (process.env.NO_OPEN !== '1') openUI();
});
