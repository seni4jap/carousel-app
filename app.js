'use strict';

// =====================================================================
// Константы и состояние
// =====================================================================
const FORMATS = { '4:5': [1080, 1350], '1:1': [1080, 1080], '3:4': [1080, 1440], '9:16': [1080, 1920] };
const MIN_SLIDES = 1;
const MAX_SLIDES = 20; // лимит карусели Instagram
const PREVIEW_SIDE = 2048; // копия фото для редактора; экспорт берёт оригинальный файл
const MAX_CANVAS_PX = 16e6; // предел площади одного canvas в iOS Safari
const ROT_SNAP = (4 * Math.PI) / 180;
const SNAP_PX = 14; // радиус прилипания в экранных пикселях
const MAX_VIDEO_SEC = 60;
const JPEG_QUALITY = 0.95;

// media — сам файл (фото или видео), item — его размещение на холсте.
// Копия фото ссылается на тот же media.
// media: { id, type: 'image'|'video', file, src, iw, ih, ow, oh, duration }
//   src — то, что рисуем в редакторе (уменьшенная копия фото или <video>)
//   iw/ih — размер src (в нём же координаты обрезки), ow/oh — размер оригинала
// item:  { media, x, y, sc, r, flip, crop: {x, y, w, h}, w, h } — w/h = размер обрезки
const state = {
  format: '4:5',
  slides: 3,
  bg: '#ffffff',
  items: [],
  sel: null,
  cropping: false,
  magnet: true,
  guides: [], // активные линии прилипания { axis: 'x'|'y', v }
  exportScale: 'orig',
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
const isVideo = (it) => it.media.type === 'video';

// exportScale: 1 — 1080 px JPEG для Instagram; 'orig' — разрешение оригиналов, PNG без сжатия
const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Предел площади слайда в режиме «Оригинал»: Safari на iPhone ограничивает общую память canvas
const MAX_SLIDE_PX = IS_IOS ? 8e6 : 12e6;
try {
  state.exportScale = localStorage.getItem('exportScale') === '1' ? 1 : 'orig';
} catch {}

// =====================================================================
// Вид (масштаб/сдвиг холста)
// =====================================================================
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
  if (!r.width || !r.height) return;
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

// =====================================================================
// Отрисовка
// =====================================================================
// patch — заранее подготовленная картинка нужного размера (для экспорта)
function drawItem(c, it, patch) {
  const k = it.crop;
  const dw = k.w * it.sc;
  const dh = k.h * it.sc;
  c.save();
  c.translate(it.x, it.y);
  c.rotate(it.r);
  if (it.flip) c.scale(-1, 1);
  if (patch) c.drawImage(patch, -dw / 2, -dh / 2, dw, dh);
  else c.drawImage(it.media.src, k.x, k.y, k.w, k.h, -dw / 2, -dh / 2, dw, dh);
  c.restore();
}

// Полное (необрезанное) фото — полупрозрачно в режиме обрезки
function drawItemGhost(c, it) {
  const k = it.crop;
  const m = it.media;
  c.save();
  c.translate(it.x, it.y);
  c.rotate(it.r);
  if (it.flip) c.scale(-1, 1);
  c.globalAlpha = 0.35;
  c.drawImage(
    m.src, 0, 0, m.iw, m.ih,
    (-k.w / 2 - k.x) * it.sc, (-k.h / 2 - k.y) * it.sc, m.iw * it.sc, m.ih * it.sc
  );
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
  if (!stageW) return;
  const W = slideW();
  const H = slideH();
  const s = view.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
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

  // Части фото за пределами полосы — полупрозрачно: видно, что обрежется
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

  // Режим обрезки: всё фото полупрозрачно, видимая часть — поверх
  const it = state.sel;
  if (it && state.cropping) {
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(s, s);
    drawItemGhost(ctx, it);
    drawItem(ctx, it);
    ctx.restore();
  }

  // Значок видео
  for (const v of state.items) {
    if (!isVideo(v)) continue;
    const b = itemBounds(v);
    const x = view.ox + b.l * s + 14;
    const y = view.oy + b.t * s + 14;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 5);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x - 3, y + 5);
    ctx.fill();
    ctx.restore();
  }

  // Рамка выделения
  if (it) {
    ctx.save();
    ctx.translate(view.ox + it.x * s, view.oy + it.y * s);
    ctx.rotate(it.r);
    const hw = (it.w * it.sc * s) / 2;
    const hh = (it.h * it.sc * s) / 2;
    ctx.strokeStyle = state.cropping ? '#ffffff' : '#ff7a59';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    if (state.cropping) {
      // Ручки-«палочки» по серединам сторон и уголки
      const L = Math.min(22, hw * 0.6, hh * 0.6);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of [
        [-L, -hh, L, -hh], [-L, hh, L, hh], [-hw, -L, -hw, L], [hw, -L, hw, L],
        [-hw, -hh + L, -hw, -hh], [-hw, -hh, -hw + L, -hh],
        [hw - L, -hh, hw, -hh], [hw, -hh, hw, -hh + L],
        [hw, hh - L, hw, hh], [hw, hh, hw - L, hh],
        [-hw + L, hh, -hw, hh], [-hw, hh, -hw, hh - L],
      ]) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    } else {
      for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Направляющие прилипания
  if (state.guides.length) {
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    for (const g of state.guides) {
      ctx.beginPath();
      if (g.axis === 'x') {
        const x = view.ox + g.v * s;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, stageH);
      } else {
        const y = view.oy + g.v * s;
        ctx.moveTo(0, y);
        ctx.lineTo(stageW, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Пока на холсте есть видео — перерисовываем каждый кадр
let looping = false;
function ensureLoop() {
  if (looping || !state.items.some(isVideo)) return;
  looping = true;
  const tick = () => {
    if (!state.items.some(isVideo)) {
      looping = false;
      return;
    }
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Видео в редакторе играют без звука по кругу; неиспользуемые — на паузе
const allVideos = new Set();
function syncVideos() {
  const used = new Set(state.items.filter(isVideo).map((it) => it.media));
  for (const m of allVideos) {
    if (!used.has(m)) m.src.pause();
    else if (m.src.paused && !exporting) m.src.play().catch(() => {});
  }
  ensureLoop();
}

// =====================================================================
// Геометрия
// =====================================================================
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

// Габариты на холсте с учётом поворота
function itemBounds(it) {
  const hw = (it.w * it.sc) / 2;
  const hh = (it.h * it.sc) / 2;
  const c = Math.abs(Math.cos(it.r));
  const s = Math.abs(Math.sin(it.r));
  const ex = c * hw + s * hh;
  const ey = s * hw + c * hh;
  return { l: it.x - ex, r: it.x + ex, t: it.y - ey, b: it.y + ey };
}

function onSlide(it, i) {
  const b = itemBounds(it);
  return b.r > i * slideW() + 0.5 && b.l < (i + 1) * slideW() - 0.5 && b.b > 0 && b.t < slideH();
}

// =====================================================================
// Вибрация
// =====================================================================
// Android: Vibration API. iOS Safari его не поддерживает, но даёт тактильный отклик
// при переключении <input type="checkbox" switch> (iOS 18+) — используем это.
const haptic = (() => {
  if (typeof navigator.vibrate === 'function' && !/iP(hone|ad|od)/.test(navigator.userAgent)) {
    return () => navigator.vibrate(12);
  }
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.append(input);
  document.body.append(label);
  return () => label.click();
})();

// =====================================================================
// Магнит (прилипание)
// =====================================================================
function axisAligned(it) {
  return Math.abs(Math.sin(it.r)) < 1e-3 || Math.abs(Math.cos(it.r)) < 1e-3;
}

// Половины ширины/высоты фото на холсте с учётом поворота на 90°
function halfExt(it) {
  const a = (it.w * it.sc) / 2;
  const b = (it.h * it.sc) / 2;
  return Math.abs(Math.cos(it.r)) > 0.5 ? [a, b] : [b, a];
}

// Края: края холста, стыки слайдов, края других фото.
// Центры: стыки (фото ровно пополам на двух слайдах), центры слайдов, центры других фото.
function snapTargets(exclude) {
  const W = slideW();
  const H = slideH();
  const xs = [];
  const ys = [0, H];
  const cxs = [];
  const cys = [H / 2];
  for (let i = 0; i <= state.slides; i++) {
    xs.push(i * W);
    if (i > 0 && i < state.slides) cxs.push(i * W);
    if (i < state.slides) cxs.push((i + 0.5) * W);
  }
  for (const it of state.items) {
    if (it === exclude || !axisAligned(it)) continue;
    const [hw, hh] = halfExt(it);
    xs.push(it.x - hw, it.x + hw);
    ys.push(it.y - hh, it.y + hh);
    cxs.push(it.x);
    cys.push(it.y);
  }
  return { xs, ys, cxs, cys };
}

// Ближайшая цель для любой из точек; { d: сдвиг, t: цель } или null
function nearest(points, targets, th) {
  let best = null;
  for (const e of points) {
    for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
  }
  return best;
}

const closer = (a, b) => (!a ? b : !b ? a : Math.abs(b.d) < Math.abs(a.d) ? b : a);

// Вибрируем только в момент нового прилипания, а не на каждом кадре
function feel(g, tx, ty) {
  const kx = tx == null ? null : Math.round(tx);
  const ky = ty == null ? null : Math.round(ty);
  if ((kx != null && kx !== g.kx) || (ky != null && ky !== g.ky)) haptic();
  g.kx = kx;
  g.ky = ky;
}

function snapItem(g) {
  const it = g.item;
  state.guides = [];
  if (!state.magnet || !axisAligned(it)) return;
  const th = SNAP_PX / view.s;
  const T = snapTargets(it);
  const [hw, hh] = halfExt(it);
  const bx = closer(nearest([it.x - hw, it.x + hw], T.xs, th), nearest([it.x], T.cxs, th));
  const by = closer(nearest([it.y - hh, it.y + hh], T.ys, th), nearest([it.y], T.cys, th));
  if (bx) {
    it.x += bx.d;
    state.guides.push({ axis: 'x', v: bx.t });
  }
  if (by) {
    it.y += by.d;
    state.guides.push({ axis: 'y', v: by.t });
  }
  feel(g, bx ? bx.t : null, by ? by.t : null);
}

// При обрезке притягиваем палец (а с ним и край рамки) к целям
function snapCropPointer(g, p) {
  const it = g.item;
  state.guides = [];
  if (!state.magnet || !axisAligned(it)) return p;
  const th = SNAP_PX / view.s;
  const T = snapTargets(it);
  const l = toLogical(p.x, p.y);
  const localXisWorldX = Math.abs(Math.cos(it.r)) > 0.5;
  const axes = [];
  if (g.sides.l || g.sides.r) axes.push(localXisWorldX ? 'x' : 'y');
  if (g.sides.t || g.sides.b) axes.push(localXisWorldX ? 'y' : 'x');
  let tx = null;
  let ty = null;
  for (const axis of axes) {
    const b = nearest([l[axis]], axis === 'x' ? T.xs : T.ys, th);
    if (!b) continue;
    l[axis] = b.t;
    state.guides.push({ axis, v: b.t });
    if (axis === 'x') tx = b.t;
    else ty = b.t;
  }
  feel(g, tx, ty);
  return { x: view.ox + l.x * view.s, y: view.oy + l.y * view.s };
}

// =====================================================================
// Обрезка
// =====================================================================
// Точка экрана → координаты в пикселях источника относительно центра обрезки
function toImageSpace(it, px, py) {
  const p = toLogical(px, py);
  const dx = p.x - it.x;
  const dy = p.y - it.y;
  const c = Math.cos(-it.r);
  const s = Math.sin(-it.r);
  let u = (dx * c - dy * s) / it.sc;
  const v = (dx * s + dy * c) / it.sc;
  if (it.flip) u = -u;
  return { u, v };
}

// Сдвиг центра фото на (su, sv) пикселей источника
function shiftCenter(it, su, sv) {
  const lx = (it.flip ? -su : su) * it.sc;
  const ly = sv * it.sc;
  const c = Math.cos(it.r);
  const s = Math.sin(it.r);
  it.x += lx * c - ly * s;
  it.y += lx * s + ly * c;
}

function syncSize(it) {
  it.w = it.crop.w;
  it.h = it.crop.h;
}

// Какие края рамки под пальцем (или null)
function cropSidesAt(it, px, py) {
  const { u, v } = toImageSpace(it, px, py);
  const tol = 26 / (it.sc * view.s);
  const hw = it.w / 2;
  const hh = it.h / 2;
  if (Math.abs(u) > hw + tol || Math.abs(v) > hh + tol) return null;
  const sides = {};
  const dl = Math.abs(u + hw), dr = Math.abs(u - hw), dt = Math.abs(v + hh), db = Math.abs(v - hh);
  if (Math.min(dl, dr) < tol) sides[dl < dr ? 'l' : 'r'] = true;
  if (Math.min(dt, db) < tol) sides[dt < db ? 't' : 'b'] = true;
  return Object.keys(sides).length ? sides : null;
}

function applyCropEdges(it, sides, px, py) {
  const { u, v } = toImageSpace(it, px, py);
  const k = it.crop;
  const m = it.media;
  const MIN = 36 / (it.sc * view.s); // минимум ~36px на экране
  const hw = k.w / 2;
  const hh = k.h / 2;
  let su = 0;
  let sv = 0;
  if (sides.l) {
    const d = clamp(u, -hw - k.x, hw - MIN) + hw;
    k.x += d; k.w -= d; su += d / 2;
  } else if (sides.r) {
    const d = clamp(u, -hw + MIN, hw + (m.iw - k.x - k.w)) - hw;
    k.w += d; su += d / 2;
  }
  if (sides.t) {
    const d = clamp(v, -hh - k.y, hh - MIN) + hh;
    k.y += d; k.h -= d; sv += d / 2;
  } else if (sides.b) {
    const d = clamp(v, -hh + MIN, hh + (m.ih - k.y - k.h)) - hh;
    k.h += d; sv += d / 2;
  }
  syncSize(it);
  shiftCenter(it, su, sv);
}

// Двигаем фото внутри рамки (рамка остаётся на месте)
function applyCropPan(g, p) {
  const it = g.item;
  const dx = (p.x - g.sx) / view.s;
  const dy = (p.y - g.sy) / view.s;
  const c = Math.cos(-it.r);
  const s = Math.sin(-it.r);
  let du = (dx * c - dy * s) / it.sc;
  const dv = (dx * s + dy * c) / it.sc;
  if (it.flip) du = -du;
  it.crop.x = clamp(g.cx - du, 0, it.media.iw - it.crop.w);
  it.crop.y = clamp(g.cy - dv, 0, it.media.ih - it.crop.h);
}

function resetCrop(it) {
  const k = it.crop;
  const m = it.media;
  shiftCenter(it, m.iw / 2 - (k.x + k.w / 2), m.ih / 2 - (k.y + k.h / 2));
  it.crop = { x: 0, y: 0, w: m.iw, h: m.ih };
  syncSize(it);
}

// =====================================================================
// Отмена / повтор
// =====================================================================
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 60;

const cloneItem = (it) => ({ ...it, crop: { ...it.crop } });

function snapshot() {
  return { format: state.format, slides: state.slides, bg: state.bg, items: state.items.map(cloneItem) };
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function restoreSnapshot(snap) {
  const formatChanged = snap.format !== state.format;
  state.format = snap.format;
  state.slides = snap.slides;
  state.bg = snap.bg;
  state.items = snap.items.map(cloneItem);
  state.sel = null;
  state.cropping = false;
  syncControls();
  updateBar();
  if (formatChanged) fitView();
  clampView();
  updateHint();
  changed();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  updateUndoButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  updateUndoButtons();
}

function updateUndoButtons() {
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
}

// Любое изменение проекта: перерисовать и сохранить
function changed() {
  syncVideos();
  requestDraw();
  scheduleSave();
}

// =====================================================================
// Жесты
// =====================================================================
const pointers = new Map();
let gesture = null;
let gestureDirty = false; // в этом жесте уже сохранили точку отмены

function markGestureChange() {
  if (gestureDirty) return;
  gestureDirty = true;
  pushUndo();
}

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

// Режим «Поменять»: следующее нажатие на другое фото меняет их рамки местами
let swapFrom = null;
function finishSwap(target) {
  const a = swapFrom;
  swapFrom = null;
  toast('');
  if (!target || target === a || !state.items.includes(a)) return;
  pushUndo();
  const ra = itemBounds(a);
  const rb = itemBounds(target);
  fitToFrame(a, rb);
  fitToFrame(target, ra);
  haptic();
  select(a);
  changed();
}

function startSingle(p) {
  if (swapFrom) {
    finishSwap(hitTest(p.x, p.y));
    gesture = { type: 'none' };
    return;
  }
  if (state.cropping && state.sel) {
    const it = state.sel;
    const sides = cropSidesAt(it, p.x, p.y);
    if (sides) {
      gesture = { type: 'cropEdge', item: it, sides };
      return;
    }
    if (hitTest(p.x, p.y) === it) {
      gesture = { type: 'cropPan', item: it, sx: p.x, sy: p.y, cx: it.crop.x, cy: it.crop.y };
      return;
    }
  }
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
    state.sel &&
    (['drag', 'cropEdge', 'cropPan'].includes(gesture?.type) || hitTest(t.mid.x, t.mid.y) === state.sel);
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

  if (g.type === 'cropEdge' && pointers.size === 1) {
    markGestureChange();
    const q = snapCropPointer(g, p);
    applyCropEdges(g.item, g.sides, q.x, q.y);
  } else if (g.type === 'cropPan' && pointers.size === 1) {
    markGestureChange();
    applyCropPan(g, p);
  } else if (g.type === 'drag' && pointers.size === 1) {
    if (Math.hypot(p.x - g.sx, p.y - g.sy) < 2 && !gestureDirty) return;
    markGestureChange();
    g.item.x = g.ix + (p.x - g.sx) / view.s;
    g.item.y = g.iy + (p.y - g.sy) / view.s;
    snapItem(g);
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
      markGestureChange();
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
  state.guides = [];
  if (pointers.size === 0) {
    if (gesture?.type === 'pan' && !gesture.moved && e.type === 'pointerup') select(null);
    gesture = null;
    if (gestureDirty) {
      gestureDirty = false;
      scheduleSave();
    }
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
let wheelTimer = 0;
cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = stagePoint(e);
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * 0.01);
      if (state.sel && hitTest(p.x, p.y) === state.sel) {
        if (!wheelTimer) pushUndo();
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => {
          wheelTimer = 0;
          scheduleSave();
        }, 400);
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

// Если система не дала автозапуск видео (режим энергосбережения) — запустим по касанию
document.addEventListener('pointerdown', () => syncVideos(), { capture: true });

// Клавиатура на компьютере
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel) {
    e.preventDefault();
    runAction('del');
  } else if (e.key === 'Escape') {
    select(null);
  }
});

// =====================================================================
// Выделение и действия
// =====================================================================
function select(it) {
  if (it !== state.sel) state.cropping = false;
  state.sel = it;
  updateBar();
  requestDraw();
}

function updateBar() {
  $('itemBar').hidden = !state.sel;
  $('barMain').hidden = state.cropping;
  $('barCrop').hidden = !state.cropping;
  $('itemBar').querySelector('[data-act="span"]').hidden = state.slides < 2;
  requestAnimationFrame(resize); // панель меняет высоту сцены
}

function slideIndexOf(it) {
  return clamp(Math.floor(it.x / slideW()), 0, state.slides - 1);
}

// Действия без изменения проекта (не попадают в отмену)
const UI_ONLY = new Set(['crop', 'cropDone', 'swap']);

const actions = {
  grow(it) {
    fitToFrame(it, freeRectAround(it));
  },
  swap() {
    swapFrom = state.sel;
    toast('Теперь нажми на фото, с которым поменять', true);
  },
  crop() {
    state.cropping = true;
    updateBar();
  },
  cropDone() {
    state.cropping = false;
    updateBar();
  },
  uncrop(it) {
    resetCrop(it);
  },
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
    const c = { ...cloneItem(it), x: it.x + 60, y: it.y + 60 };
    state.items.splice(state.items.indexOf(it) + 1, 0, c);
    select(c);
  },
  del(it) {
    state.items.splice(state.items.indexOf(it), 1);
    select(null);
  },
};

function runAction(name) {
  const it = state.sel;
  if (!it || !actions[name]) return;
  if (!UI_ONLY.has(name)) pushUndo();
  actions[name](it);
  updateHint();
  if (UI_ONLY.has(name)) requestDraw();
  else changed();
}

$('itemBar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (b) runAction(b.dataset.act);
});

// =====================================================================
// Загрузка фото и видео
// =====================================================================
let mediaSeq = 0;
const newMediaId = () => `${Date.now().toString(36)}-${(mediaSeq++).toString(36)}`;

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function freeCanvas(c) {
  if (c && c.tagName === 'CANVAS') {
    c.width = 0;
    c.height = 0;
  }
}

function hqContext(c) {
  const x = c.getContext('2d');
  // Safari возвращает null, когда кончилась память под canvas
  if (!x) throw new Error('canvas-memory');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  return x;
}

// Уменьшение в несколько шагов по 2× — без «лесенки» и шума, в отличие от одного шага
function resample(src, sx, sy, sw, sh, tw, th) {
  let cur = src;
  let rx = sx, ry = sy, rw = sw, rh = sh;
  while (rw > tw * 2 && rh > th * 2) {
    let nw = Math.round(rw / 2);
    let nh = Math.round(rh / 2);
    if (nw * nh > MAX_CANVAS_PX) {
      const f = Math.sqrt(MAX_CANVAS_PX / (rw * rh));
      nw = Math.floor(rw * f);
      nh = Math.floor(rh * f);
    }
    const c = makeCanvas(nw, nh);
    hqContext(c).drawImage(cur, rx, ry, rw, rh, 0, 0, c.width, c.height);
    if (cur !== src) freeCanvas(cur);
    cur = c;
    rx = 0; ry = 0; rw = c.width; rh = c.height;
  }
  const out = makeCanvas(tw, th);
  hqContext(out).drawImage(cur, rx, ry, rw, rh, 0, 0, out.width, out.height);
  if (cur !== src) freeCanvas(cur);
  return out;
}

async function makeImageMedia(file, id) {
  const { img, url } = await decodeImage(file);
  const ow = img.naturalWidth;
  const oh = img.naturalHeight;
  const k = Math.min(1, PREVIEW_SIDE / Math.max(ow, oh));
  let src = resample(img, 0, 0, ow, oh, Math.round(ow * k), Math.round(oh * k));
  URL.revokeObjectURL(url);
  // ImageBitmap не занимает лимит памяти canvas в Safari — остаётся больше на экспорт
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(src);
      freeCanvas(src);
      src = bmp;
    } catch {}
  }
  return { id, type: 'image', file, src, iw: src.width, ih: src.height, ow, oh };
}

function makeVideoMedia(file, id) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.loop = true;
    v.preload = 'auto';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(v.src);
      reject(new Error('video'));
    };
    v.onerror = fail;
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      if (!v.videoWidth) return fail();
      const media = {
        id, type: 'video', file, src: v,
        iw: v.videoWidth, ih: v.videoHeight, ow: v.videoWidth, oh: v.videoHeight,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
      };
      allVideos.add(media);
      resolve(media);
    };
    v.src = URL.createObjectURL(file);
    v.play().catch(() => {});
  });
}

const isVideoFile = (f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name);

function makeMedia(file, type, id) {
  return type === 'video' ? makeVideoMedia(file, id) : makeImageMedia(file, id);
}

function placeNew(media) {
  const W = slideW();
  const H = slideH();
  const k = state.items.length % state.slides;
  const sc = Math.min((W * 0.85) / media.iw, (H * 0.85) / media.ih);
  return {
    media, sc, r: 0, flip: false,
    crop: { x: 0, y: 0, w: media.iw, h: media.ih }, w: media.iw, h: media.ih,
    x: k * W + W / 2, y: H / 2,
  };
}

$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  toast('Загружаю…', true);
  pushUndo();
  let last = null;
  let failed = 0;
  for (const f of files) {
    try {
      const media = await makeMedia(f, isVideoFile(f) ? 'video' : 'image', newMediaId());
      last = placeNew(media);
      state.items.push(last);
    } catch {
      failed++;
    }
  }
  if (!last) undoStack.pop();
  updateUndoButtons();
  if (last) {
    select(last);
    view.ox = stageW / 2 - last.x * view.s; // прокрутить к последнему добавленному
    clampView();
  }
  toast(failed ? `Не открылось файлов: ${failed}` : '');
  updateHint();
  changed();
});

// =====================================================================
// Формат, слайды, фон, магнит, новый проект
// =====================================================================
function syncControls() {
  $('format').value = state.format;
  $('slidesCount').textContent = state.slides;
  $('slidesMinus').disabled = state.slides <= MIN_SLIDES;
  $('slidesPlus').disabled = state.slides >= MAX_SLIDES;
  $('bgInput').value = state.bg;
  $('bgSwatch').style.background = state.bg;
  $('magnetBtn').setAttribute('aria-pressed', String(state.magnet));
  $('itemBar').querySelector('[data-act="span"]').hidden = state.slides < 2;
}

$('format').addEventListener('change', (e) => {
  pushUndo();
  const oldH = slideH();
  state.format = e.target.value;
  const k = slideH() / oldH;
  for (const it of state.items) it.y *= k;
  fitView();
  changed();
});

function setSlides(n) {
  n = clamp(n, MIN_SLIDES, MAX_SLIDES);
  if (n === state.slides) return;
  pushUndo();
  state.slides = n;
  syncControls();
  clampView();
  changed();
}
$('slidesMinus').addEventListener('click', () => setSlides(state.slides - 1));
$('slidesPlus').addEventListener('click', () => setSlides(state.slides + 1));

$('magnetBtn').addEventListener('click', () => {
  state.magnet = !state.magnet;
  syncControls();
  toast(state.magnet ? 'Магнит включён' : 'Магнит выключен');
  scheduleSave();
});

let bgEditing = false;
$('bgInput').addEventListener('input', (e) => {
  if (!bgEditing) {
    pushUndo();
    bgEditing = true;
  }
  state.bg = e.target.value;
  $('bgSwatch').style.background = state.bg;
  requestDraw();
});
$('bgInput').addEventListener('change', () => {
  bgEditing = false;
  scheduleSave();
});

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('newBtn').addEventListener('click', () => {
  if (!state.items.length) return;
  if (!confirm('Начать новый проект? Текущий можно будет вернуть кнопкой «Отменить».')) return;
  pushUndo();
  state.items = [];
  select(null);
  updateHint();
  changed();
});

function updateHint() {
  $('hint').hidden = state.items.length > 0;
}

let toastTimer = 0;
function toast(msg, sticky = false) {
  const t = $('toast');
  clearTimeout(toastTimer);
  if (!msg) {
    t.hidden = true;
    return;
  }
  t.textContent = msg;
  t.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// =====================================================================
// Автосохранение (IndexedDB) — проект не теряется, если iOS выгрузит приложение
// =====================================================================
const db = (() => {
  let opening = null;
  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no idb'));
    if (!opening) {
      opening = new Promise((res, rej) => {
        const r = indexedDB.open('carousel-app', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('media');
          r.result.createObjectStore('kv');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return opening;
  }
  async function run(name, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode);
      let out;
      const r = fn(t.objectStore(name));
      if (r) r.onsuccess = () => (out = r.result);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    get: (n, k) => run(n, 'readonly', (s) => s.get(k)),
    put: (n, k, v) => run(n, 'readwrite', (s) => s.put(v, k)),
    del: (n, k) => run(n, 'readwrite', (s) => s.delete(k)),
    keys: (n) => run(n, 'readonly', (s) => s.getAllKeys()),
  };
})();

const savedMedia = new Set();
let saveTimer = 0;
let saveChain = Promise.resolve();
let saveWarned = false;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveChain = saveChain.then(saveProject).catch((err) => {
      console.error('autosave', err);
      if (!saveWarned) {
        saveWarned = true;
        const quota = err && err.name === 'QuotaExceededError';
        toast(quota ? 'Автосохранение: не хватает места' : `Автосохранение не сработало (${err?.name || 'ошибка'})`);
      }
    });
  }, 500);
}

async function saveProject() {
  const used = new Map();
  for (const it of state.items) used.set(it.media.id, it.media);
  for (const [id, m] of used) {
    if (savedMedia.has(id)) continue;
    // Safari не умеет класть в IndexedDB файл прямо из галереи — копируем в обычный Blob
    const data = new Blob([await m.file.arrayBuffer()], { type: m.file.type });
    await db.put('media', id, { type: m.type, file: data });
    savedMedia.add(id);
  }
  await db.put('kv', 'project', {
    v: 1,
    format: state.format,
    slides: state.slides,
    bg: state.bg,
    magnet: state.magnet,
    items: state.items.map((it) => ({
      m: it.media.id, x: it.x, y: it.y, sc: it.sc, r: it.r, flip: it.flip, crop: { ...it.crop },
    })),
  });
  for (const k of await db.keys('media')) {
    if (!used.has(k)) {
      await db.del('media', k);
      savedMedia.delete(k);
    }
  }
}

async function restoreProject() {
  let p;
  try {
    p = await db.get('kv', 'project');
  } catch {
    return;
  }
  if (!p) return;
  if (FORMATS[p.format]) state.format = p.format;
  state.slides = clamp(p.slides | 0 || 3, MIN_SLIDES, MAX_SLIDES);
  state.bg = p.bg || '#ffffff';
  state.magnet = p.magnet !== false;
  if (!p.items?.length) return;
  toast('Открываю проект…', true);
  const loaded = new Map();
  for (const d of p.items) {
    let m = loaded.get(d.m);
    if (m === undefined) {
      try {
        const rec = await db.get('media', d.m);
        m = rec ? await makeMedia(rec.file, rec.type, d.m) : null;
      } catch {
        m = null;
      }
      loaded.set(d.m, m);
      if (m) savedMedia.add(d.m);
    }
    if (!m) continue;
    // Координаты обрезки — в пикселях копии; на всякий случай поджимаем под её размер
    const crop = {
      x: clamp(d.crop.x, 0, m.iw - 1),
      y: clamp(d.crop.y, 0, m.ih - 1),
      w: 0,
      h: 0,
    };
    crop.w = clamp(d.crop.w, 1, m.iw - crop.x);
    crop.h = clamp(d.crop.h, 1, m.ih - crop.y);
    state.items.push({ media: m, x: d.x, y: d.y, sc: d.sc, r: d.r, flip: !!d.flip, crop, w: crop.w, h: crop.h });
  }
  toast('');
}

// =====================================================================
// Вписать фото в рамку (с обрезкой, без пустот)
// =====================================================================
// rect — в координатах холста {l, t, r, b}. Видимый центр фото по возможности сохраняется.
function fitToFrame(it, rect) {
  const m = it.media;
  const fw = rect.r - rect.l;
  const fh = rect.b - rect.t;
  if (fw < 1 || fh < 1) return;
  const ar = fw / fh;
  let cw;
  let ch;
  if (m.iw / m.ih > ar) {
    ch = m.ih;
    cw = ch * ar;
  } else {
    cw = m.iw;
    ch = cw / ar;
  }
  const pcx = it.crop.x + it.crop.w / 2;
  const pcy = it.crop.y + it.crop.h / 2;
  it.crop = {
    x: clamp(pcx - cw / 2, 0, m.iw - cw),
    y: clamp(pcy - ch / 2, 0, m.ih - ch),
    w: cw,
    h: ch,
  };
  syncSize(it);
  it.r = 0;
  it.sc = fw / cw;
  it.x = (rect.l + rect.r) / 2;
  it.y = (rect.t + rect.b) / 2;
}

// Самый большой свободный прямоугольник вокруг фото: до соседей и краёв холста
function freeRectAround(it) {
  const b = itemBounds(it);
  const eps = 0.5;
  const others = state.items.filter((o) => o !== it).map(itemBounds)
    // уже перекрывающиеся с фото не считаем препятствием
    .filter((o) => !(o.l < b.r - eps && o.r > b.l + eps && o.t < b.b - eps && o.b > b.t + eps));
  let L = 0;
  let R = stripW();
  for (const o of others) {
    if (o.b <= b.t + eps || o.t >= b.b - eps) continue; // не пересекается по вертикали
    if (o.r <= b.l + eps) L = Math.max(L, o.r);
    if (o.l >= b.r - eps) R = Math.min(R, o.l);
  }
  let T = 0;
  let B = slideH();
  for (const o of others) {
    if (o.r <= L + eps || o.l >= R - eps) continue;
    if (o.b <= b.t + eps) T = Math.max(T, o.b);
    if (o.t >= b.b - eps) B = Math.min(B, o.t);
  }
  return { l: L, t: Math.max(0, Math.min(T, b.t)), r: R, b: Math.min(slideH(), Math.max(B, b.b)) };
}

// =====================================================================
// Шаблоны раскладок
// =====================================================================
// Раскладка — набор ячеек без зазоров на всю ленту. Координаты ячеек:
// x/w — в ширинах слайда (0…S), y/h — в высотах слайда (0…1).
// Строим «колонки» (часть проходит через стыки), каждую делим на 1–3 ряда.
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLayout(N, S, rng) {
  const minC = Math.max(Math.ceil(N / 3), Math.ceil(S / 1.5));
  const maxC = Math.min(N, Math.floor(S / 0.34));
  if (minC > maxC) return null;
  const C = minC + Math.floor(rng() * (maxC - minC + 1));
  const rows = new Array(C).fill(1);
  for (let left = N - C; left > 0; ) {
    const i = Math.floor(rng() * C);
    if (rows[i] < 3) {
      rows[i]++;
      left--;
    }
  }
  // Ширины колонок; колонки с бо́льшим числом рядов чуть шире
  const ws = rows.map((r) => (0.6 + rng()) * (1 + 0.25 * (r - 1)));
  const sum = ws.reduce((a, b) => a + b, 0);
  const bounds = [0];
  for (let i = 0; i < C - 1; i++) bounds.push(bounds[i] + (ws[i] / sum) * S);
  bounds.push(S);
  // Иногда ровняем границу ровно по стыку — чистый разрез
  for (let i = 1; i < C; i++) {
    const k = Math.round(bounds[i]);
    if (k > 0 && k < S && Math.abs(bounds[i] - k) < 0.25 && rng() < 0.4) bounds[i] = k;
  }
  for (let i = 1; i <= C; i++) if (bounds[i] - bounds[i - 1] < 0.2) return null;
  const cells = [];
  for (let i = 0; i < C; i++) {
    const hs = Array.from({ length: rows[i] }, () => 0.7 + rng() * 0.6);
    const hsum = hs.reduce((a, b) => a + b, 0);
    let y = 0;
    for (let j = 0; j < rows[i]; j++) {
      const h = j === rows[i] - 1 ? 1 - y : hs[j] / hsum;
      cells.push({ x: bounds[i], y, w: bounds[i + 1] - bounds[i], h });
      y += h;
    }
  }
  return { cells, bounds };
}

// Пары «ячейка ↔ фото»: вытянутые ячейки получают вытянутые фото
function assignCells(cells, items, aspect) {
  const cellAr = (c) => c.w / (c.h * aspect);
  const itemAr = (it) => it.media.iw / it.media.ih;
  const cs = cells.map((c, i) => ({ c, i })).sort((a, b) => cellAr(a.c) - cellAr(b.c));
  const is = [...items].sort((a, b) => itemAr(a) - itemAr(b));
  return cs.map((x, k) => ({ cell: x.c, item: is[k] }));
}

function scoreLayout(L, S, items, aspect) {
  let pen = 0;
  for (const c of L.cells) {
    const lr = Math.abs(Math.log(c.w / (c.h * aspect)));
    pen += lr * 0.3 + Math.max(0, lr - Math.log(1.9)) * 10;
  }
  // Узкие полоски фото у стыка смотрятся как ошибка
  for (let k = 1; k < S; k++) {
    let crossed = true;
    for (const b of L.bounds) {
      const d = Math.abs(b - k);
      if (d < 1e-6) crossed = false;
      else if (d < 0.18) pen += 6;
    }
    if (crossed) pen -= 0.6; // фото через стык — тот самый бесшовный эффект
  }
  for (const { cell, item } of assignCells(L.cells, items, aspect)) {
    const d = Math.log(cell.w / (cell.h * aspect)) - Math.log(item.media.iw / item.media.ih);
    pen += d * d * 0.5;
  }
  return pen;
}

function layoutKey(L) {
  return L.cells.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.w.toFixed(1)}`).join('|');
}

function generateLayouts(items, S, seed, count = 6) {
  const N = items.length;
  const aspect = slideH() / slideW();
  const rng = mulberry32(seed * 9973 + N * 31 + S);
  const found = [];
  for (let t = 0; t < 600; t++) {
    const L = randomLayout(N, S, rng);
    if (L) found.push({ L, score: scoreLayout(L, S, items, aspect) + rng() * 0.8 });
  }
  found.sort((a, b) => a.score - b.score);
  const out = [];
  const seen = new Set();
  for (const f of found) {
    const key = layoutKey(f.L);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.L);
    if (out.length >= count) break;
  }
  return out;
}

// Прямоугольник ячейки на холсте с учётом отступов
function cellRect(c, S, gap) {
  const W = slideW();
  const H = slideH();
  const e = 1e-6;
  const inset = (atEdge) => (atEdge ? gap : gap / 2);
  return {
    l: c.x * W + inset(c.x < e),
    r: (c.x + c.w) * W - inset(c.x + c.w > S - e),
    t: c.y * H + inset(c.y < e),
    b: (c.y + c.h) * H - inset(c.y + c.h > 1 - e),
  };
}

const GAPS = { 0: 0, 1: 12, 2: 32 };
const tpl = { slides: 3, seed: 1, gap: 0, layouts: [] };

function openTemplates() {
  if (state.items.length < 1) {
    toast('Сначала добавь фото');
    return;
  }
  select(null);
  tpl.slides = state.slides;
  $('tplSheet').hidden = false;
  renderTemplates();
}

function renderTemplates() {
  $('tplCount').textContent = tpl.slides;
  $('tplMinus').disabled = tpl.slides <= MIN_SLIDES;
  $('tplPlus').disabled = tpl.slides >= MAX_SLIDES;
  for (const b of $('gapSeg').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.gap) === tpl.gap));
  }
  tpl.layouts = generateLayouts(state.items, tpl.slides, tpl.seed);
  const list = $('tplList');
  list.innerHTML = '';
  $('tplEmpty').hidden = tpl.layouts.length > 0;
  $('tplEmpty').textContent =
    `Для ${state.items.length} фото на ${tpl.slides} слайд(ах) раскладок нет — ` +
    (state.items.length > tpl.slides * 6 ? 'добавь слайдов.' : 'убавь слайдов или добавь фото.');
  const width = Math.min(list.clientWidth || 340, 640);
  const height = Math.round((width * slideH()) / (slideW() * tpl.slides));
  tpl.layouts.forEach((L, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tpl';
    btn.setAttribute('aria-label', `Раскладка ${idx + 1}`);
    const c = document.createElement('canvas');
    const d = window.devicePixelRatio || 1;
    c.width = Math.round(width * d);
    c.height = Math.round(height * d);
    c.style.width = width + 'px';
    c.style.height = height + 'px';
    drawTemplateThumb(c, L);
    btn.append(c);
    btn.addEventListener('click', () => applyTemplate(L));
    list.append(btn);
  });
}

function drawTemplateThumb(c, L) {
  const x = c.getContext('2d');
  const S = tpl.slides;
  const k = c.width / (slideW() * S);
  x.imageSmoothingQuality = 'high';
  x.scale(k, k);
  x.fillStyle = state.bg;
  x.fillRect(0, 0, slideW() * S, slideH());
  const gap = GAPS[tpl.gap];
  for (const { cell, item } of assignCells(L.cells, state.items, slideH() / slideW())) {
    const r = cellRect(cell, S, gap);
    const m = item.media;
    const ar = (r.r - r.l) / (r.b - r.t);
    let cw = m.iw;
    let ch = m.ih;
    if (m.iw / m.ih > ar) cw = ch * ar;
    else ch = cw / ar;
    x.drawImage(m.src, (m.iw - cw) / 2, (m.ih - ch) / 2, cw, ch, r.l, r.t, r.r - r.l, r.b - r.t);
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.strokeStyle = 'rgba(255,122,89,0.95)';
  x.lineWidth = Math.max(1, c.width / 400);
  x.setLineDash([6, 5]);
  for (let i = 1; i < S; i++) {
    const px = Math.round(i * slideW() * k) + 0.5;
    x.beginPath();
    x.moveTo(px, 0);
    x.lineTo(px, c.height);
    x.stroke();
  }
}

function applyTemplate(L) {
  pushUndo();
  state.slides = tpl.slides;
  const gap = GAPS[tpl.gap];
  for (const { cell, item } of assignCells(L.cells, state.items, slideH() / slideW())) {
    item.crop = { x: 0, y: 0, w: item.media.iw, h: item.media.ih }; // от центра фото
    fitToFrame(item, cellRect(cell, tpl.slides, gap));
  }
  $('tplSheet').hidden = true;
  syncControls();
  // Показываем всю ленту целиком; приблизить можно щипком
  view.s = Math.min(fitScale(), (stageW - 32) / stripW());
  view.oy = (stageH - slideH() * view.s) / 2 - 8;
  clampView();
  toast('Раскладка готова');
  changed();
}

$('tplBtn').addEventListener('click', openTemplates);
$('tplClose').addEventListener('click', () => ($('tplSheet').hidden = true));
$('tplSheet').addEventListener('click', (e) => {
  if (e.target === $('tplSheet')) $('tplSheet').hidden = true;
});
$('tplMore').addEventListener('click', () => {
  tpl.seed++;
  renderTemplates();
});
$('tplMinus').addEventListener('click', () => {
  tpl.slides = clamp(tpl.slides - 1, MIN_SLIDES, MAX_SLIDES);
  renderTemplates();
});
$('tplPlus').addEventListener('click', () => {
  tpl.slides = clamp(tpl.slides + 1, MIN_SLIDES, MAX_SLIDES);
  renderTemplates();
});
$('gapSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-gap]');
  if (!b) return;
  tpl.gap = Number(b.dataset.gap);
  renderTemplates();
});

// =====================================================================
// Экспорт
// =====================================================================
let exported = []; // { file, url, kind }
let exporting = false;

// Фото в нужном для экспорта размере, собранное из оригинального файла
async function makePatch(it, scale) {
  const m = it.media;
  let tw = Math.max(1, Math.round(it.crop.w * it.sc * scale));
  let th = Math.max(1, Math.round(it.crop.h * it.sc * scale));
  if (tw * th > MAX_CANVAS_PX) {
    const f = Math.sqrt(MAX_CANVAS_PX / (tw * th));
    tw = Math.floor(tw * f);
    th = Math.floor(th * f);
  }
  const rx = m.ow / m.iw;
  const ry = m.oh / m.ih;
  const sx = it.crop.x * rx, sy = it.crop.y * ry, sw = it.crop.w * rx, sh = it.crop.h * ry;
  let decoded = null;
  try {
    decoded = await decodeImage(m.file);
    return resample(decoded.img, sx, sy, sw, sh, tw, th);
  } catch {
    // Оригинал не открылся — берём копию редактора
    return resample(m.src, it.crop.x, it.crop.y, it.crop.w, it.crop.h, tw, th);
  } finally {
    if (decoded) URL.revokeObjectURL(decoded.url);
  }
}

async function getPatch(it, scale, cache) {
  if (!cache.has(it)) cache.set(it, await makePatch(it, scale));
  return cache.get(it);
}

// Освобождаем фото, которые правее уже не встретятся
function dropPatchesBefore(xLimit, cache) {
  for (const [it, p] of cache) {
    if (itemBounds(it).r <= xLimit) {
      freeCanvas(p);
      cache.delete(it);
    }
  }
}

async function drawSlideFrame(x, i, cache, scale) {
  const W = slideW();
  x.setTransform(scale, 0, 0, scale, -i * W * scale, 0);
  x.fillStyle = state.bg;
  x.fillRect(i * W, 0, W, slideH());
  for (const it of state.items) {
    if (!onSlide(it, i)) continue;
    drawItem(x, it, isVideo(it) ? null : cache.get(it));
  }
}

// Во сколько раз больше 1080 нужно сохранять, чтобы ни одно фото не потеряло пикселей
function nativeScale() {
  let s = 1;
  for (const it of state.items) {
    if (isVideo(it)) continue;
    const m = it.media;
    s = Math.max(s, m.ow / m.iw / it.sc);
  }
  const cap = Math.sqrt(MAX_SLIDE_PX / (slideW() * slideH()));
  return Math.min(s, cap);
}

async function renderStill(i, scale, cache, lossless) {
  for (const it of state.items) if (onSlide(it, i) && !isVideo(it)) await getPatch(it, scale, cache);
  const c = makeCanvas(slideW() * scale, slideH() * scale);
  const x = hqContext(c);
  await drawSlideFrame(x, i, cache, scale);
  const blob = await new Promise((r) =>
    lossless ? c.toBlob(r, 'image/png') : c.toBlob(r, 'image/jpeg', JPEG_QUALITY)
  );
  freeCanvas(c);
  if (!blob) throw new Error('encode');
  return blob;
}

// Если на слайд не хватило памяти — пробуем меньше, в крайнем случае 1080 JPEG
async function renderStillSafe(i, scale, cache, lossless) {
  const attempts = [[scale, lossless]];
  if (scale > 2) attempts.push([2, lossless]);
  attempts.push([1, false]);
  let lastErr;
  for (const [s, l] of attempts) {
    try {
      return { blob: await renderStill(i, s, cache, l), scale: s, lossless: l };
    } catch (err) {
      lastErr = err;
      console.error('slide', i + 1, 'scale', s, err);
      for (const p of cache.values()) freeCanvas(p);
      cache.clear();
    }
  }
  throw lastErr;
}

function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  return list.find((t) => MediaRecorder.isTypeSupported?.(t)) || null;
}

function seekStart(v) {
  return new Promise((res) => {
    v.pause();
    if (v.currentTime === 0 && v.readyState >= 2) return res();
    const done = () => {
      v.removeEventListener('seeked', done);
      res();
    };
    v.addEventListener('seeked', done);
    v.currentTime = 0;
    setTimeout(done, 2000);
  });
}

// Слайд с видео: записываем canvas в реальном времени (без звука)
async function recordVideoSlide(i, cache, mime, patchScale, onProgress) {
  const scale = 1; // видео всегда 1080 по ширине
  for (const it of state.items) if (onSlide(it, i) && !isVideo(it)) await getPatch(it, patchScale, cache);
  const vids = [...new Set(state.items.filter((it) => isVideo(it) && onSlide(it, i)).map((it) => it.media))];
  const D = Math.min(MAX_VIDEO_SEC, Math.max(1, ...vids.map((m) => m.duration || 0)));

  const c = makeCanvas(slideW() * scale, slideH() * scale);
  const x = hqContext(c);
  await Promise.all(vids.map((m) => seekStart(m.src)));
  await drawSlideFrame(x, i, cache, scale);

  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(500);
  await Promise.all(vids.map((m) => m.src.play().catch(() => {})));

  const t0 = performance.now();
  await new Promise((res) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      drawSlideFrame(x, i, cache, scale);
      onProgress(Math.min(t, D), D);
      if (t >= D) return res();
      // rAF замирает в фоне — подстраховываемся таймером
      setTimeout(step, 1000 / 30);
    };
    step();
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  freeCanvas(c);
  return new Blob(chunks, { type: mime.split(';')[0] });
}

function clearExported() {
  for (const e of exported) URL.revokeObjectURL(e.url);
  exported = [];
  $('previews').innerHTML = '';
}

function addPreview(entry, n) {
  const f = document.createElement('figure');
  let el;
  if (entry.kind === 'video') {
    el = document.createElement('video');
    el.muted = true;
    el.loop = true;
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('muted', '');
  } else {
    el = document.createElement('img');
    el.alt = `Слайд ${n}`;
  }
  el.src = entry.url;
  el.addEventListener('click', () => shareFiles([entry.file]));
  const cap = document.createElement('figcaption');
  cap.textContent = entry.kind === 'video' ? `${n} · видео` : String(n);
  f.append(el, cap);
  $('previews').append(f);
}

function setStatus(text) {
  $('exportStatus').textContent = text;
  $('exportStatus').hidden = !text;
}

async function runExport() {
  if (exporting) return;
  if (!state.items.length) {
    toast('Сначала добавь фото');
    return;
  }
  const W = slideW();
  const videoSlides = new Set();
  for (let i = 0; i < state.slides; i++) {
    if (state.items.some((it) => isVideo(it) && onSlide(it, i))) videoSlides.add(i);
  }
  const mime = videoSlides.size ? pickVideoMime() : null;
  if (videoSlides.size && !mime) {
    toast('Этот браузер не умеет сохранять видео — обнови iOS/браузер');
    return;
  }
  // Разблокируем воспроизведение, пока есть жест пользователя
  for (const m of allVideos) m.src.play().catch(() => {});

  exporting = true;
  select(null);
  clearExported();
  $('sheet').hidden = false;
  $('saveAll').disabled = true;
  $('qualitySeg').classList.add('busy');
  $('sheetTitle').textContent = 'Готовлю слайды…';
  if (videoSlides.size) toast('Записываю видео — не сворачивай приложение', true);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const lossless = state.exportScale === 'orig';
  const scale = lossless ? nativeScale() : 1;
  const cache = new Map();
  let reduced = false;
  try {
    for (let i = 0; i < state.slides; i++) {
      const n = i + 1;
      let blob;
      let kind = 'image';
      if (videoSlides.has(i)) {
        kind = 'video';
        blob = await recordVideoSlide(i, cache, mime, scale, (t, D) =>
          setStatus(`Слайд ${n} из ${state.slides}: видео ${Math.floor(t)} / ${Math.round(D)} с`)
        );
      } else {
        setStatus(`Слайд ${n} из ${state.slides}…`);
        const res = await renderStillSafe(i, scale, cache, lossless);
        blob = res.blob;
        if (res.scale < scale) reduced = true;
      }
      dropPatchesBefore((i + 1) * W, cache);
      const ext =
        kind === 'video' ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : blob.type === 'image/png' ? 'png' : 'jpg';
      const name = `carousel-${stamp}-${String(n).padStart(2, '0')}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      const entry = { file, url: URL.createObjectURL(blob), kind };
      exported.push(entry);
      addPreview(entry, n);
    }
    const nv = exported.filter((e) => e.kind === 'video').length;
    const px = reduced ? 'размер уменьшен' : `${Math.round(slideW() * scale)}×${Math.round(slideH() * scale)}`;
    $('sheetTitle').textContent = `Слайды: ${exported.length} · ${px}${nv ? ` · видео: ${nv}` : ''}`;
    setStatus(reduced ? 'Телефону не хватило памяти на полный размер — часть слайдов сохранена меньше.' : '');
    $('saveAll').disabled = false;
  } catch (err) {
    console.error(err);
    $('sheetTitle').textContent = 'Не получилось';
    setStatus(`Ошибка при подготовке (${err?.message || err?.name || 'неизвестно'}). Попробуй режим 1080 или меньше слайдов.`);
  } finally {
    for (const p of cache.values()) freeCanvas(p);
    exporting = false;
    $('qualitySeg').classList.remove('busy');
    toast('');
    syncVideos();
  }
}

$('exportBtn').addEventListener('click', runExport);

function syncQuality() {
  for (const b of $('qualitySeg').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.scale === String(state.exportScale)));
  }
}
$('qualitySeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-scale]');
  if (!b || exporting) return;
  const s = b.dataset.scale === 'orig' ? 'orig' : 1;
  if (s === state.exportScale) return;
  state.exportScale = s;
  try {
    localStorage.setItem('exportScale', String(s));
  } catch {}
  syncQuality();
  runExport();
});

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
      setStatus('');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('share', err);
      setStatus(
        `Не открылось меню «Поделиться» (${err.name}). ` +
          'Сохрани по одной: нажми на картинку или зажми её и выбери «Сохранить в Фото».'
      );
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
function closeSheet() {
  if (exporting) return;
  $('sheet').hidden = true;
}
$('sheetClose').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet')) closeSheet();
});

// =====================================================================
// Старт
// =====================================================================
(async function init() {
  syncControls();
  syncQuality();
  updateHint();
  updateUndoButtons();
  new ResizeObserver(resize).observe(stage);
  await restoreProject();
  syncControls();
  updateHint();
  view.fitted = false;
  resize();
  syncVideos();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Для отладки
window.__carousel = { state, view, undo, redo, runExport, db };
