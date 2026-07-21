// Live visualizer for the three input types. Sensor-agnostic: it just renders
// whatever trigger / state / value messages arrive on the bus.

import { onInput } from './bus.js';

export function initVisualizer() {
  const light = document.getElementById('trigger-light');
  const count = document.getElementById('trigger-count');
  const pill = document.getElementById('state-pill');
  const readout = document.getElementById('value-readout');
  const canvas = document.getElementById('value-canvas');
  const ctx = canvas.getContext('2d');

  let triggers = 0;
  let flashUntil = 0;

  // Rolling history of continuous values (newest at the end).
  const HISTORY = 120;
  const history = new Array(HISTORY).fill(0);
  let current = 0;

  onInput((msg) => {
    if (msg.type === 'trigger') {
      triggers++;
      count.textContent = String(triggers);
      light.classList.add('flash');
      flashUntil = performance.now() + 120;
    } else if (msg.type === 'state') {
      pill.dataset.on = String(msg.value);
      pill.textContent = String(msg.value);
    } else if (msg.type === 'value') {
      current = msg.value;
      readout.textContent = msg.value.toFixed(2);
    }
  });

  // Match the canvas backing store to its displayed size for crisp lines.
  // Returns false when the canvas has no size yet (e.g. its tab is hidden).
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  const accentColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f2795a';

  const traceAt = (i, w, h, stepX, pad) => ({
    x: i * stepX,
    y: h - history[i] * (h - pad * 2) - pad,
  });

  function frame(now) {
    // Turn the trigger light off once its flash window elapses.
    if (light.classList.contains('flash') && now > flashUntil) {
      light.classList.remove('flash');
    }

    // Re-fit if the displayed size changed (e.g. the Play tab just became visible).
    const dpr = window.devicePixelRatio || 1;
    if (canvas.clientWidth && canvas.width !== Math.round(canvas.clientWidth * dpr)) {
      fitCanvas();
    }

    // Push the current value into the rolling history and redraw the plot.
    history.push(current);
    history.shift();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w) { requestAnimationFrame(frame); return; } // tab hidden — skip drawing
    const c = accentColor();
    ctx.clearRect(0, 0, w, h);

    // Soft horizontal guide lines (light, minimal).
    ctx.strokeStyle = 'rgba(58,53,45,.07)';
    ctx.lineWidth = 1;
    for (let j = 1; j < 4; j++) {
      const y = Math.round((j / 4) * h) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const stepX = w / (HISTORY - 1);
    const pad = 8;

    // Soft coral fill under the trace.
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const p = traceAt(i, w, h, stepX, pad);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = c + '1f';
    ctx.fill();

    // The friendly rounded trace.
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const p = traceAt(i, w, h, stepX, pad);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Leading-edge dot with a soft white ring.
    const last = traceAt(HISTORY - 1, w, h, stepX, pad);
    ctx.beginPath();
    ctx.arc(last.x - 1, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
