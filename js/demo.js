// "Send test input" controls (in the Live popover) — generate protocol messages
// without a micro:bit, so the pipeline is testable on any machine. Always visible;
// feeds the exact same bus as real Bluetooth input.

import { emitInput } from './bus.js';

export function initDemo() {
  const triggerBtn = document.getElementById('demo-trigger');
  const stateBtn = document.getElementById('demo-state');
  const valueSlider = document.getElementById('demo-value');
  if (!triggerBtn || !stateBtn || !valueSlider) return;

  triggerBtn.addEventListener('click', () => emitInput({ type: 'trigger', value: null }));

  stateBtn.addEventListener('click', () => {
    const next = stateBtn.dataset.on !== 'true';
    stateBtn.dataset.on = String(next);
    emitInput({ type: 'state', value: next });
  });

  valueSlider.addEventListener('input', () => {
    emitInput({ type: 'value', value: parseFloat(valueSlider.value) });
  });
}
