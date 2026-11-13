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
  const groups = {}; let cur = null;
  for (const s of sl) { if (s.label) { cur = s.label; groups[cur] ||= []; } if (cur) groups[cur].push(s); }
  const out = arr.flatMap(l => groups[l] || []);
  return out.length ? out : sl;
}

const DEFAULT_LOGO = { screenPos: 'c', screenSize: 50, mark: false, markPos: 'tr', markSize: 10, markOpacity: 0.85, markOverlay: false };

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
function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.style = { main: { ...DEFAULT_STYLE.main, ...(db.style?.main || {}) }, overlay: { ...DEFAULT_STYLE.overlay, ...(db.style?.overlay || {}) } };
    db.settings = { logo: '', bibleFolders: [], ...(db.settings || {}) };
    db.settings.logoStyle = { ...DEFAULT_LOGO, ...(db.settings.logoStyle || {}) };
    db.settings.obsScenes = { base: '', pip: '', ...(db.settings.obsScenes || {}) };
    db.phrases ||= [];
    db.props ||= [];
    if (!db.settings.pin || db.settings.pin === '0000') { db.settings.pin = randomPin(); save(); }  // 예전 기본값 0000 은 바꿈
  } catch {
    db = seed();
    save();
  }
  return db;
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}

module.exports = { load, save, uid, splitLyrics, seq, DATA_DIR, DEFAULT_STYLE, DEFAULT_LOGO };
