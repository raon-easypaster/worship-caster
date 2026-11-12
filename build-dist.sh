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

ABOUT_KO="예배송출 v$VERSION — 만든 사람: 쉬운목사 이광복 (무료로 나눕니다)"

# ── 3. 맥 앱 ───────────────────────────────────────────────
MAC="$STAGE/mac/예배송출.app"
mkdir -p "$MAC/Contents/MacOS" "$MAC/Contents/Resources/node"
cp -R "$APPSRC" "$MAC/Contents/Resources/app"
cp "$STAGE/n/node-universal" "$MAC/Contents/Resources/node/node"
cp assets/icon.icns "$MAC/Contents/Resources/icon.icns"
cat > "$MAC/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>예배송출</string>
  <key>CFBundleDisplayName</key><string>예배송출</string>
  <key>CFBundleIdentifier</key><string>kr.easypastor.worship-caster</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>NSHumanReadableCopyright</key><string>만든 사람: 쉬운목사 이광복</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string><string>x86_64</string></array>
</dict></plist>
PLIST
cat > "$MAC/Contents/MacOS/launcher" <<'LAUNCH'
#!/bin/bash
# 예배송출 실행기 — 만든 사람: 쉬운목사 이광복
R="$(cd "$(dirname "$0")/../Resources" && pwd)"
export WC_DATA_DIR="$HOME/Library/Application Support/WorshipCaster"
LOG="$HOME/Library/Logs/WorshipCaster.log"
mkdir -p "$WC_DATA_DIR" "$(dirname "$LOG")"
cd "$R/app" || exit 1
# 서버가 운영 화면을 직접 엽니다. 이미 켜져 있으면 창만 다시 엽니다.
# 애플 칩(M1~)이면 애플 칩용으로 바로 실행 (안 그러면 인텔용으로 번역되며 첫 실행이 느려짐)
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then RUN=(arch -arm64); else RUN=(); fi
nohup "${RUN[@]}" "$R/node/node" server.js >>"$LOG" 2>&1 &
PID=$!
for i in $(seq 1 50); do
  curl -s -m 1 http://localhost:5300/api/me >/dev/null 2>&1 && exit 0
  kill -0 $PID 2>/dev/null || break
  sleep 0.2
done
curl -s -m 1 http://localhost:5300/api/me >/dev/null 2>&1 && exit 0
osascript -e "display alert \"예배송출\" message \"프로그램을 시작하지 못했습니다. 기록 파일: $LOG\" as critical" >/dev/null 2>&1
exit 1
LAUNCH
chmod +x "$MAC/Contents/MacOS/launcher" "$MAC/Contents/Resources/node/node"
xattr -cr "$MAC"
codesign --force --deep -s - "$MAC"
cat > "$STAGE/mac/처음 실행 방법.txt" <<TXT
$ABOUT_KO

1. 예배송출.app 을 '응용 프로그램' 폴더로 끌어다 놓으세요.
2. 처음 한 번만: 앱을 더블클릭하면 "확인할 수 없습니다"라는 창이 뜹니다. [완료]를 누른 뒤
   시스템 설정 → 개인정보 보호 및 보안 → 맨 아래 "예배송출" 옆 [그래도 열기] 를 누르세요.
   (애플 유료 개발자 인증을 받지 않은 무료 프로그램이라 나오는 안내입니다)
3. "네트워크의 다른 기기를 찾도록 허용" 또는 방화벽 질문이 나오면 [허용] 하세요. (OBS 자막·웹 편집기에 필요)
4. 운영 화면이 열리면 끝! 끌 때는 오른쪽 위 [⏻ 종료].

자료 저장 위치: ~/Library/Application Support/WorshipCaster  (백업하려면 이 폴더를 복사)
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

자료 저장 위치: %APPDATA%\\WorshipCaster  (백업하려면 이 폴더를 복사)
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
ls -lh "$DIST"
