/* Aadhaar Crop & Print — runs entirely in the browser. */
'use strict';

// ---------- Constants (exact output geometry) ----------
const PT_PER_CM = 72 / 2.54;
const PAGE_W = 288, PAGE_H = 432;            // 4 × 6 inch in points
const CARD_W = 8.5 * PT_PER_CM;              // 240.945 pt
const CARD_H = 5.5 * PT_PER_CM;              // 155.906 pt
const RATIO = 8.5 / 5.5;                     // 1.5455
const TOP_MARGIN = 36;                       // 0.5 inch above the front card
const CARD_PX = [1020, 660];                 // 17:11, exactly the card ratio (~300 dpi)

const $ = id => document.getElementById(id);
const S = { bytes: null, canvas: null, rects: [], name: '', cards: null };
const NAMES = ['Front', 'Back'];

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- Navigation ----------
function show(n) {
  ['s1', 's2', 's3'].forEach((id, i) => $(id).hidden = i + 1 !== Math.min(n, 3));
  document.querySelectorAll('#steps li').forEach(li => {
    const k = +li.dataset.s;
    li.className = k === n ? 'on' : k < n ? 'past' : '';
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showError(msg) { $('err').textContent = msg; $('err').hidden = !msg; }
function restart() {
  Object.assign(S, { bytes: null, canvas: null, rects: [], name: '', cards: null });
  $('file').value = ''; $('pw').value = '';
  $('fileinfo').hidden = $('pwbox').hidden = $('done').hidden = true; showError('');
  show(1);
}

// ---------- Upload ----------
const drop = $('drop');
$('choose').onclick = e => { e.stopPropagation(); $('file').click(); };
drop.onclick = () => $('file').click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
$('file').onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); };
const checkPw = () => { const v = $('pw').value; if (!v) return showError('Enter the password, then press Open PDF.'); openPdf(v); };
$('openpdf').onclick = checkPw;
$('pw').onkeydown = e => { if (e.key === 'Enter') checkPw(); };
document.querySelectorAll('[data-restart]').forEach(b => b.onclick = restart);

async function handleFile(file) {
  showError(''); $('pwbox').hidden = true;
  const ext = file.name.split('.').pop().toLowerCase();
  const isPdf = file.type === 'application/pdf' || ext === 'pdf';
  const isJpg = /^image\/jpe?g$/.test(file.type) || ['jpg', 'jpeg'].includes(ext);
  if (!isPdf && !isJpg) return showError('This file type is not supported. Choose a PDF, JPG or JPEG file.');
  S.name = file.name;
  $('fileinfo').hidden = false;
  $('fileinfo').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  try {
    if (isPdf) { S.bytes = new Uint8Array(await file.arrayBuffer()); await openPdf(); }
    else { S.canvas = await imageToCanvas(file); afterLoad(); }
  } catch (err) { console.error(err); showError('This file could not be read. Check that it is a valid Aadhaar PDF or JPG.'); }
}

async function imageToCanvas(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const k = Math.min(1, 3600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

const isPw = e => e && e.name === 'PasswordException';

async function renderPdf(password) {
  const task = pdfjsLib.getDocument({ data: S.bytes.slice(), password });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const v = page.getViewport({ scale: Math.min(4, 3000 / Math.max(v1.width, v1.height)) });
  const c = document.createElement('canvas');
  c.width = Math.round(v.width); c.height = Math.round(v.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: v }).promise;
  return c;
}

// The file name is tried automatically as the password: first without ".pdf", then exactly as saved.
function nameGuesses(name) {
  const base = name.replace(/\.pdf$/i, '');
  return base === name ? [name] : [base, name];
}

async function openPdf(password) {
  if (!window.pdfjsLib) return showError('PDF.js could not load. Check your internet connection and reload.');
  showError('');
  try {
    let canvas, first;
    try { canvas = await renderPdf(password); }
    catch (e) {
      if (password !== undefined || !isPw(e)) throw e;
      first = e;
      for (const guess of nameGuesses(S.name)) {          // automatic attempt, no prompt
        try { canvas = await renderPdf(guess); break; }
        catch (e2) { if (!isPw(e2)) throw e2; }
      }
      if (!canvas) throw first;
    }
    S.canvas = canvas; $('pwbox').hidden = true; $('pw').value = '';
    afterLoad();
  } catch (e) {
    if (isPw(e)) {
      $('pwbox').hidden = false; $('pw').focus();
      showError(password !== undefined
        ? 'Incorrect password. Check it and try again.'
        : 'Incorrect password. The file name did not open this PDF, so enter the password below.');
    } else { console.error(e); showError('This PDF could not be opened. It may be damaged or in an unsupported format.'); }
  }
}

// ---------- Detection (plain JS image processing, no server) ----------
function dilate(m, w, h, r) {
  const a = new Uint8Array(m.length), b = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= r) a[y * w + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) a[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (a[y * w + x]) last = y; if (y - last <= r) b[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (a[y * w + x]) last = y; if (last - y <= r) b[y * w + x] = 1; }
  }
  return b;
}

function detect(c) {
  const s = 500 / Math.max(c.width, c.height), w = Math.round(c.width * s), h = Math.round(c.height * s), r = 3;
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) { const p = i * 4; if (d[p] < 235 || d[p + 1] < 235 || d[p + 2] < 235) m[i] = 1; }
  const g = dilate(m, w, h, r), seen = new Uint8Array(g.length), found = [], stack = new Int32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    if (!g[i] || seen[i]) continue;
    let sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp], px = p % w, py = (p / w) | 0;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= g.length || g[q] === 0 || seen[q]) continue;
        if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue;
        seen[q] = 1; stack[sp++] = q;
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ar = bw / bh;
    if (bw > Math.min(w, h) * 0.3 && ar > 1.25 && ar < 1.9) found.push({ x: (x0 + r) / s, y: (y0 + r) / s, w: (bw - 2 * r) / s, h: (bh - 2 * r) / s });
  }
  found.sort((a, b) => b.w * b.h - a.w * a.h);
  if (found.length < 2) return null;
  const [p, q] = found.slice(0, 2).map(r => ({ ...r }));
  const overlapY = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  const sideBySide = overlapY > 0.5 * Math.min(p.h, q.h);
  return [p, q].sort((a, b) => sideBySide ? a.x - b.x : a.y - b.y);   // front first, back second
}

function defaultRects() {
  const W = S.canvas.width, H = S.canvas.height, w = Math.min(W * 0.44, H * 0.4 * RATIO), h = w / RATIO;
  return [{ x: W * 0.053, y: H * 0.6750, w, h }, { x: W * 0.505, y: H * 0.6750, w, h }];
}

function afterLoad() {
  const f = detect(S.canvas);
  S.rects = f || defaultRects();
  $('notice').hidden = !!f;
  if (!f) $('notice').textContent = 'The cards could not be found automatically. Move and resize the two boxes onto the front and back cards.';
  const th = document.createElement('canvas'); th.width = 80; th.height = Math.round(80 * S.canvas.height / S.canvas.width);
  th.getContext('2d').drawImage(S.canvas, 0, 0, th.width, th.height);
  const img = new Image(); img.src = th.toDataURL('image/jpeg', .7); img.alt = '';
  $('fileinfo').prepend(img);
  $('src').width = S.canvas.width; $('src').height = S.canvas.height;
  $('src').getContext('2d').drawImage(S.canvas, 0, 0);
  buildBoxes(); show(2);
}
$('redetect').onclick = () => { const f = detect(S.canvas); S.rects = f || defaultRects(); $('notice').hidden = !!f; if (!f) $('notice').textContent = 'Nothing was detected. Place the boxes on the cards by hand.'; refresh(); };
$('swap').onclick = () => { S.rects.reverse(); refresh(); };

// ---------- Rectangle editor ----------
function buildBoxes() {
  const o = $('overlay'); o.innerHTML = '';
  S.rects.forEach((_, i) => {
    const b = document.createElement('div'); b.className = 'box'; b.dataset.i = i;
    b.style.setProperty('--c', i ? 'var(--back)' : 'var(--front)');
    b.innerHTML = `<b></b><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>`;
    o.appendChild(b);
  });
  refresh();
}
function refresh() {
  const W = S.canvas.width, H = S.canvas.height;
  document.querySelectorAll('.box').forEach((b, i) => {
    const r = S.rects[i];
    Object.assign(b.style, { left: r.x / W * 100 + '%', top: r.y / H * 100 + '%', width: r.w / W * 100 + '%', height: r.h / H * 100 + '%' });
    b.firstChild.textContent = NAMES[i];
  });
  const ul = $('checks'); ul.innerHTML = '';
  S.rects.forEach((r, i) => {
    const ratio = r.w / r.h, ok = Math.abs(ratio / RATIO - 1) < 0.03, dpi = Math.round(r.w / (8.5 / 2.54));
    const li = document.createElement('li');
    li.innerHTML = ok
      ? `<span class="ok">✓ ${NAMES[i]}: shape matches a card.</span><span class="muted">About ${dpi} dpi when printed.</span>`
      : `<span class="bad">⚠ ${NAMES[i]}: shape is ${ratio.toFixed(2)}, a card is ${RATIO.toFixed(2)}. The crop will be trimmed to fit, never stretched.</span>`;
    if (!ok) { const b = document.createElement('button'); b.textContent = 'Fix shape'; b.onclick = () => { fitRatio(r); refresh(); }; li.appendChild(b); }
    ul.appendChild(li);
  });
}
function fitRatio(r) {
  const W = S.canvas.width, H = S.canvas.height, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let h = r.w / RATIO, w = r.w;
  if (h > H) { h = H; w = h * RATIO; }
  Object.assign(r, { w, h, x: Math.min(Math.max(0, cx - w / 2), W - w), y: Math.min(Math.max(0, cy - h / 2), H - h) });
}

let drag = null;
$('overlay').addEventListener('pointerdown', e => {
  const box = e.target.closest('.box'); if (!box) return;
  e.preventDefault(); box.setPointerCapture(e.pointerId);
  const i = +box.dataset.i;
  drag = { i, h: e.target.dataset.h || null, sx: e.clientX, sy: e.clientY, o: { ...S.rects[i] }, id: e.pointerId, box };
});
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const W = S.canvas.width, H = S.canvas.height, k = W / $('src').clientWidth, mn = 60;
  const dx = (e.clientX - drag.sx) * k, dy = (e.clientY - drag.sy) * k, o = drag.o, hd = drag.h;
  let { x, y, w, h } = o;
  if (!hd) { x = Math.min(Math.max(0, o.x + dx), W - w); y = Math.min(Math.max(0, o.y + dy), H - h); }
  else {
    if (hd.includes('w')) { const nx = Math.min(Math.max(0, o.x + dx), o.x + o.w - mn); w = o.x + o.w - nx; x = nx; }
    if (hd.includes('e')) w = Math.min(Math.max(mn, o.w + dx), W - o.x);
    if (hd.includes('n')) { const ny = Math.min(Math.max(0, o.y + dy), o.y + o.h - mn); h = o.y + o.h - ny; y = ny; }
    if (hd.includes('s')) h = Math.min(Math.max(mn, o.h + dy), H - o.y);
  }
  S.rects[drag.i] = { x, y, w, h }; refresh();
});
['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, () => { drag = null; }));

// ---------- Output ----------
// Cover-crops the selection to exactly 17:11 so nothing is ever stretched.
function cardCanvas(r) {
  let sw = r.w, sh = r.h;
  if (sw / sh > RATIO) sw = sh * RATIO; else sh = sw / RATIO;
  const sx = r.x + (r.w - sw) / 2, sy = r.y + (r.h - sh) / 2;
  const c = document.createElement('canvas'); c.width = CARD_PX[0]; c.height = CARD_PX[1];
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(S.canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
const gapPt = () => $('gap').value / 25.4 * 72;
function layout() {   // positions in points, measured from the top-left of the page
  const x = (PAGE_W - CARD_W) / 2;
  return [{ x, y: TOP_MARGIN }, { x, y: TOP_MARGIN + CARD_H + gapPt() }];
}
function drawPreview() {
  const K = 3, c = $('prev'); c.width = PAGE_W * K; c.height = PAGE_H * K;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  layout().forEach((p, i) => x.drawImage(S.cards[i], p.x * K, p.y * K, CARD_W * K, CARD_H * K));
}
$('toPreview').onclick = () => { S.cards = S.rects.map(cardCanvas); $('done').hidden = true; drawPreview(); show(3); };
$('back').onclick = () => show(2);
$('gap').oninput = () => { $('gapv').textContent = $('gap').value; drawPreview(); };

const dataUrlToBytes = u => Uint8Array.from(atob(u.split(',')[1]), ch => ch.charCodeAt(0));

async function buildPdf() {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const pos = layout();
  for (let i = 0; i < 2; i++) {
    const img = await doc.embedJpg(dataUrlToBytes(S.cards[i].toDataURL('image/jpeg', 0.95)));
    page.drawImage(img, { x: pos[i].x, y: PAGE_H - pos[i].y - CARD_H, width: CARD_W, height: CARD_H });
  }
  const bytes = await doc.save();
  const size = (await PDFDocument.load(bytes)).getPage(0).getSize();   // self-check of the saved file
  return { bytes, size };
}
const markStep4 = () => document.querySelectorAll('#steps li').forEach(li => li.className = +li.dataset.s === 4 ? 'on' : 'past');

$('download').onclick = async () => {
  try {
    const { bytes, size } = await buildPdf();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = 'aadhaar-4x6.pdf';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('done').textContent = `Downloaded: 1 page, ${size.width} × ${size.height} pt (4 × 6 in).`;
    $('done').hidden = false; markStep4();
  } catch (e) { console.error(e); alert('The PDF could not be created. Please try again.'); }
};

$('print').onclick = async () => {
  try {
    const { bytes } = await buildPdf();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.onload = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch { window.open(url, '_blank'); }                  // fallback: open the PDF and print from there
    };
    f.src = url; document.body.appendChild(f);
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
    $('done').textContent = 'Print dialog opened. Choose your printer, set paper to 4 × 6 in and scale to 100%.';
    $('done').hidden = false; markStep4();
  } catch (e) { console.error(e); alert('The PDF could not be prepared for printing. Please try again.'); }
};
