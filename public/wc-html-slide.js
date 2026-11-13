// smdjoo-stack 님 버전(worship-caster-on)에서 가져옴
// HTML 슬라이드 도우미 — 예배송출이 가져온 HTML 파일 안에서 실행됨 (샌드박스, 앱 조종 불가)
//   #wc=3      → 3번째(0부터) 슬라이드 한 장만 보여 줌 (나머지·넘김 버튼·진행 막대 숨김)
//   #wc=count  → 슬라이드 수와 각 장의 글자를 부모 창에 알려 줌 (가져오기용)
(function () {
  const SLIDE_SELECTORS = ['.slide', '[data-slide]', 'section.slide', '.reveal .slides > section', 'body > section', 'main > section', 'section'];
  const NAV_SELECTORS = '.controls,.nav,.navigation,.progress,.progress-bar,.slide-number,.slide-counter,.counter,.pagination,.page-number,.dots,.indicators,#progress,#controls,#nav,#counter,.prev,.next,.btn-prev,.btn-next,[class*="nav-btn"],[class*="progress"]';

  // 서로 겹치지 않는(안쪽에 들어 있지 않은) 슬라이드 목록
  function findSlides() {
    for (const sel of SLIDE_SELECTORS) {
      const all = [...document.querySelectorAll(sel)];
      const top = all.filter(el => !all.some(o => o !== el && o.contains(el)));
      if (top.length > 1) return top;
    }
    return [];
  }

  function show(idx) {
    const slides = findSlides();
    if (!slides.length) return;              // 한 장짜리 HTML: 그대로 보여 줌
    const cur = slides[Math.min(idx, slides.length - 1)];
    const st = document.getElementById('wc-style') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'wc-style' }));
    st.textContent = `
      html, body { overflow: hidden !important; cursor: none !important; }
      [data-wc-hide] { display: none !important; }
      [data-wc-cur] { visibility: visible !important; opacity: 1 !important; }
      /* 현재 장을 화면 가득: 슬라이드 프로그램의 위·아래 막대(제목줄·넘김 버튼) 없이 */
      [data-wc-cur][data-wc-full] { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
        max-width: none !important; max-height: none !important; min-height: 0 !important; margin: 0 !important; transform: none !important;
        z-index: 2147483000 !important; overflow: hidden !important; }
      *, *::before, *::after { transition-duration: 0s !important; animation-delay: 0s !important; }`;
    slides.forEach(s => {
      if (s === cur) {
        s.removeAttribute('data-wc-hide');
        s.setAttribute('data-wc-cur', '');
        s.classList.add('active', 'current', 'present', 'visible', 'show');
        s.classList.remove('hidden', 'past', 'future', 'prev', 'next');
      } else {
        s.classList.remove('active', 'current', 'present', 'visible', 'show');
        s.removeAttribute('data-wc-cur');
        s.setAttribute('data-wc-hide', '');
      }
    });
    cur.setAttribute('data-wc-full', '');
    // 넘김 버튼·진행 막대·제목줄·대화상자 숨김 (슬라이드 안의 내용은 건드리지 않음)
    document.querySelectorAll(NAV_SELECTORS + ',header,footer,nav,dialog,.start,.restart,.toolbar,.edit-tools').forEach(el => {
      if (!slides.some(s => s.contains(el) || el.contains(s))) el.setAttribute('data-wc-hide', '');
    });
    if (getComputedStyle(cur).display === 'none') cur.style.setProperty('display', 'block', 'important');
  }

  function report() {
    const slides = findSlides();
    const list = slides.length ? slides : [document.body];
    parent.postMessage({ wc: 'count', n: list.length, texts: list.map(s => (s.innerText || s.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, 400)) }, '*');
  }

  // 페이지 맨 앞에서 실행되므로, 슬라이드 프로그램이 주소를 바꾸기 전의 값을 저장해 둠
  const HASH = decodeURIComponent(location.hash.slice(1));
  let cur = null;
  function apply(idx) {
    cur = idx;
    show(idx);
    // 슬라이드 프로그램이 나중에 첫 장으로 되돌려 놓는 경우가 있어 몇 번 더 적용
    [150, 600, 1500].forEach(t => setTimeout(() => { if (cur === idx) show(idx); }, t));
  }
  function run() {
    const h = HASH;
    const m = h.match(/(?:^|&)wc=([^&]+)/);
    if (!m) return;
    if (m[1] === 'count') return report();
    apply(cur ?? Math.max(0, parseInt(m[1], 10) || 0));
  }

  // [패치] 파일을 다시 불러오지 않고 장만 바꿈: 운영 화면이 { wc: 'show', page } 를 보냄
  addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.wc !== 'show' || /wc=count/.test(HASH)) return;
    const idx = Math.max(0, parseInt(e.data.page, 10) || 0);
    if (idx !== cur) apply(idx);
  });

  // 키보드·마우스 넘김 막기 (운영 화면에서만 넘김)
  ['keydown', 'wheel', 'click', 'touchstart'].forEach(ev => addEventListener(ev, e => { e.stopImmediatePropagation(); }, true));

  // 슬라이드가 다 만들어진 뒤 적용, 그림까지 다 불러온 뒤 한 번 더
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', run); else run();
  if (document.readyState !== 'complete') addEventListener('load', () => { if (!/wc=count/.test(HASH)) run(); });
})();
