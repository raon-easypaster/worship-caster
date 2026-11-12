// 문구·예배 순서·성찬 예식 템플릿
// 성경 본문은 넣지 않음 — 성찬 제정의 말씀은 연결된 성경 폴더에서 그때그때 불러옴

// [분류, 기본 테마, 문구들]
const PHRASES = [
  ['예배 준비', 'prayer', [
    '지금은 기도로\n예배를 준비하는 시간입니다',
    '휴대전화는 무음으로 해 주시고\n기도로 예배를 준비해 주십시오',
    '잠시 후 예배가 시작됩니다',
    '오늘 예배에 오신 여러분을\n환영합니다',
  ]],
  ['예배 순서', 'title', [
    '예배의 부름', '경배와 찬양', '신앙고백\n사도신경', '대표 기도\n(기도하실 분)', '성경 봉독\n(본문)', '말씀 선포\n(설교 제목)',
    '응답의 찬양', '봉헌\n감사의 예물을 드립니다', '봉헌 기도', '교회 소식', '축도', '주기도문',
  ]],
  ['기도', 'prayer', [
    '다 함께 기도합니다', '통성으로 기도합니다', '중보 기도 시간입니다', '서로를 위해 축복하며 기도합니다', '침묵으로 기도합니다',
  ]],
  ['교제·광고', 'notice', [
    '새가족을 환영합니다\n함께 예배하게 되어 기쁩니다', '교회 소식\n예배 후 친교실에서 함께 식사합니다',
    '생일·결혼기념일을 축하합니다', '다음 주 예배 안내\n(날짜·시간)',
  ]],
  ['마침', 'title', [
    '예배를 마칩니다\n한 주간도 주님과 동행하세요', '파송의 찬양', '평안히 돌아가십시오',
  ]],
];

// 예배 순서 템플릿: 각 줄 = [문구, 테마]
const T = (text, theme = 'title') => [text, theme];
const PREP = T('지금은 기도로\n예배를 준비하는 시간입니다', 'prayer');
const SERVICES = {
  sunday: { name: '주일 예배', steps: [PREP, T('예배의 부름'), T('경배와 찬양'), T('신앙고백\n사도신경'), T('대표 기도\n(기도하실 분)'), T('성경 봉독\n(본문)'), T('말씀 선포\n(설교 제목)'), T('응답의 찬양'), T('봉헌\n감사의 예물을 드립니다'), T('교회 소식\n(광고)', 'notice'), T('축도'), T('예배를 마칩니다\n한 주간도 주님과 동행하세요')] },
  communion: { name: '성찬 주일', steps: [PREP, T('예배의 부름'), T('경배와 찬양'), T('신앙고백\n사도신경'), T('대표 기도\n(기도하실 분)'), T('성경 봉독\n(본문)'), T('말씀 선포\n(설교 제목)'), 'COMMUNION', T('봉헌\n감사의 예물을 드립니다'), T('교회 소식\n(광고)', 'notice'), T('축도')] },
  afternoon: { name: '주일 오후 예배', steps: [PREP, T('찬양'), T('기도\n(기도하실 분)'), T('성경 봉독\n(본문)'), T('말씀\n(설교 제목)'), T('봉헌'), T('교회 소식\n(광고)', 'notice'), T('주기도문')] },
  praise: { name: '찬양 예배', steps: [PREP, T('찬양으로 여는 예배'), T('경배와 찬양'), T('함께 기도합니다', 'prayer'), T('말씀\n(설교 제목)'), T('결단의 찬양'), T('축도')] },
  wednesday: { name: '수요 예배', steps: [PREP, T('찬양'), T('기도\n(기도하실 분)'), T('성경 봉독\n(본문)'), T('말씀\n(설교 제목)'), T('봉헌'), T('주기도문')] },
  friday: { name: '금요 기도회', steps: [PREP, T('경배와 찬양'), T('말씀\n(설교 제목)'), T('통성으로 기도합니다', 'prayer'), T('중보 기도 시간입니다', 'prayer'), T('마침 기도')] },
  dawn: { name: '새벽 기도회', steps: [T('새벽 기도회', 'word_dawn'), T('찬송'), T('말씀\n(본문)', 'word_dawn'), T('개인 기도', 'prayer')] },
};
const SERVICE_LIST = [['', '빈 순서'], ...Object.entries(SERVICES).map(([k, v]) => [k, v.name])];

// 성찬 예식: 성경 폴더가 있으면 고린도전서 11:23-26 을 불러와 넣음
function communionItem(bible) {
  const slides = [{ text: '성찬 예식\n주님의 몸과 피를 기억합니다' }];
  let ok = false;
  try {
    const v = bible.defaultVersion();
    const r = v && bible.lookup('고전 11:23-26', v);
    if (r && !r.error && r.verses?.length) {
      ok = true;
      slides.push({ text: '성찬 제정의 말씀\n고린도전서 11:23-26' });
      for (const x of r.verses) slides.push({ text: x.text, ref: `${r.book} ${r.ch}:${x.v} (${r.version})` });
    }
  } catch {}
  if (!ok) slides.push({ text: '성찬 제정의 말씀\n고린도전서 11:23-26\n(＋ 성경으로 본문을 넣으세요)' });
  slides.push(
    { text: '감사 기도' },
    { text: '떡을 나눕니다\n우리를 위해 찢기신 주님의 몸을 기억합니다' },
    { text: '잔을 나눕니다\n주님의 피로 세운 새 언약을 기억합니다' },
    { text: '함께 기도합니다\n주님 오실 때까지 주의 죽으심을 전합니다' },
    { text: '성찬 후 감사 찬양' },
  );
  return { type: 'text', title: '성찬 예식', theme: 'communion', slides };
}

module.exports = { PHRASES, SERVICES, SERVICE_LIST, communionItem };
