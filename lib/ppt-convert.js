// PPT(.pptx·.ppt·.key)를 원본 모양 그대로 PDF로 바꾸기 — 운영 컴퓨터에 이미 있는 프로그램을 빌려 씀
//   맥:    리브레오피스 → 이음오피스 → 키노트
//   윈도우: 파워포인트 → 리브레오피스
// 바꾼 PDF는 운영 화면이 페이지마다 그림으로 만들어 슬라이드로 넣음 (글자·도형·아이콘·배경이 원본과 같음)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// 키노트: 열어서 PDF로 내보내고 닫음. 원래 꺼져 있었으면 다시 끔
const KEYNOTE_SCRIPT = [
  'on run argv',
  '  set inPath to item 1 of argv',
  '  set outPath to item 2 of argv',
  '  set wasRunning to application "Keynote" is running',
  '  try',
  '  with timeout of 110 seconds',
  '    tell application "Keynote"',
  '      set n0 to count of documents',
  '      open POSIX file inPath',
  '      repeat 60 times',   // 큰 파일은 여는 데 시간이 걸림 (최대 30초 기다림)
  '        if (count of documents) > n0 then exit repeat',
  '        delay 0.5',
  '      end repeat',
  '      if (count of documents) = n0 then error "키노트가 파일을 열지 못했습니다"',
  // 'set d to open …' 로 받은 문서를 내보내면 키노트 14가 죽음 → 맨 앞 문서로 내보냄
  '      export front document to POSIX file outPath as PDF with properties {PDF image quality:Best}',
  '      close front document saving no',
  '      if not wasRunning then quit',
  '    end tell',
  '  end timeout',
  '  on error msg',
  // 키노트가 못 여는 파일이면 "가져올 수 없습니다" 창이 뜬 채 남음 → 원래 꺼져 있었으면 키노트를 끔 (사용자 문서는 없음)
  '    if not wasRunning then do shell script "killall Keynote > /dev/null 2>&1 || true"',
  '    error msg',
  '  end try',
  'end run',
].join('\n');

// 파워포인트(윈도우): 창 없이 열어 PDF(32 = ppSaveAsPDF)로 저장. 다른 발표 자료가 열려 있지 않으면 끔
const POWERPOINT_PS1 = [
  '$ErrorActionPreference = "Stop"',
  '$in = $args[0]; $out = $args[1]',
  '$pp = New-Object -ComObject PowerPoint.Application',
  '$pp.AutomationSecurity = 3',   // 매크로는 절대 실행하지 않음 (msoAutomationSecurityForceDisable)
  '$p = $pp.Presentations.Open($in, -1, 0, 0)',
  'try { $p.SaveAs($out, 32) } finally { $p.Close() }',
  'if ($pp.Presentations.Count -eq 0) { $pp.Quit() }',
].join('\r\n');

const run = (cmd, args, timeout = 300000) => new Promise((res, rej) =>
  execFile(cmd, args, { timeout, windowsHide: true }, (err, so, se) => (err ? rej(new Error(String(se || err.message).trim().slice(0, 300))) : res())));

function sofficePath(platform = process.platform, exists = fs.existsSync) {
  const list = platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
    : platform === 'win32' ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
    : ['/usr/bin/soffice', '/usr/bin/libreoffice'];
  return list.find(p => exists(p)) || null;
}

function ieumPath(platform = process.platform, exists = fs.existsSync) {
  if (platform !== 'darwin') return null;
  const cli = 'IeumOffice.app/Contents/Resources/cli/ieumoffice';
  return ['/Applications/' + cli, path.join(os.homedir(), 'Applications', cli)].find(p => exists(p)) || null;
}

// 이 컴퓨터에서 쓸 수 있는 변환 방법 (앞에 있는 것부터 시도)
function converters(platform = process.platform, exists = fs.existsSync) {
  const out = [];
  const soffice = sofficePath(platform, exists);
  const lo = soffice && {
    name: '리브레오피스',
    async run(inPath, outPdf, work) {
      // 따로 쓰는 설정 폴더: 리브레오피스 창이 열려 있어도 변환이 됨
      const prof = 'file:///' + path.join(work, 'lo-profile').replace(/\\/g, '/').replace(/^\/+/, '');
      await run(soffice, [`-env:UserInstallation=${prof}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', work, inPath]);
      const made = path.join(work, path.basename(inPath, path.extname(inPath)) + '.pdf');
      if (!exists(made)) throw new Error('PDF가 만들어지지 않음');
      if (made !== outPdf) fs.renameSync(made, outPdf);
    },
  };
  if (platform === 'darwin') {
    if (lo) out.push(lo);
    const ieum = ieumPath(platform, exists);
    if (ieum) out.push({
      name: '이음오피스',
      // 이음오피스 명령줄: 창 없이 열어 PDF로 저장 (키노트가 못 여는 AI·웹 도구 PPT도 원본 모양 그대로). .pptx 만 됨
      async run(inPath, outPdf) {
        if (!/\.pptx$/i.test(inPath)) throw new Error('.pptx 파일만 바꿀 수 있음');
        await run(ieum, ['convert', inPath, '--to', 'pdf', '--out', outPdf, '--force'], 300000);
      },
    });
    if (exists('/Applications/Keynote.app')) out.push({
      name: '키노트',
      run: (inPath, outPdf) => run('osascript', ['-e', KEYNOTE_SCRIPT, inPath, outPdf], 120000),   // 키노트가 안내 창 등으로 멈추면 2분 뒤 포기
    });
  } else if (platform === 'win32') {
    out.push({
      name: '파워포인트',
      async run(inPath, outPdf, work) {
        const ps1 = path.join(work, 'to-pdf.ps1');
        fs.writeFileSync(ps1, '\ufeff' + POWERPOINT_PS1);
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, inPath, outPdf]);
      },
    });
    if (lo) out.push(lo);
  } else if (lo) out.push(lo);
  return out;
}

// 다른 프로그램(웹 도구 등)이 만든 .pptx 중에는 zip 안에 폴더 항목이 들어 있어 리브레오피스가 못 여는 것이 있음
// → 폴더 항목을 빼고 [Content_Types].xml 을 맨 앞에 두어 다시 묶음 (내용은 그대로)
async function repackPptx(file) {
  const JSZip = require('jszip');
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  // 압축을 풀면 터무니없이 커지는 파일(압축 폭탄)은 다시 묶지 않음
  const all = Object.values(z.files);
  const total = all.reduce((t, f) => t + (f._data?.uncompressedSize || 0), 0);
  if (all.length > 10000 || total > 500 * 1024 * 1024) return false;
  const names = Object.keys(z.files).filter(n => !z.files[n].dir);
  if (names.length === Object.keys(z.files).length) return false;   // 폴더 항목이 없으면 그대로
  names.sort((a, b) => (b === '[Content_Types].xml') - (a === '[Content_Types].xml'));
  const o = new JSZip();
  for (const n of names) o.file(n, await z.files[n].async('nodebuffer'), { createFolders: false });
  fs.writeFileSync(file, await o.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return true;
}

// inPath(.pptx 등) → { pdf: PDF 파일 경로, by: 쓴 프로그램 이름, dir: 지울 임시 폴더 }
// 파일 앞머리가 그 종류가 맞는지: .pptx·.key·.odp 는 zip(PK), 옛 .ppt 는 OLE 문서
function looksRight(file, ext) {
  const fd = fs.openSync(file, 'r'), b = Buffer.alloc(8);
  try { fs.readSync(fd, b, 0, 8, 0); } finally { fs.closeSync(fd); }
  if (/^\.ppt$/i.test(ext)) return b.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return b[0] === 0x50 && b[1] === 0x4b;
}
async function pptToPdf(inPath, ext = '.pptx') {
  if (!looksRight(inPath, ext)) { const e = new Error('PPT 파일이 아니거나 망가진 파일입니다'); e.code = 'BAD_FILE'; throw e; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-ppt-'));
  const src = path.join(work, 'slides' + (/^\.(pptx|ppt|key|odp)$/i.test(ext) ? ext.toLowerCase() : '.pptx'));
  fs.copyFileSync(inPath, src);
  if (/^\.pptx$/i.test(ext)) await repackPptx(src).catch(() => {});
  const outPdf = path.join(work, 'out.pdf');
  // 점검(하네스)용: 실제 프로그램 대신 미리 만든 PDF를 돌려줌
  if (process.env.WC_TEST_PPT_PDF !== undefined) {
    if (!process.env.WC_TEST_PPT_PDF) { fs.rmSync(work, { recursive: true, force: true }); throw noConverter(); }
    fs.copyFileSync(process.env.WC_TEST_PPT_PDF, outPdf);
    return { pdf: outPdf, by: '시험', dir: work };
  }
  const list = converters();
  if (!list.length) { fs.rmSync(work, { recursive: true, force: true }); throw noConverter(); }
  const errs = [];
  for (const c of list) {
    try {
      await c.run(src, outPdf, work);
      if (fs.existsSync(outPdf) && fs.statSync(outPdf).size > 0) return { pdf: outPdf, by: c.name, dir: work };
      errs.push(`${c.name}: PDF가 비어 있음`);
    } catch (e) { errs.push(`${c.name}: ${e.message}`); }
  }
  fs.rmSync(work, { recursive: true, force: true });
  const e = new Error(failMessage(errs, list.some(c => c.name === '리브레오피스' || c.name === '이음오피스')));
  e.code = 'CONVERT_FAILED'; throw e;
}
// 바꾸지 못했을 때 안내. 리브레오피스가 없으면 설치를 권함 (AI·웹 도구로 만든 PPT는 키노트가 못 여는 것이 많음)
function failMessage(errs, hasLO, platform = process.platform) {
  let m = '그림으로 바꾸지 못했습니다 (' + errs.join(' / ') + '). 파워포인트·키노트에서 PDF로 저장한 뒤 [＋ PDF·악보]로 넣어 주세요.';
  if (!hasLO) m += platform === 'win32'
    ? ' 또는 무료 프로그램 리브레오피스(libreoffice.org)를 설치하면 이런 파일도 그림으로 바꿀 수 있습니다.'
    : ' 또는 무료 프로그램 리브레오피스(libreoffice.org)나 이음오피스를 응용 프로그램 폴더에 설치하면, 키노트가 못 여는 PPT(AI·웹 도구로 만든 것 등)도 그림으로 바꿀 수 있습니다.';
  return m;
}
function noConverter() {
  const e = new Error(process.platform === 'win32'
    ? '이 컴퓨터에 파워포인트나 리브레오피스가 없어 그림으로 바꿀 수 없습니다. 파워포인트에서 PDF로 저장한 뒤 [＋ PDF·악보]로 넣어 주세요.'
    : '이 컴퓨터에 키노트·리브레오피스·이음오피스가 없어 그림으로 바꿀 수 없습니다. 키노트는 앱 스토어에서 무료로 받을 수 있습니다. 또는 PDF로 저장한 뒤 [＋ PDF·악보]로 넣어 주세요.');
  e.code = 'NO_CONVERTER'; return e;
}

module.exports = { pptToPdf, repackPptx, looksRight, converters, sofficePath, ieumPath, failMessage, KEYNOTE_SCRIPT, POWERPOINT_PS1 };
