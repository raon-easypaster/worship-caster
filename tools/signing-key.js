#!/usr/bin/env node
// 자동 업데이트 서명 열쇠 다루기 (만든 사람: 쉬운목사 이광복)
//   node tools/signing-key.js new           → 비밀 열쇠를 새로 만듦 (~/.worshipcaster-signing/), 공개 열쇠를 보여 줌
//   node tools/signing-key.js check         → 비밀 열쇠가 앱에 든 공개 열쇠와 짝인지 확인 (build-dist.sh 가 맨 먼저 씀)
//   node tools/signing-key.js pub           → 가진 비밀 열쇠의 공개 열쇠를 보여 줌 (lib/updater.js 에 넣는 값)
//   node tools/signing-key.js sign <파일>    → <파일>.sig 만들기 (build-dist.sh 가 SHA256SUMS.txt 에 씀)
//   node tools/signing-key.js verify <파일>  → <파일>.sig 가 앱에 든 공개 열쇠로 맞는지 확인
// 비밀 열쇠 위치는 WC_SIGNING_KEY 로 바꿀 수 있음. 비밀 열쇠는 절대 저장소(깃허브)에 넣지 않습니다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const updater = require('../lib/updater');

const KEY = process.env.WC_SIGNING_KEY || path.join(os.homedir(), '.worshipcaster-signing', 'update-signing-key.pem');
const die = m => { console.error('✗ ' + m); process.exit(1); };
const readKey = () => {
  if (!fs.existsSync(KEY)) die(`비밀 열쇠가 없습니다: ${KEY}\n  처음이면: node tools/signing-key.js new\n  잃어버렸다면: docs/서명열쇠.md 의 '열쇠를 잃었을 때'를 보세요`);
  return crypto.createPrivateKey(fs.readFileSync(KEY));
};
const [cmd, file] = process.argv.slice(2);

if (cmd === 'new') {
  if (fs.existsSync(KEY)) die(`이미 비밀 열쇠가 있습니다: ${KEY}\n  덮어쓰면 지금까지 나눠 준 앱이 자동 업데이트를 받지 못합니다. 정말 새로 만들려면 그 파일을 먼저 다른 곳으로 옮기세요.`);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  console.log(`✓ 비밀 열쇠를 만들었습니다: ${KEY}`);
  console.log(`  공개 열쇠 (lib/updater.js 의 UPDATE_PUBLIC_KEYS 에 넣기):\n  ${updater.publicKeyText(crypto.createPublicKey(privateKey))}`);
  console.log('  ⚠️ 이 비밀 열쇠 파일을 USB나 비밀번호 관리 앱에 한 벌 더 보관하세요 (docs/서명열쇠.md).');
} else if (cmd === 'check') {
  const probe = crypto.randomBytes(32);
  if (!updater.verifySig(probe, crypto.sign(null, probe, readKey()).toString('base64'))) die('이 비밀 열쇠는 앱에 든 공개 열쇠(lib/updater.js)와 짝이 아닙니다.');
  console.log('✓ 서명 열쇠가 앱의 공개 열쇠와 짝이 맞습니다');
} else if (cmd === 'pub') {
  console.log(updater.publicKeyText(crypto.createPublicKey(readKey())));
} else if (cmd === 'sign') {
  if (!file || !fs.existsSync(file)) die('서명할 파일이 없습니다: ' + file);
  const sig = crypto.sign(null, fs.readFileSync(file), readKey());
  fs.writeFileSync(file + '.sig', sig.toString('base64') + '\n');
  if (!updater.verifySig(fs.readFileSync(file), fs.readFileSync(file + '.sig'))) {
    fs.rmSync(file + '.sig', { force: true });
    die('이 비밀 열쇠는 앱에 든 공개 열쇠(lib/updater.js)와 짝이 아닙니다. 이대로 배포하면 자동 업데이트가 거절됩니다.');
  }
  console.log('✓ 서명: ' + file + '.sig');
} else if (cmd === 'verify') {
  if (!file) die('파일을 적어 주세요');
  const good = fs.existsSync(file + '.sig') && updater.verifySig(fs.readFileSync(file), fs.readFileSync(file + '.sig'));
  if (!good) die('서명이 맞지 않습니다: ' + file);
  console.log('✓ 서명이 맞습니다: ' + file);
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
