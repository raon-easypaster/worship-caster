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
app.use(express.json({ limit: '20mb' }));
const upload = multer({ dest: path.join(os.tmpdir(), 'worship-caster-up'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.get('/', (req, res) => res.redirect(isLocal(req) ? '/control' : '/editor'));
app.get('/control', (req, res) => isLocal(req) ? res.sendFile(path.join(__dirname, 'public', 'app.html')) : res.redirect('/editor'));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
for (const p of ['output', 'overlay', 'stage']) app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build'), {
  setHeaders: (res, p) => { if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript'); },
}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  if (String(req.body?.pin) !== String(db.settings.pin)) return res.status(401).json({ error: 'PIN이 맞지 않습니다' });
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
app.put('/api/style', needAuth, (req, res) => {
  db.style = { main: { ...db.style.main, ...(req.body.main || {}) }, overlay: { ...db.style.overlay, ...(req.body.overlay || {}) } };
  changed(); pushLive(); res.json(db.style);
});
app.put('/api/settings', needLocal, (req, res) => {
  if (req.body.pin != null) db.settings.pin = String(req.body.pin).slice(0, 12);
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
const mediaExt = /\.(png|jpe?g|gif|webp|svg|bmp|mp4|mov|m4v|webm|mp3|m4a|wav|aac)$/i;
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
const wss = new WebSocketServer({ server, path: '/ws' });
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
    console.log(`  웹 편집기     http://${ip}:${PORT}/editor    (PIN: 설정에서 변경, 기본 0000)`);
  }
  console.log('');
  if (process.env.NO_OPEN !== '1') require('child_process').exec(`open http://localhost:${PORT}/control`);
});
