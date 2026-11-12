// 예배송출 (Worship Caster) — 로컬 서버
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

const PORT = +process.env.PORT || 5300;
const MEDIA_DIR = path.join(store.DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = store.load();
bible.loadAll(db.settings.bibleFolders);

// ── 송출 상태 (메모리) ─────────────────────────────
const live = { itemId: null, index: 0, black: false, clear: false, logo: false, rev: 0 };

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

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

function snapshot() {
  const item = db.items.find(i => i.id === live.itemId);
  const slide = item?.slides[live.index] || null;
  const next = item?.slides[live.index + 1] || null;
  return {
    type: 'live', live: { ...live }, style: db.style, logo: db.settings.logo,
    item: item ? { id: item.id, title: item.title, type: item.type, count: item.slides.length } : null,
    slide, next,
  };
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
const upload = multer({ dest: path.join(os.tmpdir(), 'worship-caster-up'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.get('/', (req, res) => res.redirect(isLocal(req) ? '/control' : '/editor'));
app.get('/control', (req, res) => isLocal(req) ? res.sendFile(path.join(__dirname, 'public', 'app.html')) : res.redirect('/editor'));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
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
app.get('/api/me', (req, res) => res.json({ authed: authed(req), local: isLocal(req) }));

app.get('/api/state', needAuth, (req, res) => {
  res.json({
    items: db.items, services: db.services, currentServiceId: db.currentServiceId,
    style: db.style, settings: isLocal(req) ? db.settings : { logo: db.settings.logo },
    bibleVersions: bible.versionNames(), bibleDefault: bible.defaultVersion(), lan: lanAddresses(), port: PORT, live: snapshot(),
  });
});

const changed = () => { store.save(); broadcast({ type: 'data' }); };

// 자료(곡/말씀/광고/PPT)
app.post('/api/items', needAuth, (req, res) => {
  const it = { id: store.uid(), type: req.body.type || 'song', title: req.body.title || '새 자료', slides: req.body.slides || [], updatedAt: Date.now() };
  it.slides.forEach(s => (s.id ||= store.uid()));
  db.items.push(it); changed(); res.json(it);
});
app.put('/api/items/:id', needAuth, (req, res) => {
  const it = db.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: '없음' });
  Object.assign(it, { title: req.body.title ?? it.title, type: req.body.type ?? it.type, slides: req.body.slides ?? it.slides, updatedAt: Date.now() });
  it.slides.forEach(s => (s.id ||= store.uid()));
  if (live.itemId === it.id) { live.index = Math.min(live.index, Math.max(0, it.slides.length - 1)); pushLive(); }
  changed(); res.json(it);
});
app.delete('/api/items/:id', needAuth, (req, res) => {
  db.items = db.items.filter(i => i.id !== req.params.id);
  db.services.forEach(s => (s.itemIds = s.itemIds.filter(x => x !== req.params.id)));
  changed(); res.json({ ok: true });
});
app.post('/api/split', needAuth, (req, res) => res.json(store.splitLyrics(req.body.text, Math.max(1, +req.body.lines || 2))));

// 예배 순서
app.post('/api/services', needAuth, (req, res) => {
  const s = { id: store.uid(), name: req.body.name || '새 예배', date: req.body.date || new Date().toISOString().slice(0, 10), itemIds: [] };
  db.services.push(s); db.currentServiceId = s.id; changed(); res.json(s);
});
app.put('/api/services/:id', needAuth, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: '없음' });
  Object.assign(s, { name: req.body.name ?? s.name, date: req.body.date ?? s.date, itemIds: req.body.itemIds ?? s.itemIds });
  changed(); res.json(s);
});
app.delete('/api/services/:id', needAuth, (req, res) => {
  db.services = db.services.filter(s => s.id !== req.params.id);
  if (db.currentServiceId === req.params.id) db.currentServiceId = db.services[0]?.id || null;
  changed(); res.json({ ok: true });
});
app.put('/api/current-service', needAuth, (req, res) => { db.currentServiceId = req.body.id; changed(); res.json({ ok: true }); });

// 스타일·설정
// 스타일 값 검증 (색은 #hex, 숫자는 범위, 글꼴은 안전한 문자만)
const STYLE_RULES = {
  color: 'color', stroke: 'color', bg: 'color', box: 'color',
  size: [1, 30], strokeWidth: [0, 10], lineHeight: [0.8, 3], boxOpacity: [0, 1],
  align: ['left', 'center', 'right'], valign: ['top', 'middle', 'bottom'], position: ['top', 'bottom'],
  bold: 'bool', shadow: 'bool', showTitle: 'bool', font: 'font',
};
function cleanStyle(src, base) {
  const out = { ...base };
  for (const [k, v] of Object.entries(src || {})) {
    const r = STYLE_RULES[k];
    if (!r) continue;
    if (r === 'color') { if (/^#[0-9a-f]{3,8}$/i.test(String(v))) out[k] = v; }
    else if (r === 'bool') out[k] = !!v;
    else if (r === 'font') { if (/^[\w\s',\-가-힣]{1,120}$/.test(String(v))) out[k] = v; }
    else if (typeof r[0] === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.min(r[1], Math.max(r[0], n)); }
    else if (r.includes(v)) out[k] = v;
  }
  return out;
}
app.put('/api/style', needAuth, (req, res) => {
  db.style = { main: cleanStyle(req.body.main, db.style.main), overlay: cleanStyle(req.body.overlay, db.style.overlay) };
  changed(); pushLive(); res.json(db.style);
});
app.put('/api/settings', needLocal, (req, res) => {
  if (req.body.pin != null) {
    const pin = String(req.body.pin).trim();
    if (!/^\w{6,12}$/.test(pin)) return res.status(400).json({ error: 'PIN은 6~12자리 숫자/영문으로 정하세요' });
    db.settings.pin = pin;
  }
  if (req.body.logo != null) db.settings.logo = req.body.logo;
  if (req.body.pin != null) sessions.clear();
  changed(); pushLive(); res.json({ ok: true });
});

// 성경
app.get('/api/bible', needAuth, (req, res) => res.json(bible.lookup(req.query.q, req.query.v)));
app.post('/api/bible/upload', needAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일 없음' });
  const name = (req.body.name || req.file.originalname).replace(/[^\w가-힣().\- ]/g, '').replace(/\.(txt|tsv)$/i, '') || 'bible';
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
    const ext = path.extname(f.originalname).toLowerCase();
    if (!mediaExt.test(ext)) { fs.unlink(f.path, () => {}); continue; }
    const base = path.basename(f.originalname, ext).replace(/[^\w가-힣\-]/g, '_').slice(0, 40);
    const name = `${base}_${store.uid().slice(0, 4)}${ext}`;
    fs.renameSync(f.path, path.join(MEDIA_DIR, name));
    out.push({ url: '/media/' + name, name });
  }
  res.json(out);
});
app.delete('/api/media/:name', needAuth, (req, res) => {
  const p = path.join(MEDIA_DIR, path.basename(req.params.name));
  fs.rm(p, { force: true }, () => res.json({ ok: true }));
});

// PPT
app.post('/api/pptx', needAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('파일 없음');
    const buf = fs.readFileSync(req.file.path);
    const it = await importPptx(buf, MEDIA_DIR, path.basename(req.file.originalname, path.extname(req.file.originalname)));
    it.updatedAt = Date.now();
    db.items.push(it); changed(); res.json(it);
  } catch (e) {
    res.status(400).json({ error: 'PPT 가져오기 실패: ' + e.message });
  } finally { if (req.file) fs.unlink(req.file.path, () => {}); }
});

// 송출 제어 (운영 맥 전용)
// 프로그램 종료 (운영 맥에서만)
app.post('/api/quit', needLocal, (req, res) => {
  res.json({ ok: true });
  broadcast({ type: 'quit' });
  setTimeout(() => process.exit(0), 300);
});

app.post('/api/live', needLocal, (req, res) => {
  const b = req.body || {};
  if (b.itemId !== undefined) { live.itemId = b.itemId; live.index = 0; live.clear = false; live.black = false; }
  if (b.index !== undefined) { live.index = Math.max(0, +b.index); live.clear = false; live.black = false; }
  if (b.step) {
    const it = db.items.find(i => i.id === live.itemId);
    if (it) live.index = Math.min(Math.max(0, live.index + b.step), it.slides.length - 1);
    live.clear = false; live.black = false;
  }
  for (const k of ['black', 'clear', 'logo']) if (b[k] !== undefined) live[k] = !!b[k];
  if (b.reset) Object.assign(live, { black: false, clear: true, logo: false });
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
wss.on('connection', ws => ws.send(JSON.stringify(snapshot())));

server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('\n  ✝  예배송출 (Worship Caster) 실행 중\n');
  console.log(`  운영 화면     http://localhost:${PORT}/control`);
  console.log(`  예배당 화면   http://localhost:${PORT}/output   (TV로 옮긴 뒤 F 키 = 전체화면)`);
  console.log(`  프롬프터      http://localhost:${PORT}/stage`);
  for (const ip of lan) {
    console.log(`  OBS 자막      http://${ip}:${PORT}/overlay   (OBS 브라우저 소스 1920×1080)`);
    console.log(`  웹 편집기     http://${ip}:${PORT}/editor    (PIN: ${db.settings.pin})`);
  }
  console.log('');
  if (process.env.NO_OPEN !== '1') require('child_process').exec(`open http://localhost:${PORT}/control`);
});
