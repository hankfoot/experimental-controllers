// "Send test input" controls (in the Live popover) — generate protocol messages
// without a micro:bit, so the pipeline is testable on any machine. Always visible;
// feeds the exact same bus as real Bluetooth input, using real channel names.

import { emitInput } from './bus.js';

export function initDemo() {
  const holdBtn = document.getElementById('demo-a');
  const shakeBtn = document.getElementById('demo-shake');
  const lightSlider = document.getElementById('demo-light');
  if (!holdBtn || !shakeBtn || !lightSlider) return;

  // Hold-to-press: btna reads 1 while held, 0 on release — like the real button.
  const setA = (on) => {
    holdBtn.dataset.on = String(on);
    emitInput({ channel: 'btna', value: on ? 1 : 0 });
  };
  holdBtn.addEventListener('pointerdown', () => setA(true));
  holdBtn.addEventListener('pointerup', () => setA(false));
  holdBtn.addEventListener('pointerleave', () => {
    if (holdBtn.dataset.on === 'true') setA(false);
  });

  shakeBtn.addEventListener('click', () => emitInput({ channel: 'shake', value: 1 }));

  lightSlider.addEventListener('input', () => {
    emitInput({ channel: 'light', value: parseInt(lightSlider.value, 10) });
  });
}
