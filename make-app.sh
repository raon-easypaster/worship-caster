#!/bin/bash
# 예배송출.app 만들기 — 더블클릭으로 실행되는 맥 앱 (터미널 불필요)
# 사용: bash make-app.sh   → 이 폴더와 ~/Applications 에 예배송출.app 생성
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/예배송출.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>예배송출</string>
  <key>CFBundleDisplayName</key><string>예배송출</string>
  <key>CFBundleIdentifier</key><string>local.worship-caster</string>
  <key>CFBundleVersion</key><string>0.2.0</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/launcher" <<LAUNCH
#!/bin/bash
# 예배송출 실행기: 서버를 뒤에서 켜고 운영 화면을 엽니다.
PROJECT="$DIR"
PORT=5300
URL="http://localhost:\$PORT/control"
LOG="\$HOME/Library/Logs/예배송출.log"

alert() { osascript -e "display alert \"예배송출\" message \"\$1\" as critical" >/dev/null 2>&1; }

open_ui() {
  # 크롬이 있으면 주소창 없는 '앱 창'으로, 없으면 기본 브라우저로
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="\$URL" --window-size=1440,900
  else
    open "\$URL"
  fi
}

# 이미 켜져 있으면 창만 다시 연다
if curl -s -m 1 "http://localhost:\$PORT/api/me" >/dev/null 2>&1; then open_ui; exit 0; fi

if [ ! -f "\$PROJECT/server.js" ]; then
  alert "프로그램 폴더를 찾을 수 없습니다: \$PROJECT  — 폴더를 옮겼다면 그 폴더에서 make-app.sh 를 다시 실행하세요."
  exit 1
fi

NODE=""
for c in "\$HOME/.local/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node "\$HOME"/.nvm/versions/node/*/bin/node /usr/bin/node; do
  [ -x "\$c" ] && NODE="\$c" && break
done
[ -z "\$NODE" ] && NODE="\$(/bin/bash -lc 'command -v node' 2>/dev/null)"
if [ -z "\$NODE" ]; then alert "Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요."; exit 1; fi

cd "\$PROJECT"
if [ ! -d node_modules ]; then
  PATH="\$(dirname "\$NODE"):\$PATH" npm install >>"\$LOG" 2>&1 || { alert "처음 설치(npm install)에 실패했습니다. 인터넷 연결을 확인하세요. 기록: \$LOG"; exit 1; }
fi

NO_OPEN=1 PORT=\$PORT nohup "\$NODE" server.js >>"\$LOG" 2>&1 &

for i in \$(seq 1 50); do
  curl -s -m 1 "http://localhost:\$PORT/api/me" >/dev/null 2>&1 && { open_ui; exit 0; }
  sleep 0.2
done
alert "프로그램을 시작하지 못했습니다. 기록 파일을 확인하세요: \$LOG"
exit 1
LAUNCH
chmod +x "$APP/Contents/MacOS/launcher"

# 아이콘 (파란 바탕 + 흰 십자가)
if [ -f "$DIR/assets/icon.icns" ]; then cp "$DIR/assets/icon.icns" "$APP/Contents/Resources/icon.icns"; fi

codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/예배송출.app"
cp -R "$APP" "$HOME/Applications/"
echo "만들었습니다: $APP"
echo "              $HOME/Applications/예배송출.app  (Launchpad·Spotlight 에서 '예배송출' 검색)"
