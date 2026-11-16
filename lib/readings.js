// 교독문: 교회가 가진 교독문 파일을 한 번 가져오면 번호·제목·본문으로 바로 찾아 넣음
// (교독문은 성경 본문이라 저작권이 있어 프로그램에는 넣지 않음)
//
// 가져오는 파일 형식 (.txt, UTF-8 또는 EUC-KR):
//   1. 시편 1편                 ← 'N. 제목' 줄에서 새 교독문 시작 ('1.시편 1편', '1번 시편 1편', '[1] …' 도 됨)
//   복 있는 사람은 …            ← 한 줄씩 인도자·회중이 번갈아 읽음
//   (다같이)                    ← 이 줄 뒤는 다 같이 읽음
// .json 도 됨: [{ "num": 1, "title": "시편 1편", "text": "…" }] 또는 { "1": { "title", "text" } }
const fs = require('fs');
const path = require('path');
const FILE = path.join(require('./store').DATA_DIR, 'readings.json');

let data = {};
function load() {
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { data = {}; }
  return data;
}
const HEAD = /^\s*(?:교독문\s*)?(?:\[\s*(\d{1,3})\s*\]|(\d{1,3})\s*(?:\.|번\.?|\))(?!\d))\s*(\S.*)?$/;
const TOGETHER = /^\s*[(\[（]?\s*다\s*같\s*이\s*[)\]）]?\s*[:.]?\s*$/;
const tidy = s => String(s || '').replace(/&#160;|&nbsp;| /g, ' ').replace(/[ \t]+/g, ' ').trim();

function parseText(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n')) {
    const line = tidy(raw);
    const m = line.match(HEAD);
    if (m) {
      const num = +(m[1] || m[2]);
      if (num >= 1 && num <= 999 && (m[3] || '').length <= 40) { cur = { num, title: tidy(m[3]), body: [] }; out[num] = cur; continue; }
    }
    if (cur) cur.body.push(line);
  }
  const res = {};
  for (const [n, r] of Object.entries(out)) {
    const body = r.body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    res[n] = { title: (r.title || body.split('\n')[0]).slice(0, 80), text: body.slice(0, 12000) };
  }
  return res;
}
function parseJson(j) {
  const res = {};
  const add = (n, r) => {
    n = +n; if (!(n >= 1 && n <= 999) || !r) return;
    const text = String(r.text ?? r.body ?? r.lyrics ?? '').split('\n').map(tidy).join('\n').trim();
    if (text) res[n] = { title: tidy(r.title).slice(0, 80) || text.split('\n')[0].slice(0, 80), text: text.slice(0, 12000) };
  };
  if (Array.isArray(j)) j.forEach(r => add(r?.num ?? r?.number, r));
  else if (j && typeof j === 'object') for (const [n, r] of Object.entries(j)) add(n, r);
  return res;
}

function importFile(buf, name) {
  let txt = buf.toString('utf8');
  if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf);
  let found;
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(txt)) { try { found = parseJson(JSON.parse(txt)); } catch { found = {}; } }
  else found = parseText(txt);
  const n = Object.keys(found).length;
  if (!n) return { count: 0 };
  data = { ...data, ...found };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data));
  return { count: n, total: Object.keys(data).length };
}

// 교독문 → 슬라이드 (한 화면에 lines 줄씩, '(다같이)' 부분은 따로 나눠 첫 줄에 (다같이) 표시)
function slides(n, lines = 2) {
  const r = data[+n];
  if (!r) return null;
  lines = Math.min(4, Math.max(1, Math.round(+lines) || 2));
  const ref = `교독문 ${+n} ${r.title}`.trim();
  const parts = [[]];
  for (const l of r.text.split('\n')) {
    if (!l.trim()) continue;
    if (TOGETHER.test(l)) { parts.push(['(다같이)']); continue; }
    parts[parts.length - 1].push(l.trim());
  }
  const out = [];
  parts.forEach((p, pi) => {
    const head = pi > 0 ? p.shift() : null;   // '(다같이)'
    for (let i = 0; i < p.length; i += lines) {
      const chunk = p.slice(i, i + lines);
      if (head && i === 0) chunk.unshift(head);
      out.push({ text: chunk.join('\n'), ref });
    }
  });
  return out;
}
function get(n) {
  const r = data[+n];
  return r ? { num: +n, title: r.title, text: r.text } : null;
}
const firstLine = t => String(t).split('\n').find(l => l.trim() && !TOGETHER.test(l)) || '';
// 번호·제목·본문 한 줄로 찾기 (띄어쓰기 무시)
function search(q) {
  q = String(q || '').trim();
  const m = q.match(/^(?:교독문\s*)?(\d{1,3})\s*번?$/);
  if (m) { const r = get(m[1]); return r ? [{ num: r.num, title: r.title, first: firstLine(r.text) }] : []; }
  const k = q.replace(/\s+/g, '');
  if (k.length < 2) return [];
  const hit = [], body = [];
  for (const [n, r] of Object.entries(data)) {
    const row = { num: +n, title: r.title, first: firstLine(r.text) };
    if (r.title.replace(/\s+/g, '').includes(k)) hit.push(row);                // 제목이 맞는 것 먼저
    else if (r.text.replace(/\s+/g, '').includes(k)) body.push(row);
  }
  const byNum = (a, b) => a.num - b.num;
  return [...hit.sort(byNum), ...body.sort(byNum)].slice(0, 30);
}
function clear() { data = {}; try { fs.rmSync(FILE, { force: true }); } catch {} }
const count = () => Object.keys(data).length;

module.exports = { load, importFile, get, slides, search, clear, count, parseText, FILE };
