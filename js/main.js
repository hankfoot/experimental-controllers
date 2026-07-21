// Entry point — wires the UI together.

import { onStatus } from './bus.js';
import { connect, disconnect, isSupported } from './bluetooth.js';
import { initVisualizer } from './visualizer.js';
import { initGame } from './game.js';
import { initDemo } from './demo.js';
import { renderSensors } from './sensors.js';

// --- Sensor grid -----------------------------------------------------------
renderSensors(document.getElementById('sensor-grid'));

// --- Consumers -------------------------------------------------------------
initVisualizer();
initGame();
const demo = initDemo();

// --- Browser support banner ------------------------------------------------
if (!isSupported()) {
  document.getElementById('unsupported-banner').hidden = false;
}

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
  } else {
    statusText.textContent = 'Not connected';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect micro:bit';
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
