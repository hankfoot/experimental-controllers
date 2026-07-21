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
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  const phosphor = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#57ffa6';

  function drawGraticule(w, h, c) {
    ctx.save();
    ctx.strokeStyle = c + '18'; // faint green graticule
    ctx.lineWidth = 1;
    const cols = 10, rows = 4;
    for (let i = 1; i < cols; i++) {
      const x = Math.round((i / cols) * w) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let j = 1; j < rows; j++) {
      const y = Math.round((j / rows) * h) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // brighter center axes
    ctx.strokeStyle = c + '33';
    ctx.beginPath(); ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2 + 0.5, 0); ctx.lineTo(w / 2 + 0.5, h); ctx.stroke();
    ctx.restore();
  }

  function frame(now) {
    // Turn the trigger light off once its flash window elapses.
    if (light.classList.contains('flash') && now > flashUntil) {
      light.classList.remove('flash');
    }

    // Push the current value into the rolling history and redraw the plot.
    history.push(current);
    history.shift();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const c = phosphor();
    ctx.clearRect(0, 0, w, h);

    drawGraticule(w, h, c);

    // Build the trace path (0 at bottom, 1 at top).
    const stepX = w / (HISTORY - 1);
    const pad = 6;
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const x = i * stepX;
      const y = h - history[i] * (h - pad * 2) - pad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // Soft fill under the trace.
    ctx.save();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = c + '14';
    ctx.fill();
    ctx.restore();

    // Glowing phosphor trace (redraw path — fill mutated it).
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const x = i * stepX;
      const y = h - history[i] * (h - pad * 2) - pad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = c;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Leading-edge dot.
    const lastY = h - history[HISTORY - 1] * (h - pad * 2) - pad;
    ctx.beginPath();
    ctx.arc(w - 1, lastY, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
