// Live visualizer. Sensor-agnostic: it renders whatever trigger / state / value
// messages arrive on the bus. It drives TWO views at once from one shared history:
//   - the compact "Live" chip in the navbar (mini sparkline + dots)
//   - the full popover (trigger pop, state pill, big value plot)
// Either set of elements may be absent; everything is guarded.

import { onInput } from './bus.js';

export function initVisualizer() {
  const el = (id) => document.getElementById(id);

  const triggerFull = el('trigger-light');
  const triggerMini = el('mini-trigger');
  const statePill = el('state-pill');
  const stateMini = el('mini-state');
  const valFull = el('value-readout');
  const valMini = el('mini-value');
  const countEl = el('trigger-count');

  const canvases = ['value-canvas', 'mini-canvas']
    .map((id) => {
      const c = el(id);
      return c ? { c, ctx: c.getContext('2d'), mini: id === 'mini-canvas' } : null;
    })
    .filter(Boolean);

  let triggers = 0;
  let flashUntil = 0;
  const HISTORY = 120;
  const history = new Array(HISTORY).fill(0);
  let current = 0;

  onInput((msg) => {
    if (msg.type === 'trigger') {
      triggers++;
      if (countEl) countEl.textContent = String(triggers);
      triggerFull?.classList.add('flash');
      triggerMini?.classList.add('flash');
      flashUntil = performance.now() + 130;
    } else if (msg.type === 'state') {
      const on = String(msg.value);
      if (statePill) { statePill.dataset.on = on; statePill.textContent = String(msg.value); }
      if (stateMini) stateMini.dataset.on = on;
    } else if (msg.type === 'value') {
      current = msg.value;
      const txt = msg.value.toFixed(2);
      if (valFull) valFull.textContent = txt;
      if (valMini) valMini.textContent = txt;
    }
  });

  // Size a canvas to its displayed box. Returns false if it has no size (hidden).
  function fit({ c, ctx }) {
    const r = c.getBoundingClientRect();
    if (r.width === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  const accentColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';

  function drawTrace(entry, color) {
    if (!fit(entry)) return;
    const { c, ctx, mini } = entry;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const pad = mini ? 3 : 8;
    const stepX = w / (HISTORY - 1);
    const pt = (i) => ({ x: i * stepX, y: h - history[i] * (h - pad * 2) - pad });

    ctx.clearRect(0, 0, w, h);

    if (!mini) {
      ctx.strokeStyle = 'rgba(58,53,45,.07)';
      ctx.lineWidth = 1;
      for (let j = 1; j < 4; j++) {
        const y = Math.round((j / 4) * h) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    // fill under the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = color + (mini ? '14' : '1f');
    ctx.fill();

    // the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.75 : 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    if (!mini) {
      const last = pt(HISTORY - 1);
      ctx.beginPath(); ctx.arc(last.x - 1, last.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }

  function frame(now) {
    if (now > flashUntil) {
      triggerFull?.classList.remove('flash');
      triggerMini?.classList.remove('flash');
    }

    history.push(current);
    history.shift();

    const color = accentColor();
    for (const entry of canvases) drawTrace(entry, color);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
