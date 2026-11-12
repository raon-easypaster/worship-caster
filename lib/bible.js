// 성경: 한글 약어 파서 + 텍스트 파일 가져오기
// 지원 파일 형식 (UTF-8 .txt):
//   1) "창1:1 본문..."  (약어+장:절 공백 본문)
//   2) "창세기\t1\t1\t본문..."   (TSV)
const fs = require('fs');
const path = require('path');

const BOOKS = [
  ['창세기', '창'], ['출애굽기', '출'], ['레위기', '레'], ['민수기', '민'], ['신명기', '신'],
  ['여호수아', '수'], ['사사기', '삿'], ['룻기', '룻'], ['사무엘상', '삼상'], ['사무엘하', '삼하'],
  ['열왕기상', '왕상'], ['열왕기하', '왕하'], ['역대상', '대상'], ['역대하', '대하'], ['에스라', '스'],
  ['느헤미야', '느'], ['에스더', '에'], ['욥기', '욥'], ['시편', '시'], ['잠언', '잠'],
  ['전도서', '전'], ['아가', '아'], ['이사야', '사'], ['예레미야', '렘'], ['예레미야애가', '애'],
  ['에스겔', '겔'], ['다니엘', '단'], ['호세아', '호'], ['요엘', '욜'], ['아모스', '암'],
  ['오바댜', '옵'], ['요나', '욘'], ['미가', '미'], ['나훔', '나'], ['하박국', '합'],
  ['스바냐', '습'], ['학개', '학'], ['스가랴', '슥'], ['말라기', '말'],
  ['마태복음', '마'], ['마가복음', '막'], ['누가복음', '눅'], ['요한복음', '요'], ['사도행전', '행'],
  ['로마서', '롬'], ['고린도전서', '고전'], ['고린도후서', '고후'], ['갈라디아서', '갈'], ['에베소서', '엡'],
  ['빌립보서', '빌'], ['골로새서', '골'], ['데살로니가전서', '살전'], ['데살로니가후서', '살후'], ['디모데전서', '딤전'],
  ['디모데후서', '딤후'], ['디도서', '딛'], ['빌레몬서', '몬'], ['히브리서', '히'], ['야고보서', '약'],
  ['베드로전서', '벧전'], ['베드로후서', '벧후'], ['요한일서', '요일'], ['요한이서', '요이'], ['요한삼서', '요삼'],
  ['유다서', '유'], ['요한계시록', '계'],
];
const ALIASES = { '시편': '시', '계시록': '계', '요한1서': '요일', '요한2서': '요이', '요한3서': '요삼', '애가': '애' };

function toAbbr(name) {
  name = String(name).replace(/\s/g, '');
  if (ALIASES[name]) return ALIASES[name];
  for (const [full, ab] of BOOKS) if (name === full || name === ab) return ab;
  return null;
}
const fullName = ab => (BOOKS.find(b => b[1] === ab) || [ab])[0];

const BIBLE_DIR = path.join(require('./store').DATA_DIR, 'bible');

// 번역본: name -> { lang, source, books: {abbr: {ch:{v:text}}}, files: {abbr: mdPath} (필요할 때 읽음) }
const versions = {};
const EN = {}; // 영어 책 이름(소문자, 공백 없음) -> abbr  (마크다운 파일명에서 수집)

function parseText(txt) {
  const data = {};
  const put = (ab, c, v, t) => {
    ((data[ab] ||= {})[c] ||= {})[v] = t.trim();
  };
  for (const raw of txt.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tsv = line.split('\t');
    if (tsv.length >= 4) {
      const ab = toAbbr(tsv[0]);
      if (ab) { put(ab, +tsv[1], +tsv[2], tsv.slice(3).join(' ')); continue; }
    }
    const m = line.match(/^([가-힣]+)\s*(\d+):(\d+)\s+(.*)$/);
    if (m) {
      const ab = toAbbr(m[1]);
      if (ab) put(ab, +m[2], +m[3], m[4].replace(/^<[^>]*>\s*/, ''));
    }
  }
  return data;
}

// 화면용 본문 정리: "| 주석: …" 각주와 ①② 표시 제거
function clean(t) {
  return t.replace(/\s*\|\s*주석:.*$/, '').replace(/[①-⓿❶-➓]/g, '').replace(/\s{2,}/g, ' ').trim();
}

// 옵시디언 마크다운: "## 3장" + "**3:16** 본문"
function parseMarkdownBook(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\*\*(\d+):(\d+)\*\*\s*(.*)$/);
    if (m) (out[+m[1]] ||= {})[+m[2]] = clean(m[3]);
  }
  return out;
}

// 폴더 안의 하위 폴더 = 번역본, 파일명 "43-요한복음(John) - 개역개정.md"
function scanMarkdownFolder(root) {
  let count = 0;
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch (e) { console.warn('성경 폴더를 열 수 없음:', root, e.message); return 0; }
  for (const d of dirs) {
    const files = {};
    let lang = '';
    for (const f of fs.readdirSync(path.join(root, d.name))) {
      const m = f.normalize('NFC').match(/^(\d{1,2})-([^(]+)\(([^)]+)\).*\.md$/);
      if (!m) continue;
      const book = BOOKS[+m[1] - 1];
      if (!book) continue;
      files[book[1]] = path.join(root, d.name, f);
      EN[m[3].toLowerCase().replace(/\s/g, '')] = book[1];
    }
    if (!Object.keys(files).length) continue;
    const dname = d.name.normalize('NFC');
    const pm = dname.match(/^(.*?)\s*\((.+)\)\s*$/);   // "한글 (개역개정)" → 개역개정
    const name = pm ? pm[2] : dname;
    lang = pm ? pm[1] : '';
    versions[name] = { lang, source: root, files, books: {} };
    count++;
  }
  return count;
}

function loadAll(folders = []) {
  for (const k of Object.keys(versions)) delete versions[k];
  const folderCount = folders.reduce((n, f) => n + scanMarkdownFolder(f), 0);
  fs.mkdirSync(BIBLE_DIR, { recursive: true });
  for (const f of fs.readdirSync(BIBLE_DIR)) {
    if (!/\.(txt|tsv)$/i.test(f)) continue;
    try {
      const buf = fs.readFileSync(path.join(BIBLE_DIR, f));
      let txt = buf.toString('utf8');
      if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf); // 옛 한글 텍스트 파일
      const parsed = parseText(txt);
      if (Object.keys(parsed).length) versions[f.replace(/\.(txt|tsv)$/i, '')] = { lang: '', books: parsed, files: {} };
    } catch (e) { console.warn('성경 파일 읽기 실패', f, e.message); }
  }
}

function chapter(vname, ab, ch) {
  const v = versions[vname];
  if (!v) return null;
  if (!v.books[ab] && v.files[ab]) {
    try { v.books[ab] = parseMarkdownBook(v.files[ab]); } catch (e) { console.warn('성경 읽기 실패', v.files[ab], e.message); }
  }
  return v.books[ab]?.[ch] || null;
}

// 한글이 먼저, 그다음 영어, 원어 순
const LANG_ORDER = ['한글', '영어', '헬라어', '히브리어'];
function versionNames() {
  return Object.keys(versions).sort((a, b) => {
    const la = LANG_ORDER.indexOf(versions[a].lang), lb = LANG_ORDER.indexOf(versions[b].lang);
    return (la < 0 ? 9 : la) - (lb < 0 ? 9 : lb);
  });
}
function defaultVersion() {
  const names = versionNames();
  return names.find(n => n === '개역개정') || names.find(n => versions[n].lang === '한글') || names[0];
}

// "요 3:16", "시23:1-3", "요한복음 3장 16절", "롬 8:28-30", "John 3:16", "1 John 1:9", "요한1서 1:9"
function parseRef(q) {
  const m = String(q).trim().match(/^(\d?\s*[가-힣A-Za-z]+(?:\d[가-힣]+)?)\.?\s*(\d+)\s*(?:[:장]\s*(\d+)\s*절?\s*(?:[-~]\s*(\d+)\s*절?)?)?\s*장?$/);
  if (!m) return null;
  const ab = toAbbr(m[1]) || EN[m[1].toLowerCase().replace(/\s/g, '')];
  if (!ab) return null;
  return { ab, ch: +m[2], from: m[3] ? +m[3] : 1, to: m[4] ? +m[4] : (m[3] ? +m[3] : 999) };
}

function lookup(q, version) {
  const ref = parseRef(q);
  if (!ref) return { error: '형식 예: 요 3:16, 시 23:1-3, 롬 8장, John 3:16' };
  if (!versionNames().length) return { error: '성경 본문이 없습니다. ⚙︎ 설정 → 성경 폴더 또는 성경 텍스트 가져오기로 본문을 연결하세요.' };
  const vname = version && versions[version] ? version : defaultVersion();
  const chap = chapter(vname, ref.ab, ref.ch);
  if (!chap) return { error: `${fullName(ref.ab)} ${ref.ch}장을 '${vname}'에서 찾지 못했습니다.` };
  const verses = [];
  for (let v = ref.from; v <= ref.to; v++) if (chap[v]) verses.push({ v, text: chap[v] });
  if (!verses.length) return { error: '해당 절이 없습니다.' };
  const range = verses.length > 1 ? `${verses[0].v}-${verses[verses.length - 1].v}` : `${verses[0].v}`;
  return { version: vname, lang: versions[vname].lang, title: `${fullName(ref.ab)} ${ref.ch}:${range}`, book: fullName(ref.ab), ch: ref.ch, from: ref.from, to: ref.to, verses };
}

module.exports = { loadAll, lookup, versions, versionNames, defaultVersion, BIBLE_DIR, parseText };
