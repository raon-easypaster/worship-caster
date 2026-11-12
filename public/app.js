// 운영 화면(/control) + 웹 편집기(/editor) 공용 로직
const IS_EDITOR = location.pathname.startsWith('/editor');
const $ = s => document.querySelector(s);
const esc = WC.esc;
const TYPE = { song: '찬양', bible: '말씀', notice: '광고', ppt: 'PPT', score: '악보·PDF' };

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
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>
      <span class="acts"><button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button><button class="icon" data-a="rm" title="순서에서 빼기">✕</button></span>`;
    li.onclick = e => {
      const a = e.target.dataset.a;
      if (!a) return select(id);
      e.stopPropagation();
      const ids = [...svc.itemIds];
      if (a === 'rm') ids.splice(i, 1);
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
  const list = S.items.filter(i => !q || i.title.toLowerCase().includes(q) || i.slides.some(s => (s.text || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const it of list) {
    const li = document.createElement('li');
    li.className = (it.id === selId ? 'sel ' : '') + (snap?.live.itemId === it.id ? 'live' : '');
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>
      <span class="acts"><button class="icon" data-a="add" title="예배 순서에 추가">＋</button><button class="icon" data-a="del" title="삭제">🗑</button></span>`;
    li.onclick = async e => {
      const a = e.target.dataset.a;
      if (!a) return select(it.id);
      e.stopPropagation();
      if (a === 'add') { if (!service()) await newService(); saveService([...service().itemIds, it.id]); toast('예배 순서에 추가했습니다'); }
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

function renderLive() {
  if (IS_EDITOR || !snap) return;
  WC.render($('#pvMain'), snap, 'main');
  WC.render($('#pvOverlay'), snap, 'overlay');
  const L = snap.live;
  for (const k of ['black', 'clear', 'logo']) $('#' + k).classList.toggle('on', !!L[k]);
  $('#liveInfo').textContent = snap.item ? `· ${snap.item.title} ${L.index + 1}/${snap.item.count}` : '· 대기';
  $('#pvNext').textContent = snap.next ? snap.next.text : (snap.item ? '— 마지막 슬라이드 —' : '');
}

function select(id) { selId = id; renderServices(); renderLib(); renderSlides(); }

// ── 송출 ─────────────────────────────────────────
async function goLive(b) { if (!IS_EDITOR) snap = await api('POST', '/api/live', b); }

function connectWS() {
  const ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onopen = () => { if (S) reload().catch(() => {}); };  // 끊겼다 다시 연결되면 놓친 변경 반영
  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.type === 'live') {
      const changedItem = snap?.live.itemId !== m.live.itemId;
      snap = m;
      renderLive();
      if (S) { renderSlides(); if (changedItem) { renderServices(); renderLib(); } }
    }
    if (m.type === 'data') reload().catch(() => {});
    if (m.type === 'quit') document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출이 종료되었습니다.</div>';
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}

// ── 예배 순서 ───────────────────────────────────
async function saveService(ids) { await api('PUT', '/api/services/' + S.currentServiceId, { itemIds: ids }); }
async function newService() {
  const name = prompt('예배 이름', '주일 예배'); if (!name) return;
  const date = prompt('날짜 (YYYY-MM-DD)', new Date().toISOString().slice(0, 10)) || '';
  const s = await api('POST', '/api/services', { name, date });
  S.services.push(s); S.currentServiceId = s.id;
}

// ── 대화상자 ─────────────────────────────────────
const dlg = $('#dlg');
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); return $('#dlgBody'); }
function closeDlg() { dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });

// 자료 편집기
function openItemEditor(id, focusIndex) {
  const src = id ? item(id) : null;
  const it = src ? JSON.parse(JSON.stringify(src)) : { type: 'song', title: '새 찬양', slides: [] };
  const body = openDlg(`
    <div class="dlg-head"><h3>${src ? '자료 편집' : '새 자료'}</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>제목</label><input id="eTitle" value="${esc(it.title)}">
      <label>종류</label><select id="eType">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === it.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>가사 붙여넣기</label>
      <div><textarea id="ePaste" rows="5" placeholder="가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다."></textarea>
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
      row.innerHTML = `<div class="wc-screen" style="border-radius:6px"></div>
        <div>${s.elements?.length ? elEdit : `<textarea data-text rows="4">${esc(s.text)}</textarea>`}
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
  body.querySelector('#eType').onchange = e => { it.type = e.target.value; draw(); };
  const doSplit = async append => {
    const slides = await api('POST', '/api/split', { text: body.querySelector('#ePaste').value, lines: body.querySelector('#eLines').value });
    const bg = it.slides[0]?.bg; if (bg) slides.forEach(s => (s.bg = bg));
    it.slides = append ? [...it.slides, ...slides] : slides;
    body.querySelector('#ePaste').value = ''; draw();
  };
  body.querySelector('#eSplit').onclick = () => doSplit(false);
  body.querySelector('#eAppend').onclick = () => doSplit(true);
  body.querySelector('#eAdd').onclick = () => { it.slides.push({ text: '' }); draw(); };
  body.querySelector('#eBgAll').onclick = () => pickMedia(url => it.slides.forEach(s => (s.bg = url)), openItemEditorResume);
  body.querySelector('#eBgNone').onclick = () => { it.slides.forEach(s => delete s.bg); draw(); };
  body.querySelector('#eDel')?.addEventListener('click', async () => {
    if (!confirm('이 자료를 삭제할까요?')) return;
    await api('DELETE', '/api/items/' + id); selId = null; closeDlg();
  });
  body.querySelector('#eSave').onclick = async () => {
    const saved = src ? await api('PUT', '/api/items/' + id, it) : await api('POST', '/api/items', it);
    selId = saved.id; closeDlg(); toast('저장했습니다');
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  draw();
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
    const it = await api('POST', '/api/items', { type: 'bible', title: `${res.title} ${res.version}`, slides });
    if (service()) await saveService([...service().itemIds, it.id]);
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
    악보 슬라이드는 예배당 화면에만 나가고 방송 자막(OBS)에는 나가지 않습니다.</p>
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
      const it = await api('POST', '/api/items', { type: 'score', title, slides });
      if (service()) await saveService([...service().itemIds, it.id]);
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
function openStyle() {
  const st = JSON.parse(JSON.stringify(S.style));
  const fonts = [["'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif", '본고딕 (Noto Sans KR)'], ["'Apple SD Gothic Neo', sans-serif", '애플 SD 고딕'], ["'Nanum Myeongjo', 'AppleMyungjo', serif", '나눔명조'], ["'AppleMyungjo', serif", '애플 명조']];
  const fontSel = (cur, id) => `<select id="${id}">${fonts.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
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
      </div><div id="sPvMain" class="wc-screen pv" style="margin-top:10px"></div></div>
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
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  $('#dlgBody').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('복사했습니다'); });
  $('#dlgBody').querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// 설정
function openSettings() {
  const body = openDlg(`
    <div class="dlg-head"><h3>설정</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>웹 편집기 PIN</label><div class="row"><input id="stPin" value="${esc(S.settings.pin || '')}" maxlength="12" placeholder="6~12자리"><button class="btn" id="stPinSave">저장</button></div>
      <label>로고 (L 키)</label><div class="row">${S.settings.logo ? `<img src="${esc(S.settings.logo)}" style="height:40px">` : '<span class="muted">없음</span>'}<button class="btn" id="stLogo">로고 선택</button></div>
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
  $('#svcDel').onclick = async () => { const s = service(); if (s && confirm(`'${s.name}' 순서를 삭제할까요? (자료는 남습니다)`)) await api('DELETE', '/api/services/' + s.id); };
  $('#newSong').onclick = () => openItemEditor(null);
  $('#newNotice').onclick = () => { openItemEditor(null); $('#eType').value = 'notice'; $('#eType').dispatchEvent(new Event('change')); $('#eTitle').value = '광고'; $('#eTitle').dispatchEvent(new Event('input')); };
  $('#newBible').onclick = openBible;
  $('#newScore').onclick = openScore;
  $('#pptFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    toast('PPT 가져오는 중…');
    const it = await api('POST', '/api/pptx', fd);
    e.target.value = ''; selId = it.id;
    if (service()) await saveService([...service().itemIds, it.id]);
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

  addEventListener('keydown', e => {
    if (dlg.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const k = e.key;
    if (['ArrowRight', ' ', 'PageDown', 'ArrowDown'].includes(k)) { e.preventDefault(); goLive({ step: 1 }); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) { e.preventDefault(); goLive({ step: -1 }); }
    else if (k === 'b' || k === 'B') $('#black').click();
    else if (k === 'c' || k === 'C') $('#clear').click();
    else if (k === 'l' || k === 'L') $('#logo').click();
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
