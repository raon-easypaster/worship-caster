// 메뉴 언어 (한국어 · English)
// 한국어 문장을 그대로 열쇠로 씀 → 영어가 빠진 곳은 한국어로 나올 뿐 깨지지 않음
// 가사·말씀 같은 자막 내용(.wc-screen 안)과 입력칸은 번역하지 않음
(function () {
  const EN = {
    // ── 맨 위 · 공통 ──
    '예배송출': 'Worship Caster', '운영 · 송출': 'Operator', '웹 편집기 · 준비 전용': 'Web editor · prep only',
    '📺 예배당 화면 열기': '📺 Open Main Screen', '🎤 프롬프터 열기': '🎤 Open Prompter', '🎥 OBS 자막 주소': '🎥 OBS Caption URL',
    '🎨 자막 스타일': '🎨 Caption Style', '🖼 미디어': '🖼 Media', '⚙︎ 설정': '⚙︎ Settings', '⏻ 종료': '⏻ Quit', '프로그램 종료': 'Quit the program',
    '설정': 'Settings', '닫기': 'Close', '취소': 'Cancel', '저장': 'Save', '적용': 'Apply', '삭제': 'Delete', '추가': 'Add', '빼기': 'Remove',
    '복사': 'Copy', '만들기': 'Create', '고르기': 'Choose', '고르세요': 'Choose', '들어가기': 'Enter', '켜기': 'On', '꺼짐': 'Off', '없음': 'None',
    '오류': 'Error', '오류가 발생했습니다': 'Something went wrong', '저장했습니다': 'Saved', '삭제했습니다': 'Deleted', '복사했습니다': 'Copied',
    '고쳤습니다': 'Updated', '올렸습니다': 'Uploaded', '올리는 중…': 'Uploading…', '불러오는 중…': 'Loading…', '잘못된 값': 'Invalid value',
    '연결 끊김': 'Disconnected', '서버 연결 끊김 — 재연결 중': 'Server disconnected — reconnecting', '파일 선택': 'Choose file', '파일 없음': 'No file',
    '파일을 고르세요': 'Choose a file', '파일': 'File', '이름': 'Name', '날짜': 'Date', '제목': 'Title', '종류': 'Type', '크기': 'Size', '위치': 'Position',
    '시작': 'Start', '정지': 'Stop', '보내기': 'Send', '지우기': 'Clear', '위로': 'Up', '아래로': 'Down', '또는': 'or', '까지': 'until', '분': 'min',
    '쉬운목사 이광복': 'Easy Pastor Lee Kwangbok', '예배송출 · 만든 사람: 쉬운목사 이광복': 'Worship Caster · made by Easy Pastor Lee Kwangbok',
    '· 무료로 나눕니다': '· free to share',
    // ── 로그인 ──
    '예배송출 웹 편집기': 'Worship Caster Web Editor', '운영 맥에서 정한 PIN을 입력하세요.': 'Enter the PIN set on the operator computer.',
    'PIN이 맞지 않습니다': 'Wrong PIN', 'PIN 로그인이 필요합니다': 'PIN login required',
    // ── 왼쪽: 예배 순서 · 자료실 ──
    '새 예배 순서': 'New service', '이름·날짜 변경': 'Rename / change date', '예배 순서 삭제': 'Delete service',
    '콘티 — 키·빠르기·메모, 카톡용 복사, 인쇄': 'Setlist — key, tempo, notes, copy for chat, print',
    '예배 순서에 넣기': 'Add to service', '＋ 찬양': '＋ Song', '＋ 성경': '＋ Bible', '＋ 문구·성찬': '＋ Text · Communion', '＋ 광고': '＋ Notice',
    '＋ PPT': '＋ PPT', '＋ PDF·악보': '＋ PDF · Score', '＋ HTML': '＋ HTML',
    "'지금은 기도로 예배를 준비하는 시간입니다' 같은 문구, 성찬 예식": "Phrases like 'Let us prepare for worship in prayer', and Communion",
    '웹 페이지(HTML)를 화면에 띄우기': 'Show a web page (HTML) on screen',
    '새 자료는 순서에서 고른 자료 다음에 들어갑니다.': 'New items go right after the item selected in the service.', '다음': 'Next',
    '찬양 자료실': 'Song Library', '최근순': 'Recent', '가나다순': 'A–Z', '가져오기': 'Import', '찬양 검색 (제목·가사)': 'Search songs (title, lyrics)',
    '세라핌·동역 콘티에서 받은 곡 파일(.json)이나 가사 글 파일(.txt)을 자료실에 넣기': 'Import song files (.json from Seraphim/Dongyeok, or lyric .txt files) into the library',
    '예배 순서 없음': 'No service', '예배 순서가 비어 있습니다': 'The service is empty', '예배 순서에서 자료를 고르세요': 'Choose an item from the service',
    '순서에서 빼기': 'Remove from service', '예배 순서에 추가': 'Add to service', '예배 순서에 넣었습니다': 'Added to the service',
    '예배 순서를 만들었습니다': 'Service created', '예배 순서를 먼저 만드세요': 'Create a service first',
    '찬양 자료실에 남습니다': 'Stays in the song library', '예배 순서에서 빼면 지워집니다': 'Deleted when removed from the service',
    '아직 없습니다.': 'Nothing yet.',
    // 종류
    '찬양': 'Song', '말씀': 'Scripture', '성경': 'Bible', '문구': 'Text', '광고': 'Notice', '악보·PDF': 'Score · PDF', 'PPT': 'PPT', 'HTML': 'HTML',
    // ── 가운데: 슬라이드 · 미디어 배경 ──
    '자료를 선택하세요': 'Select an item', '✎ 편집': '✎ Edit', '슬라이드': 'Slides',
    '슬라이드가 없습니다. ✎ 편집에서 내용을 넣으세요.': 'No slides yet. Add content with ✎ Edit.',
    '🎞 미디어 배경': '🎞 Media Background', '미디어 배경': 'Media background', '방송에도 내보내기': 'Also send to stream', '· 대기': '· Standby', '전체': 'All', '영상': 'Video', '사진': 'Photo', '배경 없음': 'No background', '미리보기 크기': 'Thumbnail size',
    '＋ 올리기': '＋ Upload', '배경 크기 맞춤 (파일마다 기억)': 'Background fit (remembered per file)', '맞춤: 자동': 'Fit: Auto', '꽉 채우기': 'Fill',
    '전체 보이기': 'Fit whole', '작게 (로고)': 'Small (logo)', '🎥 방송에도': '🎥 Also on stream', '미디어 배경을 방송(OBS)에도 똑같이 내보내기': 'Send the media background to the stream (OBS) too',
    '⏹ 배경 끄기': '⏹ Background off', '예배당 화면의 미디어 배경 끄기': 'Turn off the media background on the main screen', '미디어 칸 접기·펴기': 'Collapse / expand media',
    '사진·영상을 ＋ 올리기로 넣으면 여기에 나옵니다. 누르면 예배당 화면 배경으로 계속 나오고, 슬라이드 글자는 그 위에 얹힙니다.':
      'Photos and videos you add with ＋ Upload appear here. Click one to keep it as the main-screen background; slide text sits on top.',
    '예배당 화면 배경으로 내보냈습니다': 'Sent to the main-screen background',
    '끌어서 왼쪽 칸 너비 조절 · 두 번 누르면 처음대로': 'Drag to resize the left panel · double-click to reset',
    '끌어서 오른쪽 칸 너비 조절 · 두 번 누르면 처음대로': 'Drag to resize the right panel · double-click to reset',
    '끌어서 슬라이드·미디어 배경 높이 조절 · 두 번 누르면 처음대로': 'Drag to resize slides / media · double-click to reset',
    '처음 너비로 되돌렸습니다': 'Width reset', '처음 높이로 되돌렸습니다': 'Height reset',
    // ── 오른쪽: 미리보기 · 송출 ──
    '📺 예배당 화면': '📺 Main Screen', '🎥 방송 자막 (OBS)': '🎥 Stream Captions (OBS)', '방송 바로 조절': 'Quick stream settings',
    '예배당 글자 크기 ( [ / ] 키 )': 'Main screen text size ( [ / ] keys )', '방송 글자 크기 ( Shift+[ / Shift+] 키 )': 'Stream text size ( Shift+[ / Shift+] )',
    '🎛 송출 조작': '🎛 Output Controls', '◀ 이전': '◀ Prev', '다음 ▶': 'Next ▶', '■ 검은화면': '■ Black', '■ 검은 화면': '■ Black screen',
    '◻ 글자 지우기': '◻ Clear text', '◻ 글자 지움': '◻ Text cleared', '✝ 로고': '✝ Logo', '모두 끄기': 'All off', '🎥 방송 자막 끄기': '🎥 Stream captions off',
    '🎥 방송 자막 다시 켜기': '🎥 Stream captions on', '🎥 방송 끄기': '🎥 Stream off', '👤 사람 화면': '👤 Camera PiP', '🌌 움직이는 배경': '🌌 Motion background',
    '예배당 TV에는 그대로 나가고, 유튜브(OBS)에만 자막을 끕니다': 'Keeps the main TV on and turns captions off only on YouTube (OBS)',
    '그림·악보·PPT를 유튜브에 보낼 때 오른쪽 아래에 사람(카메라) 화면을 작게 띄웁니다 (OBS 장면 전환 설정 필요)':
      'When sending pictures, scores or PPT to YouTube, show the camera small in the lower right (needs OBS scene setup)',
    '움직이는 배경 켜기/끄기': 'Motion background on/off', '⏭ 다음 슬라이드': '⏭ Next slide', '— 마지막 슬라이드 —': '— Last slide —', '— 끝 —': '— End —',
    '단축키: → Space 다음 · ← 이전 · 숫자키 1~9 슬라이드 · O 방송 자막 끄기 · P 사람 화면 · [ ] 글자 크기 (Shift: 방송)':
      'Keys: → Space next · ← prev · 1–9 slide · O stream captions off · P camera PiP · [ ] text size (Shift: stream)',
    '🎥 방송에도 나가는 중': '🎥 Also on stream', '꺼짐 — 예배당 화면에만 나가는 중': 'Off — main screen only',
    '먼저 자료의 슬라이드를 하나 띄우세요': 'Show a slide from an item first',
    '사람 화면을 쓰려면 🎥 OBS 자막 주소 → 사람 화면 설정을 해 주세요': 'To use Camera PiP, set it up in 🎥 OBS Caption URL → camera scene',
    '바꾸면 바로 방송에 적용됩니다': 'Changes apply to the stream immediately', '그림 보내기': 'Pictures', '화면 가득': 'Full screen',
    '화면 일부 (카메라 보이게)': 'Part of screen (camera visible)', '화면 일부': 'Part of screen', '보내지 않기 (자막만)': "Don't send (captions only)",
    '보내지 않기': "Don't send", '자막 위치': 'Caption position', '바 진하기': 'Bar opacity', '위': 'Top', '아래': 'Bottom',
    '오른쪽 위': 'Top right', '오른쪽 중간': 'Middle right', '오른쪽 아래': 'Bottom right', '왼쪽 위': 'Top left', '왼쪽 중간': 'Middle left', '왼쪽 아래': 'Bottom left',
    '위 가운데': 'Top center', '아래 가운데': 'Bottom center', '가운데': 'Center', '왼쪽': 'Left', '오른쪽': 'Right', '구석에 작게': 'Small in a corner',
    // ── 도구 ──
    '🧰 도구': '🧰 Tools', '⏱ 타이머': '⏱ Timer', '타이머': 'Timer', '💬 무대 메시지': '💬 Stage Message', '🏷 이름 자막': '🏷 Name Caption', '⏩ 자동 넘김': '⏩ Auto Advance',
    '이름 (예: 예배 시작까지)': 'Label (e.g. Service starts in)', '시각을 고르세요': 'Choose a time', '화면 가득 크게': 'Full screen', 'TV만': 'TV only',
    '예배당 화면': 'Main screen', '안 보임 (프롬프터만)': 'Hidden (prompter only)', '(프롬프터에만)': '(prompter only)',
    '설교자·찬양팀에게 보낼 말 (Enter)': 'Message to preacher / worship team (Enter)', '프롬프터에 메시지를 보냈습니다': 'Message sent to the prompter',
    '예배가 곧 시작됩니다': 'Service starts soon', '마이크 확인': 'Check mic', '한 번 더': 'One more time', '마무리': 'Wrap up',
    '✎ 로 이름 자막을 만드세요': 'Create name captions with ✎', '이름 자막 만들기·고치기': 'Create / edit name captions', '＋ 이름 자막 추가': '＋ Add name caption',
    '큰 글 (예: 설교 · 홍길동 목사)': 'Main line (e.g. Sermon · Pastor Kim)', '작은 글 (예: 말씀 제목)': 'Second line (e.g. sermon title)',
    '예배당+유튜브': 'Main + YouTube', '예배당만': 'Main only', '유튜브만': 'YouTube only',
    '설교자·특송·순서 맡은 분 이름을 화면 아래(또는 위) 띠로 띄웁니다. 운영 화면 도구 카드에서 누르면 켜지고, 다시 누르면 꺼집니다. 슬라이드를 넘겨도 계속 보입니다.':
      "Shows a speaker's name as a band at the bottom (or top). Click it in the Tools card to show, click again to hide. It stays while slides change.",
    '⏩ 자동 넘김 시작': '⏩ Start auto advance', '(광고 반복 등)': '(e.g. looping notices)', '끝나면 처음부터': 'Loop at the end',
    '지금 띄운 자료의 슬라이드를 정한 시간마다 넘깁니다. 다른 자료를 띄우거나 모두 끄기(Esc)를 누르면 멈춥니다.':
      'Advances the current item every few seconds. Stops when you show another item or press All off (Esc).',
    '5초': '5 s', '8초': '8 s', '10초': '10 s', '15초': '15 s', '20초': '20 s', '30초': '30 s', '1분': '1 min', '5분 남음': '5 min left',
    // ── 자료 편집 ──
    '자료 편집': 'Edit item', '새 자료': 'New item', '새 찬양': 'New song', '모양 (테마)': 'Look (theme)', '모양': 'Look', '유튜브 방송(OBS)': 'YouTube stream (OBS)',
    '자동 — 글자는 자막 바로, 그림은 화면 그대로': 'Auto — text as a caption bar, pictures as they are',
    '예배당 화면 그대로 보내기 (배경·글꼴까지)': 'Send the main screen as is (background and font)',
    '보내지 않기 — 예배당 화면에만 (기도 제목 등)': "Don't send — main screen only (prayer requests etc.)",
    '이 자료는 방송에 내보내지 않음': 'This item is not sent to the stream', '유튜브 방송에는 나가지 않음': 'Not sent to YouTube',
    '콘티': 'Setlist', '키 (예: G)': 'Key (e.g. G)', '흐름 메모 (예: 후렴 2번, 마지막 조용히)': 'Flow notes (e.g. chorus twice, end softly)',
    '가사 찾기': 'Find lyrics', '곡 제목 (가수를 함께 쓰면 더 잘 찾습니다)': 'Song title (adding the artist helps)', '🔎 가사 찾아 넣기': '🔎 Find lyrics',
    '못 찾으면': 'Not found?', '구글': 'Google', '네이버': 'Naver', '벅스': 'Bugs', '📋 복사한 가사 붙여넣고 정리': '📋 Paste & clean copied lyrics',
    '인터넷에서 복사한 가사를 붙여넣고, 코드·[후렴] 표시·작사/작곡 줄을 지웁니다': 'Pastes lyrics copied from the web and removes chords, [Chorus] marks and credit lines',
    '인터넷에서 찾는 중…': 'Searching the web…', '고르면 아래 가사 칸에 들어갑니다': 'Choose one to put it in the lyrics box below', '곡 제목을 넣으세요': 'Enter a song title',
    '가사를 찾지 못했습니다. 제목을 줄이거나 가수 이름을 넣어 보세요. 아래 구글·네이버로 찾아도 됩니다.':
      'No lyrics found. Try a shorter title or add the artist, or search Google / Naver below.',
    '인터넷에 연결할 수 없습니다': 'No internet connection',
    '가사를 넣었습니다. 확인 후 [나누어 슬라이드 만들기]를 누르세요': 'Lyrics added. Check them, then press [Split into slides]',
    '정리했습니다. 확인 후 [나누어 슬라이드 만들기]를 누르세요': 'Cleaned up. Check, then press [Split into slides]',
    '복사한 가사가 없습니다. 가사 칸에 직접 붙여넣은 뒤 다시 누르세요': 'Nothing copied. Paste into the lyrics box, then press again',
    '가사를 찾아 복사(⌘C / Ctrl+C)한 뒤 📋 버튼을 누르세요': 'Find the lyrics, copy them (⌘C / Ctrl+C), then press 📋',
    '가사·글 붙여넣기': 'Paste lyrics / text', '줄씩': 'lines each', '나누어 슬라이드 만들기 (덮어쓰기)': 'Split into slides (replace)', '뒤에 추가': 'Append',
    '가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다.&#10;묶음 첫 줄에 #1절 · #후렴 · #브리지 처럼 쓰면 곡 구성 이름이 붙습니다.':
      'Paste lyrics. A blank line always starts a new slide.\nStart a group with #Verse1 · #Chorus · #Bridge to name it.',
    '모든 슬라이드 배경': 'Background for all slides', '배경 선택': 'Choose background', '배경 없애기': 'Remove background',
    '곡 구성 (부를 순서)': 'Arrangement (singing order)', '예: 1절 후렴 2절 후렴 브리지 후렴 — 비우면 슬라이드 순서대로': 'e.g. Verse1 Chorus Verse2 Chorus Bridge Chorus — empty = slide order',
    '아래 슬라이드에 이름을 붙이면 여기 단추가 생깁니다.': 'Name the slides below and buttons appear here.',
    "슬라이드마다 '이름'(1절·후렴…)을 붙이면, 그 슬라이드부터 다음 이름 전까지가 한 묶음입니다. 후렴을 여러 번 불러도 복사할 필요가 없습니다.":
      'Give slides a name (Verse 1, Chorus…). Each name starts a group that runs until the next name, so a repeated chorus needs no copies.',
    '📝 모든 슬라이드를 한 글로 보고 고치기': '📝 Edit all slides as one text', '전체 글로 고치기': 'Edit as one text', '빈 줄 = 슬라이드 나눔 · #후렴 = 이름': 'Blank line = new slide · #Chorus = name',
    '슬라이드로 다시 나누기': 'Split into slides again', '＋ 빈 슬라이드': '＋ Blank slide', '이름 (1절·후렴…)': 'Name (Verse 1, Chorus…)',
    '1절': 'Verse 1', '2절': 'Verse 2', '3절': 'Verse 3', '4절': 'Verse 4', '후렴': 'Chorus', '브리지': 'Bridge', '프리코러스': 'Pre-chorus', '엔딩': 'Ending',
    '그림 바꾸기': 'Change picture', '그림 삭제': 'Remove picture', '다음 슬라이드와 합치기': 'Merge with next slide', '커서 위치에서 나누기': 'Split at cursor',
    '나눌 위치에 커서를 두세요': 'Put the cursor where you want to split', '구절 표시 (예: 요한복음 3:16)': 'Reference (e.g. John 3:16)',
    '🔊 소리 켜고 한 번 재생 (예배당 화면)': '🔊 Play once with sound (main screen)', '이 자료를 삭제할까요?': 'Delete this item?',
    '저장하면 바로 화면에도 바뀝니다. (⌘/Ctrl + Enter 저장)': 'Saving updates the screen right away. (⌘/Ctrl + Enter to save)',
    'PPT·HTML 슬라이드가 있는 자료는 슬라이드마다 고쳐 주세요': 'Items with PPT/HTML slides must be edited slide by slide',
    '칸은 | 로, 줄은 줄바꿈으로': 'Cells with |, rows with line breaks', '표': 'Table', '글자': 'Text', '그림': 'Picture',
    // ── 성경 ──
    '성경 구절 불러오기': 'Load Bible verses', '구절을 입력하고 Enter': 'Type a reference and press Enter', '예: 요 3:16, 시 23:1-6, 롬 8장': 'e.g. John 3:16, Ps 23:1-6, Rom 8',
    '번역본': 'Version', '함께 보일 번역본': 'Second version', '슬라이드당 절 수': 'Verses per slide', '결과:': 'Result:', '슬라이드 만들기': 'Make slides',
    '말씀 슬라이드를 만들고 예배 순서에 넣었습니다': 'Scripture slides added to the service',
    '성경 본문은 ⚙︎ 설정 → 성경 폴더 또는 성경 텍스트 가져오기로 연결합니다.': 'Connect Bible text in ⚙︎ Settings → Bible folder or Import Bible text.',
    // ── 문구 · 성찬 ──
    '문구·성찬 넣기': 'Add text / Communion', '누르면 예배 순서에서 고른 자료 다음에 들어갑니다.': 'Click to add it after the selected item in the service.',
    '성찬 예식 (제정의 말씀·떡·잔·기도)': 'Communion (words of institution, bread, cup, prayer)', '내 문구': 'My phrases', '직접 쓰기': 'Write your own',
    "아래 '직접 쓰기'에서 저장한 문구가 여기에 모입니다.": "Phrases saved below under 'Write your own' appear here.",
    '화면에 띄울 문구 (Enter로 줄바꿈)': 'Text to show (Enter for a new line)', '이 문구 넣기': 'Add this text', '내 문구로 저장': 'Save to my phrases',
    '내 문구에 저장했습니다': 'Saved to my phrases', '내 문구에서 지우기': 'Remove from my phrases', '문구를 먼저 쓰세요': 'Write the text first',
    '성찬 예식을 넣었습니다 (제정의 말씀 포함)': 'Communion added (with words of institution)',
    '성찬 예식을 넣었습니다 — 성경 폴더가 없어 말씀은 직접 넣어 주세요': 'Communion added — no Bible folder, so please enter the scripture yourself',
    '예배 준비': 'Preparing for worship', '기도': 'Prayer', '교제·광고': 'Fellowship · Notices', '마침': 'Closing',
    // ── 새 예배 · 템플릿 ──
    '새 예배': 'New service', '예배 이름': 'Service name', '순서 템플릿': 'Order template', '빈 순서': 'Empty', '주일 예배': 'Sunday Service', '성찬 주일': 'Communion Sunday',
    '주일 오후 예배': 'Sunday Afternoon', '찬양 예배': 'Praise Service', '수요 예배': 'Wednesday Service', '금요 기도회': 'Friday Prayer', '새벽 기도회': 'Dawn Prayer',
    "템플릿을 고르면 '예배 준비 → 예배의 부름 → 찬양 → 기도 → 말씀 → 봉헌 → 광고 → 축도' 같은 순서 제목 화면이 미리 들어갑니다. 순서 제목을 고른 뒤 ＋ 찬양·＋ 성경을 누르면 그 다음 자리에 들어갑니다. 필요 없는 순서는 ✕로 빼세요.":
      'A template adds title screens such as Preparation → Call to Worship → Songs → Prayer → Sermon → Offering → Notices → Benediction. Select a title, then ＋ Song / ＋ Bible to add after it. Remove what you do not need with ✕.',
    // ── 테마 · 움직이는 배경 · 글꼴 ──
    '기본 (자막 스타일 따름)': 'Default (follows caption style)', '찬양 · 은하수': 'Song · Galaxy', '찬양 · 물결': 'Song · Waves', '찬양 · 오로라': 'Song · Aurora',
    '찬양 · 빛줄기': 'Song · Light rays', '말씀 · 명조': 'Scripture · Serif', '말씀 · 새벽 하늘': 'Scripture · Dawn sky', '광고 · 제목 강조': 'Notice · Bold title',
    '광고 · 밝은 화면': 'Notice · Bright', '기도 · 빛망울': 'Prayer · Bokeh', '순서 제목': 'Order title', '성찬 · 촛불빛': 'Communion · Candlelight',
    '은하수': 'Galaxy', '물결': 'Waves', '빛줄기': 'Light rays', '빛망울': 'Bokeh', '오로라': 'Aurora', '새벽 하늘': 'Dawn sky', '촛불빛': 'Candlelight',
    '내 동영상 (미디어에서 고르기)': 'My video (choose from media)',
    '본고딕 (Noto Sans KR)': 'Noto Sans KR', '나눔고딕': 'Nanum Gothic', '고운돋움': 'Gowun Dodum', '나눔명조': 'Nanum Myeongjo', '고운바탕': 'Gowun Batang',
    '송명 (붓 느낌 명조)': 'Song Myung (brush serif)', '검은고딕 (아주 굵게)': 'Black Han Sans (extra bold)', '도현': 'Do Hyeon', '주아 (둥근 글씨)': 'Jua (rounded)',
    '나눔손글씨 펜': 'Nanum Pen Script', '컴퓨터 기본 고딕': 'System sans-serif', '다국어 Noto Sans (베트남·태국·미얀마어)': 'Multilingual Noto Sans (Vietnamese · Thai · Myanmar)',
    // ── 자막 스타일 ──
    '자막 스타일': 'Caption Style', '방송 자막 (OBS)': 'Stream captions (OBS)', '글꼴': 'Font', '글자 크기': 'Text size', '글자 색': 'Text color', '굵게': 'Bold',
    '그림자': 'Shadow', '테두리 두께': 'Outline width', '테두리 색': 'Outline color', '가로 정렬': 'Alignment', '세로 위치': 'Vertical position',
    '화면 비율': 'Aspect ratio', '16:9 (TV·요즘 프로젝터)': '16:9 (TVs, modern projectors)', '4:3 (옛 프로젝터)': '4:3 (older projectors)',
    '옛 프로젝터(4:3)면 4:3으로. 방송(OBS)은 늘 16:9': 'Use 4:3 for older projectors. The stream (OBS) is always 16:9',
    '배경색': 'Background color', '움직이는 배경': 'Motion background', '배경 동영상': 'Background video', '동영상 고르기': 'Choose video', '고르지 않음': 'Not chosen',
    '움직이는 배경 켜기': 'Motion background on', '동영상(mp4·mov·webm)을 골라 주세요': 'Please choose a video (mp4, mov, webm)',
    '움직이는 배경은 그림 배경이 없는 글자 슬라이드 뒤에 깔립니다. 자료마다 ✎ 편집 → 모양(테마)으로 따로 정할 수도 있습니다.':
      'The motion background goes behind text slides without a picture. You can also set it per item in ✎ Edit → Look (theme).',
    '자막 바 색': 'Caption bar color', '바 불투명도': 'Bar opacity', '곡명·구절 표시': 'Show song title / reference', '곡명·구절': 'Title / reference',
    '악보·사진·PPT 그림 슬라이드를 방송에 어떻게 보낼지': 'How to send score / photo / PPT picture slides to the stream',
    '일부 — 크기': 'Part — size', '일부 — 위치': 'Part — position', '스타일을 적용했습니다': 'Style applied',
    // ── 설정 ──
    '언어 · Language': 'Language · 언어',
    '웹 편집기 PIN': 'Web editor PIN', '6~12자리': '6–12 characters', 'PIN은 6~12자리 숫자/영문으로 정하세요': 'Use 6–12 letters or digits for the PIN',
    'PIN을 바꿨습니다 (기존 접속은 로그아웃)': 'PIN changed (other sessions signed out)', '로고': 'Logo', '로고 선택': 'Choose logo', '로고 설정 저장': 'Save logo settings',
    '로고 설정을 저장했습니다': 'Logo settings saved', '로고 화면 (✝ 로고 버튼 · L 키)': 'Logo screen (✝ Logo button · L key)', '항상 작게 띄우기 (워터마크)': 'Always show small (watermark)',
    '진하기': 'Opacity', '유튜브에도': 'Also on YouTube', '교회 로고 그림(png 권장, 배경이 투명하면 더 좋음)을 고르면 위치·크기를 정할 수 있습니다.':
      'Choose your church logo (PNG recommended, transparent is best) to set its position and size.',
    '타이틀 로고': 'Title logo', '✝ (기본)': '✝ (default)', '✝ 로 되돌리기': 'Back to ✝', "운영 화면 맨 위 '예배송출' 앞에 붙는 작은 로고": "Small logo before 'Worship Caster' at the top",
    '타이틀 로고는 사진 파일(png·jpg)만 됩니다': 'The title logo must be an image (png, jpg)',
    '📱 휴대폰 리모컨': '📱 Phone Remote', '휴대폰에서 자막 넘기기 허용': 'Allow advancing slides from a phone',
    '같은 와이파이의 휴대폰 브라우저에서 이 주소 → PIN 입력': 'Open this address on a phone on the same Wi-Fi → enter PIN',
    '휴대폰 리모컨을 켰습니다': 'Phone remote on', '휴대폰 리모컨을 껐습니다': 'Phone remote off',
    '💾 백업·복원': '💾 Backup & Restore', '자료 전체 백업 받기 (zip)': 'Download full backup (zip)', '백업 파일로 되살리기': 'Restore from backup',
    '찬양·예배 순서·모양·설정·사진·영상을 파일 하나로 내려받습니다. 컴퓨터를 바꿀 때나 고장에 대비해 가끔 USB에 받아 두세요. 되살리면 지금 자료가 백업 내용으로 바뀝니다(바뀌기 전 자료도 data 폴더에 한 벌 남깁니다).':
      'Downloads songs, services, styles, settings, photos and videos as one file. Keep a copy on USB now and then. Restoring replaces current data (a copy of the old data is kept in the data folder).',
    '되살리는 중…': 'Restoring…', '되살리지 못했습니다': 'Could not restore', 'zip 파일이 아니거나 깨졌습니다': 'Not a zip file, or the file is damaged',
    '예배송출 백업 파일이 아닙니다': 'Not a Worship Caster backup', '예배송출 백업 파일이 아닙니다 (db.json 없음)': 'Not a Worship Caster backup (no db.json)',
    '백업 파일(zip)을 고르세요': 'Choose a backup file (zip)',
    '성경 폴더': 'Bible folder', '폴더 경로 (Finder에서 폴더를 이 칸으로 끌어다 놓아도 됩니다)': 'Folder path (you can drag a folder here)', '추가된 폴더 없음': 'No folders added',
    '하위 폴더마다 번역본 하나: "한글 (개역개정)/43-요한복음(John) - 개역개정.md" 형식, 절은 "**3:16** 본문". 원본 파일은 읽기만 합니다.':
      'One version per subfolder, e.g. "Korean (NKRV)/43-John - NKRV.md", verses as "**3:16** text". Files are only read.',
    '기본 번역본': 'Default version', '성경 텍스트 가져오기': 'Import Bible text', '번역본 이름 (예: 개역한글)': 'Version name (e.g. KJV)',
    '구절을 하나도 읽지 못했습니다. 형식을 확인하세요.': 'No verses could be read. Check the format.', '폴더를 찾을 수 없습니다:': 'Folder not found:',
    '새 버전이 나오면 알려 주기': 'Tell me when a new version is out', '받는 곳 열기': 'Open download page',
    // ── 미디어 고르기 ──
    '미디어 관리': 'Media', '배경·그림 선택': 'Choose background / picture', '＋ 사진·영상 올리기': '＋ Upload photos / videos', '아직 올린 파일이 없습니다.': 'No files uploaded yet.',
    'jpg·png·mp4·mov·webm 등. 영상 배경은 소리 없이 반복 재생됩니다.': 'jpg, png, mp4, mov, webm… Video backgrounds loop without sound.',
    '이 파일 삭제': 'Delete this file', '반복 재생': 'Loop',
    // ── OBS ──
    '🎥 OBS에 자막 얹기': '🎥 Captions in OBS', '방송 PC(맥/윈도우)의 OBS에서': 'In OBS on the streaming PC (Mac/Windows),', '소스 ＋ → 브라우저': 'Sources ＋ → Browser',
    '를 추가하고 아래 주소를 넣으세요. 너비': 'and enter the address below. Width', ', 높이': ', height', '두면 자막만 투명하게 얹힙니다. (캡처 장비·NDI 플러그인 필요 없음)': 'and only the captions are overlaid transparently. (No capture card or NDI plugin needed)',
    '· 방송 PC와 이 맥은 같은 공유기(네트워크)에 있어야 합니다. 맥 방화벽이 묻으면 "허용"을 누르세요.': '· The streaming PC and this computer must be on the same network. Allow it if the firewall asks.',
    '· 같은 맥에서 OBS를 돌릴 때:': '· When OBS runs on this same computer:',
    '👤 그림·악보·PPT를 보낼 때 오른쪽 아래에 사람 화면 (선택)': '👤 Camera in the lower right when sending pictures (optional)',
    '평소 장면': 'Normal scene', '사람 화면 장면': 'Camera PiP scene', '장면 저장': 'Save scenes', 'OBS 장면 이름 그대로': 'Exact OBS scene name',
    'OBS 장면 전환 가능': 'OBS scene switching available', 'OBS 자막 소스가 아직 연결되지 않았습니다': 'The OBS caption source is not connected yet',
    'OBS 권한이 부족합니다 — 아래 3번을 해 주세요': 'OBS permission missing — do step 3 below', '이 OBS는 장면 전환을 지원하지 않습니다 (OBS 28 이상 필요)': 'This OBS cannot switch scenes (needs OBS 28+)',
    '페이지 권한': 'Page permissions', '고급 접근 권한': 'Advanced access', '자막 브라우저 소스 속성 →': 'Caption browser source properties →', '기존 소스 추가': 'Add Existing Source',
    // ── 콘티 ──
    '찬양팀에 미리 보낼 순서표입니다. 가사는 들어가지 않습니다(저작권). 키·빠르기·메모는 곡에 저장되어 다음에도 그대로 나옵니다.':
      'An order sheet to send to the worship team. Lyrics are not included (copyright). Key, tempo and notes are saved with each song.',
    '순서': 'Order', '키': 'Key', '흐름 메모': 'Flow notes', '인도자 메모': "Leader's note", '예: 3번 곡 끝나고 바로 기도로': 'e.g. go straight to prayer after song 3',
    '예: 후렴 2번': 'e.g. chorus twice', '전체 키 ♭': 'All keys ♭', '전체 키 ♯': 'All keys ♯', '모든 곡 키를 반음 내림': 'Lower every key a half step',
    '모든 곡 키를 반음 올림': 'Raise every key a half step', '🖨 인쇄': '🖨 Print', '💬 카톡용 복사': '💬 Copy for chat', '키를 반음 올렸습니다': 'Keys raised a half step',
    '키를 반음 내렸습니다': 'Keys lowered a half step', '복사했습니다. 카톡에 붙여넣으세요': 'Copied. Paste it into your chat', '아래 글을 복사하세요': 'Copy the text below',
    // ── PDF · HTML · PPT ──
    'PDF·악보 가져오기': 'Import PDF / score', '위·아래 2칸 (악보 권장)': 'Top / bottom halves (for scores)', '3칸': '3 parts', '4칸': '4 parts', '나누지 않음 (PDF 문서·주보)': "Don't split (documents)",
    '흰 여백 잘라내기': 'Trim white margins', '흰색 (악보)': 'White (scores)', '검정': 'Black', '한 페이지 나누기': 'Split a page',
    'PPT 가져오는 중…': 'Importing PPT…', 'PPT 가져오기 실패:': 'PPT import failed:', '가져오기 실패:': 'Import failed:', 'HTML 가져오기 실패:': 'HTML import failed:',
    '새 HTML': 'New HTML', '📂 HTML 파일 가져오기': '📂 Import HTML file', '✏️ 직접 만들기': '✏️ Write your own', 'HTML 파일 열기': 'Open HTML file',
    'AI나 다른 프로그램으로 만든 발표 자료(.html). 한 파일에 여러 장이 있으면 장마다 슬라이드가 됩니다.': 'Slides made with AI or other tools (.html). Each page becomes a slide.',
    'HTML 코드를 붙여넣거나 예시(카운트다운·말씀 카드)로 시작합니다.': 'Paste HTML code or start from an example (countdown, verse card).',
    '예시: 예배 시작 카운트다운': 'Example: service countdown', '예시: 오늘의 말씀 카드': 'Example: verse of the day card', '30MB 이하의 .html 파일만 가져올 수 있습니다': 'Only .html files up to 30 MB',
    'HTML 파일 자료는 예배당 화면·프롬프터에만 나가고 유튜브(OBS)에는 나가지 않습니다. (파일 속 프로그램이 OBS를 건드리지 못하게)':
      'HTML files go only to the main screen and prompter, not to YouTube (OBS), so code in the file cannot touch OBS.',
    '[HTML 화면]': '[HTML screen]', '[그림]': '[Picture]',
    // ── 모니터 · 창 ──
    '모니터': 'Monitor', '그냥 창으로 열기': 'Open as a normal window', '· 주 모니터': '· main monitor', '· 지금 운영 화면이 있는 곳': '· where this window is', '· 지난번 선택': '· last used',
    '창 관리 권한이 없어 기본 창으로 엽니다 (주소창 왼쪽 자물쇠 → 창 관리 허용)': 'No window-management permission, opening a normal window (lock icon → allow window management)',
    '운영 화면이 이미 열려 있습니다': 'The operator screen is already open', '다른 창에서 운영 중입니다': 'Another window is operating',
    '먼저 열린 창을 쓰시거나, 이 창에서 계속하세요.': 'Use the first window, or continue here.', '이 창은 닫으셔도 됩니다.': 'You can close this window.',
    '이 창에서 계속': 'Continue here', '이 창 닫기': 'Close this window', '이 창에서 운영합니다': 'Operating from this window',
    '예배송출 프로그램을 끌까요?\n(예배당 화면·프롬프터 창도 함께 닫히고, OBS 자막도 꺼집니다)': 'Quit Worship Caster?\n(The main screen and prompter windows close, and OBS captions stop.)',
    '예배송출을 종료했습니다. 이 창은 닫으셔도 됩니다.': 'Worship Caster has quit. You can close this window.', '예배송출이 종료되었습니다. 이 창은 닫으셔도 됩니다.': 'Worship Caster has quit. You can close this window.',
    '예배송출이 종료되었습니다.': 'Worship Caster has quit.', '창이 닫히지 않으면 창 왼쪽 위(윈도우는 오른쪽 위) 닫기 단추를 눌러 주세요.': "If the window doesn't close, use its close button.",
    // ── 화면 · 프롬프터 · 리모컨 ──
    'F 키 또는 더블클릭 = 전체화면': 'F key or double-click = full screen', '프롬프터': 'Prompter', '방송 자막(OBS)': 'Stream captions (OBS)',
    '대기': 'Standby', '● 송출 중': '● Live', '· 방송 자막 꺼짐': '· stream captions off', '· 검은 화면': '· black screen', '· 글자 지움': '· text cleared',
    '👤 사람 화면': '👤 Camera PiP', '(OBS 장면 전환)': '(OBS scene switch)',
    '✝ 예배송출 리모컨': '✝ Worship Caster Remote', '예배송출 리모컨': 'Worship Caster Remote', '운영 컴퓨터의': 'Enter the', '⚙︎ 설정 → 웹 편집기 PIN': '⚙︎ Settings → Web editor PIN',
    '을 넣으세요.': 'from the operator computer.', '휴대폰 리모컨이 꺼져 있습니다.': 'The phone remote is off.', '⚙︎ 설정 → 📱 휴대폰 리모컨': '⚙︎ Settings → 📱 Phone Remote',
    '을 켠 뒤 새로고침하세요.': 'on the operator computer, then reload.', '예배 순서': 'Service',
    '구절': 'Reference', '예배당 화면 (HDMI)': 'Main screen (HDMI)', '분류에 맞게 자동': 'Auto by category', '성찬': 'Communion', '배경': 'Background',
    '비우면 파일 이름': 'Empty = file name', '한국어': '한국어',
    '가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다. 묶음 첫 줄에 #1절 · #후렴 · #브리지 처럼 쓰면 곡 구성 이름이 붙습니다.':
      'Paste lyrics. A blank line always starts a new slide.\nStart a group with #Verse1 · #Chorus · #Bridge to name it.',
    'PDF는 페이지마다, 사진(jpg·png)은 장마다 슬라이드가 됩니다. 악보는 화면 비율(16:9)에 맞게 위·아래로 나누면 TV에서 훨씬 크게 보입니다. 악보·그림 슬라이드는 유튜브(OBS)에도 화면 그대로 나갑니다. 예배당에만 보내려면 ✎ 편집 → 유튜브 방송 → \'보내지 않기\'.':
      "Each PDF page or photo (jpg, png) becomes a slide. Splitting a score into top/bottom halves makes it much bigger on a 16:9 TV. Score and picture slides also go to YouTube (OBS) as they are; to keep one on the main screen only, use ✎ Edit → YouTube stream → \"Don't send\".",
    // ── 서버 안내 ──
    '송출 제어는 운영 맥에서만 가능합니다': 'Only the operator computer can do this',
    '송출 조작은 운영 컴퓨터에서만 됩니다 (⚙︎ 설정에서 휴대폰 리모컨을 켜면 휴대폰에서도 됨)': 'Output controls work only on the operator computer (turn on the phone remote in ⚙︎ Settings to use a phone)',
    '다른 사이트에서 온 요청은 막혀 있습니다': 'Requests from other sites are blocked', '허용되지 않은 주소입니다': 'Address not allowed',
    '슬라이드 파일이 없습니다': 'Slide file not found',
  };
  // 숫자·이름이 들어가는 문장
  const RX = [
    [/^찬양 (\d+)곡을 자료실에 넣었습니다$/, 'Added $1 songs to the library'],
    [/^같은 제목 (\d+)곡은 건너뜀$/, 'skipped $1 with the same title'], [/^가사 없는 (\d+)곡은 건너뜀$/, 'skipped $1 without lyrics'],
    [/^슬라이드 (\d+)장으로 나눴습니다$/, 'Split into $1 slides'], [/^슬라이드 (\d+)장을 가져왔습니다$/, 'Imported $1 slides'],
    [/^슬라이드 (\d+)장을 만들었습니다$/, 'Made $1 slides'], [/^HTML 슬라이드 (\d+)장을 가져왔습니다$/, 'Imported $1 HTML slides'],
    [/^'(.+)'을\(를\) 넣었습니다$/, "Added '$1'"], [/^'(.+)' 을\(를\) 삭제할까요\?$/, "Delete '$1'?"],
    [/^'(.+)'을\(를\) 순서에서 빼면 지워집니다\. 뺄까요\?\n\(찬양은 자료실에 남습니다\)$/, "'$1' will be deleted when removed from the service. Remove it?\n(Songs stay in the library)"],
    [/^'(.+)' 순서를 삭제할까요\?\n\(찬양은 자료실에 남고, 말씀·광고·문구는 함께 지워집니다\)$/, "Delete the service '$1'?\n(Songs stay in the library; scripture, notices and texts are deleted with it)"],
    [/^'(.+)' 파일을 삭제할까요\?\n삭제하면 되돌릴 수 없습니다\.([\s\S]*)$/, "Delete the file '$1'?\nThis cannot be undone.$2"],
    [/^'(.+)' 백업으로 되살릴까요\?\n지금 찬양·예배 순서·설정이 백업 내용으로 바뀝니다\.$/, "Restore from '$1'?\nCurrent songs, services and settings will be replaced."],
    [/^되살렸습니다 — 자료 (\d+)개, 예배 순서 (\d+)개, 파일 (\d+)개$/, 'Restored — $1 items, $2 services, $3 files'],
    [/^번역본 (\d+)개를 읽었습니다$/, 'Read $1 versions'], [/^'(.+)' (\d+)권을 읽었습니다$/, "Read '$1' ($2 books)"],
    [/^빠른 수정 — (.+)$/, 'Quick edit — $1'], [/^📋 콘티 — (.*)$/, '📋 Setlist — $1'], [/^(.*) 콘티$/, '$1 setlist'],
    [/^🔔 새 버전 v([\d.]+)$/, '🔔 New version v$1'], [/^지금 v([\d.]+) → 새 버전 v([\d.]+)\. 받아서 앱\(폴더\)만 바꾸면 자료는 그대로 남습니다$/, 'You have v$1 → new v$2. Replace just the app (folder); your data stays.'],
    [/^글자 크기 ([\d.]+) \(기본 ([\d.]+)\)$/, 'Text size $1 (default $2)'], [/^보내는 중: ([\s\S]+)$/, 'Showing: $1'], [/^⏩ 자동 넘김 중 \((\d+)초\)$/, '⏩ Auto advancing ($1 s)'],
    [/^● 배경: (.+)$/, '● Background: $1'], [/^(.+) — 누르면 예배당 화면 배경으로$/, '$1 — click to use as the main-screen background'],
    [/^(.+)을 띄울 모니터$/, 'Monitor for $1'], [/^(.+)을 (\d+)번 모니터에 열었습니다$/, 'Opened $1 on monitor $2'],
    [/^올리는 중… (\d+)\/(\d+)$/, 'Uploading… $1/$2'], [/^(.+): (\d+)\/(\d+) 페이지 변환 중…$/, '$1: converting page $2/$3…'],
    [/^(.+): 곡 파일 모양이 아닙니다$/, '$1: not a song file'], [/^'(.+)' 가져오는 중…$/, "Importing '$1'…"],
    [/^잠시 후 다시 시도하세요 \((\d+)초\)$/, 'Try again in a moment ($1 s)'], [/^다음: ([\s\S]*)$/, 'Next: $1'], [/^모니터 (\d+)$/, 'Monitor $1'],
    [/^HTML 파일 (\d+)번째 장 · 아래 글은 프롬프터\(설교자 화면\)에만 보입니다$/, 'HTML file page $1 · the text below shows only on the prompter'],
    [/^폴더를 찾을 수 없습니다: (.+)$/, 'Folder not found: $1'],
    [/^(.*) \(개역개정이 있으면 자동 선택\)$/, '$1 (chosen automatically)'],
    [/^형식: 한 줄에 한 절\. .*현재 번역본: ?(.*)$/s, 'Format: one verse per line, "Gen1:1 text…" or "Genesis[tab]1[tab]1[tab]text". UTF-8 or EUC-KR. Current versions: $1'],
    [/^예배송출 v([\d.]+) · 만든 사람:$/, 'Worship Caster v$1 · made by'],
  ];
  // 미얀마 자우기 안내 (여러 줄)
  EN['이 미얀마어 글은 옛 방식(자우기, Zawgyi)으로 쓴 것 같습니다.\n화면에서 글자 순서가 뒤섞여 보일 수 있습니다.\n\n휴대폰이나 인터넷의 "Zawgyi → Unicode" 변환기로 유니코드로 바꾼 뒤 다시 붙여넣어 주세요.\n(설명서 11장 참고)'] =
    'This Myanmar text looks like the old Zawgyi encoding.\nLetters may appear jumbled on screen.\n\nConvert it with a "Zawgyi → Unicode" converter and paste it again.';

  let lang = 'ko';
  const HAS_KO = /[가-힣]/;
  function t(s) {
    if (lang !== 'en' || s == null) return s;
    const str = String(s);
    let k = str.trim();
    if (!k || !HAS_KO.test(k)) return str;
    let v = EN[k];
    if (v == null) {   // HTML 안에서 줄이 바뀐 글: 공백 하나로
      const k2 = k.replace(/\s+/g, ' ');
      if (EN[k2] != null) { k = k2; v = EN[k2]; }
    }
    if (v == null) for (const [re, r] of RX) if (re.test(k)) { v = k.replace(re, r); break; }
    if (v == null && k.includes('\n')) {   // 여러 줄은 줄마다
      const parts = k.split('\n').map(l => (EN[l.trim()] ?? l));
      if (parts.join('\n') !== k) v = parts.join('\n');
    }
    if (v == null && k.includes(' · ')) {   // 'A · B' 꼴
      const parts = k.split(' · ').map(p => EN[p.trim()] ?? (RX.find(([re]) => re.test(p.trim())) ? t(p) : p));
      if (parts.join(' · ') !== k) v = parts.join(' · ');
    }
    if (v == null) return str;
    const lead = str.match(/^\s*/)[0], tail = str.match(/\s*$/)[0];
    return lead + v + tail;
  }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const skip = el => !el || SKIP.has(el.tagName) || el.closest?.('.wc-screen,[data-noi18n],[contenteditable]');
  const skipAttr = el => !el || el.closest?.('.wc-screen,[data-noi18n]');
  function apply(root) {
    if (lang !== 'en' || !root) return;
    if (root.nodeType === 3) { if (!skip(root.parentElement)) { const v = t(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || skipAttr(root)) return;
    for (const a of ['title', 'placeholder', 'aria-label']) {
      root.querySelectorAll?.(`[${a}]`).forEach(el => { if (!skipAttr(el)) { const v = t(el.getAttribute(a)); if (v !== el.getAttribute(a)) el.setAttribute(a, v); } });
      if (root.hasAttribute?.(a) && !skipAttr(root)) { const v = t(root.getAttribute(a)); if (v !== root.getAttribute(a)) root.setAttribute(a, v); }
    }
    if (skip(root)) return;   // 입력칸 안의 글(사용자 내용)은 그대로
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!HAS_KO.test(n.nodeValue) || skip(n.parentElement)) continue;
      const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
    }
  }
  let obs = null;
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'ko';
    document.documentElement.lang = lang;
    if (lang !== 'en') return;
    document.title = t(document.title);
    apply(document.body);
    if (!obs && window.MutationObserver) {
      obs = new MutationObserver(list => {
        for (const m of list) {
          if (m.type === 'characterData') apply(m.target);
          else if (m.type === 'attributes') apply(m.target);
          else m.addedNodes.forEach(apply);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
    }
    // 알림 창 글도
    const A = window.alert.bind(window), C = window.confirm.bind(window), P = window.prompt.bind(window);
    window.alert = m => A(t(m)); window.confirm = m => C(t(m)); window.prompt = (m, d) => P(t(m), d);
  }
  window.I18N = { t, setLang, apply, get lang() { return lang; } };
})();
