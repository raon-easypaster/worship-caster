// 자동 업데이트: 새 프로그램(app 폴더)을 자료 폴더에 받아 두고, 다음 켤 때부터 그것을 실행
// - 앱 안의 파일(맥 .app 서명, 윈도우 폴더)은 건드리지 않음 → 맥 「손상된 앱」 걱정 없음
// - Node.js 실행 파일은 앱에 든 것을 그대로 씀. 바뀌는 것은 프로그램(server.js·lib·public·node_modules)뿐
// - 받은 파일은 같은 배포에 올린 SHA256SUMS.txt 값과 맞아야 설치함
// - SHA256SUMS.txt 에는 만든 사람의 서명(SHA256SUMS.txt.sig, Ed25519)이 있어야 함 → 깃허브 계정을 빼앗겨도 바꿔치기 못 함
//   서명이 없거나 틀리면 자동 설치하지 않음(받는 곳에서 직접 받게). 켤 때도 받아 둔 프로그램을 서명으로 다시 확인
// - 새로 받은 앱(폴더)을 직접 설치해 그 버전이 더 높으면 자료 폴더의 것은 쓰지 않음
//
// 묶음 파일(WorshipCaster-update.wcu) 모양: gzip( 'WCU1' + 4바이트 길이 + JSON 목록 + 파일 내용을 차례로 )
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MAGIC = 'WCU1';
const MAX_SIZE = 200 * 1024 * 1024;   // 풀었을 때 크기 상한
const VER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// 자동 업데이트 서명 확인용 공개 열쇠 (Ed25519, SPKI DER base64). 비밀 열쇠는 만든 사람 컴퓨터에만 (docs/서명열쇠.md)
// 열쇠를 바꿀 때는 새 열쇠를 여기 더한 버전을 옛 열쇠로 서명해 먼저 배포하고, 그다음부터 새 열쇠로 서명
const UPDATE_PUBLIC_KEYS = [
  'MCowBQYDK2VwAyEAcXCZJVM+a89dgM3OhDSLls7SQI3tahdqyaFdCKeSoMc=',
];
const UPDATE_ASSET = 'WorshipCaster-update.wcu';
const SUMS = 'SHA256SUMS.txt';
const META = ['.complete', '.update.wcu', '.SHA256SUMS.txt', '.SHA256SUMS.txt.sig'];   // 설치 폴더에 함께 두는 확인용 파일

const dataDir = () => require('./store').DATA_DIR;
const updDir = () => path.join(dataDir(), 'app-update');

function isNewer(a, b) {
  const p = s => String(s).split('.').map(n => +n || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
const versionOf = dir => { try { return String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || ''); } catch { return ''; } };

// ── 묶기 (build-dist.sh 가 씀) ──
function pack(srcDir) {
  const version = versionOf(srcDir);
  if (!VER.test(version)) throw new Error('package.json 버전을 읽지 못함');
  const files = [], bufs = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) { const b = fs.readFileSync(path.join(srcDir, r)); files.push([r.normalize('NFC'), b.length]); bufs.push(b); }
    }
  })('');
  const index = Buffer.from(JSON.stringify({ version, files }));
  const head = Buffer.alloc(8); head.write(MAGIC, 0, 'ascii'); head.writeUInt32BE(index.length, 4);
  return zlib.gzipSync(Buffer.concat([head, index, ...bufs]), { level: 9 });
}

// 경로가 묶음 밖으로 나가지 않는지 (../, 절대 경로, 드라이브 문자 막음)
const safeRel = r => typeof r === 'string' && r.length < 400 && !/^[\\/]|^[a-z]:|\0/i.test(r) && r.split(/[\\/]/).every(s => s && s !== '.' && s !== '..');

function unpack(gz) {
  const buf = zlib.gunzipSync(gz, { maxOutputLength: MAX_SIZE });
  if (buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('업데이트 파일 모양이 아닙니다');
  const n = buf.readUInt32BE(4);
  const idx = JSON.parse(buf.toString('utf8', 8, 8 + n));
  if (!VER.test(idx.version) || !Array.isArray(idx.files)) throw new Error('업데이트 파일 목록이 잘못됨');
  let at = 8 + n;
  const files = idx.files.map(([rel, size]) => {
    if (!safeRel(rel) || !Number.isInteger(size) || size < 0 || at + size > buf.length) throw new Error('업데이트 파일 목록이 잘못됨: ' + rel);
    const f = [rel, buf.subarray(at, at + size)]; at += size; return f;
  });
  if (at !== buf.length) throw new Error('업데이트 파일 크기가 맞지 않음');
  const names = new Set(files.map(f => f[0]));
  if (!names.has('server.js') || !names.has('package.json')) throw new Error('업데이트 파일에 프로그램이 없음');
  return { version: idx.version, files };
}

// ── 서명 ──
const publicKeyText = k => k.export({ type: 'spki', format: 'der' }).toString('base64');
function trustedKeys() {
  // 자동 점검(WC_UPDATE_API 로 가짜 배포를 쓸 때)에서만 시험용 공개 열쇠를 씀
  const list = process.env.WC_UPDATE_API && process.env.WC_UPDATE_PUBKEY ? [process.env.WC_UPDATE_PUBKEY] : UPDATE_PUBLIC_KEYS;
  return list.flatMap(t => { try { return [crypto.createPublicKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'spki' })]; } catch { return []; } })
    .filter(k => k.asymmetricKeyType === 'ed25519');
}
function verifySig(data, sigText) {
  const sig = Buffer.from(String(sigText || '').trim(), 'base64');
  if (sig.length !== 64) return false;
  return trustedKeys().some(k => { try { return crypto.verify(null, Buffer.from(data), k, sig); } catch { return false; } });
}
// SHA256SUMS.txt 에서 파일 하나의 확인값
const sumFor = (sums, name) => ((String(sums).split('\n').map(l => l.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)).find(m => m && m[2] === name) || [])[1] || '').toLowerCase();
const manualErr = m => Object.assign(new Error(m), { manual: true });   // 자동 설치 대신 받는 곳에서 받게 할 오류

// 서명 → 확인값 → 묶음 순서로 확인하고 묶음을 풀어 돌려줌 (설치할 때·켤 때 함께 씀)
function verifyPackage(gz, sums, sig) {
  if (!sums || !sig) throw manualErr('이 배포에는 서명이 없어 자동으로 설치하지 않습니다. 받는 곳에서 새 앱을 받아 바꿔 넣으세요');
  if (!verifySig(sums, sig)) throw manualErr('배포 파일의 서명이 맞지 않아 설치하지 않았습니다. 받는 곳에서 새 앱을 받아 바꿔 넣으세요');
  const want = sumFor(sums, UPDATE_ASSET);
  if (!want) throw new Error('확인값(SHA256SUMS)에 업데이트 파일이 없습니다');
  if (sha256(gz) !== want) throw new Error('받은 파일의 확인값이 맞지 않습니다 (받다가 깨졌을 수 있음). 잠시 뒤 다시 해 보세요');
  return unpack(gz);
}

// 받아 둔 폴더가 설치 때 그대로인지 (서명·확인값을 다시 보고, 파일 하나하나를 묶음과 견줌)
function verifyInstalled(dir, version) {
  const rd = n => fs.readFileSync(path.join(dir, n));
  const { version: v, files } = verifyPackage(rd('.update.wcu'), rd('.SHA256SUMS.txt').toString('utf8'), rd('.SHA256SUMS.txt.sig').toString('utf8'));
  if (v !== version) throw new Error('받아 둔 버전이 맞지 않음');
  const want = new Map(files);
  const seen = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = (rel ? rel + '/' + e.name : e.name).normalize('NFC');
      if (e.isDirectory()) walk(r);
      else if (!META.includes(r) && e.name !== '.DS_Store') seen.push(r);
    }
  })('');
  for (const r of seen) if (!want.has(r)) throw new Error('받아 둔 프로그램에 모르는 파일이 있음: ' + r);
  for (const [r, b] of want) {
    let disk; try { disk = fs.readFileSync(path.join(dir, ...r.split('/'))); } catch { throw new Error('받아 둔 프로그램에 파일이 없음: ' + r); }
    if (!disk.equals(b)) throw new Error('받아 둔 프로그램 파일이 바뀌었음: ' + r);
  }
  return true;
}

// ── 설치: 자료 폴더/app-update/<버전> 에 풀고, 다 풀린 뒤에야 current.json 을 바꿈 ──
function install(gz, { expectVersion, currentVersion, sums, sig } = {}) {
  const { version, files } = verifyPackage(gz, sums, sig);
  if (expectVersion && version !== expectVersion) throw new Error(`받은 파일의 버전(${version})이 배포 버전(${expectVersion})과 다릅니다`);
  if (currentVersion && !isNewer(version, currentVersion)) throw new Error(`이미 v${currentVersion} 입니다`);
  const base = updDir();
  const dest = path.join(base, version), tmp = dest + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, b] of files) {
    const to = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, b);
  }
  if (versionOf(tmp) !== version) throw new Error('풀어 놓은 프로그램의 버전이 맞지 않음');
  // 켤 때 다시 확인하려고 받은 그대로 남겨 둠
  fs.writeFileSync(path.join(tmp, '.update.wcu'), gz);
  fs.writeFileSync(path.join(tmp, '.SHA256SUMS.txt'), String(sums));
  fs.writeFileSync(path.join(tmp, '.SHA256SUMS.txt.sig'), String(sig));
  fs.writeFileSync(path.join(tmp, '.complete'), version);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  // 자료를 한 벌 남겨 둠 (혹시 새 버전이 자료를 잘못 바꾸면 되돌릴 수 있게)
  try { fs.copyFileSync(path.join(dataDir(), 'db.json'), path.join(dataDir(), `db-before-v${version}.json`)); } catch {}
  const cur = path.join(base, 'current.json');
  fs.writeFileSync(cur + '.tmp', JSON.stringify({ version, at: Date.now() }));
  fs.renameSync(cur + '.tmp', cur);
  // 예전에 받아 둔 다른 버전은 지움
  for (const d of fs.readdirSync(base)) if (d !== version && d !== 'current.json' && d !== 'bad') fs.rmSync(path.join(base, d), { recursive: true, force: true });
  return { version, files: files.length };
}

// ── 켤 때: 앱에 든 것보다 새 버전을 받아 두었으면 그 server.js 경로 (없으면 null) ──
function pick(bundleDir) {
  try {
    const base = updDir();
    const { version } = JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'));
    if (!VER.test(version)) return null;
    const dir = path.join(base, version);
    if (!isNewer(version, versionOf(bundleDir))) {
      // 앱(폴더)을 직접 더 새 버전으로 바꿔 넣었음 → 받아 둔 것은 정리
      fs.rmSync(base, { recursive: true, force: true });
      return null;
    }
    if (fs.readFileSync(path.join(dir, '.complete'), 'utf8') !== version) return null;
    const entry = path.join(dir, 'server.js');
    if (!fs.existsSync(entry)) return null;
    // 실행하기 전에 서명으로 다시 확인 → 틀리면 치워 두고 앱에 든 버전으로 켬
    try { verifyInstalled(dir, version); }
    catch (e) { console.error('받아 둔 새 버전을 확인하지 못해 앱에 든 버전으로 켭니다:', e.message); markBad(entry, '확인 실패: ' + e.message); return null; }
    return entry;
  } catch { return null; }
}

// 받아 둔 새 버전이 켜지지 않으면: 치워 두고 앱에 든 버전으로 켬 (다음 업데이트 때 다시 받음)
function markBad(entry, err) {
  try {
    const dir = path.dirname(entry), base = updDir();
    fs.mkdirSync(path.join(base, 'bad'), { recursive: true });
    fs.writeFileSync(path.join(base, 'bad', path.basename(dir) + '.txt'), String(err && err.stack || err));
    fs.rmSync(path.join(base, 'current.json'), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

module.exports = { isNewer, pack, unpack, install, pick, markBad, sha256, safeRel, updDir,
  UPDATE_ASSET, SUMS, publicKeyText, verifySig, sumFor, verifyPackage, verifyInstalled };
