// 공용 렌더러: 운영 화면 미리보기·썸네일과 실제 송출 화면이 같은 코드를 씀
// 크기 단위는 cqh/cqw(컨테이너 기준) → 어떤 크기에서도 같은 비율
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isVideo = u => /\.(mp4|mov|m4v|webm)$/i.test(u || '');

  function bgHTML(url, cover = true) {
    if (!url) return '';
    if (isVideo(url)) return `<video class="wc-bg" src="${esc(url)}" autoplay muted loop playsinline></video>`;
    return `<div class="wc-bg" style="background-image:url('${esc(url)}');background-size:${cover ? 'cover' : 'contain'}"></div>`;
  }

  function textShadow(st) {
    const parts = [];
    if (st.shadow) parts.push('0 0.4cqh 1.2cqh rgba(0,0,0,.85)');
    return parts.join(',') || 'none';
  }

  function elementsHTML(slide) {
    const ptH = slide.ptH || 540;
    return (slide.elements || []).map(e => {
      const box = `left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%`;
      if (e.type === 'image') return `<img class="wc-el" style="${box};object-fit:contain" src="${esc(e.src)}">`;
      const fs = ((e.size || 24) / ptH * 100).toFixed(2) + 'cqh';
      if (e.type === 'table') {
        return `<table class="wc-el wc-table" style="${box};font-size:${fs};color:${e.color || '#fff'}">` +
          e.rows.map(r => '<tr>' + r.map(c => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>').join('') + '</table>';
      }
      return `<div class="wc-el wc-text" style="${box};font-size:${fs};color:${e.color || '#fff'};` +
        `font-weight:${e.bold ? 700 : 400};text-align:${e.align || 'left'};${e.fill ? `background:${e.fill};` : ''}">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
    }).join('');
  }

  function mainHTML(snap) {
    const st = snap.style.main, s = snap.slide, L = snap.live;
    if (L.black || !s) {
      const logo = L.logo && snap.logo ? `<div class="wc-bg" style="background-image:url('${esc(snap.logo)}');background-size:contain;background-position:center;background-repeat:no-repeat;inset:20%"></div>` : '';
      return `<div class="wc-layer" style="background:#000">${logo}</div>`;
    }
    let inner = bgHTML(s.bg, s.fit !== 'contain');
    if (!L.clear) {
      if (s.elements && s.elements.length) inner += elementsHTML(s);
      else {
        const jc = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign] || 'center';
        const ref = s.ref ? `<div class="wc-ref" style="font-size:${(st.size * 0.6).toFixed(2)}cqh">${esc(s.ref)}</div>` : '';
        inner += `<div class="wc-textwrap" style="justify-content:${jc};text-align:${st.align}">
          <div class="wc-text-main" dir="auto" style="font-family:${st.font};font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};
            line-height:${st.lineHeight};text-shadow:${textShadow(st)};${st.strokeWidth ? `-webkit-text-stroke:${st.strokeWidth / 10}cqh ${st.stroke};paint-order:stroke fill;` : ''}">${esc(s.text).replace(/\n/g, '<br>')}</div>${ref}</div>`;
      }
    }
    return `<div class="wc-layer" style="background:${s.bgColor || st.bg}">${inner}</div>`;
  }

  function hexA(hex, a) {
    const n = parseInt((hex || '#000000').slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function overlayHTML(snap) {
    const st = snap.style.overlay, s = snap.slide, L = snap.live;
    if (L.black || L.clear || !s || !String(s.text || '').trim()) return '<div class="wc-layer"></div>';
    const title = st.showTitle && (s.ref || (snap.item?.type === 'song' ? snap.item.title : '')) ;
    const pos = st.position === 'top' ? 'top:4cqh' : 'bottom:5cqh';
    return `<div class="wc-layer"><div class="wc-ov" style="${pos};background:${hexA(st.box, st.boxOpacity)};font-family:${st.font}">
      ${title ? `<div class="wc-ov-title" style="font-size:${(st.size * 0.55).toFixed(2)}cqh">${esc(title)}</div>` : ''}
      <div class="wc-ov-text" dir="auto" style="font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};line-height:${st.lineHeight}">${esc(s.text).replace(/\n/g, '<br>')}</div>
    </div></div>`;
  }

  function stageHTML(snap) {
    const s = snap.slide, n = snap.next, L = snap.live;
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const status = L.black ? '■ 검은 화면' : L.clear ? '◻ 글자 지움' : '● 송출 중';
    return `<div class="wc-layer wc-stage">
      <div class="wc-st-top"><span>${esc(snap.item?.title || '대기')}</span><span>${snap.item ? `${L.index + 1} / ${snap.item.count}` : ''}</span><span class="wc-st-status">${status}</span><span class="wc-clock">${now}</span></div>
      <div class="wc-st-cur" dir="auto">${esc(s?.text || '').replace(/\n/g, '<br>')}${s?.ref ? `<div class="wc-st-ref">${esc(s.ref)}</div>` : ''}</div>
      <div class="wc-st-next"><b>다음</b> ${esc(n?.text || '— 끝 —').replace(/\n/g, ' / ')}</div>
    </div>`;
  }

  const RENDER = { main: mainHTML, overlay: overlayHTML, stage: stageHTML };

  // 페이드 전환 렌더
  function render(container, snap, mode, opts = {}) {
    const html = RENDER[mode](snap);
    if (container._wcHTML === html) return;
    container._wcHTML = html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const layer = tmp.firstElementChild;
    const fade = opts.fade !== false;
    if (fade) layer.style.opacity = 0;
    const olds = [...container.querySelectorAll(':scope > .wc-layer')];
    container.appendChild(layer);
    if (fade) {
      requestAnimationFrame(() => requestAnimationFrame(() => (layer.style.opacity = 1)));
      setTimeout(() => olds.forEach(o => o.remove()), 320);
    } else olds.forEach(o => o.remove());
  }

  // 썸네일용: 특정 슬라이드를 즉시 렌더
  function thumb(container, slide, style, item) {
    render(container, { slide, style, live: { black: false, clear: false }, item }, 'main', { fade: false });
  }

  window.WC = { render, thumb, esc };
})();
