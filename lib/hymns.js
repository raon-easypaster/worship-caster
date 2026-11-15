// 찬송가: 교회가 가진 찬송가 가사 파일을 한 번 가져오면 번호로 바로 찾음
// (찬송가 가사는 저작권이 있어 프로그램에는 넣지 않음)
//
// 가져오는 파일 형식 (.txt, UTF-8 또는 EUC-KR):
//   305장 나 같은 죄인 살리신        ← 'N장 제목' 줄에서 새 곡 시작 ([305], #305 도 됨)
//   1. 나 같은 죄인 살리신 …          ← '1.' '1절' 로 시작하면 1절
//   …
//                                    ← 빈 줄은 묶음 나눔
//   후렴                             ← '후렴' 한 줄(또는 '후렴: …', '[후렴] …')부터 후렴
// .json 도 됨: [{ "num": 305, "title": "…", "lyrics": "…" }] 또는 { "305": { "title", "lyrics" } }
const fs = require('fs');
const path = require('path');
const FILE = path.join(require('./store').DATA_DIR, 'hymns.json');

let hymns = {};
function load() {
  try { hymns = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { hymns = {}; }
  return hymns;
}
const HEAD = /^\s*(?:(?:새|통일)?\s*찬송가\s*)?(?:\[\s*(\d{1,3})\s*\]|#\s*(\d{1,3})|(\d{1,3})\s*장)\s*[.:·\-–]?\s*(.*)$/;
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

function parseText(text) {
  const out = {};
  let cur = null;
  for (const line of String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n')) {
    const m = line.match(HEAD);
    if (m) {
      const num = +(m[1] || m[2] || m[3]);
      if (num >= 1 && num <= 999) { cur = { num, title: m[4].trim(), body: [] }; out[num] = cur; continue; }
    }
    if (cur) cur.body.push(line);
  }
  const res = {};
  for (const [n, h] of Object.entries(out)) {
    const body = h.body.join('\n').trim();
    if (!body) continue;
    const title = (h.title || body.split('\n')[0].replace(VERSE, '$2')).trim().slice(0, 80);
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

function importFile(buf, name) {
  let txt = buf.toString('utf8');
  if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf);   // 옛 한글 텍스트 파일
  let found;
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(txt)) { try { found = parseJson(JSON.parse(txt)); } catch { found = {}; } }
  else found = parseText(txt);
  const n = Object.keys(found).length;
  if (!n) return { count: 0 };
  hymns = { ...hymns, ...found };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(hymns));
  return { count: n, total: Object.keys(hymns).length };
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

module.exports = { load, importFile, get, search, learn, clear, count, parseText, shape, FILE };
