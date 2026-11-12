// 간단한 JSON 파일 저장소 (data/db.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const uid = () => crypto.randomBytes(6).toString('hex');

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
    lineHeight: 1.35,
  },
};

function splitLyrics(text, linesPer = 2) {
  // 빈 줄 = 강제 분할, 그 외 linesPer 줄씩 묶기
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += linesPer) {
      out.push(lines.slice(i, i + linesPer).join('\n'));
    }
  }
  return out.map(t => ({ id: uid(), text: t }));
}

function seed() {
  const song = {
    id: uid(), type: 'song', title: '예시 찬양 (직접 바꿔 쓰세요)',
    slides: splitLyrics(
      '주님의 은혜가 오늘도\n나의 삶을 덮으시네\n\n작은 예배당 이 자리에\n주님 함께 계시네\n\n' +
      '할렐루야 찬양해\n우리 주님 높이세\n할렐루야 찬양해\n영원토록 함께해', 2),
  };
  const bible = {
    id: uid(), type: 'bible', title: '요한복음 3:16',
    slides: [{ id: uid(), text: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 저를 믿는 자마다 멸망치 않고 영생을 얻게 하려 하심이니라', ref: '요한복음 3:16' }],
  };
  const notice = {
    id: uid(), type: 'notice', title: '광고',
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
    settings: { pin: '0000', logo: '', bibleFolders: [] },
  };
}

let db;
function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.style = { main: { ...DEFAULT_STYLE.main, ...(db.style?.main || {}) }, overlay: { ...DEFAULT_STYLE.overlay, ...(db.style?.overlay || {}) } };
    db.settings = { pin: '0000', logo: '', bibleFolders: [], ...(db.settings || {}) };
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

module.exports = { load, save, uid, splitLyrics, DATA_DIR, DEFAULT_STYLE };
