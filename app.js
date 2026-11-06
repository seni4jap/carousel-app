'use strict';

// ---------- Константы и состояние ----------
const FORMATS = { '4:5': [1080, 1350], '1:1': [1080, 1080], '3:4': [1080, 1440], '9:16': [1080, 1920] };
const MIN_SLIDES = 1;
const MAX_SLIDES = 20; // лимит карусели Instagram
const MAX_IMG_SIDE = 2400; // уменьшаем большие фото, чтобы iOS не падал по памяти
const ROT_SNAP = (4 * Math.PI) / 180;

const state = {
  format: '4:5',
  slides: 3,
  bg: '#ffffff',
  items: [], // { img, w, h, x, y, sc, r, flip }
  sel: null,
};

const view = { s: 0.3, ox: 0, oy: 0, fitted: false };

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
const stage = $('stage');
let dpr = window.devicePixelRatio || 1;
let stageW = 0;
let stageH = 0;

const slideW = () => FORMATS[state.format][0];
const slideH = () => FORMATS[state.format][1];
const stripW = () => slideW() * state.slides;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Вид (масштаб/сдвиг холста) ----------
function fitScale() {
  return Math.min((stageH - 56) / slideH(), (stageW - 48) / slideW());
}

function minScale() {
  return Math.min(fitScale(), (stageW - 32) / stripW()) * 0.9;
}

function fitView() {
  view.s = fitScale();
  view.ox = 24;
  view.oy = (stageH - slideH() * view.s) / 2 - 8;
  clampView();
}

function clampView() {
  const w = stripW() * view.s;
  const h = slideH() * view.s;
  if (w + 48 <= stageW) view.ox = (stageW - w) / 2;
  else view.ox = clamp(view.ox, stageW - w - 24, 24);
  if (h + 56 <= stageH) view.oy = (stageH - h) / 2 - 8;
  else view.oy = clamp(view.oy, stageH - h - 40, 24);
}

function resize() {
  const r = stage.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  stageW = r.width;
  stageH = r.height;
  cv.width = Math.round(stageW * dpr);
  cv.height = Math.round(stageH * dpr);
  if (!view.fitted) {
    fitView();
    view.fitted = true;
  } else {
    clampView();
  }
  draw();
}

const toLogical = (px, py) => ({ x: (px - view.ox) / view.s, y: (py - view.oy) / view.s });

// ---------- Отрисовка ----------
function drawItem(c, it) {
  c.save();
  c.translate(it.x, it.y);
  c.rotate(it.r);
  c.scale(it.sc * (it.flip ? -1 : 1), it.sc);
  c.drawImage(it.img, -it.w / 2, -it.h / 2, it.w, it.h);
  c.restore();
}

function drawContent(c) {
  c.fillStyle = state.bg;
  c.fillRect(0, 0, stripW(), slideH());
  for (const it of state.items) drawItem(c, it);
}

let rafPending = false;
function requestDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw();
  });
}

function draw() {
  const W = slideW();
  const H = slideH();
  const s = view.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0f0f11';
  ctx.fillRect(0, 0, stageW, stageH);

  // Полоса слайдов
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(s, s);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, stripW(), H);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(0, 0, stripW(), H);
  ctx.clip();
  drawContent(ctx);
  ctx.restore();

  // Части фото за пределами полосы — полупрозрачно, чтобы было видно, что обрежется
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  ctx.rect(0, 0, stripW(), H);
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.25;
  for (const it of state.items) drawItem(ctx, it);
  ctx.restore();

  // Линии стыков и номера слайдов (в экранных координатах — всегда тонкие)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,122,89,0.9)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  for (let i = 1; i < state.slides; i++) {
    const x = Math.round(view.ox + i * W * s) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, view.oy);
    ctx.lineTo(x, view.oy + H * s);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '600 12px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < state.slides; i++) {
    ctx.fillText(String(i + 1), view.ox + (i + 0.5) * W * s, view.oy + H * s + 18);
  }
  ctx.restore();

  // Рамка выделения
  const it = state.sel;
  if (it) {
    ctx.save();
    ctx.translate(view.ox + it.x * s, view.oy + it.y * s);
    ctx.rotate(it.r);
    const hw = (it.w * it.sc * s) / 2;
    const hh = (it.h * it.sc * s) / 2;
    ctx.strokeStyle = '#ff7a59';
    ctx.lineWidth = 2;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    ctx.fillStyle = '#ff7a59';
    for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- Попадание по фото ----------
function hitTest(px, py) {
  const p = toLogical(px, py);
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    const dx = p.x - it.x;
    const dy = p.y - it.y;
    const cos = Math.cos(-it.r);
    const sin = Math.sin(-it.r);
    const u = (dx * cos - dy * sin) / it.sc;
    const v = (dx * sin + dy * cos) / it.sc;
    if (Math.abs(u) <= it.w / 2 && Math.abs(v) <= it.h / 2) return it;
  }
  return null;
}

// ---------- Жесты ----------
const pointers = new Map();
let gesture = null;

function stagePoint(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function twoPoints() {
  const [a, b] = [...pointers.values()];
  return {
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
    ang: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function startSingle(p) {
  const hit = hitTest(p.x, p.y);
  if (hit) {
    select(hit);
    gesture = { type: 'drag', item: hit, sx: p.x, sy: p.y, ix: hit.x, iy: hit.y };
  } else {
    gesture = { type: 'pan', sx: p.x, sy: p.y, ox: view.ox, oy: view.oy, moved: false };
  }
}

function startPinch() {
  const t = twoPoints();
  const onSel =
    state.sel && (gesture?.type === 'drag' || hitTest(t.mid.x, t.mid.y) === state.sel);
  if (onSel) {
    const it = state.sel;
    gesture = { type: 'pinchItem', item: it, t0: t, sc: it.sc, r: it.r, x: it.x, y: it.y };
  } else {
    gesture = { type: 'pinchView', t0: t, s: view.s, ox: view.ox, oy: view.oy };
  }
}

function snapAngle(a) {
  const q = Math.PI / 2;
  const n = Math.round(a / q) * q;
  return Math.abs(a - n) < ROT_SNAP ? n : a;
}

cv.addEventListener('pointerdown', (e) => {
  try {
    cv.setPointerCapture(e.pointerId);
  } catch {}
  pointers.set(e.pointerId, stagePoint(e));
  if (pointers.size === 1) startSingle(stagePoint(e));
  else if (pointers.size === 2) startPinch();
  requestDraw();
});

cv.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = stagePoint(e);
  pointers.set(e.pointerId, p);
  if (!gesture) return;
  const g = gesture;

  if (g.type === 'drag' && pointers.size === 1) {
    g.item.x = g.ix + (p.x - g.sx) / view.s;
    g.item.y = g.iy + (p.y - g.sy) / view.s;
  } else if (g.type === 'pan' && pointers.size === 1) {
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    view.ox = g.ox + dx;
    view.oy = g.oy + dy;
    clampView();
  } else if (pointers.size === 2) {
    const t = twoPoints();
    const k = t.dist / g.t0.dist;
    if (g.type === 'pinchItem') {
      g.item.sc = clamp(g.sc * k, 0.02, 20);
      g.item.r = snapAngle(g.r + (t.ang - g.t0.ang));
      g.item.x = g.x + (t.mid.x - g.t0.mid.x) / view.s;
      g.item.y = g.y + (t.mid.y - g.t0.mid.y) / view.s;
    } else if (g.type === 'pinchView') {
      const ns = clamp(g.s * k, minScale(), fitScale() * 3);
      const lx = (g.t0.mid.x - g.ox) / g.s;
      const ly = (g.t0.mid.y - g.oy) / g.s;
      view.s = ns;
      view.ox = t.mid.x - lx * ns;
      view.oy = t.mid.y - ly * ns;
      clampView();
    }
  }
  requestDraw();
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    if (gesture?.type === 'pan' && !gesture.moved && e.type === 'pointerup') select(null);
    gesture = null;
  } else if (pointers.size === 1) {
    // Один палец убрали — продолжаем жест оставшимся
    const p = [...pointers.values()][0];
    if (gesture?.type === 'pinchItem') {
      const it = gesture.item;
      gesture = { type: 'drag', item: it, sx: p.x, sy: p.y, ix: it.x, iy: it.y };
    } else {
      gesture = { type: 'pan', sx: p.x, sy: p.y, ox: view.ox, oy: view.oy, moved: true };
    }
  }
  requestDraw();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

// Десктоп: колесо — прокрутка, ctrl/щипок трекпада — масштаб фото или холста
cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = stagePoint(e);
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * 0.01);
      if (state.sel && hitTest(p.x, p.y) === state.sel) {
        state.sel.sc = clamp(state.sel.sc * k, 0.02, 20);
      } else {
        const ns = clamp(view.s * k, minScale(), fitScale() * 3);
        const l = toLogical(p.x, p.y);
        view.s = ns;
        view.ox = p.x - l.x * ns;
        view.oy = p.y - l.y * ns;
      }
    } else {
      view.ox -= e.deltaX || e.deltaY;
    }
    clampView();
    requestDraw();
  },
  { passive: false }
);

// ---------- Выделение и действия с фото ----------
function select(it) {
  state.sel = it;
  $('itemBar').hidden = !it;
  $('itemBar').querySelector('[data-act="span"]').hidden = state.slides < 2;
  requestAnimationFrame(resize); // панель меняет высоту сцены
}

function slideIndexOf(it) {
  return clamp(Math.floor(it.x / slideW()), 0, state.slides - 1);
}

const actions = {
  fill(it) {
    const k = slideIndexOf(it);
    it.r = 0;
    it.sc = Math.max(slideW() / it.w, slideH() / it.h);
    it.x = k * slideW() + slideW() / 2;
    it.y = slideH() / 2;
  },
  span(it) {
    if (state.slides < 2) return;
    const k = clamp(Math.round(it.x / slideW()) - 1, 0, state.slides - 2);
    it.r = 0;
    it.sc = Math.max((2 * slideW()) / it.w, slideH() / it.h);
    it.x = (k + 1) * slideW();
    it.y = slideH() / 2;
  },
  flip(it) {
    it.flip = !it.flip;
  },
  front(it) {
    state.items.splice(state.items.indexOf(it), 1);
    state.items.push(it);
  },
  back(it) {
    state.items.splice(state.items.indexOf(it), 1);
    state.items.unshift(it);
  },
  dup(it) {
    const c = { ...it, x: it.x + 60, y: it.y + 60 };
    state.items.splice(state.items.indexOf(it) + 1, 0, c);
    select(c);
  },
  del(it) {
    state.items.splice(state.items.indexOf(it), 1);
    select(null);
  },
};

$('itemBar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !state.sel) return;
  actions[b.dataset.act](state.sel);
  updateHint();
  requestDraw();
});

// ---------- Загрузка фото ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_IMG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k);
      const h = Math.round(img.naturalHeight * k);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ img: c, w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть ' + file.name));
    };
    img.src = url;
  });
}

$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  toast('Загружаю фото…');
  let last = null;
  let failed = 0;
  for (const f of files) {
    try {
      const { img, w, h } = await loadImage(f);
      const k = state.items.length % state.slides;
      const sc = Math.min((slideW() * 0.85) / w, (slideH() * 0.85) / h);
      last = { img, w, h, sc, r: 0, flip: false, x: k * slideW() + slideW() / 2, y: slideH() / 2 };
      state.items.push(last);
    } catch {
      failed++;
    }
  }
  if (last) {
    select(last);
    // Прокрутить к последнему добавленному
    view.ox = stageW / 2 - last.x * view.s;
    clampView();
  }
  toast(failed ? `Не открылось фото: ${failed}` : '');
  updateHint();
  requestDraw();
});

// ---------- Формат, количество слайдов, фон ----------
$('format').addEventListener('change', (e) => {
  const oldH = slideH();
  state.format = e.target.value;
  const k = slideH() / oldH;
  for (const it of state.items) it.y *= k;
  fitView();
  draw();
});

function setSlides(n) {
  state.slides = clamp(n, MIN_SLIDES, MAX_SLIDES);
  $('slidesCount').textContent = state.slides;
  $('slidesMinus').disabled = state.slides <= MIN_SLIDES;
  $('slidesPlus').disabled = state.slides >= MAX_SLIDES;
  $('itemBar').querySelector('[data-act="span"]').hidden = state.slides < 2;
  clampView();
  draw();
}
$('slidesMinus').addEventListener('click', () => setSlides(state.slides - 1));
$('slidesPlus').addEventListener('click', () => setSlides(state.slides + 1));

$('bgInput').addEventListener('input', (e) => {
  state.bg = e.target.value;
  $('bgSwatch').style.background = state.bg;
  requestDraw();
});

function updateHint() {
  $('hint').hidden = state.items.length > 0;
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  clearTimeout(toastTimer);
  if (!msg) {
    t.hidden = true;
    return;
  }
  t.textContent = msg;
  t.hidden = false;
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- Экспорт ----------
let exported = []; // { file, url }

function renderSlide(i) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = slideW();
    c.height = slideH();
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.translate(-i * slideW(), 0);
    drawContent(x);
    c.toBlob((b) => resolve(b), 'image/jpeg', 0.93);
  });
}

function clearExported() {
  for (const e of exported) URL.revokeObjectURL(e.url);
  exported = [];
}

$('exportBtn').addEventListener('click', async () => {
  if (!state.items.length) {
    toast('Сначала добавь фото');
    return;
  }
  const btn = $('exportBtn');
  btn.disabled = true;
  btn.textContent = 'Готовлю…';
  clearExported();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  for (let i = 0; i < state.slides; i++) {
    const blob = await renderSlide(i);
    const name = `carousel-${stamp}-${String(i + 1).padStart(2, '0')}.jpg`;
    const file = new File([blob], name, { type: 'image/jpeg' });
    exported.push({ file, url: URL.createObjectURL(blob) });
  }
  btn.disabled = false;
  btn.textContent = 'Экспорт';
  showSheet();
});

function showSheet() {
  const box = $('previews');
  box.innerHTML = '';
  exported.forEach((e, i) => {
    const f = document.createElement('figure');
    const img = document.createElement('img');
    img.src = e.url;
    img.alt = `Слайд ${i + 1}`;
    img.addEventListener('click', () => shareFiles([e.file]));
    const cap = document.createElement('figcaption');
    cap.textContent = String(i + 1);
    f.append(img, cap);
    box.append(f);
  });
  $('sheetTitle').textContent = `Слайды: ${exported.length}`;
  $('sheet').hidden = false;
}

const canShareFiles = (files) => {
  try {
    return !!navigator.canShare && navigator.canShare({ files });
  } catch {
    return false;
  }
};

async function shareFiles(files) {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Не получилось поделиться');
    }
    return;
  }
  // Запасной вариант — скачивание файлов
  for (const f of files) {
    const a = document.createElement('a');
    a.href = exported.find((e) => e.file === f)?.url || URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 250));
  }
}

$('saveAll').addEventListener('click', () => shareFiles(exported.map((e) => e.file)));
$('sheetClose').addEventListener('click', () => ($('sheet').hidden = true));
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet')) $('sheet').hidden = true;
});

// ---------- Старт ----------
new ResizeObserver(resize).observe(stage);
setSlides(state.slides);
$('bgSwatch').style.background = state.bg;
updateHint();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Для отладки
window.__carousel = { state, view };
