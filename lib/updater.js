// 자동 업데이트: 새 프로그램(app 폴더)을 자료 폴더에 받아 두고, 다음 켤 때부터 그것을 실행
// - 앱 안의 파일(맥 .app 서명, 윈도우 폴더)은 건드리지 않음 → 맥 「손상된 앱」 걱정 없음
// - Node.js 실행 파일은 앱에 든 것을 그대로 씀. 바뀌는 것은 프로그램(server.js·lib·public·node_modules)뿐
// - 받은 파일은 같은 배포에 올린 SHA256SUMS.txt 값과 맞아야 설치함
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

// ── 설치: 자료 폴더/app-update/<버전> 에 풀고, 다 풀린 뒤에야 current.json 을 바꿈 ──
function install(gz, { expectVersion, currentVersion } = {}) {
  const { version, files } = unpack(gz);
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
    return fs.existsSync(entry) ? entry : null;
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

module.exports = { isNewer, pack, unpack, install, pick, markBad, sha256, safeRel, updDir };
