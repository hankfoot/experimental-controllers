// Live visualizer. Channel-agnostic: a row appears for every channel that shows
// up on the bus, whatever its name. Row style adapts to the data:
//   - event channels (per registry, e.g. shake) → flash dot + count
//   - channels that have only ever sent 0/1     → on/off pill
//   - anything else                             → numeric readout + rolling plot
// Plots scale using the registry's range hint when there is one, expanding to
// whatever values actually arrive (so unknown channels auto-scale).
//
// It also drives the compact "Live" chip in the navbar: flash dot (events),
// state dot (any binary channel on), and a sparkline of the most recently
// active numeric channel. Either set of elements may be absent; all guarded.

import { onInput } from './bus.js';
import { channelInfo } from './channels.js';

const HISTORY = 120;

export function initVisualizer() {
  const el = (id) => document.getElementById(id);

  const rowsHost = el('live-rows');
  const emptyMsg = rowsHost?.querySelector('.live-empty');
  const miniFlash = el('mini-trigger');
  const miniState = el('mini-state');
  const miniNum = el('mini-value');
  const miniCanvas = el('mini-canvas');
  const miniCtx = miniCanvas?.getContext('2d');

  /** @type {Map<string, object>} channel name -> row state */
  const rows = new Map();
  let miniFlashUntil = 0;
  let lastNumberRow = null; // whose history the mini sparkline shows

  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  function makeRow(name, kind) {
    const info = channelInfo(name);
    const row = {
      name, kind,
      current: 0,
      count: 0,
      flashUntil: 0,
      min: info.min ?? 0,
      max: info.max ?? 1,
      history: new Array(HISTORY).fill(null),
      el: null, vizEl: null, canvas: null, ctx: null,
    };

    if (rowsHost) {
      if (emptyMsg) emptyMsg.hidden = true;
      row.el = document.createElement('div');
      row.el.className = 'chan';
      row.el.dataset.kind = kind;
      row.el.innerHTML = `
        <span class="chan-id"><span class="chan-emoji">${info.emoji}</span><code>${name}</code></span>
        <div class="chan-viz"></div>
      `;
      row.vizEl = row.el.querySelector('.chan-viz');
      fillViz(row);
      rowsHost.appendChild(row.el);
    }
    rows.set(name, row);
    return row;
  }

  function fillViz(row) {
    if (!row.vizEl) return;
    if (row.kind === 'event') {
      row.vizEl.innerHTML = `<span class="chan-flash"></span><span class="chan-count">×<b>0</b></span>`;
    } else if (row.kind === 'binary') {
      row.vizEl.innerHTML = `<span class="chan-pill" data-on="false">0</span>`;
    } else {
      row.vizEl.innerHTML = `<canvas class="chan-spark"></canvas><span class="chan-num">0</span>`;
      row.canvas = row.vizEl.querySelector('canvas');
      row.ctx = row.canvas.getContext('2d');
    }
  }

  onInput(({ channel, value }) => {
    const info = channelInfo(channel);
    let row = rows.get(channel);
    if (!row) {
      const kind = info.kind === 'event' ? 'event'
        : (value === 0 || value === 1) ? 'binary' : 'number';
      row = makeRow(channel, kind);
    }

    // A "binary" channel that sends a non-0/1 value was numeric all along.
    if (row.kind === 'binary' && value !== 0 && value !== 1) {
      row.kind = 'number';
      if (row.el) row.el.dataset.kind = 'number';
      fillViz(row);
    }

    row.current = value;

    if (row.kind === 'event') {
      row.count++;
      row.flashUntil = performance.now() + 150;
      miniFlashUntil = row.flashUntil;
      row.vizEl?.querySelector('.chan-flash')?.classList.add('flash');
      row.vizEl?.querySelector('.chan-count b')?.replaceChildren(String(row.count));
      miniFlash?.classList.add('flash');
    } else if (row.kind === 'binary') {
      const pill = row.vizEl?.querySelector('.chan-pill');
      if (pill) { pill.dataset.on = String(value === 1); pill.textContent = String(value); }
    } else {
      if (value < row.min) row.min = value;
      if (value > row.max) row.max = value;
      const txt = fmt(value);
      row.vizEl?.querySelector('.chan-num')?.replaceChildren(txt);
      lastNumberRow = row;
      if (miniNum) miniNum.textContent = txt;
    }
  });

  // --- Drawing --------------------------------------------------------------

  // Size a canvas to its displayed box. Returns false if it has no size (hidden).
  function fit(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  const accentColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';

  function drawTrace(canvas, ctx, row, color) {
    if (!fit(canvas, ctx)) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pad = 3;
    const span = row.max - row.min || 1;
    const stepX = w / (HISTORY - 1);
    const norm = (v) => (v - row.min) / span;
    const pt = (i) => ({
      x: i * stepX,
      y: h - norm(row.history[i] ?? row.min) * (h - pad * 2) - pad,
    });

    ctx.clearRect(0, 0, w, h);

    // fill under the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = color + '18';
    ctx.fill();

    // the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function frame(now) {
    const color = accentColor();

    for (const row of rows.values()) {
      if (row.kind === 'event') {
        if (now > row.flashUntil) row.vizEl?.querySelector('.chan-flash')?.classList.remove('flash');
        continue;
      }
      if (row.kind !== 'number') continue;
      row.history.push(row.current);
      row.history.shift();
      if (row.canvas) drawTrace(row.canvas, row.ctx, row, color);
    }

    if (now > miniFlashUntil) miniFlash?.classList.remove('flash');
    if (miniState) {
      const anyOn = [...rows.values()].some((r) => r.kind === 'binary' && r.current === 1);
      miniState.dataset.on = String(anyOn);
    }
    if (miniCanvas && lastNumberRow) drawTrace(miniCanvas, miniCtx, lastNumberRow, color);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
