// Entry point — wires the UI together.

import { onStatus, onInput } from './bus.js';
import { activeVia, connect, disconnect, isSupported } from './connection.js';
import { initVisualizer } from './visualizer.js';
import { initBuilder } from './builder.js';
import { initGame } from './game.js';
import { initGameWarning } from './game-warning.js';
import { createSignalStore } from './signal-store.js';
import { initTabs } from './tabs.js';
import { createWiringEngine } from './wiring-engine.js';
import { initWiringUI } from './wiring-ui.js';
import { initDesign } from './design.js';
import { createThemeStore, browserStorage } from './theme/theme-store.js';
import { createAssetStore } from './theme/assets.js';
import { createImageCache, assetBytes } from './theme/images.js';
import { createAudio } from './theme/audio.js';
import { SOUND_FILES } from './theme/defaults.js';
import { migrateStorage } from './storage-migrate.js';

// --- Tabs ------------------------------------------------------------------
initTabs();

// --- How the game looks and sounds ------------------------------------------
// Built before the game host, which reads the theme on every frame. The images
// a theme points at load asynchronously; until they arrive each one reads as
// null and the game draws its built-in art, so there is nothing to wait for.
const storage = browserStorage();
// Before anything reads a store. This works because no module reads storage at
// import time — every reader does it inside `init…`/`create…`, so a statement
// here is early enough. A future top-level `const saved = storage.getItem(…)`
// in any of them would break that silently, so it is worth keeping true.
migrateStorage(storage);
const themeStore = createThemeStore({ storage });
const assetStore = createAssetStore();
const images = createImageCache({ assets: assetStore });
const audio = createAudio({
  resolveUpload: async (id) => assetBytes(await assetStore.get(id)),
  builtIn: SOUND_FILES,
});
const look = { theme: () => themeStore.get(), images };
// The defaults are drawn or fetched once; the theme's own drawings load after.
// Neither is awaited here — the game redraws every frame and picks them up on
// its own. The Design cards do not, so they are told when this settles.
const drawingsReady = images.ready().then(() => images.warm(themeStore.get()));

// --- Shared controller state ------------------------------------------------
const signalStore = createSignalStore();
// The music belongs to the game, and plays only where the game is: not on the
// screen where you pick it, and not while the browser tab itself is away. It
// did play on Design for a while, on the theory that you would want to hear
// what you were choosing — but a track that starts itself the moment you set it
// and follows you around the screen is not a preview, it is a radio.
const gameHost = initGame({
  look,
  audio,
  musicWhen: () => document.visibilityState === 'visible'
    && !document.getElementById('panel-game')?.hidden,
});
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
const builder = initBuilder({
  grid: document.getElementById('builder-grid'),
  codeEl: document.getElementById('builder-code'),
  stepsEl: document.getElementById('builder-steps'),
  warnEl: document.getElementById('builder-warning'),
  clearBtn: document.getElementById('builder-clear'),
  onChange: ({ channels }) => signalStore.setPlannedChannels(channels),
});

// --- Consumers -------------------------------------------------------------
initVisualizer(signalStore);
if (wiringEngine) initWiringUI({ signalStore, engine: wiringEngine });
if (wiringEngine) {
  initGameWarning({
    element: document.getElementById('game-warning'),
    signalStore,
    engine: wiringEngine,
    host: gameHost,
  });
}
if (wiringEngine) {
  const byId = (id) => document.getElementById(id);
  const design = initDesign({
    hosts: {
      settings: byId('design-settings'),
      sprites: byId('design-sprites'),
      sound: byId('design-sound'),
      text: byId('design-text'),
      share: byId('design-share'),
      shareNote: byId('theme-io-note'),
      exportBtn: byId('theme-export'),
      importFile: byId('theme-import-file'),
      preview: byId('design-preview'),
    },
    engine: wiringEngine,
    theme: themeStore,
    assets: assetStore,
    images,
    audio,
    storage,
    // Registered after the engine's own listener above, so by the time this
    // runs the engine already holds the new scheme's settings.
    onGameChange: (redraw) => gameHost.onGameChange(redraw),
    // A redrawn sprite needs no announcement — the renderer reads the theme
    // every frame. This is for the music, which has to be told to change.
    onThemeApplied: () => gameHost.syncMusic(),
    onOptionsImported: () => wiringEngine.reloadOptions(),
    // An imported bundle rewrites the picked inputs and the wiring underneath
    // both of the things holding them, so both are told to look again.
    onInputsImported: () => {
      builder?.reload();
      wiringEngine.reloadWiring();
    },
  });
  drawingsReady.then(() => design?.refreshPreviews());
}

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

// The chip washes green as readings arrive. Generic on/off — it never reflects
// any specific channel, so many simultaneous streams can't make it thrash.
// `data-state` (set below) colours the dot; `data-active` runs the wash.
//
// A CSS animation only replays if the element leaves and re-enters the state
// that runs it, which is what the reflow below is for. The rate limit is why
// that is affordable, and it is also the point: readings arrive ten times a
// second, and restarting a half-second fade on every one of them would hold the
// chip at full green — which says "connected", not "receiving". Restarting it
// three times a second lets it visibly breathe.
let washedAt = -Infinity;
let washOff = null;

function blink() {
  const now = performance.now();
  if (now - washedAt < 320) return;
  washedAt = now;
  signalToggle.dataset.active = 'false';
  void signalToggle.offsetWidth;
  signalToggle.dataset.active = 'true';
  clearTimeout(washOff);
  washOff = setTimeout(() => { signalToggle.dataset.active = 'false'; }, 520);
}

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
// state ("Not Connected" → the board's own name). Connect and Disconnect swap
// places beside it, and both stay in the bar: needing to unplug is what happens
// when something has gone wrong, and that is the worst possible moment for the
// control to be hidden inside a popover.
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const signalLabel = document.getElementById('signal-label');

// How long a connected board may say nothing before the chip stops claiming
// everything is fine. Only applies when something is expected to be streaming —
// see `expectsStream`. Generous, because a board that has just been asked to
// calibrate its compass is legitimately busy for a few seconds.
const QUIET_MS = 3000;
let lastHeard = 0;
let live = null; // the last real status, while `stale` is standing in for it

// Whether silence means anything. A controller made of buttons and gestures
// sends nothing at all while nobody is touching it — that is the whole point of
// reporting edges — so only a build with a polled reading in it can be quiet in
// a way worth mentioning.
function expectsStream() {
  return signalStore.all().some((signal) =>
    (signal.planned || signal.wired) && (signal.kind === 'number' || signal.kind === 'bearing'));
}

const LABELS = {
  lost: 'Connection lost',
  stale: 'Connected, no data',
};

function paint({ state, message, retrying = false }) {
  // Whichever of the two buttons is about to vanish, if it is the one somebody
  // just pressed, hand focus on rather than dropping it on the floor.
  const wasFocused = document.activeElement;
  const connected = state === 'connected' || state === 'stale';
  const connecting = state === 'connecting';

  signalToggle.dataset.state = state;
  connectBtn.hidden = connected;
  connectBtn.disabled = connecting;
  connectBtn.textContent = connecting ? 'Connecting…' : 'Connect';
  // Offered whenever there is something to give up on, which during a reconnect
  // there is — that is the one moment somebody most wants to stop waiting.
  disconnectBtn.hidden = !connected && !retrying;

  if (state === 'connected') {
    // e.g. "BBC micro:bit [gapeg] · Bluetooth". The board's own name identifies
    // *which* board, and the transport says how it is reaching you — which is
    // the thing that decides whether unplugging the cable ends the session.
    const via = activeVia();
    signalLabel.textContent = [message || 'Connected', via].filter(Boolean).join(' · ');
  } else if (connecting) {
    signalLabel.textContent = retrying ? 'Reconnecting…' : 'Connecting…';
  } else {
    signalLabel.textContent = LABELS[state] ?? 'Not Connected';
  }
  if (connected && wasFocused === connectBtn) signalToggle.focus();
  if (!connected && wasFocused === disconnectBtn) connectBtn.focus();
}

onStatus((status) => {
  live = status;
  lastHeard = performance.now();
  paint(status);
  // A wire holds its last value until the next one arrives, and a board that
  // has gone lets go of nothing. Without this the craft carries on climbing
  // into the ceiling while the chip says the controller is gone.
  if (status.state !== 'connected') wiringEngine?.release();
});

onInput(() => {
  blink();
  lastHeard = performance.now();
  if (live && signalToggle.dataset.state === 'stale') paint(live);
});

// Checked on a timer rather than worked out when asked, because the thing being
// watched is the absence of events, and nothing arrives to prompt the question.
setInterval(() => {
  if (live?.state !== 'connected') return;
  const quiet = performance.now() - lastHeard > QUIET_MS;
  const showing = signalToggle.dataset.state;
  if (quiet && showing === 'connected' && expectsStream()) paint({ state: 'stale' });
}, 1000);

// --- Connecting --------------------------------------------------------------
// One way in, so Connect just connects. There was a menu here offering Bluetooth
// or the USB cable; the cable is gone (see js/connection.js) and a menu with one
// item is a question with a single answer.

async function start() {
  try {
    await connect();
  } catch (err) {
    // The chooser being dismissed throws, and is not a failure — the transport
    // has already put the previous status back.
    console.debug('connect cancelled or failed:', err?.message);
  }
}

connectBtn.addEventListener('click', () => start());
disconnectBtn.addEventListener('click', () => disconnect());
