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
const service = () => S.services.find(s => s.id === S.currentServiceId);

async function reload() {
  S = await api('GET', '/api/state');
  if (!snap) snap = S.live;
  renderAll();
}

// ── 화면 그리기 ─────────────────────────────────
function renderAll() { renderServices(); renderLib(); renderSlides(); renderLive(); }

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
  const list = S.items.filter(i => KEEP.has(i.type)).filter(i => !q || i.title.toLowerCase().includes(q) || i.slides.some(s => (s.text || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
  const grid = $('#slides');
  grid.innerHTML = '';
  if (!it) return;
  it.slides.forEach((s, i) => {
    const d = document.createElement('div');
    const isLive = snap?.live.itemId === it.id && snap.live.index === i;
    d.className = 'slide' + (isLive ? ' live' : '');
    d.innerHTML = `<span class="num">${i + 1}</span><div class="wc-screen"></div>`;
    WC.thumb(d.querySelector('.wc-screen'), s, S.style, it);
    d.onclick = () => IS_EDITOR ? openItemEditor(it.id, i) : goLive({ itemId: it.id, index: i });
    grid.appendChild(d);
  });
  if (!it.slides.length) grid.innerHTML = '<p class="muted">슬라이드가 없습니다. ✎ 편집에서 내용을 넣으세요.</p>';
}
// 새 자료를 넣을 자리: 예배 순서에서 고른 자료 다음
const afterId = () => (service()?.itemIds.includes(selId) ? selId : null);

function renderLive() {
  if (IS_EDITOR || !snap) return;
  WC.render($('#pvMain'), snap, 'main');
  WC.render($('#pvOverlay'), snap, 'overlay', { preview: true });
  const L = snap.live;
  for (const k of ['black', 'clear', 'logo', 'overlayOff', 'pip']) $('#' + k).classList.toggle('on', !!L[k]);
  $('#motionOn').classList.toggle('on', snap.style.main.motionOn !== false);
  $('#szMain').textContent = (+snap.style.main.size).toFixed(1);
  $('#szOv').textContent = (+snap.style.overlay.size).toFixed(1);
  const ovOff = L.overlayOff || snap.item?.noBroadcast;
  $('#ovState').classList.toggle('hidden', !ovOff);
  $('#ovState').textContent = L.overlayOff ? '꺼짐 — 예배당 화면에만 나가는 중' : '이 자료는 방송에 내보내지 않음';
  $('#overlayOff').innerHTML = (L.overlayOff ? '🎥 방송 자막 다시 켜기' : '🎥 방송 자막 끄기') + ' <kbd>O</kbd>';
  $('#liveInfo').textContent = snap.item ? `· ${snap.item.title} ${L.index + 1}/${snap.item.count}` : '· 대기';
  $('#pvNext').textContent = snap.next ? snap.next.text : (snap.item ? '— 마지막 슬라이드 —' : '');
}

function select(id) { selId = id; renderServices(); renderLib(); renderSlides(); }

// ── 송출 ─────────────────────────────────────────
// 다른 운영 창이 자막을 넘기는 중이면 이 창은 쉬게 함 (실수로 두 창에서 넘기는 일 방지)
let inactive = false;
let wsNow = null;
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
    if (m.type === 'dup' || m.type === 'replaced') showWindowNotice(m.type);
    if (m.type === 'quit') { stopped = true; ws.close(); }
    if (m.type === 'quit') document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출이 종료되었습니다.</div>';
  };
  ws.onclose = () => { if (!stopped) setTimeout(connectWS, 1000); };
}

// ── 예배 순서 ───────────────────────────────────
async function saveService(ids) { await api('PUT', '/api/services/' + S.currentServiceId, { itemIds: ids }); }
async function newService() {
  const T = await api('GET', '/api/templates');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const body = openDlg(`
    <div class="dlg-head"><h3>새 예배 순서</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>순서 템플릿</label><select id="nsT">${T.services.map(([k, n]) => `<option value="${k}" ${k === 'sunday' ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label>예배 이름</label><input id="nsName" value="주일 예배">
      <label>날짜</label><input id="nsDate" type="date" value="${today}">
    </div>
    <p class="muted small">템플릿을 고르면 '예배 준비 → 예배의 부름 → 찬양 → 기도 → 말씀 → 봉헌 → 광고 → 축도' 같은 순서 제목 화면이 미리 들어갑니다.
    순서 제목을 고른 뒤 ＋ 찬양·＋ 성경을 누르면 그 다음 자리에 들어갑니다. 필요 없는 순서는 ✕로 빼세요.</p>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="nsGo">만들기</button></div>`);
  body.querySelector('#nsT').onchange = e => { const o = e.target.selectedOptions[0]; body.querySelector('#nsName').value = e.target.value ? o.textContent : '새 예배'; };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#nsGo').onclick = async () => {
    const s = await api('POST', '/api/services', { name: body.querySelector('#nsName').value, date: body.querySelector('#nsDate').value, template: body.querySelector('#nsT').value });
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
function cleanLyrics(t) {
  const chord = /^[\s|]*(([A-G][#b♯♭]?(m|maj|min|sus|dim|aug|add|M)?\d*(\/[A-G][#b♯♭]?)?)[\s|\-–~]*)+$/;
  const out = [];
  for (let line of t.replace(/\r/g, '').replace(/\u00a0/g, ' ').split('\n')) {
    line = line.trim();
    if (line && chord.test(line)) continue;
    if (/^(\[.*\]|\(.*\)|<.*>)$/.test(line) || /^(verse|chorus|bridge|intro|outro|pre-?chorus|tag|ending|후렴|간주|브릿지|전주|후주|\d+\s*절)[\s\d.:)\]]*$/i.test(line)) { out.push(''); continue; }
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
      <label class="song-only">가사 찾기</label><div class="row wrap song-only" style="margin:0">
        <button class="btn sm" id="eFindG">🔎 구글에서 가사 검색</button><button class="btn sm" id="eFindN">🔎 네이버</button>
        <button class="btn sm" id="eClip" title="인터넷에서 복사한 가사를 붙여넣고, 코드·[후렴] 표시·작사/작곡 줄을 지웁니다">📋 복사한 가사 붙여넣고 정리</button></div>
      <label class="no-html">가사·글 붙여넣기</label>
      <div class="no-html"><textarea id="ePaste" rows="5" placeholder="가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다."></textarea>
        <div class="row" style="margin-top:6px"><select id="eLines" style="width:auto">${[1, 2, 3, 4, 5, 6].map(n => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="muted">줄씩</span><button class="btn sm" id="eSplit">나누어 슬라이드 만들기 (덮어쓰기)</button><button class="btn sm" id="eAppend">뒤에 추가</button></div></div>
      <label>모든 슬라이드 배경</label><div class="row"><button class="btn sm" id="eBgAll">배경 선택</button><button class="btn sm" id="eBgNone">배경 없애기</button></div>
    </div>
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
      const isHtml = it.type === 'html' || s.html != null;
      row.innerHTML = `<div class="wc-screen" style="border-radius:6px"></div>
        <div>${isHtml ? `<textarea data-html class="mono" rows="7" placeholder="&lt;h1&gt;안녕하세요&lt;/h1&gt; 처럼 HTML 코드를 넣으세요">${esc(s.html || '')}</textarea>
          <div class="row wrap" style="margin-top:6px"><label class="btn sm">HTML 파일 열기<input type="file" data-hfile accept=".html,.htm,text/html" hidden></label>
          <button class="btn sm" data-hsample="count">예시: 예배 시작 카운트다운</button><button class="btn sm" data-hsample="verse">예시: 오늘의 말씀 카드</button></div>`
        : s.elements?.length ? elEdit : `<textarea data-text rows="4">${esc(s.text)}</textarea>`}
          ${it.type === 'bible' ? `<input data-ref placeholder="구절 표시 (예: 요한복음 3:16)" value="${esc(s.ref || '')}" style="margin-top:6px">` : ''}</div>
        <div class="tools">
          <button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button>
          ${s.elements?.length ? '' : '<button class="icon" data-a="split" title="커서 위치에서 나누기">✂</button>'}
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
  }
  // 미디어 고르기 뒤 다시 이 편집기로 돌아오기
  function openItemEditorResume() { dlg.showModal(); $('#dlgBody').replaceChildren(...saved); draw(); }
  let saved;
  const pickMedia = (onPick, back) => { saved = [...$('#dlgBody').childNodes]; openMediaPicker(url => { onPick(url); back(); }, back); };

  body.querySelector('#eTitle').oninput = e => (it.title = e.target.value);
  const typeUI = () => {
    body.querySelectorAll('.song-only').forEach(x => x.classList.toggle('hidden', it.type !== 'song'));
    body.querySelectorAll('.no-html').forEach(x => x.classList.toggle('hidden', it.type === 'html'));
    body.querySelector('#eKeepNote').textContent = KEEP.has(it.type) ? '찬양 자료실에 남습니다' : '예배 순서에서 빼면 지워집니다';
  };
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
    const saved = src ? await api('PUT', '/api/items/' + id, it) : await api('POST', '/api/items', { ...it, place: true, after: afterId() });
    selId = saved.id; closeDlg(); toast('저장했습니다');
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
    const n = +body.querySelector('#bN').value, slides = [];
    for (let i = 0; i < res.verses.length; i += n) {
      const g = res.verses.slice(i, i + n);
      const r = g.length > 1 ? `${g[0].v}-${g[g.length - 1].v}` : g[0].v;
      const v2map = Object.fromEntries((res2 && !res2.error ? res2.verses : []).map(v => [v.v, v.text]));
      const line = (v, t) => (n > 1 ? `${v.v} ` : '') + t;
      let text = g.map(v => line(v, v.text)).join('\n');
      const t2 = g.filter(v => v2map[v.v]).map(v => line(v, v2map[v.v])).join('\n');
      if (t2) text += '\n\n' + t2;
      slides.push({ text, ref: `${res.book} ${res.ch}:${r} (${res.version}${t2 ? ' · ' + res2.version : ''})` });
    }
    const it = await api('POST', '/api/items', { type: 'bible', title: `${res.title} ${res.version}`, theme: 'word', slides, after: afterId() });
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
    toast('올리는 중…'); await api('POST', '/api/media', fd); openMediaPicker(onPick, onCancel);
  };
  body.querySelectorAll('.m').forEach(m => m.onclick = async e => {
    if (e.target.dataset.del) { if (confirm('삭제할까요?')) { await api('DELETE', '/api/media/' + encodeURIComponent(e.target.dataset.del)); openMediaPicker(onPick, onCancel); } return; }
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
      </div><div id="sPvOv" class="wc-screen pv checker" style="margin-top:10px"></div></div>
    </div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="sSave">적용</button></div>`);
  body.querySelector('#mvPick').onclick = () => openMediaPicker(url => {
    if (!/\.(mp4|mov|m4v|webm)$/i.test(url)) return toast('동영상(mp4·mov·webm)을 골라 주세요');
    st.main.motionVideo = url; st.main.motion = 'video'; openStyle(st);
  }, () => openStyle(st));
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
  const urls = S.lan.map(ip => `http://${ip}:${S.port}/overlay`);
  openDlg(`
    <div class="dlg-head"><h3>🎥 OBS에 자막 얹기</h3><button class="icon" data-x>✕</button></div>
    <p>방송 PC(맥/윈도우)의 OBS에서 <b>소스 ＋ → 브라우저</b>를 추가하고 아래 주소를 넣으세요. 너비 <b>1920</b>, 높이 <b>1080</b>.
    카메라 소스 <b>위에</b> 두면 자막만 투명하게 얹힙니다. (캡처 장비·NDI 플러그인 필요 없음)</p>
    ${urls.map(u => `<div class="copy row"><input readonly value="${u}"><button class="btn" data-copy="${u}">복사</button></div>`).join('') || '<p class="err">네트워크 주소를 찾지 못했습니다. 와이파이/랜 연결을 확인하세요. 같은 맥에서 OBS를 쓰면: http://localhost:' + S.port + '/overlay</p>'}
    <p class="muted small">· 같은 맥에서 OBS를 돌릴 때: <code>http://localhost:${S.port}/overlay</code><br>
    · 방송 PC와 이 맥은 같은 공유기(네트워크)에 있어야 합니다. 맥 방화벽이 묻으면 "허용"을 누르세요.<br>
    · 웹 편집기(주중 준비): <code>${S.lan[0] ? `http://${S.lan[0]}:${S.port}/editor` : '-'}</code> · PIN <b>${esc(S.settings.pin || '')}</b> (⚙︎ 설정에서 변경)</p>
    <h4 id="obsPipBox" style="margin:18px 0 6px">👤 그림·악보·PPT를 보낼 때 오른쪽 아래에 사람 화면 (선택)</h4>
    <div class="notebox">상태: ${!obsInfo ? '<span class="muted">OBS 자막 소스가 아직 연결되지 않았습니다</span>'
      : obsInfo.level >= 4 ? '<span class="ok">OBS 장면 전환 가능</span>' : obsInfo.level >= 0 ? '<span class="warn">OBS 권한이 부족합니다 — 아래 3번을 해 주세요</span>' : '<span class="warn">이 OBS는 장면 전환을 지원하지 않습니다 (OBS 28 이상 필요)</span>'}
      <ol>
        <li>지금 쓰는 장면(예: <b>예배</b>)은 그대로 둡니다. 카메라 위에 이 자막 브라우저 소스가 있으면 됩니다.</li>
        <li>장면을 하나 더 만듭니다(예: <b>예배-그림</b>). 소스 ＋ → 브라우저 → <b>기존 소스 추가</b>로 같은 자막 소스를 넣고,
          그 <b>위에</b> 카메라도 '기존 소스 추가'로 넣어 오른쪽 아래에 작게 놓습니다.</li>
        <li>자막 브라우저 소스 속성 → <b>페이지 권한</b>을 <b>고급 접근 권한</b>(장면 변경 가능, 영어: Advanced access to OBS)으로 바꿉니다.</li>
        <li>아래에서 두 장면을 고르고 저장합니다. 그림이 나갈 때는 '예배-그림'으로, 글자 자막으로 돌아오면 '예배'로 OBS가 알아서 바뀝니다.
          운영 화면의 <b>👤 사람 화면</b> 버튼(P 키)으로 켜고 끕니다.</li>
      </ol></div>
    <div class="form" style="margin-top:8px">
      <label>평소 장면</label>${sceneField('obsBase', S.settings.obsScenes?.base)}
      <label>사람 화면 장면</label>${sceneField('obsPip', S.settings.obsScenes?.pip)}
    </div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button><button class="btn primary" id="obsSave">장면 저장</button></div>`);
  $('#dlgBody').querySelector('#obsSave').onclick = async () => {
    await api('PUT', '/api/settings', { obsScenes: { base: $('#obsBase').value.trim(), pip: $('#obsPip').value.trim() } });
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
    <div class="form">
      <label>웹 편집기 PIN</label><div class="row"><input id="stPin" value="${esc(S.settings.pin || '')}" maxlength="12" placeholder="6~12자리"><button class="btn" id="stPinSave">저장</button></div>
    </div>
    <h4 style="margin:18px 0 8px">로고</h4><div>
        <div class="row">${S.settings.logo ? `<img src="${esc(S.settings.logo)}" style="height:40px;background:#333;border-radius:4px">` : '<span class="muted">없음</span>'}
          <button class="btn" id="stLogo">로고 선택</button>${S.settings.logo ? '<button class="btn" id="stLogoDel">빼기</button>' : ''}</div>
        ${S.settings.logo ? `<div class="two">
          <div><b class="small">로고 화면 (✝ 로고 버튼 · L 키)</b><div class="form narrow">
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
        </div><div class="row" style="margin-top:8px"><button class="btn primary" id="lgSave">로고 설정 저장</button></div>` : '<p class="muted small">교회 로고 그림(png 권장, 배경이 투명하면 더 좋음)을 고르면 위치·크기를 정할 수 있습니다.</p>'}</div>
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
    <p class="muted small" style="margin-top:16px">예배송출 v0.4.0 · 만든 사람: <b>쉬운목사 이광복</b> · 무료로 나눕니다</p>
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
  body.querySelector('#stLogo').onclick = () => openMediaPicker(async url => { await api('PUT', '/api/settings', { logo: url }); await reload(); openSettings(); }, openSettings);
  body.querySelector('#stLogoDel')?.addEventListener('click', async () => { await api('PUT', '/api/settings', { logo: '' }); await reload(); openSettings(); });
  if (S.settings.logo) {
    const paintLogo = () => {
      const logo = { url: S.settings.logo, ...ls };
      WC.render(body.querySelector('#lgPv1'), { slide: null, style: S.style, live: { black: true, logo: true }, logo }, 'main', { fade: false, still: true });
      WC.render(body.querySelector('#lgPv2'), { slide: { text: '주님의 은혜가 오늘도\n나의 삶을 덮으시네' }, style: S.style, live: {}, logo, item: { type: 'song' } }, 'main', { fade: false, still: true });
    };
    const bindL = (id, key, conv) => body.querySelector('#' + id).addEventListener('input', e => { ls[key] = conv(e.target); paintLogo(); });
    bindL('lgSPos', 'screenPos', t => t.value); bindL('lgSSize', 'screenSize', t => +t.value);
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

// ── 이벤트 연결 ─────────────────────────────────
function bind() {
  $('#search').oninput = e => { search = e.target.value; renderLib(); };
  $('#serviceSel').onchange = async e => { await api('PUT', '/api/current-service', { id: e.target.value }); };
  $('#svcNew').onclick = newService;
  $('#svcEdit').onclick = async () => {
    const s = service(); if (!s) return;
    const name = prompt('예배 이름', s.name); if (name == null) return;
    const date = prompt('날짜', s.date) ?? s.date;
    await api('PUT', '/api/services/' + s.id, { name, date });
  };
  $('#svcDel').onclick = async () => { const s = service(); if (s && confirm(`'${s.name}' 순서를 삭제할까요?\n(찬양은 자료실에 남고, 말씀·광고·문구는 함께 지워집니다)`)) await api('DELETE', '/api/services/' + s.id); };
  $('#newSong').onclick = () => openItemEditor(null);
  $('#newNotice').onclick = () => openItemEditor(null, null, { type: 'notice', title: '광고', theme: 'notice', slides: [{ text: '교회 소식\n내용을 적으세요' }] });
  $('#newHtml').onclick = () => openItemEditor(null, null, { type: 'html', title: '새 HTML', slides: [{ text: '', html: HTML_SAMPLES.count }] });
  $('#newPhrase').onclick = openPhrases;
  $('#newBible').onclick = openBible;
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
  $('#styleBtn').onclick = openStyle;
  $('#mediaBtn').onclick = () => openMediaPicker(null, null);
  if (IS_EDITOR) return;

  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => window.open(b.dataset.open, b.dataset.open, 'width=1280,height=720'));
  $('#obsBtn').onclick = openOBS;
  $('#settingsBtn').onclick = openSettings;
  $('#quitBtn').onclick = async () => {
    if (!confirm('예배송출 프로그램을 끌까요?\n(예배당 화면·OBS 자막도 함께 꺼집니다)')) return;
    stopped = true;
    await api('POST', '/api/quit');
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출을 종료했습니다. 이 창은 닫으셔도 됩니다.</div>';
    setTimeout(() => window.close(), 800);
  };
  $('#prev').onclick = () => goLive({ step: -1 });
  $('#next').onclick = () => goLive({ step: 1 });
  $('#black').onclick = () => goLive({ black: !snap.live.black });
  $('#clear').onclick = () => goLive({ clear: !snap.live.clear });
  $('#logo').onclick = () => goLive({ logo: !snap.live.logo, black: !snap.live.logo });
  $('#reset').onclick = () => goLive({ reset: true });
  $('#overlayOff').onclick = () => goLive({ overlayOff: !snap.live.overlayOff });
  $('#pip').onclick = () => { goLive({ pip: !snap.live.pip }); if (!S.settings.obsScenes?.pip) toast('사람 화면을 쓰려면 🎥 OBS 자막 주소 → 사람 화면 설정을 해 주세요'); };
  $('#motionOn').onclick = () => api('PUT', '/api/style', { main: { motionOn: snap.style.main.motionOn === false } });
  document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => {
    const [grp, d] = b.dataset.size.split(':'), cur = +snap.style[grp].size;
    api('PUT', '/api/style', { [grp]: { size: Math.round((cur + d * (grp === 'main' ? 0.4 : 0.3)) * 10) / 10 } });
  });

  addEventListener('keydown', e => {
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
  if (!me.authed) {
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
})();
