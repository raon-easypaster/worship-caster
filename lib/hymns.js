// 찬송가: 교회가 가진 찬송가 가사 파일을 한 번 가져오면 번호로 바로 찾음
// (찬송가 가사는 저작권이 있어 프로그램에는 넣지 않음)
//
// 가져오는 파일 형식 (.txt, UTF-8 또는 EUC-KR):
//   305장 나 같은 죄인 살리신        ← 'N장 제목' 줄에서 새 곡 시작 ([305], #305, 제305장, 찬송가 305 도 됨. 제목은 없어도 됨)
//   1. 나 같은 죄인 살리신 …          ← '1.' '1절' 로 시작하면 1절
//   …
//                                    ← 빈 줄은 묶음 나눔
//   후렴                             ← '후렴' 한 줄(또는 '후렴: …', '[후렴] …')부터 후렴
// 한 곡이 파일 하나이고 안에 장 번호 줄이 없으면 파일 이름의 번호를 씀 (305장.txt, 305.txt, 새찬송가 305장 나 같은 죄인.txt)
// .json 도 됨: [{ "num": 305, "title": "…", "lyrics": "…" }] 또는 { "305": { "title", "lyrics" } }
const fs = require('fs');
const path = require('path');
const FILE = path.join(require('./store').DATA_DIR, 'hymns.json');

let hymns = {};
function load() {
  try { hymns = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { hymns = {}; }
  return hymns;
}
const HEAD = /^\s*(?:(?:새|통일)?\s*찬송가\s*)?(?:\[\s*(\d{1,3})\s*\]|#\s*(\d{1,3})|제?\s*(\d{1,3})\s*장)\s*[.:·\-–]?\s*(.*)$/;
// '찬송가 305 나 같은 죄인' — '찬송가'가 앞에 있으면 '장'이 없어도 번호로 봄
const HEAD2 = /^\s*(?:새|통일)?\s*찬송가\s*(\d{1,3})(?!\s*절)(?:\s*[.:·\-–]\s*|\s+|$)(.*)$/;
// 제목 앞뒤의 '(통405)' '[통일 405장]' 같은 옛 번호는 뺌
const cleanTitle = t => String(t || '').replace(/[(\[]\s*통일?\s*(?:찬송가)?\s*\d{1,3}\s*장?\s*[)\]]/g, '').replace(/^[\s.:·\-–]+|[\s.:·\-–]+$/g, '').trim();
// 파일 이름의 장 번호: '305장.txt' '305.txt' '새찬송가 305장 나 같은 죄인.txt' 'hymn_305.txt'
function nameNum(name) {
  const b = String(name || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').normalize('NFC');
  const m = b.match(/^(?:.*?찬송가\s*)?제?\s*0*(\d{1,3})\s*장?(?![\d절])\s*[.\-_·]?\s*(.*)$/) || b.match(/(?:^|[^\d])0*(\d{1,3})\s*장(?!\d)\s*[.\-_·]?\s*(.*)$/) || b.match(/^[a-z_\-\s]*0*(\d{1,3})$/i);
  if (!m) return null;
  const num = +m[1];
  return num >= 1 && num <= 999 ? { num, title: cleanTitle(m[2] || '') } : null;
}
const VERSE = /^\s*(\d{1,2})\s*(?:절|\.|\))\s*(.*)$/;
const CHORUS = /^\s*[\[(]?\s*(?:후렴|후 렴|refrain|chorus)\s*(?:[\])]\s*[.:]?|[.:])?\s*$|^\s*[\[(]\s*(?:후렴|refrain|chorus)\s*[\])]\s*(.+)$|^\s*(?:후렴|refrain|chorus)\s*[.:]\s*(.+)$/i;

// 곡 본문 → '#1절 …' 꼴 가사 + 부를 순서
function shape(body) {
  const blocks = [];
  let cur = null;
  for (const raw of String(body).replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) { cur = null; continue; }
    let m;
    if ((m = l.match(/^#\s*(\S.{0,19})$/))) { cur = { label: m[1].trim(), lines: [] }; blocks.push(cur); continue; }   // '#1절' '#후렴' (가사 찾기에서 정리한 꼴)
    if ((m = l.match(VERSE))) { cur = { label: `${+m[1]}절`, lines: [] }; blocks.push(cur); if (m[2]) cur.lines.push(m[2]); continue; }
    if ((m = l.match(CHORUS))) { cur = { label: '후렴', lines: [] }; blocks.push(cur); const rest = m[1] || m[2]; if (rest) cur.lines.push(rest); continue; }
    // 같은 절 안의 빈 줄은 이어 붙임 (2줄씩 미리 나뉜 찬송가 파일도 1~4줄로 다시 나눌 수 있게)
    if (!cur) cur = blocks[blocks.length - 1];
    if (!cur) { cur = { label: '', lines: [] }; blocks.push(cur); }
    cur.lines.push(l);
  }
  const named = blocks.filter(b => b.lines.length);
  const lyrics = named.map(b => (b.label ? `#${b.label}\n` : '') + b.lines.join('\n')).join('\n\n');
  // 후렴이 하나 있으면 절마다 뒤에 붙여 부르게
  const verses = [...new Set(named.filter(b => /절$/.test(b.label)).map(b => b.label))];
  const arr = named.some(b => b.label === '후렴') && verses.length ? verses.flatMap(v => [v, '후렴']) : [];
  return { lyrics, arr };
}

function parseText(text, name) {
  const out = {};
  let cur = null;
  const lines = String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  for (const line of lines) {
    const m = line.match(HEAD), m2 = !m && line.match(HEAD2);
    if (m || m2) {
      const num = m ? +(m[1] || m[2] || m[3]) : +m2[1];
      if (num >= 1 && num <= 999) { cur = { num, title: cleanTitle(m ? m[4] : m2[2]), body: [] }; out[num] = cur; continue; }
    }
    if (cur) cur.body.push(line);
  }
  // 장 번호 줄이 없는 파일 = 한 곡짜리 → 파일 이름의 번호로
  if (!Object.keys(out).length) {
    const nn = nameNum(name);
    if (nn) out[nn.num] = { num: nn.num, title: nn.title, body: lines };
  }
  const res = {};
  for (const [n, h] of Object.entries(out)) {
    const body = h.body.join('\n').trim();
    if (!body) continue;
    const title = (h.title || firstLine(body)).trim().slice(0, 80);
    res[n] = { title, lyrics: body.slice(0, 8000) };
  }
  return res;
}
function parseJson(j) {
  const res = {};
  const add = (n, h) => {
    n = +n; if (!(n >= 1 && n <= 999) || !h) return;
    const lyrics = String(h.lyrics ?? h.text ?? '').trim();
    if (lyrics) res[n] = { title: String(h.title ?? '').trim().slice(0, 80) || lyrics.split('\n')[0].slice(0, 80), lyrics: lyrics.slice(0, 8000) };
  };
  if (Array.isArray(j)) j.forEach(h => add(h?.num ?? h?.number, h));
  else if (j && typeof j === 'object') for (const [n, h] of Object.entries(j)) add(n, h);
  return res;
}

// 파일 하나 읽기 → { 번호: {title, lyrics} }
function parseFile(buf, name) {
  let txt = buf.toString('utf8');
  if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf);   // 옛 한글 텍스트 파일
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(txt)) { try { return parseJson(JSON.parse(txt)); } catch { return {}; } }
  return parseText(txt, name);
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(hymns));
}
function importFile(buf, name) {
  const found = parseFile(buf, name);
  const n = Object.keys(found).length;
  if (!n) return { count: 0 };
  hymns = { ...hymns, ...found };
  save();
  return { count: n, total: Object.keys(hymns).length };
}
// 여러 파일을 한꺼번에 (한 곡에 파일 하나인 찬송가 모음). 못 읽은 파일 이름도 알려 줌
function importFiles(files) {
  const found = {}, failed = [];
  for (const f of files) {
    const r = parseFile(f.buf, f.name);
    if (Object.keys(r).length) Object.assign(found, r); else failed.push(f.name);
  }
  const n = Object.keys(found).length;
  if (n) { hymns = { ...hymns, ...found }; save(); }
  return { count: n, total: Object.keys(hymns).length, failed };
}

function get(n) {
  const h = hymns[+n];
  if (!h) return null;
  return { num: +n, title: `찬송가 ${+n}장 ${h.title}`.trim(), ...shape(h.lyrics) };
}
// 장 번호·제목·가사 한 줄로 찾기 (띄어쓰기 무시)
function search(q) {
  q = String(q || '').trim();
  const m = q.match(/^(?:찬송가\s*)?(\d{1,3})\s*장?$/);
  if (m) { const h = get(m[1]); return h ? [{ num: h.num, title: h.title, first: firstLine(hymns[h.num].lyrics) }] : []; }
  const k = q.replace(/\s+/g, '');
  if (k.length < 2) return [];
  const out = [];
  for (const [n, h] of Object.entries(hymns)) {
    if ((h.title + '\n' + h.lyrics).replace(/\s+/g, '').includes(k)) out.push({ num: +n, title: `찬송가 ${+n}장 ${h.title}`.trim(), first: firstLine(h.lyrics) });
    if (out.length >= 20) break;
  }
  return out.sort((a, b) => a.num - b.num);
}
const firstLine = t => String(t).split('\n').map(l => l.replace(VERSE, '$2').trim()).find(l => l && !l.startsWith('#') && !CHORUS.test(l)) || '';
// 인터넷에서 찾아 넣은 찬송가를 번호와 함께 기억 → 다음부터 번호로 바로
function learn(num, title, lyrics) {
  num = +num;
  if (!(num >= 1 && num <= 999)) throw new Error('장 번호는 1~999');
  lyrics = String(lyrics || '').replace(/\r/g, '').trim().slice(0, 8000);
  if (!lyrics) throw new Error('가사가 없습니다');
  hymns[num] = { title: String(title || '').replace(/^\s*(?:새|통일)?\s*찬송가\s*\d{1,3}\s*장\s*/, '').trim().slice(0, 80) || firstLine(lyrics).slice(0, 80), lyrics };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(hymns));
  return get(num);
}
function clear() { hymns = {}; try { fs.rmSync(FILE, { force: true }); } catch {} }
const count = () => Object.keys(hymns).length;
const has = n => !!hymns[+n];

module.exports = { load, importFile, importFiles, get, search, learn, clear, count, has, parseText, nameNum, shape, FILE };
