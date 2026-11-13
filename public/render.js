// 공용 렌더러: 운영 화면 미리보기·썸네일과 실제 송출 화면이 같은 코드를 씀
// 크기 단위는 cqh/cqw(컨테이너 기준) → 어떤 크기에서도 같은 비율
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isVideo = u => /\.(mp4|mov|m4v|webm)$/i.test(u || '');

  // ── 값 검증: 스타일 속성에 들어가는 값은 모두 여기서 걸러서 HTML/CSS 주입을 막음 ──
  const col = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : d);
  const num = (n, d, lo = -1e4, hi = 1e4) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const DEFAULT_FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif";
  const font = f => (/^[\w\s',\-가-힣]{1,120}$/.test(String(f || '')) ? f : DEFAULT_FONT);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const mediaUrl = u => (/^\/media\/[^"'<>()\\\s]+$/.test(String(u || '')) ? u : '');

  // 오래된 브라우저(OBS 28 이하 내장 브라우저 등)는 cqh/cqw 단위를 몰라 글자가 아주 작게 나옴.
  // 송출 화면은 화면을 꽉 채우므로 vh/vw 로 바꿔도 결과가 같음. (smdjoo-stack 님 버전에서 가져옴)
  const NO_CQ = !(window.CSS && CSS.supports && CSS.supports('height', '1cqh'));
  const toVp = h => (NO_CQ ? String(h).replace(/(\d)cq([hw])\b/g, '$1v$2') : h);
  if (NO_CQ) {
    fetch('/render.css').then(r => r.text()).then(t => {
      const el = document.createElement('style');
      el.textContent = toVp(t.replace(/@import[^;]*;/g, ''));
      document.head.appendChild(el);
    }).catch(() => {});
  }
  // 창이 가려져 있어도 확실히 나타나게: requestAnimationFrame 은 창이 안 보이면 멈춰서
  // 새 화면이 투명한 채로 남는 문제가 있었음 → 강제로 한 번 그린 뒤 바꾸고, 타이머로 한 번 더 보장
  function fadeIn(el, ms = 320) {
    void el.offsetWidth;
    el.style.opacity = 1;
    setTimeout(() => (el.style.opacity = 1), ms);
  }

  // 글꼴 (프로그램에 함께 들어 있어 인터넷 없이도 나옴)
  const FONTS = [
    [DEFAULT_FONT, '본고딕 (Noto Sans KR)'],
    ["'Nanum Gothic', sans-serif", '나눔고딕'],
    ["'Gowun Dodum', sans-serif", '고운돋움'],
    ["'Nanum Myeongjo', serif", '나눔명조'],
    ["'Gowun Batang', serif", '고운바탕'],
    ["'Song Myung', serif", '송명 (붓 느낌 명조)'],
    ["'Black Han Sans', sans-serif", '검은고딕 (아주 굵게)'],
    ["'Do Hyeon', sans-serif", '도현'],
    ["'Jua', sans-serif", '주아 (둥근 글씨)'],
    ["'Nanum Pen Script', cursive", '나눔손글씨 펜'],
    ["'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", '컴퓨터 기본 고딕'],
  ];
  const MYEONGJO = "'Nanum Myeongjo', serif", BATANG = "'Gowun Batang', serif";

  // 움직이는 배경 (동영상 파일 없이 화면에서 바로 그림 → 가볍고 끊김 없이 반복)
  const MOTIONS = { none: '없음', galaxy: '은하수', water: '물결', rays: '빛줄기', bokeh: '빛망울', aurora: '오로라', dawn: '새벽 하늘', embers: '촛불빛', video: '내 동영상 (미디어에서 고르기)' };

  // 자료 모양(테마): 전체 자막 스타일 위에 덮어씀
  const THEMES = {
    '': { name: '기본 (자막 스타일 따름)' },
    song_galaxy: { name: '찬양 · 은하수', motion: 'galaxy' },
    song_water: { name: '찬양 · 물결', motion: 'water' },
    song_aurora: { name: '찬양 · 오로라', motion: 'aurora' },
    song_rays: { name: '찬양 · 빛줄기', motion: 'rays' },
    word: { name: '말씀 · 명조', font: MYEONGJO, bg: '#0f1a2e', motion: 'none', refColor: '#ffd76a', lineHeight: 1.6 },
    word_dawn: { name: '말씀 · 새벽 하늘', font: MYEONGJO, motion: 'dawn', refColor: '#ffe9a8', lineHeight: 1.6 },
    notice: { name: '광고 · 제목 강조', headline: true, headColor: '#ffd76a', bg: '#10294a', motion: 'none' },
    notice_light: { name: '광고 · 밝은 화면', headline: true, headColor: '#b4530c', bg: '#f7f3ea', color: '#1d2330', shadow: false, motion: 'none' },
    prayer: { name: '기도 · 빛망울', motion: 'bokeh', font: BATANG, bold: false, lineHeight: 1.6 },
    title: { name: '순서 제목', headline: true, headColor: '#ffffff', motion: 'aurora', size: 7.5 },
    communion: { name: '성찬 · 촛불빛', motion: 'embers', font: MYEONGJO, headline: true, headColor: '#f3c77a', lineHeight: 1.6 },
  };

  const safeMain = st => ({
    ...st, font: font(st.font), size: num(st.size, 6.2, 1, 30), color: col(st.color, '#ffffff'), stroke: col(st.stroke, '#000000'),
    strokeWidth: num(st.strokeWidth, 0, 0, 10), align: pick(st.align, ['left', 'center', 'right'], 'center'),
    valign: pick(st.valign, ['top', 'middle', 'bottom'], 'middle'), bg: col(st.bg, '#000000'), lineHeight: num(st.lineHeight, 1.45, 0.8, 3),
    motion: pick(st.motion, Object.keys(MOTIONS), 'none'), headColor: col(st.headColor, '#ffd76a'), refColor: col(st.refColor, '#ffe9a8'),
  });
  const safeOverlay = st => ({
    ...st, font: font(st.font), size: num(st.size, 4.6, 1, 20), color: col(st.color, '#ffffff'), box: col(st.box, '#0b1d3a'),
    boxOpacity: num(st.boxOpacity, 0.72, 0, 1), position: pick(st.position, ['top', 'bottom'], 'bottom'), lineHeight: num(st.lineHeight, 1.35, 0.8, 3),
    // 방송에 그림 보내는 방식: full 화면 가득 / part 화면 일부(크기·위치) / none 보내지 않음
    imgMode: pick(st.imgMode, ['full', 'part', 'none'], 'full'), partSize: num(st.partSize, 35, 15, 70),
    partPos: pick(st.partPos, ['tr', 'mr', 'br', 'tl', 'ml', 'bl'], 'tr'),
  });
  const safeEl = e => ({
    ...e, x: num(e.x, 0), y: num(e.y, 0), w: num(e.w, 100, 0), h: num(e.h, 100, 0), size: num(e.size, 24, 1, 400),
    color: col(e.color, '#ffffff'), fill: col(e.fill, null), align: pick(e.align, ['left', 'center', 'right'], 'left'),
  });

  // ── 움직이는 배경 그리기 ─────────────────────────────
  function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
  const cache = {};
  function stars(n, seed, maxR) {
    const k = `s${n}_${seed}`;
    if (cache[k]) return cache[k];
    const r = rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      const s = 0.06 + r() * maxR, a = (0.35 + r() * 0.65).toFixed(2);
      out.push(`radial-gradient(circle at ${(r() * 100).toFixed(2)}% ${(r() * 100).toFixed(2)}%,rgba(255,255,255,${a}) 0 ${s.toFixed(2)}cqh,transparent ${(s * 2.2).toFixed(2)}cqh)`);
    }
    return (cache[k] = out.join(','));
  }
  function particles(n, seed, colors, smin, smax, dmin, dmax, cls = 'pt') {
    const r = rng(seed); let h = '';
    for (let i = 0; i < n; i++) {
      const s = smin + r() * (smax - smin), d = dmin + r() * (dmax - dmin), c = colors[i % colors.length];
      h += `<i class="${cls}" style="left:${(r() * 100).toFixed(1)}%;width:${s.toFixed(1)}cqh;height:${s.toFixed(1)}cqh;` +
        `background:radial-gradient(circle,${c} 0%,transparent 68%);animation-duration:${d.toFixed(1)}s;animation-delay:-${(r() * d).toFixed(1)}s"></i>`;
    }
    return h;
  }
  function motionHTML(key, still) {
    if (!key) return '';
    if (key.startsWith('video:')) {
      const u = mediaUrl(key.slice(6)); if (!u) return '';
      return still ? `<div class="wc-motion m-video"><video class="wc-bg" src="${esc(u)}#t=1" muted preload="metadata"></video></div>`
        : `<div class="wc-motion m-video"><video class="wc-bg" src="${esc(u)}" autoplay muted loop playsinline></video></div>`;
    }
    const st = (n, seed, max, dur, cls = '') => `<i class="g-st ${cls}" style="background-image:${stars(n, seed, max)};animation-duration:${dur}s"></i>`;
    const M = {
      galaxy: () => `<i class="g-neb"></i><i class="g-band"></i>${st(90, 11, 0.12, 360)}${st(60, 29, 0.18, 220)}${st(30, 47, 0.26, 140, 'tw')}`,
      water: () => `<i class="w-glow"></i><i class="w-ray"></i><i class="mw w1"></i><i class="mw w2"></i><i class="mw w3"></i>${particles(14, 7, ['rgba(200,240,255,.55)'], 0.6, 1.8, 14, 26, 'pt bub')}`,
      rays: () => `<i class="r-glow"></i><i class="r-rays"></i>${particles(22, 5, ['rgba(255,236,190,.7)', 'rgba(255,255,255,.6)'], 0.4, 1.2, 18, 34, 'pt dust')}`,
      bokeh: () => particles(18, 3, ['rgba(255,200,120,.55)', 'rgba(255,140,170,.45)', 'rgba(150,180,255,.45)', 'rgba(255,240,200,.5)'], 6, 22, 22, 40),
      aurora: () => `${st(70, 13, 0.1, 999, 'still')}<i class="a-b a1"></i><i class="a-b a2"></i><i class="a-b a3"></i>`,
      dawn: () => `<i class="d-sun"></i><i class="d-cl c1"></i><i class="d-cl c2"></i>`,
      embers: () => `<i class="e-glow"></i>${particles(26, 9, ['rgba(255,170,80,.85)', 'rgba(255,120,40,.75)', 'rgba(255,220,150,.8)'], 0.6, 2.4, 9, 18, 'pt ember')}`,
    };
    return M[key] ? `<div class="wc-motion m-${key}">${M[key]()}</div>` : '';
  }

  // sound: 소리 켜고 한 번 재생 (예배당 화면에서만 — 미리보기·방송에서는 소리 없이)
  function bgHTML(url, cover = true, sound = false) {
    if (!url) return '';
    if (isVideo(url) && sound) return `<video class="wc-bg" src="${esc(url)}" autoplay playsinline data-sound="1" style="object-fit:${cover ? 'cover' : 'contain'}"></video>`;
    if (isVideo(url)) return `<video class="wc-bg" src="${esc(url)}" autoplay muted loop playsinline style="object-fit:${cover ? 'cover' : 'contain'}"></video>`;
    return `<div class="wc-bg" style="background-image:url('${esc(url)}');background-size:${cover ? 'cover' : 'contain'}"></div>`;
  }

  function textShadow(st) { return st.shadow ? '0 0.4cqh 1.2cqh rgba(0,0,0,.85)' : 'none'; }

  function elementsHTML(slide) {
    const ptH = num(slide.ptH, 540, 1, 1e5);
    return (slide.elements || []).map(e0 => {
      const e = safeEl(e0);
      const box = `left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%`;
      if (e.type === 'image') return `<img class="wc-el" style="${box};object-fit:contain" src="${esc(e.src)}">`;
      const fs = ((e.size || 24) / ptH * 100).toFixed(2) + 'cqh';
      if (e.type === 'table') {
        return `<table class="wc-el wc-table" style="${box};font-size:${fs};color:${e.color}">` +
          e.rows.map(r => '<tr>' + r.map(c => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>').join('') + '</table>';
      }
      return `<div class="wc-el wc-text" style="${box};font-size:${fs};color:${e.color};` +
        `font-weight:${e.bold ? 700 : 400};text-align:${e.align};${e.fill ? `background:${e.fill};` : ''}">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
    }).join('');
  }

  // 로고
  const POS = {
    c: 'left:50%;top:50%;transform:translate(-50%,-50%)', tl: 'left:4cqh;top:4cqh', tc: 'left:50%;top:4cqh;transform:translateX(-50%)',
    tr: 'right:4cqh;top:4cqh', bl: 'left:4cqh;bottom:4cqh', bc: 'left:50%;bottom:4cqh;transform:translateX(-50%)', br: 'right:4cqh;bottom:4cqh',
  };
  const logoObj = l => (typeof l === 'string' ? { url: l } : (l || {}));
  function logoImg(url, pos, size, opacity = 1) {
    url = mediaUrl(url); if (!url) return '';
    return `<img class="wc-logo" src="${esc(url)}" style="position:absolute;${POS[pos] || POS.c};height:${num(size, 40, 2, 95)}cqh;max-width:92cqw;object-fit:contain;opacity:${num(opacity, 1, 0.05, 1)}">`;
  }

  const themeOf = snap => THEMES[snap.item?.theme] || THEMES[''];
  function mainStyle(snap) {
    const { name, motion, ...t } = themeOf(snap);
    return safeMain({ ...snap.style.main, ...t });
  }
  // 이 슬라이드 뒤에 깔 움직이는 배경 (그림·PPT·HTML 슬라이드에는 깔지 않음)
  function motionKey(snap, st) {
    const L = snap.live || {}, s = snap.slide, main = snap.style.main || {};
    if (L.black || !s || s.bg || s.html || s.htmlFile || (s.elements && s.elements.length) || main.motionOn === false || mediaUrl(L.mediaBg)) return '';
    const t = themeOf(snap);
    const m = t.motion !== undefined ? t.motion : st.motion;
    if (!MOTIONS[m] || m === 'none') return '';
    if (m === 'video') { const u = mediaUrl(main.motionVideo); return u ? 'video:' + u : ''; }
    return m;
  }
  const isVisual = s => !!(s && (s.html || s.htmlFile || (s.elements || []).some(e => e.type === 'image') || (s.bg && !String(s.text || '').trim())));
  const isHtmlFile = s => /^\/slides\/[a-f0-9]{12}\.html$/.test(String(s?.htmlFile || ''));

  // HTML 파일(여러 장짜리 발표 자료): 1920×1080 으로 그린 뒤 화면 크기에 맞춰 줄임. 몇 번째 장인지는 #wc=번호
  function htmlFileHTML(s) {
    const page = Math.max(0, Math.floor(num(s.page, 0, 0, 9999)));
    return `<iframe class="wc-hfile" src="${esc(s.htmlFile)}#wc=${page}" sandbox="allow-scripts" scrolling="no" tabindex="-1" loading="lazy"></iframe>`;
  }
  function fitHtml(container) {
    const k = container.clientWidth / 1920;
    container.querySelectorAll('iframe.wc-hfile').forEach(f => (f.style.transform = `scale(${k})`));
  }
  const postPage = f => { try { f.contentWindow && f.contentWindow.postMessage({ wc: 'show', page: f._wcPage }, '*'); } catch {} };

  // 미디어 배경(미디어 칸에서 고른 사진·영상): 슬라이드와 다른 층 → 슬라이드를 넘겨도 영상이 처음부터 다시 시작하지 않음
  // fit: auto(영상 꽉 채우기·사진 전체 보이기) / cover / contain / small(가운데 작게 — 로고용)
  const FITS = ['auto', 'cover', 'contain', 'small'];
  const fitOf = (url, fit) => (['cover', 'contain', 'small'].includes(fit) ? fit : (isVideo(url) ? 'cover' : 'contain'));
  function fitStyle(f) {
    return `object-fit:${f === 'cover' ? 'cover' : 'contain'};background-size:${f === 'cover' ? 'cover' : 'contain'};` +
      (f === 'small' ? 'left:30%;top:30%;width:40%;height:40%;' : 'left:0;top:0;width:100%;height:100%;');
  }
  function mediaHTML(url, fit, still) {
    url = mediaUrl(url); if (!url) return '';
    const f = fitOf(url, fit);
    if (isVideo(url)) return still ? `<video class="wc-bg wc-media" style="${fitStyle(f)}" src="${esc(url)}#t=1" muted preload="metadata"></video>`
      : `<video class="wc-bg wc-media" style="${fitStyle(f)}" src="${esc(url)}" autoplay muted loop playsinline></video>`;
    return `<div class="wc-bg wc-media" style="${fitStyle(f)}background-image:url('${esc(url)}')"></div>`;
  }

  // noScript: OBS 브라우저 소스에서는 HTML 속 스크립트를 돌리지 않음.
  // (OBS가 페이지에 넣어 주는 장면 전환·방송 제어 기능을 HTML 자료가 건드리지 못하게)
  function slideInner(snap, st, still, noScript, audio) {
    const s = snap.slide;
    if (isHtmlFile(s)) return htmlFileHTML(s);
    if (s.html) return `<iframe class="wc-html" sandbox="${still || noScript ? '' : 'allow-scripts'}" srcdoc="${esc(s.html)}" tabindex="-1"></iframe>`;
    let inner = bgHTML(s.bg, s.fit !== 'contain', !!(audio && s.sound));
    if (s.elements && s.elements.length) return inner + elementsHTML(s);
    const jc = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign] || 'center';
    const ref = s.ref ? `<div class="wc-ref" style="font-size:${(st.size * 0.6).toFixed(2)}cqh;color:${st.refColor}">${esc(s.ref)}</div>` : '';
    const lines = String(s.text || '').split('\n');
    let body;
    if (st.headline && lines[0].trim()) {
      const rest = lines.slice(1).join('\n').trim();
      body = `<div class="wc-head" style="color:${st.headColor};font-size:${rest ? 1.2 : 1.3}em">${esc(lines[0])}</div>` +
        (rest ? `<div class="wc-sub" style="font-size:.8em">${esc(rest).replace(/\n/g, '<br>')}</div>` : '');
    } else body = esc(s.text).replace(/\n/g, '<br>');
    return inner + `<div class="wc-textwrap" style="justify-content:${jc};text-align:${st.align}">
      <div class="wc-text-main" dir="auto" style="font-family:${st.font};font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};
        line-height:${st.lineHeight};text-shadow:${textShadow(st)};${st.strokeWidth ? `-webkit-text-stroke:${st.strokeWidth / 10}cqh ${st.stroke};paint-order:stroke fill;` : ''}">${body}</div>${ref}</div>`;
  }

  function mainHTML(snap, opts = {}) {
    const st = mainStyle(snap), s = snap.slide, L = snap.live || {};
    if (L.black || !s) {
      const lg = logoObj(snap.logo);
      const logo = L.logo && lg.url ? logoImg(lg.url, lg.screenPos || 'c', lg.screenSize || 50) : '';
      // 띄운 슬라이드가 없어도 미디어 배경은 보이게 (검은 화면을 직접 켠 때만 가림)
      const see = !L.black && !L.logo && mediaUrl(L.mediaBg);
      return `<div class="wc-layer" style="background:${see ? 'transparent' : '#000'}">${logo}</div>`;
    }
    const mk = motionKey(snap, st);
    const under = mk || (mediaUrl(L.mediaBg) && !s.bg && !isHtmlFile(s));   // 아래에 움직이는 배경이나 미디어 배경이 깔림 → 바탕을 투명하게
    const bg = under ? 'transparent' : col(s.bgColor, st.bg);
    return `<div class="wc-layer"${under ? ' data-tr="1"' : ''} style="background:${bg}">${L.clear ? '' : slideInner(snap, st, opts.still, false, opts.audio)}</div>`;
  }

  function hexA(hex, a) {
    const n = parseInt((hex || '#000000').slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  // 방송(OBS)에 무엇을 보낼지: off(카메라만) · caption(자막 바) · full(슬라이드 화면 그대로: 그림·악보·PPT 그림·HTML)
  function bcMode(snap) {
    const s = snap.slide, L = snap.live || {};
    if (L.black || L.clear || L.overlayOff || snap.item?.noBroadcast || !s) return 'off';
    if (isHtmlFile(s)) return 'off';   // HTML 파일 자료는 스크립트가 돌아야 해서 OBS에는 보내지 않음 (OBS 제어 기능 보호)
    if (snap.item?.bcFull) return 'full';
    if (isVisual(s)) return safeOverlay(snap.style.overlay || {}).imgMode === 'none' ? 'off' : 'full';
    return String(s.text || '').trim() ? 'caption' : 'off';
  }

  function overlayHTML(snap, opts = {}) {
    const mode = bcMode(snap), s = snap.slide;
    if (mode === 'off') return '<div class="wc-layer"></div>';
    if (mode === 'full') {
      const st = mainStyle(snap), mk = motionKey(snap, st), ov = safeOverlay(snap.style.overlay || {});
      const screen = `${motionHTML(mk, opts.still)}${slideInner(snap, st, opts.still, true)}`;
      const bg = mk ? '#000' : col(s.bgColor, st.bg);
      if (ov.imgMode === 'part' && !snap.item?.bcFull) {
        // 화면 일부: 원래 크기로 그린 뒤 줄여서 구석에 → 나머지는 카메라가 보임
        const v = { t: 'top', m: 'center', b: 'bottom' }[ov.partPos[0]], h = ov.partPos[1] === 'r' ? 'right' : 'left';
        const vCss = v === 'center' ? 'top:0' : `${v}:4%`;
        return `<div class="wc-layer"><div class="wc-part" style="${vCss};${h}:3%;transform:scale(${ov.partSize / 100});transform-origin:${v} ${h};background:${bg}">${screen}</div></div>`;
      }
      const pip = snap.live?.pip && opts.preview ? '<div class="wc-pip-ph">👤 사람 화면<small>(OBS 장면 전환)</small></div>' : '';
      return `<div class="wc-layer" style="background:${bg}">${screen}${pip}</div>`;
    }
    const st = safeOverlay(snap.style.overlay);
    const title = st.showTitle && (s.ref || (snap.item?.type === 'song' ? snap.item.title : ''));
    const pos = st.position === 'top' ? 'top:4cqh' : 'bottom:5cqh';
    return `<div class="wc-layer"><div class="wc-ov" style="${pos};background:${hexA(st.box, st.boxOpacity)};font-family:${st.font}">
      ${title ? `<div class="wc-ov-title" style="font-size:${(st.size * 0.55).toFixed(2)}cqh">${esc(title)}</div>` : ''}
      <div class="wc-ov-text" dir="auto" style="font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};line-height:${st.lineHeight}">${esc(s.text).replace(/\n/g, '<br>')}</div>
    </div></div>`;
  }

  function stageHTML(snap) {
    const s = snap.slide, n = snap.next, L = snap.live;
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const status = (L.black ? '■ 검은 화면' : L.clear ? '◻ 글자 지움' : '● 송출 중') +
      (L.overlayOff || snap.item?.noBroadcast ? ' · 방송 자막 꺼짐' : '');
    const txt = x => x?.htmlFile ? (x.text || '[HTML 화면]') : x?.html ? '[HTML 화면]' : (x?.text || (x?.bg || x?.elements?.length ? '[그림]' : ''));
    return `<div class="wc-layer wc-stage">
      <div class="wc-st-top"><span>${esc(snap.item?.title || '대기')}</span><span>${snap.item ? `${L.index + 1} / ${snap.item.count}` : ''}</span><span class="wc-st-status">${status}</span><span class="wc-clock">${now}</span></div>
      <div class="wc-st-cur" dir="auto">${esc(txt(s)).replace(/\n/g, '<br>')}${s?.ref ? `<div class="wc-st-ref">${esc(s.ref)}</div>` : ''}</div>
      <div class="wc-st-next"><b>다음</b> ${esc(n ? txt(n) : '— 끝 —').replace(/\n/g, ' / ')}</div>
    </div>`;
  }

  const RENDER = { main: mainHTML, overlay: overlayHTML, stage: stageHTML };

  // 바뀔 때만 다시 그리는 고정 층 (움직이는 배경은 슬라이드가 넘어가도 끊기지 않게)
  function persist(container, cls, key, make, top, fade) {
    const old = container.querySelector(`:scope > .${cls}`);
    if ((old?._key || '') === key) return;
    if (old) {
      old.className = cls + '-old';
      if (fade) { old.style.transition = 'opacity .7s'; old.style.opacity = 0; setTimeout(() => old.remove(), 750); } else old.remove();
    }
    if (!key) return;
    const el = document.createElement('div');
    el.className = cls; el._key = key; el.innerHTML = toVp(make());
    el.style.cssText = `position:absolute;inset:0;pointer-events:none;${top ? 'z-index:5;' : ''}`;
    if (top) container.appendChild(el); else container.prepend(el);
    if (fade) { el.style.opacity = 0; el.style.transition = 'opacity .7s'; fadeIn(el, 750); }
  }

  // 페이드 전환 렌더
  function render(container, snap, mode, opts = {}) {
    const fade = opts.fade !== false;
    container.classList.toggle('wc-still', !!opts.still);
    const L0 = snap.live || {};
    if (mode === 'main' || mode === 'overlay') {
      // 미디어 배경: 예배당 화면에는 늘, 방송에는 '방송에도'를 켰을 때만 (검은 화면·방송 자막 끄기면 안 나감)
      const url = mediaUrl(L0.mediaBg);
      const on = url && !L0.black && (mode === 'main' || (L0.mediaObs && !L0.overlayOff));
      const key = on ? url + '|' + fitOf(url, L0.mediaFit) : '';
      const cur = container.querySelector(':scope > .wc-mlayer');
      if (cur && key && cur._url === url && cur._key !== key) {        // 같은 파일에서 맞춤만 바뀜 → 영상을 다시 불러오지 않음
        cur.firstElementChild.style.cssText += ';' + fitStyle(fitOf(url, L0.mediaFit)); cur._key = key;
      } else {
        persist(container, 'wc-mlayer', key, () => mediaHTML(url, L0.mediaFit, opts.still), false, fade);
        const n = container.querySelector(':scope > .wc-mlayer'); if (n) n._url = url;
      }
    }
    if (mode === 'main') {
      const mk = motionKey(snap, mainStyle(snap));
      persist(container, 'wc-mbase', mk, () => motionHTML(mk, opts.still), false, fade);
    }
    if (mode === 'main' || mode === 'overlay') {
      const lg = logoObj(snap.logo), L = snap.live || {};
      const show = lg.url && lg.mark && !L.black && (mode === 'main' || lg.markOverlay);
      const html = show ? logoImg(lg.url, lg.markPos || 'tr', lg.markSize || 10, lg.markOpacity ?? 0.85) : '';
      persist(container, 'wc-mark', html, () => html, true, false);
    }
    if (!opts.still) extras(container, snap, mode);
    const html = toVp(RENDER[mode](snap, opts));
    if (container._wcHTML === html) return;
    // 같은 HTML 파일에서 장만 바뀌면 다시 불러오지 않고 '이 장 보여 줘' 신호만 보냄
    const fm = html.match(/iframe class="wc-hfile" src="([^"#]+)#wc=(\d+)"/);
    const frameKey = fm ? html.replace(/#wc=\d+"/, '"') : null;
    if (frameKey && container._wcFrameKey === frameKey) {
      const f = container.querySelector(':scope > .wc-layer:last-of-type iframe.wc-hfile');
      if (f) { container._wcHTML = html; f._wcPage = +fm[2]; postPage(f); return; }
    }
    container._wcFrameKey = frameKey;
    container._wcHTML = html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const layer = tmp.firstElementChild;
    const olds = [...container.querySelectorAll(':scope > .wc-layer')];
    const mark = container.querySelector(':scope > .wc-mark');
    container.insertBefore(layer, mark || null);
    const frames = [...layer.querySelectorAll('iframe.wc-hfile')];
    frames.forEach(f => { f._wcPage = fm ? +fm[2] : 0; f.addEventListener('load', () => postPage(f)); });
    if (frames.length) {
      fitHtml(container);
      if (!container._wcRO && window.ResizeObserver) (container._wcRO = new ResizeObserver(() => fitHtml(container))).observe(container);
    }
    const swap = () => {
      if (fade) {
        fadeIn(layer);
        if (layer.dataset.tr || mode === 'overlay') olds.forEach(o => (o.style.opacity = 0));  // 투명 층은 서로 겹쳐 보이지 않게 같이 바꿈
        setTimeout(() => olds.forEach(o => o.remove()), 320);
      } else olds.forEach(o => o.remove());
    };
    if (fade) layer.style.opacity = 0;
    // HTML 파일은 다 그려진 뒤 바꿈 (깜빡임 방지, 최대 1.5초)
    if (frames.length && fade) {
      let done = false;
      const go = () => { if (!done) { done = true; setTimeout(swap, 80); } };
      frames[0].addEventListener('load', go, { once: true });
      setTimeout(go, 1500);
    } else swap();
  }

  // 썸네일용: 특정 슬라이드를 즉시 렌더 (움직임 멈춤)
  function thumb(container, slide, style, item, still = true) {
    render(container, { slide, style, live: {}, item }, 'main', { fade: false, still });   // 썸네일에는 미디어 배경 없음
  }

  // ── 곡 구성(Arrangement): 슬라이드에 '1절·후렴·브리지' 이름을 붙이고, 부를 순서를 정함 ──
  // 이름 붙은 슬라이드부터 다음 이름 전까지가 한 묶음. 순서(arr)가 없으면 원래 순서 그대로
  function seq(it) {
    const sl = it?.slides || [], arr = (it?.arr || []).filter(Boolean);
    if (!arr.length || !sl.some(s => s.label)) return sl;
    const groups = new Map(); let cur = null;   // Map: 이름이 '__proto__' 같아도 안전
    for (const s of sl) { if (s.label) { cur = String(s.label); if (!groups.has(cur)) groups.set(cur, []); } if (cur) groups.get(cur).push(s); }
    const out = arr.flatMap(l => groups.get(String(l)) || []);
    return out.length ? out : sl;
  }

  // ── 타이머·무대 메시지·이름 자막: 슬라이드와 따로 위에 얹는 층 (1초마다 숫자만 바뀜) ──
  function timeLeft(snap) {
    const t = snap.live?.timer; if (!t || !t.end) return null;
    if (snap.now && !snap._recv) snap._recv = Date.now();
    const now = snap.now ? snap.now + (Date.now() - snap._recv) : Date.now();
    return Math.round((t.end - now) / 1000);
  }
  function fmt(sec) {
    const neg = sec < 0, a = Math.abs(sec), h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, s = a % 60;
    return (neg ? '+' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function extrasHTML(snap, mode) {
    const L = snap.live || {}, t = L.timer, p = snap.prop, parts = [];
    const timerOn = t && t.end && (mode === 'stage' || (mode === 'main' && ['corner', 'big'].includes(t.tv)));
    if (timerOn) {
      const kind = mode === 'stage' ? 'stage' : t.tv;
      parts.push(`<div class="wc-tm wc-tm-${kind}">${t.label ? `<div class="wc-tm-l">${esc(t.label)}</div>` : ''}<div class="wc-tm-v"></div></div>`);
    }
    if (p && p.text && !L.black && ((mode === 'main' && p.where !== 'obs') || (mode === 'overlay' && p.where !== 'tv' && !L.overlayOff))) {
      parts.push(`<div class="wc-prop wc-prop-${p.pos === 'top' ? 'top' : 'bottom'}"><div class="wc-prop-t">${esc(p.text)}</div>${p.sub ? `<div class="wc-prop-s">${esc(p.sub)}</div>` : ''}</div>`);
    }
    if (mode === 'stage' && L.msg) parts.push(`<div class="wc-msg">${esc(L.msg)}</div>`);
    return parts.join('');
  }
  function extras(container, snap, mode) {
    const html = toVp(extrasHTML(snap, mode));
    persist(container, 'wc-extra', html, () => html, true, false);
    const el = container.querySelector(':scope > .wc-extra .wc-tm-v');
    if (el) {
      const left = timeLeft(snap);
      el.textContent = left == null ? '' : fmt(left);
      el.parentElement.classList.toggle('over', left != null && left < 0);
    }
  }
  // 1초마다 부름: 타이머 숫자만 바꿈 (슬라이드는 다시 그리지 않음)
  function tick(container, snap, mode) { if (snap) extras(container, snap, mode); }

  window.WC = { render, thumb, esc, bcMode, FONTS, MOTIONS, THEMES, POS, FITS, seq, tick, fmt };
})();
