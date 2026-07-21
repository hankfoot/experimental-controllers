// Demo mode — generate protocol messages without a micro:bit, so the site is
// testable on any machine (and gives the collaborator a way to drive the game).
// Feeds the exact same bus as the real Bluetooth input.

import { emitInput } from './bus.js';

let enabled = false;
let keyHandler = null;

export function isDemoEnabled() {
  return enabled;
}

export function initDemo() {
  const panel = document.getElementById('demo-panel');
  const toggle = document.getElementById('demo-toggle');
  const bannerLink = document.getElementById('banner-demo-link');
  const triggerBtn = document.getElementById('demo-trigger');
  const stateBtn = document.getElementById('demo-state');
  const valueSlider = document.getElementById('demo-value');

  function setEnabled(on) {
    enabled = on;
    panel.hidden = !on;
    toggle.textContent = on ? 'Demo mode (on)' : 'Demo mode';
    if (on) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  toggle.addEventListener('click', () => setEnabled(!enabled));
  bannerLink?.addEventListener('click', (e) => { e.preventDefault(); setEnabled(true); });

  triggerBtn.addEventListener('click', () => emitInput({ type: 'trigger', value: null }));

  stateBtn.addEventListener('click', () => {
    const next = stateBtn.dataset.on !== 'true';
    stateBtn.dataset.on = String(next);
    emitInput({ type: 'state', value: next });
  });

  valueSlider.addEventListener('input', () => {
    emitInput({ type: 'value', value: parseFloat(valueSlider.value) });
  });

  // Spacebar sends a trigger while demo mode is on (unless typing in a field).
  keyHandler = (e) => {
    if (!enabled) return;
    if (e.code === 'Space' && !/^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      e.preventDefault();
      emitInput({ type: 'trigger', value: null });
    }
  };
  window.addEventListener('keydown', keyHandler);

  return { setEnabled };
}
