// Entry point — wires the UI together.

import { onStatus, onInput } from './bus.js';
import { connect, disconnect, isSupported } from './bluetooth.js';
import { initVisualizer } from './visualizer.js';
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
const gameHost = initGame();
const wiringEngine = gameHost
  ? createWiringEngine({
    signalStore,
    actions: gameHost.actions,
    game: gameHost.activeGame(),
  })
  : null;
// Each game keeps its own independent wiring, so the board swaps with the game.
if (wiringEngine) gameHost.onGameChange((game) => wiringEngine.setGame(game));

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

// The chip pulses while data is flowing, then settles after a short idle.
// Generic on/off — it never reflects any specific channel, so many simultaneous
// streams can't make it thrash. `data-state` (set below) colors the dot
// (grey / yellow / green); `data-active` drives the pulse.
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
// The top bar always shows the live-input toggle, labelled with the connection
// state ("Not Connected" → the board's own name). Connect sits beside it while
// no board is paired and drops out once one is; Disconnect lives in the popover.
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const signalLabel = document.getElementById('signal-label');

onStatus(({ state, message }) => {
  // Connect is the control that disappears on pairing, so if it's what the user
  // just pressed, hand focus to the toggle rather than dropping it.
  const wasFocused = document.activeElement;
  const connected = state === 'connected';

  signalToggle.dataset.state = state; // colors the dot: grey / yellow / green
  connectBtn.hidden = connected;
  connectBtn.disabled = state === 'connecting';
  connectBtn.textContent = state === 'connecting' ? 'Connecting…' : 'Connect';
  disconnectBtn.hidden = !connected;

  if (connected) {
    signalLabel.textContent = message || 'Connected'; // e.g. "BBC micro:bit [gapeg]"
    if (wasFocused === connectBtn) signalToggle.focus();
  } else {
    signalLabel.textContent = state === 'connecting' ? 'Connecting…' : 'Not Connected';
    if (wasFocused === disconnectBtn) connectBtn.focus();
  }
});

connectBtn.addEventListener('click', async () => {
  try {
    await connect();
  } catch (err) {
    // requestDevice throws if the user cancels the chooser — nothing to do.
    console.debug('connect cancelled or failed:', err?.message);
  }
});

disconnectBtn.addEventListener('click', () => disconnect());
