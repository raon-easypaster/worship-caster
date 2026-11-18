#!/bin/bash
# 예배송출 배포 파일 만들기 (만든 사람: 쉬운목사 이광복)
#   bash build-dist.sh            → dist/예배송출-mac.zip, dist/예배송출-windows.zip
#   bash build-dist.sh --install  → 위 + 이 맥의 ~/Applications 에 설치
# 받는 사람은 Node.js 를 따로 설치할 필요가 없습니다 (앱 안에 들어 있음).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
NODE_V="v24.22.3"                       # Node.js LTS (지원 기간: 2028년 4월까지)
CACHE="$ROOT/.build-cache"
DIST="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# 배포 파일을 만들기 전에 자동 점검 (되던 기능이 깨졌으면 여기서 멈춤). 급할 때만 SKIP_TESTS=1
if [ "${SKIP_TESTS:-}" != "1" ]; then
  node tests/run.js || { echo "자동 점검 실패 — 배포 파일을 만들지 않습니다 (tests/run.js)"; exit 1; }
fi
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || python3 -c "import json;print(json.load(open('package.json'))['version'])")"

# ── 1. 공식 Node.js 받기 + 체크섬 확인 ─────────────────────
mkdir -p "$CACHE" "$DIST"
cd "$CACHE"
[ -f SHASUMS256.txt ] || curl -sfLO "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt"
for f in "node-$NODE_V-darwin-arm64.tar.gz" "node-$NODE_V-darwin-x64.tar.gz" "node-$NODE_V-win-x64.zip"; do
  [ -f "$f" ] || { echo "받는 중: $f"; curl -sfLO "https://nodejs.org/dist/$NODE_V/$f"; }
  grep " $f\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null || { echo "체크섬 불일치: $f"; exit 1; }
done
mkdir -p "$STAGE/n"
tar -xzf "node-$NODE_V-darwin-arm64.tar.gz" -C "$STAGE/n" "node-$NODE_V-darwin-arm64/bin/node"
tar -xzf "node-$NODE_V-darwin-x64.tar.gz"   -C "$STAGE/n" "node-$NODE_V-darwin-x64/bin/node"
unzip -q -j "node-$NODE_V-win-x64.zip" "node-$NODE_V-win-x64/node.exe" -d "$STAGE/n"
# 애플 실리콘(M1~)·인텔 맥 모두 되는 유니버설 실행 파일
lipo -create "$STAGE/n/node-$NODE_V-darwin-arm64/bin/node" "$STAGE/n/node-$NODE_V-darwin-x64/bin/node" -output "$STAGE/n/node-universal"
cd "$ROOT"

# ── 2. 프로그램 파일 + 꼭 필요한 부품만 ────────────────────
APPSRC="$STAGE/app"
mkdir -p "$APPSRC"
cp -R server.js lib public package.json package-lock.json "$APPSRC/"
(cd "$APPSRC" && npm ci --omit=dev --omit=optional --no-audit --no-fund --loglevel=error)
# pdf.js 는 브라우저용 두 파일만 남김
P="$APPSRC/node_modules/pdfjs-dist"
find "$P" -mindepth 1 -maxdepth 1 ! -name build ! -name package.json ! -name LICENSE -exec rm -rf {} +
find "$P/build" -type f ! -name pdf.min.mjs ! -name pdf.worker.min.mjs -delete
# 글꼴은 woff2 와 쓰는 굵기만 남김
F="$APPSRC/node_modules/@fontsource"
find "$F" -type f \( -name '*.woff' -o -name '*.scss' -o -name '*.md' -o -name '*.ts' \) -delete
find "$F" -type d -name scss -prune -exec rm -rf {} +
find "$F" -type f -name '*.woff2' | grep -E -- '-(100|200|300|500|600)-(normal|italic)\.woff2$' | xargs rm -f
find "$F" -type f -name '*-italic.woff2' -delete
rm -f "$APPSRC/package-lock.json"
# 자동 업데이트 묶음 (앱 안 Node.js 는 빼고 프로그램만 — 운영 화면 '지금 업데이트'가 받음)
node -e "require('fs').writeFileSync(process.argv[2], require('./lib/updater').pack(process.argv[1]))" "$APPSRC" "$DIST/WorshipCaster-update.wcu"

ABOUT_KO="예배송출 v$VERSION — 만든 사람: 쉬운목사 이광복 (무료로 나눕니다)"

# ── 3. 맥 앱 ───────────────────────────────────────────────
MAC="$STAGE/mac/예배송출.app"
# 켜져 있는 동안 독에 머무는 앱 (AppleScript '계속 열려 있는 앱'): 독 아이콘을 누르면 운영 화면을 앞으로, 독에서 종료하면 예배송출도 끔
sed "s/__PORT__/5300/" assets/mac-app.applescript > "$STAGE/mac-app.applescript"
mkdir -p "$STAGE/mac"
osacompile -s -o "$MAC" "$STAGE/mac-app.applescript"
mkdir -p "$MAC/Contents/Resources/node"
cp -R "$APPSRC" "$MAC/Contents/Resources/app"
cp "$STAGE/n/node-universal" "$MAC/Contents/Resources/node/node"
cp assets/icon.icns "$MAC/Contents/Resources/applet.icns"
# 독 아이콘: osacompile 이 넣는 기본 아이콘(Assets.car)을 빼야 예배송출 아이콘이 나옴
rm -f "$MAC/Contents/Resources/Assets.car"
P="$MAC/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$P" >/dev/null 2>&1 || true; }
pb "Delete :CFBundleIconName"; pb "Delete :CFBundleIconFile"; pb "Add :CFBundleIconFile string applet"
pb "Delete :CFBundleName"; pb "Add :CFBundleName string 예배송출"
pb "Delete :CFBundleDisplayName"; pb "Add :CFBundleDisplayName string 예배송출"
pb "Delete :CFBundleIdentifier"; pb "Add :CFBundleIdentifier string kr.easypastor.worship-caster"
pb "Delete :CFBundleVersion"; pb "Add :CFBundleVersion string $VERSION"
pb "Delete :CFBundleShortVersionString"; pb "Add :CFBundleShortVersionString string $VERSION"
pb "Delete :NSHumanReadableCopyright"; pb "Add :NSHumanReadableCopyright string 만든 사람: 쉬운목사 이광복"
pb "Delete :LSMinimumSystemVersion"; pb "Add :LSMinimumSystemVersion string 11.0"
pb "Delete :NSAppleEventsUsageDescription"; pb "Add :NSAppleEventsUsageDescription string 예배송출 운영 화면 창을 맨 앞으로 가져오는 데 씁니다."
chmod +x "$MAC/Contents/Resources/node/node"
xattr -cr "$MAC"
codesign --force --deep -s - "$MAC"
# 서명이 앱 전체에 맞게 됐는지 점검 — 틀리면 받는 맥에서 「손상된 앱」이 나오므로 여기서 멈춤
codesign --verify --deep --strict "$MAC" || { echo "맥 앱 서명 점검 실패"; exit 1; }
cat > "$STAGE/mac/처음 실행 방법.txt" <<TXT
$ABOUT_KO

1. 예배송출.app 을 '응용 프로그램' 폴더로 끌어다 놓으세요.
2. 처음 한 번만: 앱을 더블클릭하면 "확인할 수 없습니다"라는 창이 뜹니다. [완료]를 누른 뒤
   시스템 설정 → 개인정보 보호 및 보안 → 맨 아래 "예배송출" 옆 [그래도 열기] 를 누르세요.
   (애플 유료 개발자 인증을 받지 않은 무료 프로그램이라 나오는 안내입니다)
   "손상되었기 때문에 열 수 없습니다"라고 나오면 (파일이 망가진 것이 아닙니다):
   터미널(⌘+스페이스 → "터미널")을 열고 아래 한 줄을 붙여 넣고 엔터 → 다시 여세요.
       xattr -cr /Applications/예배송출.app
   비밀번호를 물으면 맥 로그인 비밀번호(입력해도 안 보이는 게 정상).
3. "네트워크의 다른 기기를 찾도록 허용" 또는 방화벽 질문이 나오면 [허용] 하세요. (OBS 자막·웹 편집기에 필요)
4. 운영 화면이 열리면 끝! 끌 때는 오른쪽 위 [⏻ 종료].

자료 저장 위치: ~/Library/Application Support/WorshipCaster
백업: 운영 화면 ⚙︎ 설정 → 💾 백업·복원 → 자료 전체 백업 받기
TXT
rm -f "$DIST/예배송출-mac.zip"
(cd "$STAGE/mac" && ditto -c -k --sequesterRsrc . "$DIST/예배송출-mac.zip")

# ── 4. 윈도우용 ───────────────────────────────────────────
WIN="$STAGE/win/예배송출"
mkdir -p "$WIN/node"
cp -R "$APPSRC" "$WIN/app"
cp "$STAGE/n/node.exe" "$WIN/node/node.exe"
# 실행 파일 (내용은 영문만: 윈도우 명령 창 한글 깨짐 방지)
printf '%s\r\n' '@echo off' \
  'rem Worship Caster - made by Easy Pastor Lee Kwangbok' \
  'set "WC_DATA_DIR=%APPDATA%\WorshipCaster"' \
  'if not exist "%WC_DATA_DIR%" mkdir "%WC_DATA_DIR%"' \
  'cd /d "%~dp0app"' \
  'start "WorshipCaster (close this window to quit)" /min "%~dp0node\node.exe" server.js' \
  > "$WIN/예배송출 실행.cmd"
python3 - "$WIN/사용법.txt" "$ABOUT_KO" <<'PY'
import sys
path, about = sys.argv[1], sys.argv[2]
text = f"""{about}

1. 압축을 푼 '예배송출' 폴더를 원하는 곳(예: 문서)에 두세요.
2. '예배송출 실행.cmd' 를 더블클릭하세요.
   - "Windows의 PC 보호" 창이 뜨면 [추가 정보] → [실행]을 누르세요. (무료 프로그램이라 나오는 안내입니다)
   - 방화벽 질문이 나오면 [액세스 허용]을 누르세요. (OBS 자막·웹 편집기에 필요)
3. 엣지 창으로 운영 화면이 열립니다.
4. 작업 표시줄의 'WorshipCaster' 창은 프로그램 본체입니다. 닫으면 꺼집니다. (운영 화면 오른쪽 위 [⏻ 종료]도 됩니다)

자료 저장 위치: %APPDATA%\\WorshipCaster
백업: 운영 화면 ⚙︎ 설정 → 💾 백업·복원 → 자료 전체 백업 받기
"""
open(path, 'w', encoding='utf-8-sig', newline='\r\n').write(text)
PY
rm -f "$DIST/예배송출-windows.zip"
python3 - "$STAGE/win" "$DIST/예배송출-windows.zip" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:   # 한글 파일명은 UTF-8 표시로 저장
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, src))
PY

# ── 5. (선택) 이 맥에 설치 ─────────────────────────────────
if [ "${1:-}" = "--install" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/예배송출.app"
  ditto "$MAC" "$HOME/Applications/예배송출.app"
  echo "설치: ~/Applications/예배송출.app"
fi
# 받은 파일이 깨지지 않았는지 확인하는 값 (릴리스 설명에 붙임)
(cd "$DIST" && shasum -a 256 예배송출-mac.zip 예배송출-windows.zip WorshipCaster-update.wcu > SHA256SUMS.txt && cat SHA256SUMS.txt)
ls -lh "$DIST"
