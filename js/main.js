// Entry point — wires the UI together.

import { onStatus, onInput } from './bus.js';
import { connect, disconnect, isSupported } from './bluetooth.js';
import { initVisualizer } from './visualizer.js';
import { initGame } from './game.js';
import { initDemo } from './demo.js';
import { renderSensors } from './sensors.js';
import { initTabs } from './tabs.js';

// --- Tabs ------------------------------------------------------------------
initTabs();

// --- Sensor grid -----------------------------------------------------------
renderSensors(document.getElementById('sensor-grid'));

// --- Consumers -------------------------------------------------------------
initVisualizer();
initGame();
initDemo();

// --- Browser support banner ------------------------------------------------
if (!isSupported()) {
  document.getElementById('unsupported-banner').hidden = false;
}

// --- Live visualizer popover ----------------------------------------------
const signalToggle = document.getElementById('signal-toggle');
const vizPop = document.getElementById('viz-pop');
const vizClose = document.getElementById('viz-close');
const bannerDemoLink = document.getElementById('banner-demo-link');

function openViz(open) {
  vizPop.hidden = !open;
  signalToggle.setAttribute('aria-expanded', String(open));
}

// Keep the chip compact until there's actually something live to show.
function markLive() { signalToggle.classList.add('is-live'); }
onInput(markLive);

signalToggle.addEventListener('click', () => openViz(vizPop.hidden));
vizClose.addEventListener('click', () => openViz(false));

// Close on Escape or a click outside the popover (but not on the toggle).
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openViz(false); });
document.addEventListener('click', (e) => {
  if (vizPop.hidden) return;
  if (vizPop.contains(e.target) || signalToggle.contains(e.target)) return;
  openViz(false);
});

// The banner's "Live → Demo mode" link opens the popover; demo.js enables demo.
bannerDemoLink?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation(); // don't let the outside-click handler immediately close it
  openViz(true);
});

// --- Connection button + status --------------------------------------------
const connectBtn = document.getElementById('connect-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

let connected = false;

onStatus(({ state, message }) => {
  statusDot.dataset.state = state;
  connected = state === 'connected';

  if (state === 'connecting') {
    statusText.textContent = 'Connecting…';
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
  } else if (state === 'connected') {
    statusText.textContent = message || 'Connected';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Disconnect';
    markLive();
  } else {
    statusText.textContent = 'Not connected';
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
