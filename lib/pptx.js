// .pptx 가져오기: 슬라이드별 글자·도형·표·그림을 위치(%)가 있는 요소로 변환
// 애니메이션·전환 효과는 가져오지 않음. 그림은 data/media 로 추출.
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const { uid } = require('./store');

const attr = (s, name) => { const m = s.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : null; };
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function relMap(xml) {
  const map = {};
  for (const m of (xml || '').matchAll(/<Relationship\b[^>]*>/g)) map[attr(m[0], 'Id')] = attr(m[0], 'Target');
  return map;
}
function resolve(base, target) { return path.posix.normalize(path.posix.join(path.posix.dirname(base), target)); }

function xfrm(block, W, H) {
  const off = block.match(/<a:off\b[^>]*>/), ext = block.match(/<a:ext\b[^>]*>/);
  if (!off || !ext) return null;
  return {
    x: +attr(off[0], 'x') / W * 100, y: +attr(off[0], 'y') / H * 100,
    w: +attr(ext[0], 'cx') / W * 100, h: +attr(ext[0], 'cy') / H * 100,
  };
}

function paragraphs(txBody) {
  const paras = [];
  let size = null, color = null, bold = false, align = null;
  for (const p of txBody.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const pp = p[0];
    const al = pp.match(/<a:pPr\b[^>]*algn="(\w+)"/);
    if (al && !align) align = { l: 'left', ctr: 'center', r: 'right', just: 'left' }[al[1]] || null;
    let line = '';
    for (const r of pp.matchAll(/<a:br\b[^>]*\/>|<a:(r|fld)\b[\s\S]*?<\/a:\1>/g)) {
      if (!r[1]) { line += '\n'; continue; }
      const rp = r[0].match(/<a:rPr\b[^>]*>/);
      if (rp) {
        if (!size && attr(rp[0], 'sz')) size = +attr(rp[0], 'sz') / 100;
        if (attr(rp[0], 'b') === '1') bold = true;
      }
      const c = r[0].match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/);
      if (c && !color) color = '#' + c[1];
      const t = r[0].match(/<a:t>([\s\S]*?)<\/a:t>/);
      if (t) line += decode(t[1]);
    }
    paras.push(line);
  }
  // 앞뒤 빈 줄 정리
  while (paras.length && !paras[paras.length - 1].trim()) paras.pop();
  while (paras.length && !paras[0].trim()) paras.shift();
  return { text: paras.join('\n'), size, color, bold, align };
}

async function importPptx(buffer, mediaDir, title) {
  const zip = await JSZip.loadAsync(buffer);
  const pres = await zip.file('ppt/presentation.xml')?.async('string');
  if (!pres) throw new Error('올바른 .pptx 파일이 아닙니다');
  const sz = pres.match(/<p:sldSz\b[^>]*>/);
  const W = sz ? +attr(sz[0], 'cx') : 12192000, H = sz ? +attr(sz[0], 'cy') : 6858000;
  const presRels = relMap(await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'));
  const order = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map(m => attr(m[0], 'r:id')).map(id => 'ppt/' + presRels[id]);

  const saved = {};
  async function saveImage(zpath) {
    if (saved[zpath]) return saved[zpath];
    const f = zip.file(zpath);
    if (!f) return null;
    const ext = path.extname(zpath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) return null;
    const name = `ppt_${uid()}${ext}`;
    fs.writeFileSync(path.join(mediaDir, name), await f.async('nodebuffer'));
    return (saved[zpath] = '/media/' + name);
  }

  const slides = [];
  for (const sp of order) {
    const xml = await zip.file(sp)?.async('string');
    if (!xml) continue;
    const rels = relMap(await zip.file(sp.replace('slides/', 'slides/_rels/') + '.rels')?.async('string'));
    const elements = [];
    let bg = null, bgColor = null;

    // 배경
    const bgm = xml.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
    if (bgm) {
      const blip = bgm[1].match(/r:embed="([^"]+)"/);
      if (blip && rels[blip[1]]) bg = await saveImage(resolve(sp, rels[blip[1]]));
      const c = bgm[1].match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
      if (c) bgColor = '#' + c[1];
    }

    // 도형/글상자
    const tree = xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/)?.[1] || '';
    for (const m of tree.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      const kind = m[1], block = m[0];
      const box = xfrm(block, W, H);
      if (kind === 'pic') {
        const emb = block.match(/r:embed="([^"]+)"/);
        const src = emb && rels[emb[1]] ? await saveImage(resolve(sp, rels[emb[1]])) : null;
        if (src && box) {
          // 화면 대부분을 덮는 그림은 배경으로
          if (!bg && box.w > 90 && box.h > 90) bg = src;
          else elements.push({ id: uid(), type: 'image', ...box, src });
        }
      } else if (kind === 'graphicFrame') {
        const rows = [...block.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map(tr =>
          [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(tc => paragraphs(tc[0]).text));
        if (rows.length && box) elements.push({ id: uid(), type: 'table', ...box, rows, size: 18, color: '#ffffff' });
      } else {
        const tx = block.match(/<p:txBody>[\s\S]*?<\/p:txBody>/);
        const spPr = block.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0] || '';
        const fill = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, '').match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/);
        const p = tx ? paragraphs(tx[0]) : { text: '' };
        const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(block);
        const pos = box || (isTitle ? { x: 5, y: 5, w: 90, h: 18 } : { x: 5, y: 25, w: 90, h: 65 });
        if (!p.text.trim() && !fill) continue;
        elements.push({
          id: uid(), type: 'text', ...pos, text: p.text,
          size: p.size || (isTitle ? 40 : 28), color: p.color || null, bold: p.bold || isTitle,
          align: p.align || (isTitle ? 'center' : 'left'), fill: fill ? '#' + fill[1] : null,
        });
      }
    }
    const text = elements.filter(e => e.type === 'text').map(e => e.text).join('\n').trim();
    slides.push({ id: uid(), text, bg, bgColor, elements, ppt: true, ptH: H / 12700 });
  }
  return { id: uid(), type: 'ppt', title: title || 'PPT', slides };
}

module.exports = { importPptx };
