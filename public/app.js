// 운영 화면(/control) + 웹 편집기(/editor) 공용 로직
const IS_EDITOR = location.pathname.startsWith('/editor');
const $ = s => document.querySelector(s);
const esc = WC.esc;
const TYPE = { song: '찬양', score: '악보·PDF', bible: '말씀', text: '문구', notice: '광고', ppt: 'PPT', html: 'HTML' };
const KEEP = new Set(['song', 'score']);   // 자료실에 남는 것: 찬양(가사·악보). 나머지는 예배 순서에서 빼면 지워짐
let obsInfo = null;     // OBS 브라우저 소스가 알려 준 상태

let S = null;           // 서버 데이터
let snap = null;        // 송출 상태
let selId = null;       // 가운데에 보이는 자료
let search = '';

// ── 공통 ─────────────────────────────────────────
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || '오류가 발생했습니다'); throw new Error(j.error); }
  // 내가 바꾼 내용은 실시간 연결 상태와 상관없이 바로 화면에 반영
  if (method !== 'GET' && !url.startsWith('/api/live') && S) { clearTimeout(api._t); api._t = setTimeout(() => reload().catch(() => {}), 120); }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
const item = id => S.items.find(i => i.id === id);
const mediaName = u => decodeURIComponent(String(u || '').split('/').pop());
const service = () => S.services.find(s => s.id === S.currentServiceId);

async function reload() {
  S = await api('GET', '/api/state');
  if (!snap) snap = S.live;
  renderAll();
}

// ── 화면 그리기 ─────────────────────────────────
function renderAll() { renderBrand(); renderServices(); renderLib(); renderSlides(); renderLive(); }
// 맨 위 '예배송출' 앞 로고: ⚙︎ 설정 → 타이틀 로고 (없으면 ✝)
function renderBrand() {
  const url = S?.settings?.titleLogo || '', old = $('#brandMark');
  if (!old || (old.dataset.url || '') === url) return;
  const el = url ? Object.assign(document.createElement('img'), { className: 'brand-mark', src: url, alt: '' }) : Object.assign(document.createElement('span'), { className: 'brand-cross', textContent: '✝' });
  el.id = 'brandMark'; el.dataset.url = url;
  old.replaceWith(el);
}

function renderServices() {
  const sel = $('#serviceSel');
  sel.innerHTML = S.services.map(s => `<option value="${s.id}" ${s.id === S.currentServiceId ? 'selected' : ''}>${esc(s.date)} ${esc(s.name)}</option>`).join('') || '<option>예배 순서 없음</option>';
  const svc = service();
  const ol = $('#serviceList');
  ol.innerHTML = '';
  (svc?.itemIds || []).forEach((id, i) => {
    const it = item(id); if (!it) return;
    const li = document.createElement('li');
    li.className = (id === selId ? 'sel ' : '') + (snap?.live.itemId === id ? 'live' : '');
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>${it.noBroadcast ? '<span class="badge tv" title="유튜브 방송에는 나가지 않음">TV만</span>' : ''}
      <span class="acts"><button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button><button class="icon" data-a="rm" title="순서에서 빼기">✕</button></span>`;
    li.onclick = e => {
      const a = e.target.dataset.a;
      if (!a) return select(id);
      e.stopPropagation();
      const ids = [...svc.itemIds];
      if (a === 'rm') {
        if (!KEEP.has(it.type) && !S.services.some(x => x.id !== svc.id && x.itemIds.includes(id)) && !confirm(`'${it.title}'을(를) 순서에서 빼면 지워집니다. 뺄까요?\n(찬양은 자료실에 남습니다)`)) return;
        ids.splice(i, 1);
      }
      if (a === 'up' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      if (a === 'down' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
      saveService(ids);
    };
    ol.appendChild(li);
  });
}

function renderLib() {
  const ul = $('#libList');
  ul.innerHTML = '';
  const q = search.trim().toLowerCase();
  const abc = $('#libSort')?.value === 'abc';
  const list = S.items.filter(i => KEEP.has(i.type)).filter(i => !q || i.title.toLowerCase().includes(q) || i.slides.some(s => (s.text || '').toLowerCase().includes(q)))
    .sort(abc ? (a, b) => a.title.localeCompare(b.title, 'ko') : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const it of list) {
    const li = document.createElement('li');
    li.className = (it.id === selId ? 'sel ' : '') + (snap?.live.itemId === it.id ? 'live' : '');
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>${it.noBroadcast ? '<span class="badge tv" title="유튜브 방송에는 나가지 않음">TV만</span>' : ''}
      <span class="acts"><button class="icon" data-a="add" title="예배 순서에 추가">＋</button><button class="icon" data-a="del" title="삭제">🗑</button></span>`;
    li.onclick = async e => {
      const a = e.target.dataset.a;
      if (!a) return select(it.id);
      e.stopPropagation();
      if (a === 'add') {
        if (!service()) await api('POST', '/api/services', { name: '주일 예배' }).then(s => { S.services.push(s); S.currentServiceId = s.id; });
        const ids = [...service().itemIds], at = ids.indexOf(afterId());
        if (at >= 0) ids.splice(at + 1, 0, it.id); else ids.push(it.id);
        saveService(ids); toast('예배 순서에 넣었습니다');
      }
      if (a === 'del' && confirm(`'${it.title}' 을(를) 삭제할까요?`)) { await api('DELETE', '/api/items/' + it.id); if (selId === it.id) selId = null; }
    };
    ul.appendChild(li);
  }
}

function renderSlides() {
  const it = item(selId);
  $('#itemTitle').textContent = it ? it.title : '자료를 선택하세요';
  $('#editItem').disabled = !it;
  const mv = it?.motionVideo || '';
  $('#itemVid').classList.toggle('hidden', !mv);
  if (mv) $('#itemVid .t').textContent = '🎞 ' + decodeURIComponent(mv.split('/').pop());
  const grid = $('#slides');
  grid.innerHTML = '';
  if (!it) return;
  // 곡 구성 순서대로 (같은 후렴이 여러 번 나오면 여러 칸)
  const list = WC.seq(it), groupOf = new Map();
  let g = '';
  for (const x of it.slides) { if (x.label) g = x.label; groupOf.set(x, g); }
  let prevGroup = null;
  list.forEach((s, i) => {
    const d = document.createElement('div');
    const isLive = snap?.live.itemId === it.id && snap.live.index === i;
    d.className = 'slide' + (isLive ? ' live' : '');
    const grp = groupOf.get(s) || '';
    const tag = grp && (grp !== prevGroup || s.label) ? `<span class="glabel" style="--g:${groupColor(grp)}">${esc(grp)}</span>` : '';
    prevGroup = grp;
    d.innerHTML = `<span class="num">${i + 1}</span>${tag}<div class="wc-screen"></div>`;
    WC.thumb(d.querySelector('.wc-screen'), s, S.style, it);
    d.onclick = () => IS_EDITOR ? openItemEditor(it.id, it.slides.indexOf(s)) : goLive({ itemId: it.id, index: i });
    // 오른쪽 클릭 = 빠른 수정 (오타 등)
    if (!s.elements?.length && !s.html && !s.htmlFile) d.oncontextmenu = e => { e.preventDefault(); quickEdit(it, s); };
    grid.appendChild(d);
  });
  if (!it.slides.length) grid.innerHTML = '<p class="muted">슬라이드가 없습니다. ✎ 편집에서 내용을 넣으세요.</p>';
  renderSecNav();
}
// 곡 구성 네비게이터: 1절·후렴·프리코러스… 단추를 누르면 그 부분 첫 슬라이드로 바로 (슬라이드 그림을 찾지 않아도 됨)
function secMarks(it) {
  const out = [];
  WC.seq(it).forEach((s, i) => { if (s.label) out.push({ label: String(s.label), start: i }); });
  return out;
}
function renderSecNav() {
  const nav = $('#secNav'); if (!nav) return;
  const it = item(selId), marks = it && !IS_EDITOR ? secMarks(it) : [];
  nav.classList.toggle('hidden', !marks.length);
  if (!marks.length) { nav.innerHTML = ''; return; }
  const L = snap?.live, liveHere = L && L.itemId === it.id && !L.clear && !L.black;
  let cur = -1;
  if (liveHere) marks.forEach((m, k) => { if (m.start <= L.index) cur = k; });
  nav.innerHTML = `<span class="muted small">곡 구성</span>` + marks.map((m, k) =>
    `<button class="secbtn${k === cur ? ' on' : ''}" data-start="${m.start}" style="--g:${groupColor(m.label)}">${esc(m.label)}</button>`).join('');
  nav.querySelectorAll('[data-start]').forEach(b => (b.onclick = () => goLive({ itemId: it.id, index: +b.dataset.start })));
}
// 곡 구성 이름마다 색 (1절·2절 파랑 계열, 후렴 주황, 브리지 보라 …)
function groupColor(g) {
  if (/후렴|chorus/i.test(g)) return '#f08c2e';
  if (/브리지|브릿지|bridge/i.test(g)) return '#8b5cf6';
  if (/절|verse/i.test(g)) return '#2f6df6';
  if (/엔딩|ending|outro|태그|tag/i.test(g)) return '#22a06b';
  let h = 0; for (const c of g) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 45%)`;
}
// 빠른 수정: 슬라이드 글자만 바로 고침 (운영 중 오타)
function quickEdit(it, s) {
  const body = openDlg(`
    <div class="dlg-head"><h3>빠른 수정 — ${esc(it.title)}</h3><button class="icon" data-x>✕</button></div>
    <textarea id="qeText" rows="5">${esc(s.text || '')}</textarea>
    <p class="muted small">저장하면 바로 화면에도 바뀝니다. (⌘/Ctrl + Enter 저장)</p>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="qeSave">저장</button></div>`);
  const ta = body.querySelector('#qeText');
  const save = async () => {
    const slides = it.slides.map(x => (x === s ? { ...x, text: ta.value } : x));
    await api('PUT', '/api/items/' + it.id, { slides }); closeDlg(); toast('고쳤습니다');
  };
  body.querySelector('#qeSave').onclick = save;
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}
// 새 자료를 넣을 자리: 예배 순서에서 고른 자료 다음
const afterId = () => (service()?.itemIds.includes(selId) ? selId : null);

function renderLive() {
  if (IS_EDITOR || !snap) return;
  WC.render($('#pvMain'), snap, 'main');
  WC.render($('#pvOverlay'), snap, 'overlay', { preview: true });
  const L = snap.live;
  for (const k of ['black', 'clear', 'logo', 'overlayOff']) $('#' + k).classList.toggle('on', !!L[k]);
  $('#pip').classList.toggle('on', !!L.camOnly);
  $('#tvNoImg').classList.toggle('on', !!L.tvNoImg);
  $('#motionOn').classList.toggle('on', snap.style.main.motionOn !== false);
  $('#szMain').textContent = Math.round(+snap.style.main.size / 6.2 * 100) + '%';
  $('#szOv').textContent = Math.round(+snap.style.overlay.size / 4.6 * 100) + '%';
  $('#szMain').title = `글자 크기 ${snap.style.main.size} (기본 6.2)`; $('#szOv').title = `글자 크기 ${snap.style.overlay.size} (기본 4.6)`;
  markMediaLive(); showOverlayQuick(); renderTools();
  const ovOff = L.overlayOff || snap.item?.noBroadcast;
  $('#ovState').classList.toggle('hidden', !ovOff);
  $('#ovState').textContent = L.overlayOff ? '꺼짐 — 예배당 화면에만 나가는 중' : '이 자료는 방송에 내보내지 않음';
  $('#overlayOff').innerHTML = (L.overlayOff ? '🎥 방송 자막 다시 켜기' : '🎥 방송 자막 끄기') + ' <kbd>O</kbd>';
  $('#liveInfo').textContent = snap.item ? `· ${snap.item.title} ${L.index + 1}/${snap.item.count}` : '· 대기';
  $('#pvNext').textContent = snap.next ? snap.next.text : (snap.item ? '— 마지막 슬라이드 —' : '');
  renderSecNav();
}

function select(id) { selId = id; renderServices(); renderLib(); renderSlides(); }

// ── 송출 ─────────────────────────────────────────
// 다른 운영 창이 자막을 넘기는 중이면 이 창은 쉬게 함 (실수로 두 창에서 넘기는 일 방지)
let inactive = false;
let wsNow = null;
let PC = '랩탑';   // 운영 컴퓨터를 부르는 말 (맥 '랩탑', 윈도우 '노트북') — /api/me 의 pc
let bootSeen = '', restarting = false;   // 업데이트 뒤 다시 켜짐 알아채기
let stopped = false;   // 프로그램을 끈 뒤에는 다시 연결하지 않음 (빈 창이 '열린 운영 창'으로 잡히지 않게)
async function goLive(b) { if (!IS_EDITOR && !inactive) snap = await api('POST', '/api/live', b); }

function showWindowNotice(kind) {
  inactive = true;
  document.getElementById('winNotice')?.remove();
  const d = document.createElement('div');
  d.id = 'winNotice';
  d.className = 'login';
  d.innerHTML = `<div class="card">
    <h2>${kind === 'dup' ? '운영 화면이 이미 열려 있습니다' : '다른 창에서 운영 중입니다'}</h2>
    <p class="muted">자막을 넘기는 운영 화면은 하나만 씁니다. ${kind === 'dup' ? '먼저 열린 창을 쓰시거나, 이 창에서 계속하세요.' : '이 창은 닫으셔도 됩니다.'}</p>
    <button class="btn primary" id="wnTake">이 창에서 계속</button>
    <button class="btn" id="wnClose">이 창 닫기</button>
    <p class="muted small" id="wnHint"></p></div>`;
  document.body.appendChild(d);
  d.querySelector('#wnTake').onclick = () => {
    wsNow?.send(JSON.stringify({ type: 'takeover' }));
    inactive = false; d.remove(); toast('이 창에서 운영합니다');
  };
  d.querySelector('#wnClose').onclick = () => {
    window.close();
    setTimeout(() => (d.querySelector('#wnHint').textContent = '창이 닫히지 않으면 창 왼쪽 위(윈도우는 오른쪽 위) 닫기 단추를 눌러 주세요.'), 300);
  };
}

function connectWS() {
  const ws = new WebSocket('ws://' + location.host + '/ws');
  wsNow = ws;
  ws.onopen = () => {
    // 업데이트로 본체가 다시 켜졌으면 화면도 새 프로그램으로 (다른 운영 창·웹 편집기 포함)
    fetch('/api/boot', { cache: 'no-store' }).then(r => r.json()).then(j => { if (bootSeen && j.boot !== bootSeen && restarting) location.reload(); bootSeen = j.boot; }).catch(() => {});
    if (!IS_EDITOR && !inactive) ws.send(JSON.stringify({ type: 'hello', role: 'control' }));  // "나는 운영 창"
    if (S) reload().catch(() => {});  // 끊겼다 다시 연결되면 놓친 변경 반영
  };
  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.type === 'live') {
      const changedItem = snap?.live.itemId !== m.live.itemId;
      snap = m;
      renderLive();
      if (S) { renderSlides(); if (changedItem) { renderServices(); renderLib(); } }
    }
    if (m.type === 'data') reload().catch(() => {});
    if (m.type === 'focus') { window.focus(); toast('예배송출 운영 화면입니다'); }
    if (m.type === 'obs') { obsInfo = m; document.dispatchEvent(new Event('obsinfo')); }
    if (m.type === 'audioBlocked') toast('🔊 예배당 화면 창이 소리를 막았습니다 — TV 창을 한 번 클릭(또는 F 키)한 뒤 다시 띄우세요');
    if (m.type === 'dup' || m.type === 'replaced') showWindowNotice(m.type);
    if (m.type === 'raiseHint') { toast('독 아이콘으로 이 창을 앞으로 가져오려면: 맥 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → 예배송출 켜기'); clearTimeout($('#toast')._h); $('#toast')._h = setTimeout(() => $('#toast').classList.remove('show'), 9000); }
    if (m.type === 'restart') { restarting = true; toast('새 버전으로 다시 켜는 중…'); }
    if (m.type === 'quit') { stopped = true; ws.close(); closeOpenedWins(); setTimeout(() => window.close(), 800); }
    if (m.type === 'quit') document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출이 종료되었습니다.</div>';
  };
  ws.onclose = () => { if (!stopped) setTimeout(connectWS, 1000); };
}

// ── 예배 순서 ───────────────────────────────────
async function saveService(ids) { await api('PUT', '/api/services/' + S.currentServiceId, { itemIds: ids }); }
// ── 콘티: 예배 순서를 찬양팀과 나누기 (키·빠르기·메모 / 카톡용 복사 / 인쇄) ──
// 가사는 넣지 않음 (저작권) — 곡 제목·키·흐름만
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_IDX = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
function shiftKey(k, d) {   // 'G' → 'Ab', 'F#m' → 'Gm', 모르는 글자는 그대로
  const m = String(k || '').trim().replace(/♯/g, '#').replace(/♭/g, 'b').match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return k;
  const i = KEY_IDX[m[1].toUpperCase() + m[2]];
  return i == null ? k : KEYS[(i + d + 120) % 12] + m[3];
}
function contiRows(s) {
  return (s?.itemIds || []).map(item).filter(Boolean);
}
function contiText(s) {
  const rows = contiRows(s);
  const head = `[${s.date || ''} ${s.name || ''}] 콘티`.replace('[ ', '[');
  const lines = rows.map((it, i) => {
    const meta = [it.key, it.bpm ? it.bpm + 'bpm' : ''].filter(Boolean).join(', ');
    const kind = KEEP.has(it.type) ? '' : `${TYPE[it.type] || ''}: `;
    return `${i + 1}. ${kind}${it.title}${meta ? ` (${meta})` : ''}${it.memo ? `\n   └ ${it.memo}` : ''}`;
  });
  return [head, ...lines, ...(s.note ? ['', '📝 ' + s.note] : [])].join('\n');
}
function printConti(s) {
  const rows = contiRows(s);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>콘티</title><style>
    body{font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;margin:18mm 16mm;color:#111}
    h1{font-size:20pt;margin:0 0 4px}.d{color:#555;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:12pt}th,td{border-bottom:1px solid #ccc;padding:8px 6px;text-align:left;vertical-align:top}
    th{background:#eee}td.n{width:28px;color:#666}td.k{width:70px;font-weight:700}td.b{width:60px}.memo{color:#444;font-size:10.5pt}
    .note{margin-top:14px;padding:10px;border:1px solid #ccc;white-space:pre-wrap}</style></head><body>
    <h1>${esc(s.name || '예배')} 콘티</h1><div class="d">${esc(s.date || '')}</div>
    <table><tr><th></th><th>순서</th><th>키</th><th>BPM</th><th>흐름 메모</th></tr>
    ${rows.map((it, i) => `<tr><td class="n">${i + 1}</td><td>${KEEP.has(it.type) ? '' : `<span class="memo">${esc(TYPE[it.type] || '')}</span> `}${esc(it.title)}</td>
      <td class="k">${esc(it.key || '')}</td><td class="b">${esc(String(it.bpm || ''))}</td><td class="memo">${esc(it.memo || '')}</td></tr>`).join('')}</table>
    ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f);
  f.srcdoc = html;
  f.onload = () => { f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
}
function openConti() {
  const s = service(); if (!s) return toast('예배 순서를 먼저 만드세요');
  const rows = contiRows(s);
  const body = openDlg(`
    <div class="dlg-head"><h3>📋 콘티 — ${esc(s.date || '')} ${esc(s.name || '')}</h3><button class="icon" data-x>✕</button></div>
    <p class="muted small">찬양팀에 미리 보낼 순서표입니다. 가사는 들어가지 않습니다(저작권). 키·빠르기·메모는 곡에 저장되어 다음에도 그대로 나옵니다.</p>
    <table class="conti"><tr><th></th><th>순서</th><th>키</th><th>BPM</th><th>흐름 메모</th></tr>
      ${rows.map((it, i) => `<tr data-id="${esc(it.id)}"><td class="muted">${i + 1}</td><td>${KEEP.has(it.type) ? '' : `<span class="muted small">${esc(TYPE[it.type] || '')}</span> `}${esc(it.title)}</td>
        ${KEEP.has(it.type) ? `<td><input data-f="key" value="${esc(it.key || '')}" maxlength="10" style="width:64px"></td>
        <td><input data-f="bpm" type="number" min="0" max="300" value="${esc(String(it.bpm || ''))}" style="width:64px"></td>
        <td><input data-f="memo" value="${esc(it.memo || '')}" maxlength="200" placeholder="예: 후렴 2번"></td>` : '<td></td><td></td><td></td>'}</tr>`).join('') || '<tr><td colspan="5" class="muted">예배 순서가 비어 있습니다</td></tr>'}
    </table>
    <label class="small" style="display:block;margin-top:10px">인도자 메모</label>
    <textarea id="cNote" rows="2" maxlength="1000" placeholder="예: 3번 곡 끝나고 바로 기도로">${esc(s.note || '')}</textarea>
    <div class="dlg-foot" style="justify-content:space-between">
      <div class="row" style="margin:0"><button class="btn sm" id="cDown" title="모든 곡 키를 반음 내림">전체 키 ♭</button><button class="btn sm" id="cUp" title="모든 곡 키를 반음 올림">전체 키 ♯</button></div>
      <div class="row" style="margin:0"><button class="btn" id="cPrint">🖨 인쇄</button><button class="btn primary" id="cCopy">💬 카톡용 복사</button></div>
    </div>`);
  // 칸을 고치면 곡에 바로 저장
  const save = async (tr, f, v) => {
    const it = item(tr.dataset.id); if (!it) return;
    it[f] = f === 'bpm' ? (+v || 0) : v;
    await api('PUT', '/api/items/' + it.id, { [f]: it[f] }).catch(e => toast(e.message));
  };
  body.querySelectorAll('tr[data-id] input').forEach(inp => inp.onchange = () => save(inp.closest('tr'), inp.dataset.f, inp.value));
  const note = body.querySelector('#cNote');
  note.onchange = () => { s.note = note.value; api('PUT', '/api/services/' + s.id, { note: note.value }).catch(e => toast(e.message)); };
  const shiftAll = async d => {
    for (const inp of body.querySelectorAll('input[data-f=key]')) {
      if (!inp.value.trim()) continue;
      const nv = shiftKey(inp.value, d); if (nv === inp.value) continue;
      inp.value = nv; await save(inp.closest('tr'), 'key', nv);
    }
    toast(d > 0 ? '키를 반음 올렸습니다' : '키를 반음 내렸습니다');
  };
  body.querySelector('#cUp').onclick = () => shiftAll(1);
  body.querySelector('#cDown').onclick = () => shiftAll(-1);
  const sync = () => { s.note = note.value; body.querySelectorAll('tr[data-id] input').forEach(inp => { const it = item(inp.closest('tr').dataset.id); if (it) it[inp.dataset.f] = inp.dataset.f === 'bpm' ? (+inp.value || 0) : inp.value; }); };
  body.querySelector('#cCopy').onclick = async () => {
    sync();
    try { await navigator.clipboard.writeText(contiText(s)); toast('복사했습니다. 카톡에 붙여넣으세요'); }
    catch { prompt('아래 글을 복사하세요', contiText(s)); }
  };
  body.querySelector('#cPrint').onclick = () => { sync(); printConti(s); };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// ── 곡 가져오기: 세라핌·동역 콘티 곡 파일(.json {songs:[{title, lyrics}]}) · 가사 글 파일(.txt) ──
function songsFromJson(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.songs) ? data.songs : data ? [data] : [];
  return list.filter(s => s && typeof s === 'object').map(s => {
    let lyrics = typeof s.lyrics === 'string' ? s.lyrics : typeof s.text === 'string' ? s.text : '';
    const parts = Array.isArray(s.verses) ? s.verses : Array.isArray(s.slides) ? s.slides : null;   // [{label, text}] 모양도 받음
    if (!lyrics && parts) lyrics = parts.map(v => typeof v === 'string' ? v : `${v?.label ? '#' + v.label + '\n' : ''}${v?.text || v?.lyrics || ''}`).join('\n\n');
    return { title: String(s.title || s.name || '').trim(), lyrics: lyrics.trim(), key: typeof s.key === 'string' ? s.key : '' };
  });
}
async function importSongs(files) {
  const songs = [];
  for (const f of files) {
    const t = await f.text();
    if (/\.json$/i.test(f.name) || /^\s*[[{]/.test(t)) {
      try { songs.push(...songsFromJson(JSON.parse(t))); } catch { toast(`${f.name}: 곡 파일 모양이 아닙니다`); }
    } else songs.push({ title: f.name.replace(/\.[^.]+$/, ''), lyrics: t.trim() });
  }
  const have = new Set(S.items.filter(i => KEEP.has(i.type)).map(i => i.title.trim()));
  let added = 0, same = 0, empty = 0;
  for (const s of songs) {
    if (!s.title) continue;
    if (!s.lyrics) { empty++; continue; }
    if (have.has(s.title)) { same++; continue; }
    const slides = await api('POST', '/api/split', { text: s.lyrics, lines: 2 });
    await api('POST', '/api/items', { type: 'song', title: s.title, slides, key: s.key || '' });
    have.add(s.title); added++;
  }
  toast([`찬양 ${added}곡을 자료실에 넣었습니다`, same && `같은 제목 ${same}곡은 건너뜀`, empty && `가사 없는 ${empty}곡은 건너뜀`].filter(Boolean).join(' · '));
}

// 미얀마어 옛 글자 방식(자우기 Zawgyi) 알아보기 — 표준(유니코드) 글꼴에서는 글자가 뒤섞여 보임
// 유니코드에서는 'ေ'(U+1031)가 자음 뒤에 오므로, 낱말 맨 앞이나 받침 기호 앞에 오면 자우기
const looksZawgyi = t => /(^|[\s​(\[“"'])ေ|ေ[ျ-ှ]/m.test(String(t || ''));
function zawgyiCheck(t) {
  if (looksZawgyi(t)) alert('이 미얀마어 글은 옛 방식(자우기, Zawgyi)으로 쓴 것 같습니다.\n화면에서 글자 순서가 뒤섞여 보일 수 있습니다.\n\n휴대폰이나 인터넷의 "Zawgyi → Unicode" 변환기로 유니코드로 바꾼 뒤 다시 붙여넣어 주세요.\n(설명서 11장 참고)');
}

// ── 찬송가: 번호만 치면 바로 예배 순서에 ──
// 가사는 교회가 가진 찬송가 파일에서 (⚙︎ 설정 → 찬송가). 한 번 넣은 찬송가는 자료실에 남아 다음엔 그대로 씀
async function addSongToService(id) {
  if (!service()) await api('POST', '/api/services', { name: '주일 예배' }).then(s => { S.services.push(s); S.currentServiceId = s.id; });
  const ids = [...service().itemIds], at = ids.indexOf(afterId());
  if (at >= 0) ids.splice(at + 1, 0, id); else ids.push(id);
  await saveService(ids);
}
function openHymn() {
  const body = openDlg(`
    <div class="dlg-head"><h3>찬송가 넣기</h3><button class="icon" data-x>✕</button></div>
    <div class="row"><input id="hNum" placeholder="장 번호, 제목, 가사 한 줄 (예: 305, 나 같은 죄인)" style="flex:1;font-size:18px" autofocus>
      <select id="hLines" style="width:auto" title="한 화면에 몇 줄씩 (바꾸면 기억합니다)">${[1, 2, 3, 4].map(n => `<option value="${n}">${n}줄씩</option>`).join('')}</select>
      <button class="btn primary" id="hGo">찾기</button></div>
    <p class="muted small" style="margin:6px 0 0">번호만 치고 Enter면 바로 넣습니다. 처음 쓰는 찬송가는 제목이나 가사로 찾아 넣으면서 장 번호를 적어 두면, 다음부터 번호로 바로 나옵니다.</p>
    <div id="hRes" style="margin-top:10px;max-height:52vh;overflow:auto"></div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  const qIn = body.querySelector('#hNum'), res = body.querySelector('#hRes'), linesSel = body.querySelector('#hLines');
  try { linesSel.value = localStorage.getItem('wc-hymn-lines') || '2'; } catch { linesSel.value = '2'; }
  linesSel.onchange = () => { try { localStorage.setItem('wc-hymn-lines', linesSel.value); } catch {} };
  const LINES = () => +linesSel.value || 2;
  const isNum = q => /^(?:찬송가\s*)?\d{1,3}\s*장?$/.test(q.trim());
  const numOf = q => +q.replace(/\D/g, '');
  // 찬송가를 예배 순서에 (자료실에 같은 제목이 있으면 그 곡을 씀)
  async function addHymn(h) {
    const same = S.items.filter(i => KEEP.has(i.type) && i.title.trim() === h.title);
    // 예배 순서에 이미 들어 있는 것을 먼저 (같은 찬송가가 둘 이상이면)
    const inSvc = new Set(service()?.itemIds || []);
    const have = same.find(i => inSvc.has(i.id)) || same[0];
    if (have) {
      // 지금 고른 줄 수와 다르게 나뉘어 있으면 같은 제목 찬송가를 모두 다시 나눔 (1줄·2줄로 바꿔 쓰기)
      if (h.lyrics) {
        const slides = await api('POST', '/api/split', { text: h.lyrics, lines: LINES() });
        for (const it of same) {
          const most = Math.max(1, ...it.slides.map(s => String(s.text || '').split('\n').length));
          const fresh = slides.map(s => ({ ...s, id: undefined }));
          if (most !== Math.max(...slides.map(s => s.text.split('\n').length))) { const u = await api('PUT', '/api/items/' + it.id, { slides: fresh, arr: h.arr || it.arr || [] }); Object.assign(it, u); }
        }
      }
      await addSongToService(have.id); selId = have.id;
    } else {
      const slides = await api('POST', '/api/split', { text: h.lyrics, lines: LINES() });
      const it = await api('POST', '/api/items', { type: 'song', title: h.title, slides, arr: h.arr || [], place: true, after: afterId() });
      S.items.push(it);   // 곧바로 다시 넣어도 같은 곡이 둘 생기지 않게
      selId = it.id;
    }
    toast(`'${h.title}'을(를) 넣었습니다`);
  }
  const getHymn = n => fetch('/api/hymns/' + n).then(x => x.json().then(j => (x.ok ? j : Promise.reject(j))));
  async function find(direct) {
    const q = qIn.value.trim(); if (!q) return;
    res.innerHTML = '<div class="muted small">찾는 중…</div>';
    // 1) 번호: 내 찬송가(가져온 파일·기억한 곡)에서
    if (isNum(q)) {
      const h = await getHymn(numOf(q)).catch(() => null);
      if (h && direct) { await addHymn(h); qIn.value = ''; res.innerHTML = ''; qIn.focus(); return; }
      if (h) { draw([{ kind: 'mine', ...h, first: h.lyrics.split('\n').find(l => l && !l.startsWith('#')) }], []); return; }
      res.innerHTML = `<div class="notebox small">찬송가 ${numOf(q)}장은 아직 내 찬송가에 없습니다. 제목이나 가사 한 줄로 찾아 넣으면서 장 번호를 적어 두면, 다음부터 번호로 바로 나옵니다.</div>`;
      return;
    }
    // 2) 제목·가사: 내 찬송가 + 인터넷(가사 찾기와 같은 곳)
    const [mine, net] = await Promise.all([
      api('GET', '/api/hymns-search?q=' + encodeURIComponent(q)).catch(() => []),
      fetch('/api/lyrics?q=' + encodeURIComponent(q)).then(x => x.json().then(j => (x.ok ? j : []))).catch(() => []),
    ]);
    draw(mine.map(m => ({ kind: 'mine', ...m })), Array.isArray(net) ? net : []);
  }
  function draw(mine, net) {
    if (!mine.length && !net.length) { res.innerHTML = '<div class="muted small">찾지 못했습니다. 제목을 줄이거나 가사 한 줄을 넣어 보세요.</div>'; return; }
    res.innerHTML =
      mine.map((m, i) => `<div class="lyrow hrow"><div class="grow"><b>${esc(m.title)}</b><br><span class="muted small">${esc(m.first || '')}</span></div>
        <span class="tag">내 찬송가</span><button class="btn sm primary" data-mine="${i}">넣기</button></div>`).join('') +
      net.map((x, i) => `<div class="lyrow hrow"><div class="grow"><b>${esc(x.title)}</b> <span class="muted small">${esc(x.artist || '')} · ${esc(x.src || '')}</span><br>
        <span class="muted small">${esc(x.text.split('\n').filter(Boolean).slice(0, 2).join(' / '))}</span></div>
        <input data-numfor="${i}" type="number" min="1" max="999" placeholder="장" title="찬송가 장 번호 (적으면 다음부터 번호로 바로)" style="width:70px">
        <button class="btn sm primary" data-net="${i}">넣기</button></div>`).join('');
    res.querySelectorAll('[data-mine]').forEach(b => (b.onclick = async () => {
      const m = mine[+b.dataset.mine];
      const h = m.lyrics ? m : await getHymn(m.num);
      await addHymn(h);
    }));
    res.querySelectorAll('[data-net]').forEach(b => (b.onclick = async () => {
      const x = net[+b.dataset.net], n = +res.querySelector(`[data-numfor="${b.dataset.net}"]`).value;
      const lyrics = cleanLyrics(x.text);
      if (n >= 1 && n <= 999) await addHymn(await api('POST', '/api/hymns/learn', { num: n, title: x.title, lyrics }));   // 번호와 함께 기억
      else await addHymn({ title: x.title, lyrics });
      reload().catch(() => {});
    }));
  }
  body.querySelector('#hGo').onclick = () => find(false);
  qIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); find(true); } };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  setTimeout(() => qIn.focus(), 50);
}

// ＋ 교독문: 번호·제목·본문으로 찾아 예배 순서에 (교독문 파일은 ⚙︎ 설정에서 한 번 가져옴)
function openReading() {
  const body = openDlg(`
    <div class="dlg-head"><h3>교독문 넣기</h3><button class="icon" data-x>✕</button></div>
    <div class="row"><input id="rdQ" placeholder="번호, 제목, 본문 한 줄 (예: 13, 시편 23, 목자)" style="flex:1;font-size:18px" autofocus>
      <select id="rdLines" style="width:auto" title="한 화면에 몇 줄씩 (바꾸면 기억합니다)">${[1, 2, 3, 4].map(n => `<option value="${n}">${n}줄씩</option>`).join('')}</select>
      <button class="btn primary" id="rdGo">찾기</button></div>
    <p class="muted small" style="margin:6px 0 0">번호만 치고 Enter면 바로 넣습니다. 2줄씩이면 한 화면에 인도자·회중 한 줄씩, '(다같이)' 부분은 따로 나옵니다.</p>
    <div id="rdRes" style="margin-top:10px;max-height:52vh;overflow:auto">${S.readingCount ? '' : '<div class="notebox small">아직 가져온 교독문이 없습니다. ⚙︎ 설정 → 📖 교독문에서 교회가 가진 교독문 파일(.txt)을 한 번 가져오세요.</div>'}</div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  const qIn = body.querySelector('#rdQ'), res = body.querySelector('#rdRes'), linesSel = body.querySelector('#rdLines');
  try { linesSel.value = localStorage.getItem('wc-read-lines') || '2'; } catch { linesSel.value = '2'; }
  linesSel.onchange = () => { try { localStorage.setItem('wc-read-lines', linesSel.value); } catch {} };
  async function add(n) {
    const r = await api('GET', `/api/readings/${n}?lines=${+linesSel.value || 2}`);
    const it = await api('POST', '/api/items', { type: 'bible', title: `교독문 ${r.num} ${r.title}`, theme: 'word', slides: r.slides, after: afterId() });
    selId = it.id;
    toast(`교독문 ${r.num}번 '${r.title}'을(를) 넣었습니다`);
  }
  async function find(direct) {
    const q = qIn.value.trim(); if (!q) return;
    const list = await api('GET', '/api/readings-search?q=' + encodeURIComponent(q)).catch(() => []);
    if (direct && list.length === 1 && /^(?:교독문\s*)?\d{1,3}\s*번?$/.test(q)) { await add(list[0].num); qIn.value = ''; res.innerHTML = ''; qIn.focus(); return; }
    if (!list.length) { res.innerHTML = `<div class="muted small">${S.readingCount ? '찾지 못했습니다. 번호나 제목(예: 시편 23), 본문 한 줄로 찾아 보세요.' : '아직 가져온 교독문이 없습니다. ⚙︎ 설정 → 📖 교독문에서 파일을 가져오세요.'}</div>`; return; }
    res.innerHTML = list.map((m, i) => `<div class="lyrow hrow"><div class="grow"><b>${m.num}. ${esc(m.title)}</b><br><span class="muted small">${esc(m.first || '')}</span></div>
      <button class="btn sm primary" data-rd="${i}">넣기</button></div>`).join('');
    res.querySelectorAll('[data-rd]').forEach(b => (b.onclick = () => add(list[+b.dataset.rd].num)));
  }
  body.querySelector('#rdGo').onclick = () => find(false);
  qIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); find(true); } };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  setTimeout(() => qIn.focus(), 50);
}

async function newService() {
  const T = await api('GET', '/api/templates');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const body = openDlg(`
    <div class="dlg-head"><h3>새 예배 순서</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>순서 템플릿</label><select id="nsT">${T.services.map(([k, n, tm]) => `<option value="${k}" data-time="${esc(tm || '')}" ${k === 'sunday' ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label>예배 이름</label><input id="nsName" value="주일 예배">
      <label>날짜</label><input id="nsDate" type="date" value="${today}">
      <label>예배 시작</label><input id="nsTime" type="time" value="11:00" style="width:140px" title="타이머 '예배 시작까지'에 씁니다">
    </div>
    <p class="muted small">템플릿을 고르면 '예배 준비 → 예배의 부름 → 찬양 → 기도 → 말씀 → 봉헌 → 광고 → 축도' 같은 순서 제목 화면이 미리 들어갑니다.
    순서 제목을 고른 뒤 ＋ 찬양·＋ 성경을 누르면 그 다음 자리에 들어갑니다. 필요 없는 순서는 ✕로 빼세요.</p>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="nsGo">만들기</button></div>`);
  body.querySelector('#nsT').onchange = e => { const o = e.target.selectedOptions[0]; body.querySelector('#nsName').value = e.target.value ? o.textContent : '새 예배'; if (o.dataset.time) body.querySelector('#nsTime').value = o.dataset.time; };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#nsGo').onclick = async () => {
    const s = await api('POST', '/api/services', { name: body.querySelector('#nsName').value, date: body.querySelector('#nsDate').value, time: body.querySelector('#nsTime').value, template: body.querySelector('#nsT').value });
    S.services.push(s); S.currentServiceId = s.id; selId = null; closeDlg(); toast('예배 순서를 만들었습니다');
  };
}

// ── 대화상자 ─────────────────────────────────────
const dlg = $('#dlg');
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); return $('#dlgBody'); }
function closeDlg() { dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });

// 자료 편집기
// 인터넷에서 복사한 가사 정리: 코드(G D/F# Em…)·[후렴]·작사/작곡·주소 줄 지우기
// 가사 사이 [후렴]·Verse 1 같은 표시 → 곡 구성 이름 (표시가 아니면 null, 이름 없는 표시면 '')
function sectionName(line) {
  const l = line.replace(/^[\[(<]\s*|\s*[\])>:.]\s*$/g, '').trim();
  if (!/^(verse|chorus|bridge|intro|outro|pre-?chorus|tag|ending|후렴|간주|브릿지|브리지|전주|후주|엔딩|코러스|\d+\s*절)(\s*\d+)?\s*(x\s*\d+|×\s*\d+)?$/i.test(l) && !/^(\[.*\]|\(.*\)|<.*>)$/.test(line)) return null;
  const n = (l.match(/\d+/) || [''])[0];
  if (/^\d+\s*절/.test(l)) return n + '절';
  if (/verse/i.test(l)) return (n || '1') + '절';
  if (/pre-?chorus/i.test(l)) return '프리코러스';
  if (/chorus|후렴|코러스/i.test(l)) return '후렴';
  if (/bridge|브릿지|브리지/i.test(l)) return '브리지';
  if (/ending|outro|tag|엔딩|후주/i.test(l)) return '엔딩';
  if (/intro|전주|간주/i.test(l)) return '';
  return '';
}
function cleanLyrics(t) {
  const chord = /^[\s|]*(([A-G][#b♯♭]?(m|maj|min|sus|dim|aug|add|M)?\d*(\/[A-G][#b♯♭]?)?)[\s|\-–~]*)+$/;
  const out = [];
  for (let line of t.replace(/\r/g, '').replace(/\u00a0/g, ' ').split('\n')) {
    line = line.trim();
    if (line && chord.test(line)) continue;
    const mk = sectionName(line);
    if (mk !== null) { out.push(''); if (mk) out.push('#' + mk); continue; }   // [후렴]·Verse 2 → 곡 구성 이름 '#후렴' '#2절'
    if (/https?:\/\/|www\.|^(작사|작곡|편곡|노래|가수|출처|앨범|copyright)|ⓒ|©|^가사\s*$|^\d+\s*$|더보기|접기/i.test(line)) continue;
    out.push(line.replace(/\s{2,}/g, ' '));
  }
  // 바로 이어지는 같은 줄 반복은 그대로 두되, 빈 줄은 하나로
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const HTML_SAMPLES = {
  count: `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:radial-gradient(ellipse at 50% 120%,#1c2a5a,#060a18);color:#fff;
    font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;display:grid;place-items:center;text-align:center}
  h1{font-size:7vh;margin:0 0 2vh}#t{font-size:24vh;font-weight:900;letter-spacing:.04em}p{font-size:4.5vh;opacity:.8;margin:2vh 0 0}
</style>
<div><h1>예배가 곧 시작됩니다</h1><div id="t">05:00</div><p>기도로 예배를 준비해 주십시오</p></div>
<script>
  let s = 5 * 60;   // ← 남은 시간(초)
  const t = document.getElementById('t');
  setInterval(() => { s = Math.max(0, s - 1); t.textContent = String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000);
</script>`,
  verse: `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:linear-gradient(135deg,#f7f1e3,#e9dcc0);color:#3b2f1e;
    font-family:'AppleMyungjo','Batang',serif;display:grid;place-items:center;text-align:center}
  .card{padding:6vh 8vw;border:.4vh solid #b08a4a;border-radius:3vh;max-width:75vw;background:rgba(255,255,255,.55)}
  small{font-size:3.5vh;letter-spacing:.3em;color:#8a6a33}h1{font-size:7vh;line-height:1.5;margin:3vh 0}p{font-size:4vh;margin:0;color:#8a6a33}
</style>
<div class="card"><small>오늘의 말씀</small><h1>여기에 말씀을 넣으세요</h1><p>본문 장:절</p></div>`,
};

function openItemEditor(id, focusIndex, preset) {
  const src = id ? item(id) : null;
  const it = src ? JSON.parse(JSON.stringify(src)) : (preset ? JSON.parse(JSON.stringify(preset)) : { type: 'song', title: '새 찬양', slides: [] });
  const bcVal = it.noBroadcast ? 'none' : it.bcFull ? 'full' : 'caption';
  const body = openDlg(`
    <div class="dlg-head"><h3>${src ? '자료 편집' : '새 자료'}</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>제목</label><input id="eTitle" value="${esc(it.title)}">
      <label>종류</label><div class="row" style="margin:0"><select id="eType" style="width:auto">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === it.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="muted small" id="eKeepNote"></span></div>
      <label>모양 (테마)</label><select id="eTheme">${Object.entries(WC.THEMES).map(([k, t]) => `<option value="${k}" ${k === (it.theme || '') ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <label>유튜브 방송(OBS)</label><select id="eBc">
        <option value="caption" ${bcVal === 'caption' ? 'selected' : ''}>자동 — 글자는 자막 바로, 그림은 화면 그대로</option>
        <option value="full" ${bcVal === 'full' ? 'selected' : ''}>예배당 화면 그대로 보내기 (배경·글꼴까지)</option>
        <option value="none" ${bcVal === 'none' ? 'selected' : ''}>보내지 않기 — 예배당 화면에만 (기도 제목 등)</option></select>
      <label class="song-only">가사 찾기</label><div class="song-only"><div class="row" style="margin:0">
        <input id="eLyQ" style="flex:1;min-width:160px" placeholder="곡 제목 (가수를 함께 쓰면 더 잘 찾습니다)"><button class="btn sm" id="eLyGo">🔎 가사 찾아 넣기</button></div>
      <div id="eLyRes" class="lyres"></div>
      <div class="row wrap" style="margin:4px 0 0"><span class="muted small">못 찾으면</span><button class="btn sm" id="eFindG">구글</button><button class="btn sm" id="eFindN">네이버</button>
        <button class="btn sm" id="eClip" title="인터넷에서 복사한 가사를 붙여넣고, 코드·[후렴] 표시·작사/작곡 줄을 지웁니다">📋 복사한 가사 붙여넣고 정리</button></div></div>
      <label class="no-html">가사·글 붙여넣기</label>
      <div class="no-html"><textarea id="ePaste" rows="5" placeholder="가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다.&#10;묶음 첫 줄에 #1절 · #후렴 · #브리지 처럼 쓰면 곡 구성 이름이 붙습니다."></textarea>
        <div class="row" style="margin-top:6px"><select id="eLines" style="width:auto">${[1, 2, 3, 4, 5, 6].map(n => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="muted">줄씩</span><button class="btn sm" id="eSplit">나누어 슬라이드 만들기 (덮어쓰기)</button><button class="btn sm" id="eAppend">뒤에 추가</button></div></div>
      <label>모든 슬라이드 배경</label><div class="row"><button class="btn sm" id="eBgAll">배경 선택</button><button class="btn sm" id="eBgNone">배경 없애기</button></div>
      <label class="no-html">곡 구성 (부를 순서)</label><div class="no-html">
        <input id="eArr" placeholder="예: 1절 후렴 2절 후렴 브리지 후렴 — 비우면 슬라이드 순서대로" value="${esc((it.arr || []).join(' '))}">
        <div class="row wrap" id="eArrChips" style="margin:6px 0 0"></div>
        <p class="muted small" style="margin:4px 0 0">슬라이드마다 '이름'(1절·후렴…)을 붙이면, 그 슬라이드부터 다음 이름 전까지가 한 묶음입니다. 후렴을 여러 번 불러도 복사할 필요가 없습니다.</p></div>
      <label class="no-html">전체 글로 고치기</label><div class="no-html"><button class="btn sm" id="eReflow">📝 모든 슬라이드를 한 글로 보고 고치기</button></div>
    </div>
    <datalist id="labelList"><option>1절</option><option>2절</option><option>3절</option><option>4절</option><option>후렴</option><option>프리코러스</option><option>브리지</option><option>엔딩</option></datalist>
    <div id="eSlides"></div>
    <div class="row"><button class="btn sm" id="eAdd">＋ 빈 슬라이드</button></div>
    <div class="dlg-foot">${src ? '<button class="btn danger" id="eDel">삭제</button><div class="grow"></div>' : ''}<button class="btn" data-x>취소</button><button class="btn primary" id="eSave">저장</button></div>`);

  const list = body.querySelector('#eSlides');
  function draw() {
    list.innerHTML = '';
    it.slides.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'slide-edit';
      const elEdit = (s.elements || []).map((e, j) => e.type === 'text'
        ? `<div class="el-edit"><span class="muted small">글자 ${j + 1}</span><textarea data-el="${j}" rows="${Math.min(6, (e.text.match(/\n/g) || []).length + 1)}">${esc(e.text)}</textarea></div>`
        : e.type === 'image' ? `<div class="el-edit"><span class="muted small">그림</span><div class="row"><button class="btn sm" data-img="${j}">그림 바꾸기</button><button class="btn sm" data-imgdel="${j}">그림 삭제</button></div></div>`
        : e.type === 'table' ? `<div class="el-edit"><span class="muted small">표</span><textarea data-tbl="${j}" rows="3" title="칸은 | 로, 줄은 줄바꿈으로">${esc(e.rows.map(r => r.join(' | ')).join('\n'))}</textarea></div>` : '').join('');
      const isHtml = !s.htmlFile && (it.type === 'html' || s.html != null);
      row.innerHTML = `<div class="wc-screen" style="border-radius:6px"></div>
        <div>${isHtml ? `<textarea data-html class="mono" rows="7" placeholder="&lt;h1&gt;안녕하세요&lt;/h1&gt; 처럼 HTML 코드를 넣으세요">${esc(s.html || '')}</textarea>
          <div class="row wrap" style="margin-top:6px"><label class="btn sm">HTML 파일 열기<input type="file" data-hfile accept=".html,.htm,text/html" hidden></label>
          <button class="btn sm" data-hsample="count">예시: 예배 시작 카운트다운</button><button class="btn sm" data-hsample="verse">예시: 오늘의 말씀 카드</button></div>`
        : s.elements?.length ? elEdit : `${s.htmlFile ? `<div class="muted small" style="margin-bottom:4px">HTML 파일 ${(+s.page || 0) + 1}번째 장 · 아래 글은 프롬프터(설교자 화면)에만 보입니다</div>` : ''}<textarea data-text rows="4">${esc(s.text)}</textarea>`}
          ${it.type === 'bible' ? `<input data-ref placeholder="구절 표시 (예: 요한복음 3:16)" value="${esc(s.ref || '')}" style="margin-top:6px">` : ''}
          ${isHtml || s.htmlFile || s.elements?.length ? '' : `<div class="row" style="margin:6px 0 0"><input data-label list="labelList" placeholder="이름 (1절·후렴…)" value="${esc(s.label || '')}" style="width:150px;padding:4px 8px;font-size:12px">
            ${/\.(mp4|mov|m4v|webm)$/i.test(s.bg || '') ? `<label class="small" style="display:flex;gap:4px;align-items:center;color:var(--text)"><input type="checkbox" data-sound ${s.sound ? 'checked' : ''}> 🔊 소리 켜고 한 번 재생 (예배당 화면)</label>` : ''}</div>`}
          ${isHtml || s.htmlFile ? '' : `<div class="media-row small">
            <span title="슬라이드 뒤에 깔리는 배경">🖼 배경</span> <span class="mname">${s.bg ? esc(mediaName(s.bg)) : '<span class="muted">없음</span>'}</span>
            <button class="btn sm" data-m="bg">${s.bg ? '바꾸기' : '고르기'}</button>${s.bg ? '<button class="btn sm" data-m="bgdel">빼기</button>' : ''}
            <span class="sep">·</span>
            <span title="배경 위에 따로 얹는 그림 (포스터·사진). 빼도 배경은 그대로">🏞 추가 그림</span> <span class="mname">${s.img ? esc(mediaName(s.img)) : '<span class="muted">없음</span>'}</span>
            <button class="btn sm" data-m="img">${s.img ? '바꾸기' : '넣기'}</button>${s.img ? '<button class="btn sm" data-m="imgdel">빼기</button>' : ''}</div>`}</div>
        <div class="tools">
          <button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button>
          ${s.elements?.length || s.htmlFile ? '' : '<button class="icon" data-a="split" title="커서 위치에서 나누기">✂</button>'}
          <button class="icon" data-a="merge" title="다음 슬라이드와 합치기">⇣</button>
          <button class="icon" data-a="bg" title="배경">🖼</button>
          <button class="icon" data-a="rm" title="삭제">🗑</button></div>`;
      const pv = row.querySelector('.wc-screen');
      const repaint = () => { pv._wcHTML = null; WC.thumb(pv, s, S.style, it); };
      repaint();
      row.querySelector('[data-text]')?.addEventListener('input', e => { s.text = e.target.value; repaint(); });
      let ht; row.querySelector('[data-html]')?.addEventListener('input', e => { s.html = e.target.value; clearTimeout(ht); ht = setTimeout(repaint, 400); });
      row.querySelector('[data-hfile]')?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; s.html = await f.text(); if (!it.title || it.title === '새 HTML') it.title = f.name.replace(/\.html?$/i, ''); draw(); });
      row.querySelectorAll('[data-hsample]').forEach(b => (b.onclick = () => { s.html = HTML_SAMPLES[b.dataset.hsample]; draw(); }));
      row.querySelector('[data-ref]')?.addEventListener('input', e => { s.ref = e.target.value; repaint(); });
      row.querySelector('[data-label]')?.addEventListener('input', e => { const v = e.target.value.trim().slice(0, 20); if (v) s.label = v; else delete s.label; drawChips(); });
      row.querySelector('[data-sound]')?.addEventListener('change', e => { if (e.target.checked) s.sound = true; else delete s.sound; });
      row.querySelectorAll('[data-el]').forEach(t => t.addEventListener('input', e => {
        s.elements[+t.dataset.el].text = e.target.value;
        s.text = s.elements.filter(x => x.type === 'text').map(x => x.text).join('\n');
        repaint();
      }));
      row.querySelectorAll('[data-tbl]').forEach(t => t.addEventListener('input', e => {
        s.elements[+t.dataset.tbl].rows = e.target.value.split('\n').map(l => l.split('|').map(c => c.trim())); repaint();
      }));
      row.querySelectorAll('[data-img]').forEach(b => b.onclick = () => pickMedia(url => { s.elements[+b.dataset.img].src = url; repaint(); }, () => openItemEditorResume()));
      row.querySelectorAll('[data-imgdel]').forEach(b => b.onclick = () => { s.elements.splice(+b.dataset.imgdel, 1); draw(); });
      // 배경과 추가 그림은 따로: 추가 그림을 빼도 배경은 그대로
      row.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
        const m = b.dataset.m;
        if (m === 'bg') return pickMedia(url => { s.bg = url; }, openItemEditorResume);
        if (m === 'img') return pickMedia(url => { s.img = url; }, openItemEditorResume);
        if (m === 'bgdel') delete s.bg;
        if (m === 'imgdel') delete s.img;
        draw();
      });
      row.querySelector('.tools').onclick = e => {
        const a = e.target.dataset.a; if (!a) return;
        const sl = it.slides;
        if (a === 'up' && i > 0) [sl[i - 1], sl[i]] = [sl[i], sl[i - 1]];
        if (a === 'down' && i < sl.length - 1) [sl[i + 1], sl[i]] = [sl[i], sl[i + 1]];
        if (a === 'rm') sl.splice(i, 1);
        if (a === 'split') {
          const ta = row.querySelector('[data-text]'); const p = ta.selectionStart;
          const before = s.text.slice(0, p).replace(/\n+$/, ''), after = s.text.slice(p).replace(/^\n+/, '');
          if (!before || !after) return toast('나눌 위치에 커서를 두세요');
          s.text = before; sl.splice(i + 1, 0, { ...s, id: undefined, text: after });
        }
        if (a === 'merge' && i < sl.length - 1) {
          const n = sl[i + 1];
          if (s.elements?.length || n.elements?.length) s.elements = [...(s.elements || []), ...(n.elements || [])];
          s.text = [s.text, n.text].filter(Boolean).join('\n'); sl.splice(i + 1, 1);
        }
        if (a === 'bg') return pickMedia(url => { s.bg = url; }, openItemEditorResume);
        draw();
      };
      list.appendChild(row);
    });
    if (focusIndex != null) { list.children[focusIndex]?.scrollIntoView({ block: 'center' }); focusIndex = null; }
    if (body.querySelector('#eArrChips')) drawChips();
  }
  // 미디어 고르기 뒤 다시 이 편집기로 돌아오기
  function openItemEditorResume() { dlg.showModal(); $('#dlgBody').replaceChildren(...saved); draw(); }
  let saved;
  const pickMedia = (onPick, back) => { saved = [...$('#dlgBody').childNodes]; openMediaPicker(url => { onPick(url); back(); }, back); };

  body.querySelector('#eTitle').oninput = e => (it.title = e.target.value);
  // 곡 구성: 입력칸 + 이름 단추(누르면 뒤에 붙음)
  const arrIn = body.querySelector('#eArr');
  const readArr = () => (it.arr = arrIn.value.split(/[\s,·→>]+/).map(x => x.trim()).filter(Boolean));
  function drawChips() {
    const names = [...new Set(it.slides.map(x => x.label).filter(Boolean))];
    body.querySelector('#eArrChips').innerHTML = names.length
      ? names.map(n => `<button class="btn sm" data-chip="${esc(n)}" style="border-color:${groupColor(n)};color:${groupColor(n)}">＋ ${esc(n)}</button>`).join('') + '<button class="btn sm" data-chip="">지우기</button>'
      : '<span class="muted small">아래 슬라이드에 이름을 붙이면 여기 단추가 생깁니다.</span>';
    body.querySelectorAll('[data-chip]').forEach(b => (b.onclick = () => {
      arrIn.value = b.dataset.chip ? (arrIn.value.trim() + ' ' + b.dataset.chip).trim() : ''; readArr();
    }));
  }
  arrIn.oninput = readArr;
  // 전체 글로 고치기 (Reflow): 슬라이드 사이 = 빈 줄, 이름은 #후렴 처럼
  body.querySelector('#eReflow').onclick = () => {
    if (it.slides.some(x => x.elements?.length || x.html || x.htmlFile)) return toast('PPT·HTML 슬라이드가 있는 자료는 슬라이드마다 고쳐 주세요');
    const old = it.slides;
    const text = old.map(x => (x.label ? '#' + x.label + '\n' : '') + (x.text || '')).join('\n\n');
    const box = document.createElement('div');
    box.innerHTML = `<textarea rows="16" style="font-size:15px;line-height:1.6">${esc(text)}</textarea>
      <div class="row" style="margin-top:6px"><button class="btn primary sm" data-ok>슬라이드로 다시 나누기</button><button class="btn sm" data-cancel>그만두기</button>
      <span class="muted small">빈 줄 = 슬라이드 나눔 · #후렴 = 이름</span></div>`;
    list.replaceChildren(box);
    box.querySelector('[data-cancel]').onclick = draw;
    box.querySelector('[data-ok]').onclick = () => {
      const blocks = box.querySelector('textarea').value.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
      it.slides = blocks.map((b, i) => {
        let lines = b.split('\n'), label;
        if (/^#\s*\S/.test(lines[0])) { label = lines[0].replace(/^#\s*/, '').slice(0, 20); lines = lines.slice(1); }
        const keep = { ...(old[i] || {}) }; delete keep.id; delete keep.label;   // 배경 등은 같은 자리 슬라이드 것을 유지
        return { ...keep, id: old[i]?.id, text: lines.join('\n'), ...(label ? { label } : {}) };
      });
      draw(); drawChips(); toast(`슬라이드 ${it.slides.length}장으로 나눴습니다`);
    };
  };
  const typeUI = () => {
    body.querySelectorAll('.song-only').forEach(x => x.classList.toggle('hidden', it.type !== 'song'));
    body.querySelectorAll('.no-html').forEach(x => x.classList.toggle('hidden', it.type === 'html'));
    body.querySelector('#eKeepNote').textContent = KEEP.has(it.type) ? '찬양 자료실에 남습니다' : '예배 순서에서 빼면 지워집니다';
  };
  drawChips();
  body.querySelector('#eType').onchange = e => {
    it.type = e.target.value;
    if (it.type === 'html') it.slides.forEach(x => { if (x.html == null) x.html = ''; });
    typeUI(); draw();
  };
  body.querySelector('#eTheme').onchange = e => { it.theme = e.target.value; draw(); };
  body.querySelector('#eBc').onchange = e => { it.noBroadcast = e.target.value === 'none'; it.bcFull = e.target.value === 'full'; };
  const find = site => {
    const q = encodeURIComponent((body.querySelector('#eTitle').value || '') + ' 가사');
    window.open(site === 'n' ? `https://search.naver.com/search.naver?query=${q}` : `https://www.google.com/search?q=${q}`, '_blank');
    toast('가사를 찾아 복사(⌘C / Ctrl+C)한 뒤 📋 버튼을 누르세요');
  };
  // 프로그램 안에서 바로 가사 받기
  const lyQ = body.querySelector('#eLyQ'), lyRes = body.querySelector('#eLyRes');
  const lyFind = async () => {
    const q = lyQ.value.trim();
    if (!q) return toast('곡 제목을 넣으세요');
    lyQ.value = q;
    lyRes.innerHTML = '<div class="muted small">인터넷에서 찾는 중…</div>';
    try {
      const list = await api('GET', '/api/lyrics?q=' + encodeURIComponent(q));
      if (!list.length) { lyRes.innerHTML = '<div class="muted small">가사를 찾지 못했습니다. 제목을 줄이거나 가수 이름을 넣어 보세요. 아래 구글·네이버로 찾아도 됩니다.</div>'; return; }
      lyRes.innerHTML = '<div class="muted small">고르면 아래 가사 칸에 들어갑니다</div>' + list.map((x, i) => {
        const pre = x.text.split('\n').filter(Boolean).slice(0, 2).join(' / ');
        return `<button type="button" class="lyrow" data-ly="${i}"><b>${esc(x.title)}</b> <span class="muted">${esc(x.artist)} · ${esc(x.src)}</span><br><span class="muted small">${esc(pre)}</span></button>`;
      }).join('');
      lyRes.querySelectorAll('[data-ly]').forEach(b => b.onclick = () => {
        const x = list[+b.dataset.ly];
        body.querySelector('#ePaste').value = cleanLyrics(x.text);
        // 제목이 비었거나 '새 찬양'이면 찾은 곡 제목으로 (화면 칸과 저장할 값 둘 다)
        const tt = body.querySelector('#eTitle'); if (!tt.value.trim() || tt.value.trim() === '새 찬양') { tt.value = (x.title || q).trim(); it.title = tt.value; }
        lyRes.querySelectorAll('.lyrow').forEach(y => y.classList.toggle('on', y === b));
        toast('가사를 넣었습니다. 확인 후 [나누어 슬라이드 만들기]를 누르세요');
      });
    } catch (e) { lyRes.innerHTML = `<div class="err small">${esc(e.message)}</div>`; }
  };
  const t0 = body.querySelector('#eTitle').value.trim();
  lyQ.value = t0 === '새 찬양' ? '' : t0;
  body.querySelector('#eTitle').addEventListener('change', e => { if (!lyQ.value.trim()) lyQ.value = e.target.value.trim(); });
  body.querySelector('#eLyGo').onclick = lyFind;
  lyQ.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lyFind(); } };
  body.querySelector('#eFindG').onclick = () => find('g');
  body.querySelector('#eFindN').onclick = () => find('n');
  body.querySelector('#eClip').onclick = async () => {
    const ta = body.querySelector('#ePaste');
    try { const t = await navigator.clipboard.readText(); if (t.trim()) ta.value = t; } catch {}
    if (!ta.value.trim()) return toast('복사한 가사가 없습니다. 가사 칸에 직접 붙여넣은 뒤 다시 누르세요');
    ta.value = cleanLyrics(ta.value);
    toast('정리했습니다. 확인 후 [나누어 슬라이드 만들기]를 누르세요');
  };
  typeUI();
  const doSplit = async append => {
    const slides = await api('POST', '/api/split', { text: body.querySelector('#ePaste').value, lines: body.querySelector('#eLines').value });
    const bg = it.slides[0]?.bg; if (bg) slides.forEach(s => (s.bg = bg));
    it.slides = append ? [...it.slides, ...slides] : slides;
    body.querySelector('#ePaste').value = ''; draw();
    zawgyiCheck(slides.map(s => s.text).join('\n'));
  };
  body.querySelector('#eSplit').onclick = () => doSplit(false);
  body.querySelector('#eAppend').onclick = () => doSplit(true);
  body.querySelector('#eAdd').onclick = () => { it.slides.push(it.type === 'html' ? { text: '', html: '' } : { text: '' }); draw(); };
  body.querySelector('#eBgAll').onclick = () => pickMedia(url => it.slides.forEach(s => (s.bg = url)), openItemEditorResume);
  body.querySelector('#eBgNone').onclick = () => { it.slides.forEach(s => delete s.bg); draw(); };
  body.querySelector('#eDel')?.addEventListener('click', async () => {
    if (!confirm('이 자료를 삭제할까요?')) return;
    await api('DELETE', '/api/items/' + id); selId = null; closeDlg();
  });
  body.querySelector('#eSave').onclick = async () => {
    it.title = body.querySelector('#eTitle').value.trim() || it.title;   // 저장할 때 제목 칸을 다시 읽음 (칸만 바뀌고 값이 안 바뀐 경우까지)
    const saved = src ? await api('PUT', '/api/items/' + id, it) : await api('POST', '/api/items', { ...it, place: true, after: afterId() });
    selId = saved.id; closeDlg(); toast('저장했습니다');
    zawgyiCheck(it.slides.map(s => s.text || '').join('\n'));
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  draw();
}

// 문구·성찬 템플릿
async function openPhrases() {
  const T = await api('GET', '/api/templates');
  const mine = [...(S.phrases || [])];
  const cats = [...T.phrases, ['내 문구', 'title', mine]];
  const body = openDlg(`
    <div class="dlg-head"><h3>문구·성찬 넣기</h3><button class="icon" data-x>✕</button></div>
    <div class="row"><span class="muted" style="white-space:nowrap">모양</span><select id="phTheme" style="width:auto"><option value="*">분류에 맞게 자동</option>
      ${Object.entries(WC.THEMES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select>
      <span class="muted small">누르면 예배 순서에서 고른 자료 다음에 들어갑니다.</span></div>
    <div class="cat">성찬</div>
    <div class="cards"><div class="c" data-comm><div class="wc-screen"></div><div class="n">성찬 예식 (제정의 말씀·떡·잔·기도)</div></div></div>
    ${cats.map(([cat, , list], ci) => `<div class="cat">${esc(cat)}</div><div class="cards">${list.map((t, i) => `<div class="c" data-c="${ci}" data-i="${i}"><div class="wc-screen"></div>
      <div class="row" style="margin:0"><div class="n grow">${esc(t)}</div>${cat === '내 문구' ? `<button class="icon" data-del="${i}" title="내 문구에서 지우기">🗑</button>` : ''}</div></div>`).join('') || '<p class="muted small">아래 \'직접 쓰기\'에서 저장한 문구가 여기에 모입니다.</p>'}</div>`).join('')}
    <div class="cat">직접 쓰기</div>
    <textarea id="phNew" rows="3" placeholder="화면에 띄울 문구 (Enter로 줄바꿈)"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn primary" id="phAdd">이 문구 넣기</button><button class="btn" id="phSave">내 문구로 저장</button></div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  const themeFor = ci => { const v = body.querySelector('#phTheme').value; return v === '*' ? cats[ci]?.[1] ?? 'title' : v; };
  const paint = () => {
    body.querySelectorAll('[data-c]').forEach(c => WC.thumb(c.querySelector('.wc-screen'), { text: cats[c.dataset.c][2][c.dataset.i] }, S.style, { theme: themeFor(+c.dataset.c) }));
    const cm = body.querySelector('[data-comm] .wc-screen'); cm._wcHTML = null;
    WC.thumb(cm, { text: '성찬 예식\n주님의 몸과 피를 기억합니다' }, S.style, { theme: body.querySelector('#phTheme').value === '*' ? 'communion' : body.querySelector('#phTheme').value });
  };
  const add = async (text, theme) => {
    const it = await api('POST', '/api/items', { type: 'text', title: text.split('\n')[0].slice(0, 40), theme, slides: [{ text }], after: afterId() });
    selId = it.id; toast(`'${it.title}'을(를) 넣었습니다`);
  };
  body.querySelector('#phTheme').onchange = paint;
  body.querySelectorAll('[data-c]').forEach(c => (c.onclick = async e => {
    const list = cats[c.dataset.c][2];
    if (e.target.dataset.del != null) { list.splice(+e.target.dataset.del, 1); await api('PUT', '/api/phrases', { phrases: list }); S.phrases = list; return openPhrases(); }
    await add(list[c.dataset.i], themeFor(+c.dataset.c)); closeDlg();
  }));
  body.querySelector('[data-comm]').onclick = async () => {
    const it = await api('POST', '/api/templates/communion', { after: afterId() });
    selId = it.id; closeDlg();
    toast(it.slides.length > 7 ? '성찬 예식을 넣었습니다 (제정의 말씀 포함)' : '성찬 예식을 넣었습니다 — 성경 폴더가 없어 말씀은 직접 넣어 주세요');
  };
  body.querySelector('#phAdd').onclick = async () => { const t = body.querySelector('#phNew').value.trim(); if (!t) return; const v = body.querySelector('#phTheme').value; await add(t, v === '*' ? 'title' : v); closeDlg(); };
  body.querySelector('#phSave').onclick = async () => {
    const t = body.querySelector('#phNew').value.trim(); if (!t) return toast('문구를 먼저 쓰세요');
    mine.push(t); S.phrases = await api('PUT', '/api/phrases', { phrases: mine }); toast('내 문구에 저장했습니다'); openPhrases();
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  paint();
}

// 성경
function openBible() {
  const body = openDlg(`
    <div class="dlg-head"><h3>성경 구절 불러오기</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>구절</label><input id="bQ" placeholder="예: 요 3:16, 시 23:1-6, 롬 8장" autofocus>
      <label>번역본</label><select id="bV">${S.bibleVersions.map(v => `<option ${v === S.bibleDefault ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label>함께 보일 번역본</label><select id="bV2"><option value="">없음</option>${S.bibleVersions.map(v => `<option>${esc(v)}</option>`).join('')}</select>
      <label>슬라이드당 절 수</label><select id="bN"><option>1</option><option>2</option><option>3</option></select>
      <label>번역본 이름</label><label class="ovq-chk" title="구절 아래 '창세기 3:16 (개역개정)'의 (개역개정) 부분 — 끄면 '창세기 3:16'만 나옵니다. 다음에도 기억합니다"><input type="checkbox" id="bShowV" ${S.settings.bibleNoVer ? '' : 'checked'}> 화면에 번역본 이름 보이기 (예: 개역개정)</label>
    </div>
    <p class="muted small">성경 본문은 ⚙︎ 설정 → 성경 폴더 또는 성경 텍스트 가져오기로 연결합니다.</p>
    <div id="bOut" class="verse-list muted">구절을 입력하고 Enter</div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button><button class="btn primary" id="bMake" disabled>슬라이드 만들기</button></div>`);
  let res = null, res2 = null;
  const q = body.querySelector('#bQ');
  const run = async () => {
    const get = v => api('GET', `/api/bible?q=${encodeURIComponent(q.value)}&v=${encodeURIComponent(v)}`);
    const v2 = body.querySelector('#bV2').value;
    res = await get(body.querySelector('#bV').value);
    res2 = v2 && !res.error ? await get(v2) : null;
    const out = body.querySelector('#bOut');
    out.dir = 'auto';
    if (res.error) { out.textContent = res.error; body.querySelector('#bMake').disabled = true; return; }
    const v2map = Object.fromEntries((res2 && !res2.error ? res2.verses : []).map(v => [v.v, v.text]));
    out.textContent = `${res.title} (${res.version}${res2 && !res2.error ? ' + ' + res2.version : ''})\n\n` +
      res.verses.map(v => `${v.v} ${v.text}` + (v2map[v.v] ? `\n   ${v2map[v.v]}` : '')).join('\n');
    if (res2?.error) out.textContent += `\n\n※ ${res2.error}`;
    body.querySelector('#bMake').disabled = false;
  };
  q.onkeydown = e => { if (e.key === 'Enter') run(); };
  q.onchange = run;
  body.querySelector('#bV').onchange = run;
  body.querySelector('#bV2').onchange = run;
  body.querySelector('#bMake').onclick = async () => {
    const n = +body.querySelector('#bN').value, slides = [], showV = body.querySelector('#bShowV').checked;
    if (S.settings.bibleNoVer !== !showV) { S.settings.bibleNoVer = !showV; api('PUT', '/api/settings', { bibleNoVer: !showV }).catch(() => {}); }
    for (let i = 0; i < res.verses.length; i += n) {
      const g = res.verses.slice(i, i + n);
      const r = g.length > 1 ? `${g[0].v}-${g[g.length - 1].v}` : g[0].v;
      const v2map = Object.fromEntries((res2 && !res2.error ? res2.verses : []).map(v => [v.v, v.text]));
      const line = (v, t) => (n > 1 ? `${v.v} ` : '') + t;
      let text = g.map(v => line(v, v.text)).join('\n');
      const t2 = g.filter(v => v2map[v.v]).map(v => line(v, v2map[v.v])).join('\n');
      if (t2) text += '\n\n' + t2;
      slides.push({ text, ref: `${res.book} ${res.ch}:${r}` + (showV ? ` (${res.version}${t2 ? ' · ' + res2.version : ''})` : '') });
    }
    const it = await api('POST', '/api/items', { type: 'bible', title: showV ? `${res.title} ${res.version}` : res.title, theme: 'word', slides, after: afterId() });
    selId = it.id; closeDlg(); toast('말씀 슬라이드를 만들고 예배 순서에 넣었습니다');
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  setTimeout(() => q.focus(), 50);
}

// PDF·악보: 브라우저에서 PDF 페이지/사진을 이미지로 만들어 슬라이드로
let pdfjsLib = null;
async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}
const canvasBlob = c => new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
async function loadImageCanvas(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0); return c;
}
// 한 페이지를 위→아래 n칸으로 자르기 (겹침 4%로 줄 끊김 방지)
function sliceCanvas(c, n) {
  if (n <= 1) return [c];
  const out = [], h = c.height / n, ov = n > 1 ? c.height * 0.04 : 0;
  for (let i = 0; i < n; i++) {
    const y0 = Math.max(0, i * h - ov), y1 = Math.min(c.height, (i + 1) * h + ov);
    const p = document.createElement('canvas'); p.width = c.width; p.height = y1 - y0;
    p.getContext('2d').drawImage(c, 0, y0, c.width, y1 - y0, 0, 0, c.width, y1 - y0);
    out.push(p);
  }
  return out;
}
// 흰 여백 자동 잘라내기
function trimCanvas(c) {
  const ctx = c.getContext('2d'), { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let top = h, bottom = 0, left = w, right = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4;
    if (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225) { if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x; }
  }
  if (bottom <= top || right <= left) return c;
  const pad = Math.round(Math.min(w, h) * 0.02);
  top = Math.max(0, top - pad); left = Math.max(0, left - pad); bottom = Math.min(h, bottom + pad); right = Math.min(w, right + pad);
  const o = document.createElement('canvas'); o.width = right - left; o.height = bottom - top;
  o.getContext('2d').drawImage(c, left, top, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

function openScore() {
  const body = openDlg(`
    <div class="dlg-head"><h3>PDF·악보 가져오기</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>파일</label><input type="file" id="scFiles" multiple accept="application/pdf,image/*">
      <label>제목</label><input id="scTitle" placeholder="비우면 파일 이름">
      <label>한 페이지 나누기</label><select id="scSplit"><option value="1">나누지 않음 (PDF 문서·주보)</option><option value="2" selected>위·아래 2칸 (악보 권장)</option><option value="3">3칸</option><option value="4">4칸</option></select>
      <label>흰 여백 잘라내기</label><input type="checkbox" id="scTrim" checked>
      <label>배경색</label><div class="row"><select id="scBg" style="width:auto"><option value="#ffffff">흰색 (악보)</option><option value="#000000">검정</option></select></div>
    </div>
    <p class="muted small">PDF는 페이지마다, 사진(jpg·png)은 장마다 슬라이드가 됩니다. 악보는 화면 비율(16:9)에 맞게 위·아래로 나누면 TV에서 훨씬 크게 보입니다.
    악보·그림 슬라이드는 유튜브(OBS)에도 화면 그대로 나갑니다. 예배당에만 보내려면 ✎ 편집 → 유튜브 방송 → '보내지 않기'.</p>
    <div id="scProg" class="muted"></div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="scGo">가져오기</button></div>`);
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#scGo').onclick = async () => {
    const files = [...body.querySelector('#scFiles').files];
    if (!files.length) return toast('파일을 고르세요');
    const n = +body.querySelector('#scSplit').value, trim = body.querySelector('#scTrim').checked, bgColor = body.querySelector('#scBg').value;
    const prog = body.querySelector('#scProg'), go = body.querySelector('#scGo'); go.disabled = true;
    const pages = []; // { canvas, name }
    try {
      for (const f of files) {
        const base = f.name.replace(/\.[^.]+$/, '');
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const lib = await loadPdfjs();
          const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let p = 1; p <= pdf.numPages; p++) {
            prog.textContent = `${f.name}: ${p}/${pdf.numPages} 페이지 변환 중…`;
            const page = await pdf.getPage(p);
            const v1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(4, 2400 / Math.max(v1.width, v1.height)) }); // 긴 변 약 2400px
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            pages.push({ canvas: c, name: `${base}_p${p}` });
          }
        } else pages.push({ canvas: await loadImageCanvas(f), name: base });
      }
      const slides = [];
      let k = 0;
      for (const pg of pages) {
        const parts = sliceCanvas(trim ? trimCanvas(pg.canvas) : pg.canvas, n).map(c => trim ? trimCanvas(c) : c);
        const fd = new FormData();
        for (let i = 0; i < parts.length; i++) fd.append('files', await canvasBlob(parts[i]), `${pg.name}${parts.length > 1 ? '_' + (i + 1) : ''}.jpg`);
        prog.textContent = `올리는 중… ${++k}/${pages.length}`;
        const up = await api('POST', '/api/media', fd);
        up.forEach(u => slides.push({ text: '', bg: u.url, fit: 'contain', bgColor }));
      }
      const title = body.querySelector('#scTitle').value || files[0].name.replace(/\.[^.]+$/, '');
      const it = await api('POST', '/api/items', { type: 'score', title, slides, place: true, after: afterId() });
      selId = it.id; closeDlg(); toast(`슬라이드 ${slides.length}장을 만들었습니다`);
    } catch (e) { console.error(e); prog.textContent = '가져오기 실패: ' + e.message; go.disabled = false; }
  };
}

// 미디어
async function openMediaPicker(onPick, onCancel) {
  const files = await api('GET', '/api/media');
  const body = openDlg(`
    <div class="dlg-head"><h3>${onPick ? '배경·그림 선택' : '미디어 관리'}</h3><button class="icon" data-x>✕</button></div>
    <div class="row"><label class="btn primary">＋ 사진·영상 올리기<input type="file" id="mUp" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,video/*,audio/*" hidden></label>
      <span class="muted small">jpg·png·mp4·mov·webm 등. 영상 배경은 소리 없이 반복 재생됩니다.</span></div>
    <div class="media-grid">${files.map(f => `<div class="m" data-url="${esc(f.url)}">
      ${/\.(mp4|mov|m4v|webm)$/i.test(f.url) ? `<video src="${esc(f.url)}" muted preload="metadata"></video>` : /\.(mp3|m4a|wav|aac)$/i.test(f.url) ? '<div style="aspect-ratio:16/9;display:grid;place-items:center;font-size:28px">🎵</div>' : `<img src="${esc(f.url)}" loading="lazy">`}
      <div class="n">${esc(f.name)}</div>${onPick ? '' : `<button class="icon" data-del="${esc(f.name)}" title="삭제">🗑</button>`}</div>`).join('') || '<p class="muted">아직 올린 파일이 없습니다.</p>'}</div>
    <div class="dlg-foot"><button class="btn" data-x>${onPick ? '취소' : '닫기'}</button></div>`);
  body.querySelector('#mUp').onchange = async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('files', f));
    toast('올리는 중…'); await api('POST', '/api/media', fd); loadMediaBin().catch(() => {}); openMediaPicker(onPick, onCancel);
  };
  body.querySelectorAll('.m').forEach(m => m.onclick = async e => {
    if (e.target.dataset.del) { if (await deleteMedia(m.dataset.url, e.target.dataset.del)) openMediaPicker(onPick, onCancel); return; }
    if (onPick) onPick(m.dataset.url);
  });
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => onCancel ? onCancel() : closeDlg()));
}

// 스타일
function openStyle(pre) {
  const st = pre || JSON.parse(JSON.stringify(S.style));
  const fonts = WC.FONTS.some(([v]) => v === st.main.font) ? WC.FONTS : [...WC.FONTS, [st.main.font, '지금 쓰는 글꼴']];
  const fontSel = (cur, id) => `<select id="${id}">${fonts.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''} style="font-family:${esc(v)}">${n}</option>`).join('')}</select>`;
  const vidName = st.main.motionVideo ? decodeURIComponent(st.main.motionVideo.split('/').pop()) : '고르지 않음';
  const sample = { text: '주님의 은혜가 오늘도\n나의 삶을 덮으시네' };
  const body = openDlg(`
    <div class="dlg-head"><h3>자막 스타일</h3><button class="icon" data-x>✕</button></div>
    <div class="two">
      <div><h4>예배당 화면 (HDMI)</h4><div class="form">
        <label>글꼴</label>${fontSel(st.main.font, 'm_font')}
        <label>글자 크기</label><input type="range" id="m_size" min="3" max="12" step="0.1" value="${esc(st.main.size)}">
        <label>글자 색</label><input type="color" id="m_color" value="${esc(st.main.color)}">
        <label>굵게</label><input type="checkbox" id="m_bold" ${st.main.bold ? 'checked' : ''}>
        <label>그림자</label><input type="checkbox" id="m_shadow" ${st.main.shadow ? 'checked' : ''}>
        <label>테두리 두께</label><input type="range" id="m_strokeWidth" min="0" max="5" step="0.5" value="${esc(st.main.strokeWidth)}">
        <label>테두리 색</label><input type="color" id="m_stroke" value="${esc(st.main.stroke)}">
        <label>가로 정렬</label><select id="m_align">${['left', 'center', 'right'].map(v => `<option value="${v}" ${v === st.main.align ? 'selected' : ''}>${{ left: '왼쪽', center: '가운데', right: '오른쪽' }[v]}</option>`).join('')}</select>
        <label>세로 위치</label><select id="m_valign">${['top', 'middle', 'bottom'].map(v => `<option value="${v}" ${v === st.main.valign ? 'selected' : ''}>${{ top: '위', middle: '가운데', bottom: '아래' }[v]}</option>`).join('')}</select>
        <label>화면 비율</label><select id="m_aspect" title="옛 프로젝터(4:3)면 4:3으로. 방송(OBS)은 늘 16:9">${[['16:9', '16:9 (TV·요즘 프로젝터)'], ['4:3', '4:3 (옛 프로젝터)']].map(([v, t]) => `<option value="${v}" ${(st.main.aspect || '16:9') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label>배경색</label><input type="color" id="m_bg" value="${esc(st.main.bg)}">
        <label>움직이는 배경</label><select id="m_motion">${Object.entries(WC.MOTIONS).map(([k, n]) => `<option value="${k}" ${k === (st.main.motion || 'none') ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <label>배경 동영상</label><div class="row" style="margin:0"><span class="muted small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(vidName)}</span><button class="btn sm" id="mvPick">동영상 고르기</button></div>
        <label>움직이는 배경 켜기</label><input type="checkbox" id="m_motionOn" ${st.main.motionOn !== false ? 'checked' : ''}>
      </div><div id="sPvMain" class="wc-screen pv" style="margin-top:10px"></div>
      <p class="muted small">움직이는 배경은 그림 배경이 없는 글자 슬라이드 뒤에 깔립니다. 자료마다 ✎ 편집 → 모양(테마)으로 따로 정할 수도 있습니다.</p></div>
      <div><h4>방송 자막 (OBS)</h4><div class="form">
        <label>글꼴</label>${fontSel(st.overlay.font, 'o_font')}
        <label>글자 크기</label><input type="range" id="o_size" min="2.5" max="9" step="0.1" value="${esc(st.overlay.size)}">
        <label>글자 색</label><input type="color" id="o_color" value="${esc(st.overlay.color)}">
        <label>굵게</label><input type="checkbox" id="o_bold" ${st.overlay.bold ? 'checked' : ''}>
        <label>자막 바 색</label><input type="color" id="o_box" value="${esc(st.overlay.box)}">
        <label>바 불투명도</label><input type="range" id="o_boxOpacity" min="0" max="1" step="0.05" value="${esc(st.overlay.boxOpacity)}">
        <label>위치</label><select id="o_position"><option value="bottom" ${st.overlay.position === 'bottom' ? 'selected' : ''}>아래</option><option value="top" ${st.overlay.position === 'top' ? 'selected' : ''}>위</option></select>
        <label>곡명·구절 표시</label><input type="checkbox" id="o_showTitle" ${st.overlay.showTitle ? 'checked' : ''}>
        <label>그림 보내기</label><select id="o_imgMode" title="악보·사진·PPT 그림 슬라이드를 방송에 어떻게 보낼지">
          ${[['full', '화면 가득'], ['part', '화면 일부 (카메라 보이게)'], ['circle', '화면 가득 + 사람 원'], ['none', '보내지 않기 (자막만)']].map(([v, t]) => `<option value="${v}" ${(st.overlay.imgMode || 'full') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label>일부 — 크기</label><input type="range" id="o_partSize" min="15" max="70" step="1" value="${esc(st.overlay.partSize ?? 35)}">
        <label>일부 — 위치</label><select id="o_partPos">${Object.entries(PART_POS).map(([v, t]) => `<option value="${v}" ${(st.overlay.partPos || 'tr') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label>원 — 크기</label><input type="range" id="o_circSize" min="12" max="60" step="1" value="${esc(st.overlay.circSize ?? 30)}">
        <label>원 — 위치</label><select id="o_circPos">${Object.entries(PART_POS).map(([v, t]) => `<option value="${v}" ${(st.overlay.circPos || 'br') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div><div id="sPvOv" class="wc-screen pv checker" style="margin-top:10px"></div></div>
    </div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="sSave">적용</button></div>`);
  body.querySelector('#mvPick').onclick = () => openMediaPicker(url => {
    if (!/\.(mp4|mov|m4v|webm)$/i.test(url)) return toast('동영상(mp4·mov·webm)을 골라 주세요');
    st.main.motionVideo = url; st.main.motion = 'video'; openStyle(st);
  }, () => openStyle(st));
  // 슬라이더 옆에 지금 값 표시
  body.querySelectorAll('input[type=range]').forEach(el => {
    const out = document.createElement('span'); out.className = 'muted small'; out.style.cssText = 'min-width:36px;text-align:right';
    const wrap = document.createElement('div'); wrap.className = 'row'; wrap.style.margin = '0';
    el.replaceWith(wrap); wrap.append(el, out);
    const upd = () => (out.textContent = el.id.endsWith('Opacity') ? Math.round(el.value * 100) + '%' : /(part|circ)Size$/.test(el.id) ? el.value + '%' : el.value);
    el.addEventListener('input', upd); upd();
  });
  const paint = () => {
    const fake = { slide: sample, next: null, style: st, live: { black: false, clear: false }, item: { type: 'song', title: '예시 찬양' } };
    WC.render(body.querySelector('#sPvMain'), fake, 'main', { fade: false });
    WC.render(body.querySelector('#sPvOv'), fake, 'overlay', { fade: false });
  };
  body.querySelectorAll('[id^=m_],[id^=o_]').forEach(el => el.addEventListener('input', () => {
    const [grp, key] = [el.id[0] === 'm' ? 'main' : 'overlay', el.id.slice(2)];
    st[grp][key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    paint();
  }));
  body.querySelector('#sSave').onclick = async () => { await api('PUT', '/api/style', st); closeDlg(); toast('스타일을 적용했습니다'); };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  paint();
}

// OBS 안내
function sceneField(id, cur = '') {
  const list = obsInfo?.scenes || [];
  if (!list.length) return `<input id="${id}" value="${esc(cur)}" placeholder="OBS 장면 이름 그대로">`;
  const all = cur && !list.includes(cur) ? [cur, ...list] : list;
  return `<select id="${id}"><option value="">고르세요</option>${all.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
}
document.addEventListener('obsinfo', () => { if (dlg.open && $('#obsPipBox')) openOBS(); });
function openOBS() {
  // 주소: ① 같은 컴퓨터 localhost(바뀌지 않음) ② 컴퓨터 이름(공유기가 바뀌어도 그대로) ③ 숫자(바뀔 수 있음)
  const urls = [
    [`http://localhost:${S.port}/overlay`, '같은 컴퓨터의 OBS — 늘 이 주소 (추천)'],
    ...(S.host ? [[`http://${S.host}:${S.port}/overlay`, '다른 컴퓨터의 OBS — 공유기가 다시 켜져도 그대로']] : []),
    ...S.lan.map(ip => [`http://${ip}:${S.port}/overlay`, '숫자 주소 — 공유기가 다시 켜지면 바뀔 수 있음']),
  ];
  const EN = I18N.lang === 'en';
  openDlg(`
    <div class="dlg-head"><h3>🎥 OBS에 자막 얹기</h3><button class="icon" data-x>✕</button></div>
    ${EN ? `<p>In OBS on the streaming computer (Mac/Windows), add <b>Sources ＋ → Browser</b> and enter the address below. Width <b>1920</b>, height <b>1080</b>.
    Put it <b>above</b> the camera source and only the captions are overlaid, transparently. (No capture card or NDI plugin needed.)</p>`
    : `<p>방송 PC(맥/윈도우)의 OBS에서 <b>소스 ＋ → 브라우저</b>를 추가하고 아래 주소를 넣으세요. 너비 <b>1920</b>, 높이 <b>1080</b>.
    카메라 소스 <b>위에</b> 두면 자막만 투명하게 얹힙니다. (캡처 장비·NDI 플러그인 필요 없음)</p>`}
    ${urls.map(([u, n], i) => `<div class="small ${i ? 'muted' : ''}" style="margin:8px 0 2px">${i ? '' : '⭐ '}<span>${n}</span></div><div class="copy row"><input readonly value="${u}"><button class="btn" data-copy="${u}">복사</button></div>`).join('')}
    <p class="muted small">
    ${EN ? '· The streaming computer and this one must be on the same network. Allow it if the firewall asks.' : `· 방송 PC와 이 ${PC}은 같은 공유기(네트워크)에 있어야 합니다. 방화벽이 묻으면 "허용"을 누르세요.`}<br>
    ${EN ? '· Web editor (weekday prep):' : '· 웹 편집기(주중 준비):'} <code>${S.host || S.lan[0] ? `http://${S.host || S.lan[0]}:${S.port}/editor` : '-'}</code> · PIN <b>${esc(S.settings.pin || '')}</b> ${EN ? '(change in ⚙︎ Settings)' : '(⚙︎ 설정에서 변경)'}</p>
    <h4 id="obsPipBox" style="margin:18px 0 6px">👤 그림·악보·PPT를 보낼 때 오른쪽 아래에 사람 화면 (선택)</h4>
    <div class="notebox">${EN ? 'Status:' : '상태:'} ${!obsInfo ? '<span class="muted">OBS 자막 소스가 아직 연결되지 않았습니다</span>'
      : obsInfo.level >= 4 ? '<span class="ok">OBS 장면 전환 가능</span>' : obsInfo.level >= 0 ? '<span class="warn">OBS 권한이 부족합니다 — 아래 3번을 해 주세요</span>' : '<span class="warn">이 OBS는 장면 전환을 지원하지 않습니다 (OBS 28 이상 필요)</span>'}
      ${EN ? `<ol>
        <li>Keep your current scene (e.g. <b>Worship</b>) as it is, with this caption browser source above the camera.</li>
        <li>Make one more scene (e.g. <b>Worship-Picture</b>). Sources ＋ → Browser → <b>Add Existing Source</b> to add the same caption source,
          then add the camera <b>above</b> it with 'Add Existing Source' and place it small in the lower right.</li>
        <li>Caption browser source properties → set <b>Page permissions</b> to <b>Advanced access to OBS</b>.</li>
        <li>Choose the two scenes below and save. OBS switches to 'Worship-Picture' when a picture goes out and back to 'Worship' for text captions.
          Once saved, it switches automatically when a picture goes out. (The 👤 Camera only (P) button sends only the camera instead of the picture.)</li>
      </ol>` : `<ol>
        <li>지금 쓰는 장면(예: <b>예배</b>)은 그대로 둡니다. 카메라 위에 이 자막 브라우저 소스가 있으면 됩니다.</li>
        <li>장면을 하나 더 만듭니다(예: <b>예배-그림</b>). 소스 ＋ → 브라우저 → <b>기존 소스 추가</b>로 같은 자막 소스를 넣고,
          그 <b>위에</b> 카메라도 '기존 소스 추가'로 넣어 오른쪽 아래에 작게 놓습니다.</li>
        <li>자막 브라우저 소스 속성 → <b>페이지 권한</b>을 <b>고급 접근 권한</b>(장면 변경 가능, 영어: Advanced access to OBS)으로 바꿉니다.</li>
        <li>아래에서 두 장면을 고르고 저장합니다. 그림이 나갈 때는 '예배-그림'으로, 글자 자막으로 돌아오면 '예배'로 OBS가 알아서 바뀝니다.
          장면을 저장해 두면 그림이 나갈 때 저절로 바뀝니다. (운영 화면의 👤 사람 화면(P)은 그림 대신 사람 화면만 보내는 단추입니다)</li>
      </ol>`}
      <p class="small" style="margin:6px 0 0">${EN ? `<b>⭕ Camera circle</b> (Send pictures: 'Full screen + camera circle'): the picture fills the screen with a round hole, and the camera <b>under</b> the caption source shows through it.
        For the face to fill the circle, make one more scene (e.g. <b>Worship-Circle</b>) with the same caption source on top and the camera <b>below</b> it, shrunk so the face sits in the circle, then choose it as 'Camera circle scene' below.`
      : `<b>⭕ 사람 원</b> (그림 보내기: '화면 가득 + 사람 원'): 그림은 화면 가득 나가고 동그란 구멍으로 자막 소스 <b>아래</b>의 카메라가 보입니다.
        얼굴이 원에 꽉 차게 하려면 장면을 하나 더 만들어(예: <b>예배-원</b>) 같은 자막 소스를 맨 위에, 카메라는 그 <b>아래</b>에 두고 얼굴이 원 자리에 오도록 줄여 놓은 뒤 아래 '사람 원 장면'으로 고르세요.`}</p></div>
    <div class="form" style="margin-top:8px">
      <label>평소 장면</label>${sceneField('obsBase', S.settings.obsScenes?.base)}
      <label>사람 화면 장면</label>${sceneField('obsPip', S.settings.obsScenes?.pip)}
      <label>사람 원 장면</label>${sceneField('obsCircle', S.settings.obsScenes?.circle)}
    </div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button><button class="btn primary" id="obsSave">장면 저장</button></div>`);
  $('#dlgBody').querySelector('#obsSave').onclick = async () => {
    await api('PUT', '/api/settings', { obsScenes: { base: $('#obsBase').value.trim(), pip: $('#obsPip').value.trim(), circle: $('#obsCircle').value.trim() } });
    toast('저장했습니다'); closeDlg();
  };
  $('#dlgBody').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('복사했습니다'); });
  $('#dlgBody').querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// 설정
function openSettings() {
  const ls = { ...(S.settings.logoStyle || {}) };
  const POSN = { c: '가운데', tl: '왼쪽 위', tc: '위 가운데', tr: '오른쪽 위', bl: '왼쪽 아래', bc: '아래 가운데', br: '오른쪽 아래' };
  const posSel = (id, cur) => `<select id="${id}">${Object.entries(POSN).map(([k, n]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const body = openDlg(`
    <div class="dlg-head"><h3>설정</h3><button class="icon" data-x>✕</button></div>
    <div class="row" style="margin:0 0 12px"><b class="small">언어 · Language</b>
      <select id="stLang" style="width:auto"><option value="ko" ${I18N.lang !== 'en' ? 'selected' : ''}>한국어</option><option value="en" ${I18N.lang === 'en' ? 'selected' : ''}>English</option></select></div>
    <div class="form">
      <label>웹 편집기 PIN</label><div class="row"><input id="stPin" value="${esc(S.settings.pin || '')}" maxlength="12" placeholder="6~12자리"><button class="btn" id="stPinSave">저장</button></div>
    </div>
    <h4 style="margin:18px 0 8px">로고</h4><div>
        <div class="row">${S.settings.logo ? `<img src="${esc(S.settings.logo)}" style="height:40px;background:#333;border-radius:4px">` : '<span class="muted">없음</span>'}
          <button class="btn" id="stLogo">로고 선택</button>${S.settings.logo ? '<button class="btn" id="stLogoDel">빼기</button>' : ''}</div>
        <div class="row" style="margin-top:8px"><b class="small">타이틀 로고</b> ${S.settings.titleLogo ? `<img src="${esc(S.settings.titleLogo)}" style="height:26px">` : '<span class="muted">✝ (기본)</span>'}
          <button class="btn sm" id="stTitleLogo">고르기</button>${S.settings.titleLogo ? '<button class="btn sm" id="stTitleLogoOff">✝ 로 되돌리기</button>' : ''}
          <span class="muted small">운영 화면 맨 위 '예배송출' 앞에 붙는 작은 로고</span></div>
        ${S.settings.logo ? `<div class="two">
          <div><b class="small">로고 화면 (✝ 로고 버튼 · L 키)</b><div class="form narrow">
            <label>바탕</label><select id="lgSBg" title="'배경 위에 로고만'은 미디어 배경(영상·사진)을 그대로 두고 글자 대신 로고만 띄웁니다">
              <option value="black" ${ls.screenBg !== 'over' ? 'selected' : ''}>검은 바탕</option><option value="over" ${ls.screenBg === 'over' ? 'selected' : ''}>지금 배경 위에 로고만</option></select>
            <label>위치</label>${posSel('lgSPos', ls.screenPos)}
            <label>크기</label><input type="range" id="lgSSize" min="10" max="90" step="1" value="${ls.screenSize}">
          </div><div id="lgPv1" class="wc-screen pv"></div></div>
          <div><b class="small">항상 작게 띄우기 (워터마크)</b><div class="form narrow">
            <label>켜기</label><input type="checkbox" id="lgMark" ${ls.mark ? 'checked' : ''}>
            <label>위치</label>${posSel('lgMPos', ls.markPos)}
            <label>크기</label><input type="range" id="lgMSize" min="3" max="30" step="0.5" value="${ls.markSize}">
            <label>진하기</label><input type="range" id="lgMOp" min="0.1" max="1" step="0.05" value="${ls.markOpacity}">
            <label>유튜브에도</label><input type="checkbox" id="lgMOv" ${ls.markOverlay ? 'checked' : ''}>
          </div><div id="lgPv2" class="wc-screen pv"></div></div>
        </div><div class="row" style="margin-top:8px"><button class="btn primary" id="lgSave">로고 설정 저장</button></div>` : '<p class="muted small">교회 로고 그림을 고르면 위치·크기를 정할 수 있습니다. 로고만 깔끔하게 보이려면 배경이 투명한 png를 쓰세요 (jpg는 네모난 바탕이 함께 보입니다).</p>'}</div>
    <h4 style="margin:18px 0 8px">📱 휴대폰 리모컨</h4>
    <div class="row wrap"><label class="row" style="margin:0;gap:6px"><input type="checkbox" id="stRemote" ${S.settings.remote ? 'checked' : ''}> 휴대폰에서 자막 넘기기 허용</label></div>
    <div class="notebox small" style="margin-top:6px"><b>세팅 방법</b>
      <ol style="margin:6px 0 4px;padding-left:20px">
        <li>위 "휴대폰에서 자막 넘기기 허용"을 체크합니다.</li>
        <li>휴대폰을 이 컴퓨터와 같은 와이파이에 연결합니다. (휴대폰 데이터로는 안 됩니다)</li>
        <li>휴대폰 브라우저(사파리·크롬) 주소창에 아래 주소를 넣습니다.</li>
        <li>PIN을 넣고 들어갑니다. <span class="muted">PIN:</span> <b>${esc(S.settings.pin || '')}</b></li>
        <li>사파리 공유 단추(크롬은 ⋮) → "홈 화면에 추가"를 하면 다음부터 앱처럼 바로 열립니다.</li>
      </ol>
      ${S.lan[0] ? `<div class="muted" style="margin-top:6px">모든 휴대폰</div><div class="copy row"><input readonly value="http://${esc(S.lan[0])}:${S.port}/remote"><button class="btn sm" data-copy="http://${esc(S.lan[0])}:${S.port}/remote">복사</button></div>` : ''}
      ${S.host ? `<div class="muted" style="margin-top:6px">아이폰 — 공유기가 다시 켜져도 그대로</div><div class="copy row"><input readonly value="http://${esc(S.host)}:${S.port}/remote"><button class="btn sm" data-copy="http://${esc(S.host)}:${S.port}/remote">복사</button></div>` : ''}
      <div class="muted" style="margin-top:6px">안 열리면: 같은 와이파이인지, 허용이 켜져 있는지 보세요. 공유기가 다시 켜지면 숫자 주소가 바뀌니 여기서 새 주소를 확인하세요.</div>
    </div>
    <h4 style="margin:18px 0 8px">💾 백업·복원</h4>
    <div class="row wrap"><a class="btn" href="/api/backup" download>자료 전체 백업 받기 (zip)</a>
      <label class="btn">백업 파일로 되살리기<input type="file" id="stRestore" accept=".zip,application/zip" hidden></label></div>
    <p class="muted small">찬양·예배 순서·모양·설정·사진·영상을 파일 하나로 내려받습니다. 컴퓨터를 바꿀 때나 고장에 대비해 가끔 USB에 받아 두세요. 되살리면 지금 자료가 백업 내용으로 바뀝니다(바뀌기 전 자료도 data 폴더에 한 벌 남깁니다).</p>
    <h4 style="margin:18px 0 8px">🎵 찬송가</h4>
    <div class="row wrap"><span>${S.hymnCount ? `가져온 찬송가 ${S.hymnCount}곡` : '<span class="muted">아직 가져온 찬송가가 없습니다</span>'}</span>
      <label class="btn sm">찬송가 가사 파일 가져오기<input type="file" id="stHymn" accept=".txt,.json,text/plain,application/json" hidden></label>
      ${S.hymnCount ? '<button class="btn sm" id="stHymnDel">모두 지우기</button>' : ''}</div>
    <p class="muted small">찬송가 가사는 저작권이 있어 프로그램에 넣지 않았습니다. 교회가 가진 찬송가 가사 파일(.txt)을 한 번 가져오면 ＋ 찬송가에서 번호만 쳐서 바로 넣습니다.</p>
    <p class="muted small">형식: 곡마다 "305장 제목" 줄로 시작하고, 절은 "1." "2.", 후렴은 "후렴" 줄로 나눕니다. UTF-8 또는 EUC-KR.</p>
    <h4 style="margin:18px 0 8px">📖 교독문</h4>
    <div class="row wrap"><span>${S.readingCount ? `가져온 교독문 ${S.readingCount}편` : '<span class="muted">아직 가져온 교독문이 없습니다</span>'}</span>
      <label class="btn sm">교독문 파일 가져오기<input type="file" id="stReading" accept=".txt,.json,text/plain,application/json" hidden></label>
      ${S.readingCount ? '<button class="btn sm" id="stReadingDel">모두 지우기</button>' : ''}</div>
    <p class="muted small">교독문은 성경 본문이라 저작권이 있어 프로그램에 넣지 않았습니다. 교회가 가진 교독문 파일(.txt)을 한 번 가져오면 ＋ 교독문에서 번호·제목으로 바로 넣습니다.</p>
    <p class="muted small">형식: "1. 시편 1편"처럼 번호와 제목 줄로 시작하고, 그 아래 한 줄씩 번갈아 읽을 본문, 다 같이 읽는 부분 앞에는 "(다같이)" 줄. UTF-8 또는 EUC-KR.</p>
    <h4 style="margin:18px 0 8px">성경</h4>
    <div class="form">
      <label>성경 폴더</label><div>
        <div id="stFolders"></div>
        <div class="row"><input id="stFolderNew" placeholder="폴더 경로 (Finder에서 폴더를 이 칸으로 끌어다 놓아도 됩니다)"><button class="btn" id="stFolderAdd">추가</button></div>
        <p class="muted small">하위 폴더마다 번역본 하나: "한글 (개역개정)/43-요한복음(John) - 개역개정.md" 형식, 절은 "**3:16** 본문". 원본 파일은 읽기만 합니다.</p></div>
      <label>기본 번역본</label><div class="muted">${esc(S.bibleDefault || '-')} (개역개정이 있으면 자동 선택)</div>
      <label>성경 텍스트 가져오기</label><div>
        <div class="row"><input id="stBName" placeholder="번역본 이름 (예: 개역한글)"><label class="btn">파일 선택<input type="file" id="stBFile" accept=".txt,.tsv" hidden></label></div>
        <p class="muted small">형식: 한 줄에 한 절. "창1:1 본문…" 또는 "창세기[탭]1[탭]1[탭]본문". UTF-8 또는 EUC-KR.
        현재 번역본: ${S.bibleVersions.map(esc).join(', ')}</p></div>
    </div>
    <div class="row wrap" style="margin-top:16px"><label class="row" style="margin:0;gap:6px"><input type="checkbox" id="stUpd" ${S.settings.updateCheck !== false ? 'checked' : ''}> 새 버전이 나오면 알려 주기</label>
      <a class="btn sm" href="https://raon-easypaster.github.io/worship-caster/" target="_blank" rel="noopener">받는 곳 열기</a></div>
    <p class="muted small" style="margin-top:8px">예배송출 v0.14.2 · 만든 사람: <b>쉬운목사 이광복</b> · 무료로 나눕니다</p>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  const folders = [...(S.settings.bibleFolders || [])];
  const saveFolders = async list => { const r = await api('PUT', '/api/bible/folders', { folders: list }); toast(`번역본 ${r.versions.length}개를 읽었습니다`); await reload(); openSettings(); };
  body.querySelector('#stFolders').innerHTML = folders.map((f, i) => `<div class="row"><code class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f)}">${esc(f)}</code><button class="icon" data-rmf="${i}" title="빼기">✕</button></div>`).join('') || '<p class="muted small">추가된 폴더 없음</p>';
  body.querySelectorAll('[data-rmf]').forEach(b => (b.onclick = () => { folders.splice(+b.dataset.rmf, 1); saveFolders(folders); }));
  const nf = body.querySelector('#stFolderNew');
  nf.addEventListener('dragover', e => e.preventDefault());
  nf.addEventListener('drop', e => { const t = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list'); if (t) { e.preventDefault(); nf.value = decodeURIComponent(t.replace(/^file:\/\//, '')).replace(/\/$/, ''); } });
  body.querySelector('#stFolderAdd').onclick = () => { const v = nf.value.trim().replace(/^['"]|['"]$/g, ''); if (v) saveFolders([...folders, v]); };
  body.querySelector('#stPinSave').onclick = async () => { await api('PUT', '/api/settings', { pin: body.querySelector('#stPin').value }); toast('PIN을 바꿨습니다 (기존 접속은 로그아웃)'); };
  body.querySelector('#stLogo').onclick = () => openMediaPicker(async url => {
    await api('PUT', '/api/settings', { logo: url }); await reload(); openSettings();
    if (/\.jpe?g$/i.test(url)) toast('jpg 로고는 네모난 바탕이 함께 보입니다. 로고만 보이게 하려면 배경이 투명한 png를 고르세요');
  }, openSettings);
  body.querySelector('#stLogoDel')?.addEventListener('click', async () => { await api('PUT', '/api/settings', { logo: '' }); await reload(); openSettings(); });
  body.querySelector('#stRestore').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !confirm(`'${f.name}' 백업으로 되살릴까요?\n지금 찬양·예배 순서·설정이 백업 내용으로 바뀝니다.`)) return;
    const fd = new FormData(); fd.append('file', f);
    toast('되살리는 중…');
    try { const r = await api('POST', '/api/restore', fd); await reload(); closeDlg(); toast(`되살렸습니다 — 자료 ${r.items}개, 예배 순서 ${r.services}개, 파일 ${r.files}개`); }
    catch (err) { toast(err.message); }
  };
  body.querySelector('#stLang').onchange = async e => { await api('PUT', '/api/settings', { lang: e.target.value }); location.reload(); };
  body.querySelector('#stHymn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api('POST', '/api/hymns/upload', fd); toast(`찬송가 ${r.count}곡을 가져왔습니다 (모두 ${r.total}곡)`); await reload(); openSettings(); } catch {}
  };
  body.querySelector('#stReading').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api('POST', '/api/readings/upload', fd); toast(`교독문 ${r.count}편을 가져왔습니다 (모두 ${r.total}편)`); await reload(); openSettings(); } catch {}
  };
  body.querySelector('#stReadingDel')?.addEventListener('click', async () => { if (!confirm('가져온 교독문을 모두 지울까요?\n(예배 순서에 이미 넣은 교독문은 남습니다)')) return; await api('DELETE', '/api/readings'); await reload(); openSettings(); });
  body.querySelector('#stHymnDel')?.addEventListener('click', async () => { if (!confirm('가져온 찬송가 가사를 모두 지울까요?\n(자료실에 이미 넣은 찬송가는 남습니다)')) return; await api('DELETE', '/api/hymns'); await reload(); openSettings(); });
  body.querySelector('#stUpd').onchange = async e => { await api('PUT', '/api/settings', { updateCheck: e.target.checked }); checkUpdate(); };
  body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('복사했습니다'); });
  body.querySelector('#stRemote').onchange = async e => { await api('PUT', '/api/settings', { remote: e.target.checked }); toast(e.target.checked ? '휴대폰 리모컨을 켰습니다' : '휴대폰 리모컨을 껐습니다'); };
  body.querySelector('#stTitleLogo').onclick = () => openMediaPicker(async url => {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(url)) { toast('타이틀 로고는 사진 파일(png·jpg)만 됩니다'); return openSettings(); }
    await api('PUT', '/api/settings', { titleLogo: url }); await reload(); openSettings();
  }, openSettings);
  body.querySelector('#stTitleLogoOff')?.addEventListener('click', async () => { await api('PUT', '/api/settings', { titleLogo: '' }); await reload(); openSettings(); });
  if (S.settings.logo) {
    const paintLogo = () => {
      const logo = { url: S.settings.logo, ...ls };
      const over = ls.screenBg === 'over';
      WC.render(body.querySelector('#lgPv1'), { slide: null, style: S.style, live: { black: !over, logo: true, mediaBg: over ? snap?.live?.mediaBg : null, mediaFit: snap?.live?.mediaFit }, logo }, 'main', { fade: false, still: true });
      WC.render(body.querySelector('#lgPv2'), { slide: { text: '주님의 은혜가 오늘도\n나의 삶을 덮으시네' }, style: S.style, live: {}, logo, item: { type: 'song' } }, 'main', { fade: false, still: true });
    };
    const bindL = (id, key, conv) => body.querySelector('#' + id).addEventListener('input', e => { ls[key] = conv(e.target); paintLogo(); });
    bindL('lgSBg', 'screenBg', t => t.value); bindL('lgSPos', 'screenPos', t => t.value); bindL('lgSSize', 'screenSize', t => +t.value);
    bindL('lgMark', 'mark', t => t.checked); bindL('lgMPos', 'markPos', t => t.value); bindL('lgMSize', 'markSize', t => +t.value);
    bindL('lgMOp', 'markOpacity', t => +t.value); bindL('lgMOv', 'markOverlay', t => t.checked);
    body.querySelector('#lgSave').onclick = async () => { await api('PUT', '/api/settings', { logoStyle: ls }); toast('로고 설정을 저장했습니다'); };
    paintLogo();
  }
  body.querySelector('#stBFile').onchange = async e => {
    const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('name', body.querySelector('#stBName').value || e.target.files[0].name);
    const r = await api('POST', '/api/bible/upload', fd);
    toast(r.ok ? `'${r.name}' ${r.books}권을 읽었습니다` : r.error);
    await reload(); openSettings();
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// ── 아래부터 smdjoo-stack 님 버전(worship-caster-on)의 아이디어를 옮겨 온 기능 ──────────────

// 글자 크기 바로 조절 (빠르게 여러 번 눌러도 한 번만 저장)
const SIZE_RANGE = { main: [3, 12, 0.4], overlay: [2.5, 9, 0.3] };
let sizePending = null, sizeTimer = null;
function bumpSize(grp, dir) {
  if (!snap) return;
  const st = JSON.parse(JSON.stringify(sizePending || snap.style));
  const [lo, hi, step] = SIZE_RANGE[grp];
  st[grp].size = Math.round(Math.min(hi, Math.max(lo, +st[grp].size + dir * step)) * 10) / 10;
  sizePending = st;
  $(grp === 'main' ? '#szMain' : '#szOv').textContent = Math.round(st[grp].size / (grp === 'main' ? 6.2 : 4.6) * 100) + '%';
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(async () => { const send = sizePending; sizePending = null; await api('PUT', '/api/style', { [grp]: { size: send[grp].size } }).catch(() => {}); }, 150);
}

// 방송 자막 카드의 바로 조절 (그림 보내기·화면 일부 크기·위치·자막 위치·바 진하기·곡명)
const PART_POS = { tr: '오른쪽 위', mr: '오른쪽 중간', br: '오른쪽 아래', tl: '왼쪽 위', ml: '왼쪽 중간', bl: '왼쪽 아래' };
const OV_DEF = { imgMode: 'full', partSize: 35, partPos: 'tr', circSize: 30, circPos: 'br', position: 'bottom', boxOpacity: 0.72, showTitle: true };
let ovTimer = null;
function showOverlayQuick() {
  const box = document.querySelector('.ovq'); if (!box || !snap) return;
  const o = snap.style.overlay || {};
  box.querySelectorAll('[data-ov]').forEach(el => {
    if (el === document.activeElement && el.type === 'range') return;
    const v = o[el.dataset.ov] ?? OV_DEF[el.dataset.ov];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  box.querySelectorAll('[data-ovv]').forEach(el => {
    const v = +(o[el.dataset.ovv] ?? OV_DEF[el.dataset.ovv]);
    el.textContent = Math.round(el.dataset.ovv === 'boxOpacity' ? v * 100 : v) + '%';
  });
  box.classList.toggle('no-part', (o.imgMode || 'full') !== 'part');
  box.classList.toggle('no-circ', o.imgMode !== 'circle');
  $('#ovMediaObs').checked = !!snap.live.mediaObs;
}
function initOverlayQuick() {
  document.querySelectorAll('.ovq [data-ov]').forEach(el => el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    snap = { ...snap, style: { ...snap.style, overlay: { ...snap.style.overlay, [el.dataset.ov]: v } } };
    renderLive();
    clearTimeout(ovTimer);
    ovTimer = setTimeout(() => api('PUT', '/api/style', { overlay: { [el.dataset.ov]: v } }).catch(() => {}), 200);
  }));
  $('#ovMediaObs').onchange = e => goLive({ mediaObs: e.target.checked }).catch(() => {});
}

// ── 미디어 칸: 누르면 예배당 화면 배경으로 계속 나옴 ──
const isVid = u => /\.(mp4|mov|m4v|webm)$/i.test(u);
let mbFiles = [], mbFilter = 'all';
const fitMem = () => { try { return JSON.parse(localStorage.getItem('wc-mb-fit') || '{}') || {}; } catch { return {}; } };
async function loadMediaBin() {
  if (IS_EDITOR || !$('#mbGrid')) return;
  mbFiles = (await api('GET', '/api/media')).filter(f => !/\.(mp3|m4a|wav|aac)$/i.test(f.url));
  renderMediaBin();
}
function renderMediaBin() {
  const grid = $('#mbGrid'); if (!grid) return;
  const list = mbFiles.filter(f => mbFilter === 'all' || (mbFilter === 'video') === isVid(f.url));
  grid.innerHTML = list.map(f => `<div class="mb-item" data-url="${esc(f.url)}" draggable="true" title="${esc(f.name)} — 누르면 예배당 화면 배경으로${isVid(f.url) ? ' · 위쪽 슬라이드 칸으로 끌어다 놓으면 이 찬양의 배경 영상으로 저장' : ''}">
      <div class="mb-th">${isVid(f.url) ? `<video src="${esc(f.url)}#t=0.5" muted loop playsinline preload="metadata"></video><span class="mb-dur">영상</span>` : `<img src="${esc(f.url)}" loading="lazy">`}
      <span class="mb-tag">LIVE</span><button class="mb-del" data-del="${esc(f.name)}" title="이 파일 삭제">🗑</button>
      <button class="mb-top" title="화면 위에 띄우기 (배경·슬라이드는 그대로, ⏹ 그림 끄기로 뺌)">⬆ 위에</button></div>
      <div class="mb-name"><span class="t">${esc(f.name)}</span>${isVid(f.url) ? '<span title="반복 재생">🔁</span>' : ''}</div></div>`).join('')
    || '<div class="mbin-empty">사진·영상을 ＋ 올리기로 넣으면 여기에 나옵니다. 누르면 예배당 화면 배경으로 계속 나오고, 슬라이드 글자는 그 위에 얹힙니다.</div>';
  grid.querySelectorAll('.mb-item').forEach(el => {
    const v = el.querySelector('video');
    if (v) {
      v.addEventListener('loadedmetadata', () => {
        const s = Math.round(v.duration || 0);
        el.querySelector('.mb-dur').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      });
      el.addEventListener('mouseenter', () => v.play().catch(() => {}));   // 마우스를 올리면 미리 재생
      el.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0.5; });
    }
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-wc-media', el.dataset.url); e.dataTransfer.effectAllowed = 'copy'; });
    el.querySelector('.mb-del').onclick = e => { e.stopPropagation(); deleteMedia(el.dataset.url, e.currentTarget.dataset.del); };
    el.querySelector('.mb-top').onclick = e => { e.stopPropagation(); goLive({ mediaTop: el.dataset.url }).then(() => toast('화면 위에 띄웠습니다 — ⏹ 그림 끄기로 뺍니다')).catch(() => {}); };
    el.onclick = () => goLive({ mediaBg: el.dataset.url, mediaFit: fitMem()[el.dataset.url] || 'auto' }).then(() => toast('예배당 화면 배경으로 내보냈습니다')).catch(() => {});
  });
  markMediaLive();
}
// 미디어 파일 삭제: 어디서 쓰는지 알려 주고, 지금 배경이면 끄고 지움
async function deleteMedia(url, name) {
  const used = (S?.items || []).filter(it => it.motionVideo === url || (it.slides || []).some(s => s.bg === url || s.img === url || (s.elements || []).some(e => e.src === url)));
  const isLive = snap?.live?.mediaBg === url;
  let msg = `'${name}' 파일을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`;
  if (S?.settings?.logo === url || S?.settings?.titleLogo === url) msg += '\n\n※ 설정에서 로고로 쓰고 있는 파일입니다.';
  if (S?.style?.main?.motionVideo === url) msg += '\n\n※ 움직이는 배경(내 동영상)으로 쓰고 있는 파일입니다.';
  if (isLive) msg += '\n\n※ 지금 예배당 화면 배경으로 나가는 중입니다. 배경을 끄고 삭제합니다.';
  if (used.length) msg += `\n\n※ 이 파일을 쓰는 자료가 ${used.length}개 있습니다 (${used.slice(0, 3).map(i => i.title).join(', ')}${used.length > 3 ? ' 등' : ''}).\n삭제하면 그 슬라이드에서는 그림이 안 나옵니다.`;
  if (!confirm(msg)) return false;
  await api('DELETE', '/api/media/' + encodeURIComponent(name));
  await loadMediaBin().catch(() => {});
  toast('삭제했습니다');
  return true;
}
function markMediaLive() {
  if (!$('#mbGrid') || !snap) return;
  const cur = snap.live.mediaBg || null;
  const top = snap.live.mediaTop || null;
  document.querySelectorAll('#mbGrid .mb-item').forEach(el => { el.classList.toggle('live', el.dataset.url === cur); el.classList.toggle('top', el.dataset.url === top); });
  if ($('#mbTopOff')) { $('#mbTopOff').disabled = !top; $('#mbTopOff').classList.toggle('on', !!top); }
  const lab = $('#mbLive');
  lab.classList.toggle('on', !!cur);
  lab.textContent = cur ? '● 배경: ' + decodeURIComponent(cur.split('/').pop()) : '배경 없음';
  $('#mbOff').disabled = !cur;
  const obs = !!snap.live.mediaObs;
  $('#mbObs').classList.toggle('on', obs);
  $('#mbObs').textContent = obs ? '🎥 방송에도 나가는 중' : '🎥 방송에도';
  $('#mbFit').value = snap.live.mediaFit || 'auto';
}
function initMediaBin() {
  if (IS_EDITOR) return;
  $('#mbFilter').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    mbFilter = b.dataset.f;
    $('#mbFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderMediaBin();
  };
  const size = $('#mbSize'), bin = $('.mbin');
  try { size.value = localStorage.getItem('wc-mb-size') || size.value; if (localStorage.getItem('wc-mb-fold') === '1') bin.classList.add('fold'); } catch {}
  const applySize = () => { bin.style.setProperty('--mb', size.value + 'px'); try { localStorage.setItem('wc-mb-size', size.value); } catch {} };
  size.oninput = applySize; applySize();
  $('#mbFold').onclick = () => { bin.classList.toggle('fold'); try { localStorage.setItem('wc-mb-fold', bin.classList.contains('fold') ? '1' : '0'); } catch {} };
  $('#mbUp').onchange = async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('files', f));
    e.target.value = '';
    toast('올리는 중…'); await api('POST', '/api/media', fd); await loadMediaBin(); toast('올렸습니다');
  };
  $('#mbOff').onclick = () => goLive({ mediaBg: null });
  $('#mbTopOff').onclick = () => goLive({ mediaTop: null });
  $('#mbObs').onclick = () => goLive({ mediaObs: !snap?.live?.mediaObs }).catch(() => {});
  // 맞춤은 파일마다 기억 (로고는 '작게', 영상은 '자동' 처럼) — 이 컴퓨터에 저장
  $('#mbFit').onchange = e => {
    const cur = snap?.live?.mediaBg;
    if (cur) { const m = fitMem(); m[cur] = e.target.value; try { localStorage.setItem('wc-mb-fit', JSON.stringify(m)); } catch {} }
    goLive({ mediaFit: e.target.value }).catch(() => {});
  };
  loadMediaBin().catch(() => {});
}

// ── 예배당 화면·프롬프터를 띄울 모니터 고르기 (크롬·엣지의 '창 관리' 권한) ──
const openedWins = new Set();
const track = w => { if (w) openedWins.add(w); return w; };
function closeOpenedWins() { openedWins.forEach(w => { try { w.close(); } catch {} }); openedWins.clear(); }
async function openOnScreen(url) {
  const name = url === '/output' ? '📺 예배당 화면' : '🎤 프롬프터';
  const plain = () => track(window.open(url, url, 'width=1280,height=720'));
  if (!('getScreenDetails' in window)) return plain();
  let det;
  try { det = await window.getScreenDetails(); } catch {
    toast('창 관리 권한이 없어 기본 창으로 엽니다 (주소창 왼쪽 자물쇠 → 창 관리 허용)');
    return plain();
  }
  const screens = det.screens;
  if (screens.length < 2) return plain();   // 모니터가 하나면 묻지 않음
  const key = 'wc-screen:' + url;
  let last = null; try { last = localStorage.getItem(key); } catch {}
  const id = s => `${s.left},${s.top},${s.width},${s.height}`;
  const minX = Math.min(...screens.map(s => s.left)), minY = Math.min(...screens.map(s => s.top));
  const maxX = Math.max(...screens.map(s => s.left + s.width)), maxY = Math.max(...screens.map(s => s.top + s.height));
  const k = Math.min(440 / (maxX - minX), 160 / (maxY - minY));
  const map = screens.map((s, i) => `<button class="scr-box${id(s) === last ? ' last' : ''}" data-scr="${i}"
      style="left:${(s.left - minX) * k}px;top:${(s.top - minY) * k}px;width:${s.width * k - 4}px;height:${s.height * k - 4}px">${i + 1}</button>`).join('');
  const list = screens.map((s, i) => `<button class="btn scr-btn${id(s) === last ? ' primary' : ''}" data-scr="${i}">
      <b>${i + 1}. ${esc(s.label || '모니터 ' + (i + 1))}</b> <span class="small">${s.width}×${s.height}
      ${s.isPrimary ? '· 주 모니터' : ''}${s === det.currentScreen ? ' · 지금 운영 화면이 있는 곳' : ''}${id(s) === last ? ' · 지난번 선택' : ''}</span></button>`).join('');
  openDlg(`
    <div class="dlg-head"><h3>${name}을 띄울 모니터</h3><button class="icon" data-x>✕</button></div>
    <style>
      .scr-map { position: relative; height: ${Math.ceil((maxY - minY) * k) + 4}px; width: ${Math.ceil((maxX - minX) * k) + 4}px; margin: 6px auto 14px; }
      .scr-box { position: absolute; border: 2px solid #4a5670; background: #1b2232; color: #fff; font: 700 22px sans-serif; border-radius: 6px; cursor: pointer; }
      .scr-box:hover, .scr-box.last { border-color: #6aa8ff; background: #23345a; }
      .scr-btn { display: flex; width: 100%; justify-content: flex-start; gap: 8px; margin: 6px 0; }
    </style>
    <div class="scr-map">${map}</div>${list}
    <p class="muted small">창이 그 모니터에 꽉 차게 열립니다. 전체화면은 새 창에서 <b>F 키</b> 또는 <b>더블클릭</b>.</p>
    <div class="dlg-foot"><button class="btn" id="scrPlain">그냥 창으로 열기</button><button class="btn" data-x>취소</button></div>`);
  const body = $('#dlgBody');
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#scrPlain').onclick = () => { closeDlg(); plain(); };
  body.querySelectorAll('[data-scr]').forEach(b => b.onclick = () => {
    const s = screens[+b.dataset.scr];
    try { localStorage.setItem(key, id(s)); } catch {}
    closeDlg();
    const w = track(window.open(url, url, `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`));
    try { w.moveTo(s.availLeft, s.availTop); w.resizeTo(s.availWidth, s.availHeight); w.focus(); } catch {}
    toast(`${name}을 ${+b.dataset.scr + 1}번 모니터에 열었습니다`);
  });
}

// ── HTML: 직접 만들기 또는 여러 장짜리 HTML 파일(발표 자료) 가져오기 ──
function openHtmlChoice() {
  const body = openDlg(`
    <div class="dlg-head"><h3>＋ HTML</h3><button class="icon" data-x>✕</button></div>
    <div class="cards" style="grid-template-columns:1fr 1fr">
      <label class="c" style="padding:14px"><b>📂 HTML 파일 가져오기</b><div class="muted small" style="margin-top:6px">AI나 다른 프로그램으로 만든 발표 자료(.html). 한 파일에 여러 장이 있으면 장마다 슬라이드가 됩니다.</div>
        <input type="file" id="hfFile" accept=".html,.htm,text/html" multiple hidden></label>
      <div class="c" id="hfCode" style="padding:14px"><b>✏️ 직접 만들기</b><div class="muted small" style="margin-top:6px">HTML 코드를 붙여넣거나 예시(카운트다운·말씀 카드)로 시작합니다.</div></div>
    </div>
    <p class="muted small">HTML 파일 자료는 예배당 화면·프롬프터에만 나가고 유튜브(OBS)에는 나가지 않습니다. (파일 속 프로그램이 OBS를 건드리지 못하게)</p>
    <p id="hfProg" class="muted"></p>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#hfCode').onclick = () => openItemEditor(null, null, { type: 'html', title: '새 HTML', slides: [{ text: '', html: HTML_SAMPLES.count }] });
  body.querySelector('#hfFile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      try {
        body.querySelector('#hfProg').textContent = `'${f.name}' 가져오는 중…`;
        const fd = new FormData(); fd.append('file', f);
        const { url } = await api('POST', '/api/html', fd);
        const info = await countHtmlSlides(url);
        const slides = info.texts.map((text, page) => ({ text, htmlFile: url, page }));
        const it = await api('POST', '/api/items', { type: 'html', title: f.name.replace(/\.html?$/i, ''), slides, after: afterId() });
        selId = it.id;
        toast(`HTML 슬라이드 ${slides.length}장을 가져왔습니다`);
      } catch (err) { toast('HTML 가져오기 실패: ' + (err.message || '')); }
    }
    closeDlg();
  };
}
// HTML 파일 안의 장 수 세기: 숨긴 샌드박스 창에 열어, 파일에 넣은 도우미가 알려 주는 값을 받음
function countHtmlSlides(url) {
  return new Promise(resolve => {
    const f = document.createElement('iframe');
    f.sandbox = 'allow-scripts';
    f.style.cssText = 'position:fixed;left:-30000px;top:0;width:1920px;height:1080px;border:0;visibility:hidden';
    let done = false;
    const finish = r => { if (done) return; done = true; removeEventListener('message', onMsg); f.remove(); resolve(r); };
    const onMsg = e => { if (e.source === f.contentWindow && e.data?.wc === 'count') finish({ n: e.data.n, texts: (e.data.texts || []).map(x => String(x).slice(0, 400)) }); };
    addEventListener('message', onMsg);
    setTimeout(() => finish({ n: 1, texts: [''] }), 10000);
    f.src = url + '#wc=count';
    document.body.append(f);
  });
}

// ── 도구 카드: 타이머 · 무대 메시지 · 이름 자막 · 자동 넘김 (ProPresenter 의 Timers·Stage Messages·Props·Timeline 참고) ──
function renderTools() {
  if ($('#tmSvcTime') && document.activeElement !== $('#tmSvcTime')) $('#tmSvcTime').value = service()?.time || '';
  const box = $('#tools'); if (!box || !snap) return;
  const L = snap.live;
  // 타이머
  $('#tmState').textContent = L.timer ? `${L.timer.label || '타이머'} · ` : '꺼짐';
  $('#tmStop').disabled = !L.timer;
  // 무대 메시지
  $('#msgState').textContent = L.msg ? `보내는 중: ${L.msg}` : '';
  $('#msgClear').disabled = !L.msg;
  // 이름 자막
  const props = S?.props || [];
  $('#propList').innerHTML = props.map(p => `<button class="btn sm toggle ${L.prop === p.id ? 'on' : ''}" data-prop="${p.id}" title="${esc(p.sub || '')}">${esc(p.text)}</button>`).join('')
    || '<span class="muted small">✎ 로 이름 자막을 만드세요</span>';
  $('#propList').querySelectorAll('[data-prop]').forEach(b => (b.onclick = () => goLive({ prop: L.prop === b.dataset.prop ? null : b.dataset.prop })));
  // 자동 넘김
  const a = L.auto;
  $('#autoBtn').classList.toggle('on', !!a);
  $('#autoBtn').textContent = a ? `⏩ 자동 넘김 중 (${a.sec}초)` : '⏩ 자동 넘김 시작';
  if (a) { $('#autoSec').value = String(a.sec); $('#autoLoop').checked = a.loop; }
  const tabs = $('#toolsSum'); tabs.textContent = [L.yt && '▶', L.timer && '⏱', L.msg && '💬', L.prop && '🏷', a && '⏩'].filter(Boolean).join(' ');
  // 유튜브 영상
  const y = L.yt;
  $('#ytCtl').classList.toggle('hidden', !y);
  if (y) {
    $('#ytTitle').textContent = y.title || ('YouTube ' + y.id);
    $('#ytPlay').textContent = y.playing ? '⏸ 일시정지' : '▶ 재생';
    $('#ytPlay').classList.toggle('primary', !y.playing);
    $('#ytTv').checked = !!y.tv; $('#ytObs').checked = !!y.obs; $('#ytStage').checked = !!y.stage; $('#ytSound').value = y.sound || 'tv';
    if (y.title) ytRemember(y.id, y.title);
  }
  tickTools();
}
// 최근에 띄운 유튜브 영상 (이 컴퓨터에만 기억)
function ytRecent() { try { return JSON.parse(localStorage.getItem('wc-yt-recent') || '[]').filter(r => /^[\w-]{11}$/.test(r.id)); } catch { return []; } }
function ytRemember(id, title) {
  const list = ytRecent();
  if (list[0]?.id === id && list[0]?.title === title) return;
  try { localStorage.setItem('wc-yt-recent', JSON.stringify([{ id, title }, ...list.filter(r => r.id !== id)].slice(0, 6))); } catch {}
  drawYtRecent();
}
function drawYtRecent() {
  const box = $('#ytRecent'); if (!box) return;
  const list = ytRecent();
  box.innerHTML = list.length ? '<span class="small muted">최근</span>' + list.map((r, i) => `<button class="btn sm" data-ytr="${i}" title="${esc(r.title)}" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</button>`).join('') : '';
  box.querySelectorAll('[data-ytr]').forEach(b => (b.onclick = () => goLive({ yt: { open: list[+b.dataset.ytr].id } })));
}
const ytNow = () => {
  const y = snap?.live?.yt; if (!y) return 0;
  if (snap.now && !snap._recv) snap._recv = Date.now();
  const now = snap.now + (Date.now() - (snap._recv || Date.now()));
  return Math.max(0, y.pos + (y.playing ? (now - y.at) / 1000 : 0));
};
function tickTools() {
  if (!snap || !$('#tmLeft')) return;
  const y = snap.live.yt;
  if (y) {
    const t = Math.min(ytNow(), y.dur || Infinity), seek = $('#ytSeek');
    $('#ytTime').textContent = WC.fmt(Math.round(t)).replace(/^-/, '') + (y.dur ? ' / ' + WC.fmt(y.dur) : '');
    seek.disabled = !y.dur; seek.max = y.dur || 100;
    if (!seek._drag) seek.value = Math.round(t);
    $('#ytState').textContent = y.ended ? '끝남' : y.playing ? '재생 중' : '일시정지';
  } else $('#ytState').textContent = '';
  const t = snap.live.timer;
  if (!t) { $('#tmLeft').textContent = ''; return; }
  if (snap.now && !snap._recv) snap._recv = Date.now();
  const left = Math.round((t.end - (snap.now + (Date.now() - (snap._recv || Date.now())))) / 1000);
  $('#tmLeft').textContent = WC.fmt(left);
  $('#tmLeft').classList.toggle('over', left < 0);
}
function initTools() {
  if (IS_EDITOR || !$('#tools')) return;
  const timer = () => ({ label: $('#tmLabel').value.trim(), tv: $('#tmTv').value, obs: $('#tmObs').checked });
  // [시작]: 분 칸이 비어 있고 시각을 골라 두었으면 그 시각까지 (시각만 바꾸고 시작을 눌러도 5분이 되지 않게)
  $('#tmGo').onclick = () => {
    const m = +$('#tmMin').value, u = $('#tmUntil').value;
    if (!m && u) return goLive({ timer: { ...timer(), until: u } });
    goLive({ timer: { ...timer(), min: m || 5 } });
  };
  $('#tmMin').oninput = () => { if ($('#tmMin').value) $('#tmUntil').value = ''; };   // 둘 중 마지막에 넣은 것으로
  $('#tmUntil').oninput = () => { if ($('#tmUntil').value) $('#tmMin').value = ''; };
  $('#tmUntilGo').onclick = () => { const v = $('#tmUntil').value; if (!v) return toast('시각을 고르세요'); goLive({ timer: { ...timer(), until: v } }); };
  $('#tmStop').onclick = () => goLive({ timer: null });
  // 예배 시간: 예배 순서마다 저장. 정하거나 ▶를 누르면 '예배 시작까지' 타이머가 바로 시작 (정각에 사라짐)
  const svcTimer = () => {
    const v = $('#tmSvcTime').value; if (!v) return toast('예배 시간을 정하세요');
    // 예배당 화면 표시가 '안 보임'이면: 미디어 배경이 있으면 배경 위에 타이머만(로고처럼), 없으면 화면 가득
    const tv = $('#tmTv').value === 'none' ? (snap?.live?.mediaBg ? 'over' : 'big') : $('#tmTv').value;
    goLive({ timer: { label: '예배 시작까지', tv, obs: $('#tmObs').checked, until: v } }).then(() => toast(`${v} 예배 시작까지 타이머를 시작했습니다`)).catch(() => {});
  };
  $('#tmSvcGo').onclick = svcTimer;
  $('#tmSvcTime').onchange = async () => {
    const s = service(); if (s) { s.time = $('#tmSvcTime').value; await api('PUT', '/api/services/' + s.id, { time: s.time }).catch(() => {}); }
    svcTimer();
  };
  // 표시 방법·유튜브에도를 바꾸면 도는 타이머에 바로 (남은 시간·시각 그대로)
  const retimer = () => { const t = snap?.live?.timer; if (t) goLive({ timer: { ...timer(), label: t.label, ...(t.clock ? { until: new Date(t.end).toTimeString().slice(0, 5) } : { min: Math.max(0, (t.end - Date.now()) / 60000) }) } }); };
  $('#tmTv').onchange = retimer; $('#tmObs').onchange = retimer;
  const send = () => { const v = $('#msgIn').value.trim(); if (!v) return; goLive({ msg: v }); $('#msgIn').value = ''; toast('프롬프터에 메시지를 보냈습니다'); };
  $('#msgSend').onclick = send;
  $('#msgIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('#msgClear').onclick = () => goLive({ msg: '' });
  document.querySelectorAll('[data-msg]').forEach(b => (b.onclick = () => { goLive({ msg: b.dataset.msg }); toast('프롬프터에 메시지를 보냈습니다'); }));
  // 유튜브 영상
  const ytOpen = () => {
    const v = $('#ytUrl').value.trim(); if (!v) return toast('유튜브 주소를 붙여 넣으세요');
    goLive({ yt: { open: v } }).then(() => {
      if (!snap?.live?.yt) return toast('유튜브 주소를 알아보지 못했습니다');
      $('#ytUrl').value = ''; toast('유튜브 영상을 띄웠습니다');
    }).catch(() => {});
  };
  $('#ytOpen').onclick = ytOpen;
  $('#ytUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ytOpen(); } });
  $('#ytPlay').onclick = () => goLive({ yt: { playing: !snap?.live?.yt?.playing } });
  $('#ytBack').onclick = () => goLive({ yt: { step: -10 } });
  $('#ytFwd').onclick = () => goLive({ yt: { step: 10 } });
  $('#ytRestart').onclick = () => goLive({ yt: { seek: 0 } });
  $('#ytStop').onclick = () => goLive({ yt: null });
  const seek = $('#ytSeek');
  seek.oninput = () => { seek._drag = true; };
  seek.onchange = () => { seek._drag = false; goLive({ yt: { seek: +seek.value } }); };
  for (const k of ['tv', 'obs', 'stage']) $('#yt' + k[0].toUpperCase() + k.slice(1)).onchange = e => goLive({ yt: { [k]: e.target.checked } });
  $('#ytSound').onchange = e => goLive({ yt: { sound: e.target.value } });
  drawYtRecent();
  $('#propEdit').onclick = openProps;
  $('#autoBtn').onclick = () => {
    if (snap?.live?.auto) return goLive({ auto: null });
    if (!snap?.live?.itemId) return toast('먼저 자료의 슬라이드를 하나 띄우세요');
    goLive({ auto: { sec: +$('#autoSec').value, loop: $('#autoLoop').checked } });
  };
  setInterval(() => {
    tickTools();
    if (snap) { WC.tick($('#pvMain'), snap, 'main'); WC.tick($('#pvOverlay'), snap, 'overlay'); }
  }, 1000);
}
// 이름 자막 목록 편집
function openProps() {
  const props = JSON.parse(JSON.stringify(S.props || []));
  const body = openDlg(`
    <div class="dlg-head"><h3>🏷 이름 자막</h3><button class="icon" data-x>✕</button></div>
    <p class="muted small">설교자·특송·순서 맡은 분 이름을 화면 아래(또는 위) 띠로 띄웁니다. 운영 화면 도구 카드에서 누르면 켜지고, 다시 누르면 꺼집니다. 슬라이드를 넘겨도 계속 보입니다.</p>
    <div id="pRows"></div>
    <div class="row"><button class="btn sm" id="pAdd">＋ 이름 자막 추가</button></div>
    <div id="pPv" class="wc-screen pv" style="max-width:480px;margin-top:10px"></div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="pSave">저장</button></div>`);
  const rows = body.querySelector('#pRows');
  const paint = p => WC.render(body.querySelector('#pPv'), { slide: { text: '' }, style: S.style, live: {}, prop: p || props[0], item: null }, 'main', { fade: false });
  function draw() {
    rows.innerHTML = props.map((p, i) => `<div class="row wrap" data-i="${i}" style="border-top:1px solid var(--line);padding-top:8px">
      <input data-k="text" placeholder="큰 글 (예: 설교 · 홍길동 목사)" value="${esc(p.text)}" style="flex:2;min-width:200px">
      <input data-k="sub" placeholder="작은 글 (예: 말씀 제목)" value="${esc(p.sub || '')}" style="flex:2;min-width:200px">
      <select data-k="where" style="width:auto"><option value="both" ${p.where === 'both' ? 'selected' : ''}>예배당+유튜브</option><option value="tv" ${p.where === 'tv' ? 'selected' : ''}>예배당만</option><option value="obs" ${p.where === 'obs' ? 'selected' : ''}>유튜브만</option></select>
      <select data-k="pos" style="width:auto"><option value="bottom" ${p.pos !== 'top' ? 'selected' : ''}>아래</option><option value="top" ${p.pos === 'top' ? 'selected' : ''}>위</option></select>
      <button class="icon" data-rm title="지우기">🗑</button></div>`).join('') || '<p class="muted">아직 없습니다.</p>';
    rows.querySelectorAll('[data-i]').forEach(r => {
      const p = props[+r.dataset.i];
      r.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => { p[el.dataset.k] = el.value; paint(p); }));
      r.querySelector('[data-rm]').onclick = () => { props.splice(+r.dataset.i, 1); draw(); };
      r.addEventListener('focusin', () => paint(p));
    });
    paint();
  }
  body.querySelector('#pAdd').onclick = () => { props.push({ text: '', sub: '', where: 'both', pos: 'bottom' }); draw(); rows.lastElementChild?.querySelector('input')?.focus(); };
  body.querySelector('#pSave').onclick = async () => { S.props = await api('PUT', '/api/props', { props }); closeDlg(); toast('저장했습니다'); };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  draw();
}

// ── 칸 너비 조절: 경계를 끌면 바뀌고, 이 컴퓨터에 기억 (두 번 누르면 처음대로) ──
const SPLIT = { l: { v: '--lw', min: 180, max: 560, def: 290 }, r: { v: '--rw', min: 300, max: 900, def: 420 } };
function initSplits() {
  const lay = $('.layout');
  const apply = (k, px) => lay.style.setProperty(SPLIT[k].v, px + 'px');
  for (const k of Object.keys(SPLIT)) { try { const v = +localStorage.getItem('wc-split-' + k); if (v) apply(k, v); } catch {} }
  document.querySelectorAll('[data-split]').forEach(h => {
    const k = h.dataset.split, c = SPLIT[k];
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.body.classList.add('resizing');
      const x0 = e.clientX, w0 = (k === 'l' ? $('.left') : $('.right')).getBoundingClientRect().width;
      let w = w0;
      const move = ev => {
        // 가운데 슬라이드 칸이 너무 좁아지지 않게 (최소 360px)
        const room = lay.clientWidth - 12 - 360 - (k === 'l' ? ($('.right')?.offsetWidth || 0) : $('.left').offsetWidth);
        w = Math.round(Math.max(c.min, Math.min(c.max, room, w0 + (k === 'l' ? 1 : -1) * (ev.clientX - x0))));
        apply(k, w);
      };
      const up = () => {
        h.removeEventListener('pointermove', move); h.classList.remove('drag'); document.body.classList.remove('resizing');
        try { localStorage.setItem('wc-split-' + k, w); } catch {}
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up, { once: true });
      h.addEventListener('pointercancel', up, { once: true });
    });
    h.addEventListener('dblclick', () => { apply(k, c.def); try { localStorage.removeItem('wc-split-' + k); } catch {} toast('처음 너비로 되돌렸습니다'); });
  });
}

// ── 슬라이드와 미디어 배경 사이 높이 조절 (기억, 두 번 누르면 처음대로) ──
function initHSplit() {
  const h = $('[data-hsplit]'), bin = $('.mbin'), center = $('.center');
  if (!h || !bin) return;
  const apply = px => { bin.style.setProperty('--mbh', px + 'px'); bin.classList.add('sized'); };
  try { const v = +localStorage.getItem('wc-split-m'); if (v) apply(v); } catch {}
  h.addEventListener('pointerdown', e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.body.classList.add('vresizing');
    if (bin.classList.contains('fold')) { bin.classList.remove('fold'); try { localStorage.setItem('wc-mb-fold', '0'); } catch {} }
    const y0 = e.clientY, h0 = bin.getBoundingClientRect().height;
    let px = h0;
    const move = ev => {
      // 위쪽 슬라이드 칸은 최소 160px, 미디어 칸은 최소 90px
      const max = center.clientHeight - 160 - h.offsetHeight;
      px = Math.round(Math.max(90, Math.min(max, h0 - (ev.clientY - y0))));
      apply(px);
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.classList.remove('drag'); document.body.classList.remove('vresizing');
      try { localStorage.setItem('wc-split-m', px); } catch {}
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up, { once: true });
    h.addEventListener('pointercancel', up, { once: true });
  });
  h.addEventListener('dblclick', () => {
    bin.classList.remove('sized'); bin.style.removeProperty('--mbh');
    try { localStorage.removeItem('wc-split-m'); } catch {}
    toast('처음 높이로 되돌렸습니다');
  });
}

// ── 프로그램 창 크기·위치 기억: 다음에 켤 때 그 크기로 열림 ──
function initWinMemory() {
  let t;
  const save = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (stopped || document.fullscreenElement) return;
      fetch('/api/window', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ w: outerWidth, h: outerHeight, x: screenX, y: screenY }) }).catch(() => {});
    }, 800);
  };
  addEventListener('resize', save);
  // 창을 옮기기만 할 때는 resize 가 안 생기므로 가끔 위치를 확인
  let last = screenX + ',' + screenY;
  setInterval(() => { const now = screenX + ',' + screenY; if (now !== last) { last = now; save(); } }, 3000);
}

// ── 이벤트 연결 ─────────────────────────────────
function bind() {
  $('#search').oninput = e => { search = e.target.value; renderLib(); };
  try { $('#libSort').value = localStorage.getItem('wc-libSort') || 'recent'; } catch {}
  $('#libSort').onchange = e => { try { localStorage.setItem('wc-libSort', e.target.value); } catch {} renderLib(); };
  $('#serviceSel').onchange = async e => { await api('PUT', '/api/current-service', { id: e.target.value }); };
  $('#svcNew').onclick = newService;
  $('#songImport').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; importSongs(fs); };
  $('#svcConti').onclick = () => openConti();
  $('#svcEdit').onclick = async () => {
    const s = service(); if (!s) return;
    const name = prompt('예배 이름', s.name); if (name == null) return;
    const date = prompt('날짜', s.date) ?? s.date;
    await api('PUT', '/api/services/' + s.id, { name, date });
  };
  $('#svcDel').onclick = async () => { const s = service(); if (s && confirm(`'${s.name}' 순서를 삭제할까요?\n(찬양은 자료실에 남고, 말씀·광고·문구는 함께 지워집니다)`)) await api('DELETE', '/api/services/' + s.id); };
  $('#newSong').onclick = () => openItemEditor(null);
  $('#newNotice').onclick = () => openItemEditor(null, null, { type: 'notice', title: '광고', theme: 'notice', slides: [{ text: '교회 소식\n내용을 적으세요' }] });
  $('#newHtml').onclick = openHtmlChoice;
  $('#newPhrase').onclick = openPhrases;
  $('#newBible').onclick = openBible;
  $('#newHymn').onclick = openHymn;
  $('#newReading').onclick = openReading;
  $('#newScore').onclick = openScore;
  $('#pptFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f); fd.append('after', afterId() || '');
    toast('PPT 가져오는 중…');
    const it = await api('POST', '/api/pptx', fd);
    e.target.value = ''; selId = it.id;
    toast(`슬라이드 ${it.slides.length}장을 가져왔습니다`);
  };
  $('#editItem').onclick = () => selId && openItemEditor(selId);
  // 찬양마다 배경 영상: 아래 자료실의 영상을 슬라이드 칸에 끌어다 놓으면 이 자료에 저장
  const slidesBox = $('#slides');
  const isMediaDrag = e => [...(e.dataTransfer?.types || [])].includes('application/x-wc-media');
  slidesBox.addEventListener('dragover', e => { if (!isMediaDrag(e) || !selId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; slidesBox.classList.add('drop-on'); });
  slidesBox.addEventListener('dragleave', e => { if (!slidesBox.contains(e.relatedTarget)) slidesBox.classList.remove('drop-on'); });
  slidesBox.addEventListener('drop', async e => {
    slidesBox.classList.remove('drop-on');
    const url = e.dataTransfer.getData('application/x-wc-media');
    if (!url) return;
    e.preventDefault();
    const it = item(selId); if (!it) return;
    if (!isVid(url)) { toast('배경으로 저장할 수 있는 것은 영상(mp4·mov·webm)입니다'); return; }
    await api('PUT', '/api/items/' + it.id, { motionVideo: url });
    toast(I18N.lang === 'en' ? `Saved as the background video of '${it.title}' — shown behind its text slides` : `'${it.title}' 배경 영상으로 저장했습니다 — 글자 슬라이드 뒤에 늘 깔립니다`);
  });
  $('#itemVidOff').onclick = async () => {
    const it = item(selId); if (!it) return;
    await api('PUT', '/api/items/' + it.id, { motionVideo: '' });
    toast('이 자료의 배경 영상을 뺐습니다');
  };
  initSplits();
  $('#styleBtn').onclick = () => openStyle();   // 클릭 정보가 '고치던 스타일'로 넘어가지 않게
  $('#mediaBtn').onclick = () => openMediaPicker(null, null);
  if (IS_EDITOR) return;

  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openOnScreen(b.dataset.open));
  $('#obsBtn').onclick = openOBS;
  $('#settingsBtn').onclick = openSettings;
  $('#quitBtn').onclick = async () => {
    if (!confirm('예배송출 프로그램을 끌까요?\n(예배당 화면·프롬프터 창도 함께 닫히고, OBS 자막도 꺼집니다)')) return;
    stopped = true;
    await api('POST', '/api/quit');   // 서버가 모든 화면에 '종료'를 알림 → 예배당 화면·프롬프터 창이 스스로 닫힘
    closeOpenedWins();
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출을 종료했습니다. 이 창은 닫으셔도 됩니다.</div>';
    setTimeout(() => window.close(), 800);
  };
  $('#prev').onclick = () => goLive({ step: -1 });
  $('#next').onclick = () => goLive({ step: 1 });
  $('#black').onclick = () => goLive({ black: !snap.live.black });
  $('#clear').onclick = () => goLive({ clear: !snap.live.clear });
  $('#logo').onclick = () => goLive({ logo: !snap.live.logo });
  $('#reset').onclick = () => goLive({ reset: true });
  $('#overlayOff').onclick = () => goLive({ overlayOff: !snap.live.overlayOff });
  // 👤 사람 화면(P): 유튜브에는 그림 대신 사람(카메라) 화면만. 예배당 TV는 그대로
  $('#pip').onclick = () => { const on = !snap.live.camOnly; goLive({ camOnly: on }).catch(() => {}); toast(on ? '유튜브에는 사람(카메라) 화면만 나갑니다 — 그림은 예배당 TV에만' : '유튜브에 그림도 다시 나갑니다'); };
  $('#tvNoImg').onclick = () => { const on = !snap.live.tvNoImg; goLive({ tvNoImg: on }).catch(() => {}); toast(on ? '예배당 TV에 그림을 내보내지 않습니다 (글자는 그대로)' : '예배당 TV에 그림도 다시 나갑니다'); };
  $('#motionOn').onclick = () => api('PUT', '/api/style', { main: { motionOn: snap.style.main.motionOn === false } });
  document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { const [grp, d] = b.dataset.size.split(':'); bumpSize(grp, +d); });
  initMediaBin();
  initOverlayQuick();
  initWinMemory();
  initHSplit();
  initTools();

  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !dlg.open) { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }   // 빠른 찾기
    if (inactive) return;
    if (dlg.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const k = e.key;
    if (['ArrowRight', ' ', 'PageDown', 'ArrowDown'].includes(k)) { e.preventDefault(); goLive({ step: 1 }); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) { e.preventDefault(); goLive({ step: -1 }); }
    else if (k === 'b' || k === 'B') $('#black').click();
    else if (k === 'c' || k === 'C') $('#clear').click();
    else if (k === 'l' || k === 'L') $('#logo').click();
    else if (k === 'o' || k === 'O') $('#overlayOff').click();
    else if (k === 'p' || k === 'P') $('#pip').click();
    else if (k === 'i' || k === 'I') $('#tvNoImg').click();
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') { e.preventDefault(); bumpSize(e.shiftKey ? 'overlay' : 'main', e.code === 'BracketRight' ? 1 : -1); }
    else if (k === 'Escape') $('#reset').click();
    else if (/^[1-9]$/.test(k) && selId) goLive({ itemId: selId, index: +k - 1 }).catch(() => {});
  });
  // 슬라이드 클릭 시 다른 자료로 넘어가면 그 자료 기준으로 이동
}

// ── 시작 ─────────────────────────────────────────
(async function start() {
  document.body.classList.toggle('editor', IS_EDITOR);
  $('#modeTag').textContent = IS_EDITOR ? '웹 편집기 · 준비 전용' : '운영 · 송출';
  const me = await fetch('/api/me').then(r => r.json());
  I18N.setLang(me.lang);   // 메뉴 언어 (⚙︎ 설정)
  if (me.pc) PC = me.pc;
  if (!me.authed) {
    $('#loginHint').textContent = `운영 ${PC}에서 정한 PIN을 입력하세요.`;
    $('#login').classList.remove('hidden');
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pin').value }) });
      if (r.ok) location.reload(); else $('#loginErr').textContent = (await r.json().catch(() => ({}))).error || 'PIN이 맞지 않습니다';
    };
    return;
  }
  bind();
  await reload();
  const first = service()?.itemIds[0];
  if (first) select(first);
  connectWS();
  if (!IS_EDITOR) { checkUpdate(); setInterval(checkUpdate, 6 * 3600e3); }
})();

// 새 버전이 나왔으면 맨 위에 알림 단추 + 업데이트 안내 창 (⚙︎ 설정에서 끌 수 있음)
// 안내 창은 송출 중에는 저절로 뜨지 않음. '나중에'를 누르면 그 버전은 하루 동안 다시 띄우지 않음
let updInfo = null;
async function checkUpdate() {
  const u = await fetch('/api/update').then(r => r.json()).catch(() => null);
  $('#updBtn')?.remove();
  if (!u?.newer || !/^https:\/\//.test(u.url)) return;
  updInfo = u;
  const a = Object.assign(document.createElement('button'), { id: 'updBtn', className: 'btn update', title: '새 버전 안내 보기' });
  a.textContent = `🔔 새 버전 v${u.latest}`;
  a.onclick = () => showUpdate(u);
  $('#styleBtn').before(a);
  let later = {};
  try { later = JSON.parse(localStorage.getItem('wc-upd-later') || '{}'); } catch {}
  const onAir = snap?.live && snap.live.itemId && !snap.live.clear;
  if (!onAir && !dlg.open && !(Date.now() - (later[u.latest] || 0) < 864e5)) showUpdate(u);
}
// 배포 설명(마크다운 조금)을 안전하게 보여 줌
function mdLite(md) {
  const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  let html = '', inList = false;
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim();
    const li = l.match(/^[-*]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inl(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!l) continue;
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<h4>${inl(h[1])}</h4>`;
    else if (/^>/.test(l)) html += `<p class="muted">${inl(l.replace(/^>\s*/, ''))}</p>`;
    else if (!/^\|/.test(l)) html += `<p>${inl(l)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
function showUpdate(u) {
  let d = $('#updDlg');
  if (!d) { d = Object.assign(document.createElement('dialog'), { id: 'updDlg' }); document.body.append(d); }
  d.innerHTML = `<div class="upd-head"><div class="upd-ic">✝</div><h3>새 버전이 있습니다</h3>
      <div class="upd-ver"><span>v${esc(u.current)}</span> → <b>v${esc(u.latest)}</b></div></div>
    <div class="upd-body"><div class="small muted">업데이트 내용</div>
      <div class="upd-notes" data-noi18n>${mdLite(u.notes) || `<p class="muted">설명이 없습니다</p>`}</div>
      ${u.page ? `<a class="small" href="${esc(u.page)}" target="_blank" rel="noopener">GitHub에서 전체 보기</a>` : ''}
      <p class="small muted upd-hint">${u.canInstall ? '자료(예배 순서·찬양·설정)는 그대로 남습니다. 받은 뒤 프로그램이 잠깐 꺼졌다가 새 버전으로 다시 켜집니다. 예배 중에는 하지 마세요.' : '이 버전은 자동 설치 파일이 없습니다. 받는 곳에서 새 앱(폴더)을 받아 바꿔 넣으세요. 자료는 그대로 남습니다.'}</p>
      <div class="upd-msg small"></div>
      <button class="btn primary upd-go">${u.canInstall ? '지금 업데이트' : '받는 곳 열기'}</button>
      <button class="btn upd-later">나중에</button></div>`;
  const msg = d.querySelector('.upd-msg'), go = d.querySelector('.upd-go'), later = d.querySelector('.upd-later');
  later.onclick = () => {
    try { const m = JSON.parse(localStorage.getItem('wc-upd-later') || '{}'); m[u.latest] = Date.now(); localStorage.setItem('wc-upd-later', JSON.stringify(m)); } catch {}
    d.close();
  };
  go.onclick = async () => {
    if (!u.canInstall) { window.open(u.url, '_blank', 'noopener'); return; }
    if (snap?.live?.itemId && !snap.live.clear && !confirm('지금 화면에 송출 중입니다. 업데이트하면 잠깐(몇 초) 화면이 멈춥니다. 계속할까요?')) return;
    go.disabled = later.disabled = true;
    msg.textContent = '새 버전을 받는 중입니다… (인터넷에 따라 1~3분)';
    const boot0 = await fetch('/api/boot').then(r => r.json()).then(j => j.boot).catch(() => '');
    const r = await fetch('/api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.error) { msg.textContent = '⚠️ ' + r.error; go.disabled = later.disabled = false; return; }
    if (!r.restart) { msg.textContent = '설치했습니다. 프로그램을 껐다 켜면 새 버전입니다.'; return; }
    msg.textContent = '설치했습니다. 새 버전으로 다시 켜는 중…';
    restarting = true;
    for (let i = 0; i < 90; i++) {
      await new Promise(f => setTimeout(f, 1000));
      const b = await fetch('/api/boot', { cache: 'no-store' }).then(r => r.json()).then(j => j.boot).catch(() => null);
      if (b && b !== boot0) { location.reload(); return; }
    }
    msg.textContent = '다시 켜지지 않았습니다. 예배송출을 껐다가 다시 켜 주세요.';
  };
  if (!d.open) d.showModal();
}
