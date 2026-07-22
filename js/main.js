// Entry point — wires the UI together.

import { onStatus, onInput } from './bus.js';
import { connect, disconnect, isSupported } from './bluetooth.js';
import { initVisualizer } from './visualizer.js';
import { initDemo } from './demo.js';
import { initBuilder } from './builder.js';
import { initGame } from './game.js';
import { createSignalStore } from './signal-store.js';
import { initTabs } from './tabs.js';
import { createWiringEngine } from './wiring-engine.js';
import { initWiringUI } from './wiring-ui.js';

// --- Tabs ------------------------------------------------------------------
initTabs();

// --- Shared controller state ------------------------------------------------
const signalStore = createSignalStore();
const gameActions = initGame();
const wiringEngine = gameActions
  ? createWiringEngine({ signalStore, actions: gameActions })
  : null;

// --- Controller code builder ------------------------------------------------
initBuilder({
  grid: document.getElementById('builder-grid'),
  codeEl: document.getElementById('builder-code'),
  stepsEl: document.getElementById('builder-steps'),
  warnEl: document.getElementById('builder-warning'),
  onChange: ({ channels }) => signalStore.setPlannedChannels(channels),
});

// --- Consumers -------------------------------------------------------------
initVisualizer(signalStore);
initDemo();
if (wiringEngine) initWiringUI({ signalStore, engine: wiringEngine });

// --- Copy buttons on code blocks -------------------------------------------
document.querySelectorAll('.code-copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const code = btn.parentElement.querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1400);
    } catch {
      /* clipboard blocked (e.g. non-secure context) — user can select manually */
    }
  });
});

// --- Browser support banner ------------------------------------------------
if (!isSupported()) {
  document.getElementById('unsupported-banner').hidden = false;
}

// --- Live visualizer popover ----------------------------------------------
const signalToggle = document.getElementById('signal-toggle');
const vizPop = document.getElementById('viz-pop');
const vizClose = document.getElementById('viz-close');

function openViz(open) {
  vizPop.hidden = !open;
  signalToggle.setAttribute('aria-expanded', String(open));
}

// The chip pulses while data is flowing (real or demo), then settles after a
// short idle. Generic on/off — it never reflects any specific channel, so many
// simultaneous streams can't make it thrash. `data-state` (set below) colors
// the dot (grey / yellow / green); `data-active` drives the pulse.
let idleTimer = null;
onInput(() => {
  signalToggle.dataset.active = 'true';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { signalToggle.dataset.active = 'false'; }, 400);
});

signalToggle.addEventListener('click', () => openViz(vizPop.hidden));
vizClose.addEventListener('click', () => openViz(false));

// Close on Escape or a click outside the popover (but not on the toggle).
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openViz(false); });
document.addEventListener('click', (e) => {
  if (vizPop.hidden) return;
  if (vizPop.contains(e.target) || signalToggle.contains(e.target)) return;
  openViz(false);
});

// --- Connection button + status --------------------------------------------
// The signal button doubles as the status display: its dot reflects the state,
// and once connected its label becomes the device name — so the board name
// itself is the live-input button. The Connect/Disconnect action stays separate.
const connectBtn = document.getElementById('connect-btn');
const signalLabel = document.getElementById('signal-label');

let connected = false;

onStatus(({ state, message }) => {
  connected = state === 'connected';
  signalToggle.dataset.state = state; // colors the dot: grey / yellow / green

  if (state === 'connecting') {
    signalLabel.textContent = 'Connecting…';
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
  } else if (state === 'connected') {
    signalLabel.textContent = message || 'Connected'; // e.g. "BBC micro:bit [gapeg]"
    connectBtn.disabled = false;
    connectBtn.textContent = 'Disconnect';
  } else {
    signalLabel.textContent = 'Live';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

connectBtn.addEventListener('click', async () => {
  if (connected) {
    disconnect();
    return;
  }
  try {
    await connect();
  } catch (err) {
    // requestDevice throws if the user cancels the chooser — nothing to do.
    console.debug('connect cancelled or failed:', err?.message);
  }
});
