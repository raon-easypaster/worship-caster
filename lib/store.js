// 간단한 JSON 파일 저장소 (data/db.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.WC_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const uid = () => crypto.randomBytes(6).toString('hex');
const randomPin = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');

const DEFAULT_STYLE = {
  main: {
    font: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
    size: 6.2,          // 화면 높이 대비 vh
    color: '#ffffff',
    stroke: '#000000',
    strokeWidth: 0,
    shadow: true,
    align: 'center',
    valign: 'middle',   // top | middle | bottom
    bold: true,
    bg: '#000000',
    lineHeight: 1.45,
    motion: 'none',     // 움직이는 배경 (none | galaxy | water | ...)
    motionVideo: '',    // motion 이 video 일 때 쓸 동영상
    motionOn: true,     // 움직이는 배경 전체 켜기/끄기
    aspect: '16:9',     // 예배당 화면 비율 (옛 프로젝터는 4:3)
  },
  overlay: {
    font: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
    size: 4.6,
    color: '#ffffff',
    box: '#0b1d3a',
    boxOpacity: 0.72,
    position: 'bottom', // bottom | top
    bold: true,
    showTitle: true,
    imgMode: 'full',    // 방송에 그림(악보·사진·PPT 그림): full 화면 가득 / part 화면 일부 / none 보내지 않음
    partSize: 35,       // 화면 일부일 때 크기(%)
    partPos: 'tr',      // 화면 일부 위치: tr·mr·br 오른쪽 위·중간·아래 / tl·ml·bl 왼쪽
    lineHeight: 1.35,
  },
};

function splitLyrics(text, linesPer = 2) {
  // 빈 줄 = 강제 분할, 그 외 linesPer 줄씩 묶기
  // 묶음 첫 줄이 '#후렴' 처럼 # 으로 시작하면 그 묶음의 곡 구성 이름(1절·후렴·브리지)
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    let lines = b.split('\n').map(s => s.trim()).filter(Boolean);
    let label = '';
    if (lines[0] && /^#\s*\S/.test(lines[0])) { label = lines[0].replace(/^#\s*/, '').slice(0, 20); lines = lines.slice(1); }
    for (let i = 0; i < lines.length; i += linesPer) {
      out.push({ text: lines.slice(i, i + linesPer).join('\n'), label: i === 0 ? label : '' });
    }
  }
  return out.map(o => ({ id: uid(), text: o.text, ...(o.label ? { label: o.label } : {}) }));
}

// 곡 구성 순서대로 펼친 슬라이드 (public/render.js 의 WC.seq 와 같은 규칙)
function seq(it) {
  const sl = it?.slides || [], arr = (it?.arr || []).filter(Boolean);
  if (!arr.length || !sl.some(s => s.label)) return sl;
  const groups = new Map(); let cur = null;   // Map: 이름이 '__proto__' 같아도 안전
  for (const s of sl) { if (s.label) { cur = String(s.label); if (!groups.has(cur)) groups.set(cur, []); } if (cur) groups.get(cur).push(s); }
  const out = arr.flatMap(l => groups.get(String(l)) || []);
  return out.length ? out : sl;
}

const DEFAULT_LOGO = { screenBg: 'black', screenPos: 'c', screenSize: 50, mark: false, markPos: 'tr', markSize: 10, markOpacity: 0.85, markOverlay: false };

function seed() {
  const song = {
    id: uid(), type: 'song', title: '예시 찬양 (직접 바꿔 쓰세요)', theme: 'song_galaxy',
    slides: splitLyrics(
      '주님의 은혜가 오늘도\n나의 삶을 덮으시네\n\n작은 예배당 이 자리에\n주님 함께 계시네\n\n' +
      '할렐루야 찬양해\n우리 주님 높이세\n할렐루야 찬양해\n영원토록 함께해', 2),
  };
  const bible = {
    id: uid(), type: 'bible', title: '말씀 (＋ 성경 버튼으로 만드세요)',
    slides: [{ id: uid(), text: '⚙︎ 설정에서 성경 폴더를 연결한 뒤\n＋ 성경 버튼으로 말씀 슬라이드를 만드세요' }],
  };
  const notice = {
    id: uid(), type: 'notice', title: '광고', theme: 'notice',
    slides: [
      { id: uid(), text: '오늘 예배에 오신 여러분을\n환영합니다' },
      { id: uid(), text: '수요예배 저녁 7시 30분\n금요기도회 저녁 9시' },
    ],
  };
  const service = { id: uid(), name: '주일 예배', date: new Date().toISOString().slice(0, 10), itemIds: [notice.id, song.id, bible.id] };
  return {
    items: [song, bible, notice],
    services: [service],
    currentServiceId: service.id,
    style: DEFAULT_STYLE,
    settings: { pin: randomPin(), logo: '', logoStyle: { ...DEFAULT_LOGO }, obsScenes: { base: '', pip: '' }, bibleFolders: [] },
    phrases: [],
    props: [{ id: uid(), text: '설교 · 담임목사', sub: '말씀 제목을 적으세요', where: 'both', pos: 'bottom' }],
  };
}

let db;
// 예전 판·백업에서 온 자료에 빠진 칸 채우기
function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.items) || !Array.isArray(d.services)) throw new Error('예배송출 자료가 아닙니다');
  d.style = { main: { ...DEFAULT_STYLE.main, ...(d.style?.main || {}) }, overlay: { ...DEFAULT_STYLE.overlay, ...(d.style?.overlay || {}) },
    ...(d.style?.byType && typeof d.style.byType === 'object' ? { byType: d.style.byType } : {}) };   // 종류별(찬양·말씀·문구·광고)로 따로 바꾼 값
  d.settings = { logo: '', bibleFolders: [], ...(d.settings || {}) };
  d.settings.logoStyle = { ...DEFAULT_LOGO, ...(d.settings.logoStyle || {}) };
  d.settings.obsScenes = { base: '', pip: '', ...(d.settings.obsScenes || {}) };
  d.phrases ||= [];
  d.props ||= [];
  if (!d.settings.pin || d.settings.pin === '0000') { d.settings.pin = randomPin(); setTimeout(save, 0); }  // 예전 기본값 0000 은 바꿈
  return d;
}
// 백업에서 되살리기: 같은 객체를 그대로 두고 내용만 바꿈 (server.js 가 이 객체를 붙들고 있음)
function replace(next) {
  const d = normalize(next);
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, d);
  save();
  return db;
}
// ── 자료 지키기 ──
// 날마다 자동 보관본: 그날 처음 저장할 때 바로 전 자료를 backups/db-날짜.json 으로 남김 (최근 KEEP_DAYS 개)
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_DAYS = 14;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function dailySnapshot() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const to = path.join(BACKUP_DIR, `db-${today()}.json`);
    if (fs.existsSync(to)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(DB_FILE, to);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(KEEP_DAYS);
    for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  } catch (e) { console.log('  자동 보관본을 남기지 못함:', e.message); }
}
// 되살릴 수 있는 자료 후보: 날마다 보관본, 업데이트·되살리기 전 보관본 (새것부터)
function recoveryCandidates() {
  const out = [];
  const add = (dir, re) => { try { for (const f of fs.readdirSync(dir)) if (re.test(f)) { const p = path.join(dir, f); out.push([p, fs.statSync(p).mtimeMs]); } } catch {} };
  add(BACKUP_DIR, /^db-\d{4}-\d{2}-\d{2}\.json$/);
  add(DATA_DIR, /^db[-.]before-.+\.json$/);
  return out.sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
let recovered = null;   // 자료를 읽지 못해 되살렸으면 { broken, from } — 운영 화면에 알림
function load() {
  if (db) return db;
  if (!fs.existsSync(DB_FILE)) { db = seed(); save(); return db; }   // 처음 실행
  try {
    db = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    return db;
  } catch (e) {
    // 자료 파일이 깨졌음 → 예시 자료로 덮어쓰지 않음. 깨진 파일은 그대로 남기고, 가장 최근 보관본으로 되살림
    const broken = DB_FILE.replace(/\.json$/, `.broken-${Date.now()}.json`);
    try { fs.copyFileSync(DB_FILE, broken); fs.rmSync(DB_FILE, { force: true }); } catch {}   // 깨진 것이 날마다 보관본으로 들어가지 않게
    console.log('  ⚠️ 자료 파일(db.json)을 읽지 못했습니다:', e.message, '→ 깨진 파일은', path.basename(broken), '로 남겨 둠');
    for (const p of recoveryCandidates()) {
      try {
        db = normalize(JSON.parse(fs.readFileSync(p, 'utf8')));
        recovered = { broken: path.basename(broken), from: path.relative(DATA_DIR, p), at: Date.now() };
        console.log('  ✓ 보관본으로 되살렸습니다:', recovered.from);
        writeNow();
        return db;
      } catch {}
    }
    recovered = { broken: path.basename(broken), from: '', at: Date.now() };
    console.log('  ⚠️ 되살릴 보관본이 없어 예시 자료로 시작합니다. 깨진 파일:', path.basename(broken));
    db = seed();
    writeNow();
    return db;
  }
}

let timer = null;
function writeNow() {
  timer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dailySnapshot();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  clearTimeout(timer);
  timer = setTimeout(writeNow, 150);
}
// 곧 꺼질 때(업데이트 뒤 다시 켜기): 기다리는 저장을 바로 씀
function flush() { if (timer) { clearTimeout(timer); writeNow(); } }

module.exports = { load, save, flush, replace, recoveredInfo: () => recovered, clearRecovered: () => { recovered = null; }, BACKUP_DIR, DB_FILE, uid, splitLyrics, seq, DATA_DIR, DEFAULT_STYLE, DEFAULT_LOGO };
