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

  const accent = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d4aff';

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
    ctx.clearRect(0, 0, w, h);

    // Baseline grid line at the midpoint.
    ctx.strokeStyle = 'rgba(128,128,128,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // The value trace (0 at bottom, 1 at top), with a soft fill underneath.
    const stepX = w / (HISTORY - 1);
    const c = accent();
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const x = i * stepX;
      const y = h - history[i] * (h - 8) - 4;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = c + '22';
    ctx.fill();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
