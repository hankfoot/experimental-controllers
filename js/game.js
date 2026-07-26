// Host for the game. Owns the canvas, the frame loop, the score UI, and the
// manual keyboard/button fallbacks, and swaps the active control scheme
// underneath all of it. Controller interpretation stays in the wiring engine;
// the physics and drawing stay in js/games/.
//
// The scheme picker lives on the Config tab and the canvas on the Game tab, so
// this module reaches across both — which is also why the round restarts
// whenever the game panel comes back into view.

import { GAMES, DEFAULT_GAME_ID, findGame } from './games/index.js';

const STORAGE_KEY = 'experimental-game-controllers:game';

const OVERLAY_THEMES = {
  light: {
    panel: 'rgba(255, 255, 255, .92)',
    border: 'rgba(27, 28, 32, .09)',
    title: '#1b1c20',
    body: '#666b74',
    score: '#ffffff',
    scoreShadow: 'rgba(27, 28, 32, .18)',
  },
  dark: {
    panel: 'rgba(17, 21, 28, .9)',
    border: 'rgba(255, 255, 255, .16)',
    title: '#ffffff',
    body: '#c3cad6',
    score: '#ffffff',
    scoreShadow: 'rgba(0, 0, 0, .45)',
  },
};

const KEY_LABELS = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', KeyW: 'W', KeyS: 'S' };
const keyLabel = (code) => KEY_LABELS[code] ?? code;

export function initGame() {
  const byId = (id) => document.getElementById(id);
  const ui = {
    canvas: byId('game-canvas'),
    panel: byId('panel-game'),
    picker: byId('game-picker'),
    tagline: byId('game-tagline'),
    buttons: byId('game-buttons'),
    reset: byId('game-reset'),
    scheme: byId('game-scheme'),
    score: byId('game-score'),
    best: byId('game-best'),
    status: byId('game-status'),
  };
  if (Object.values(ui).some((element) => !element)) return null;

  const ctx = ui.canvas.getContext('2d');
  if (!ctx) return null;

  const gameChangeListeners = new Set();
  let current = null; // { game, engine, render }
  let lastFrame = performance.now();
  let unsubscribe = null;

  // --- Drawing helpers shared by every game ---------------------------------
  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function makeHelpers(rules) {
    const { width, height } = rules;

    function drawScore(score, theme) {
      ctx.font = '700 38px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = theme.scoreShadow;
      ctx.strokeText(String(score), width / 2, 58);
      ctx.fillStyle = theme.score;
      ctx.fillText(String(score), width / 2, 58);
    }

    function drawOverlay(state, hint, { theme: themeName = 'light' } = {}) {
      const theme = OVERLAY_THEMES[themeName] ?? OVERLAY_THEMES.light;
      if (state.phase === 'playing') {
        drawScore(state.score, theme);
        return;
      }

      const cardWidth = Math.min(332, width - 80);
      const cardHeight = 130;
      const x = (width - cardWidth) / 2;
      // Sits high rather than centred so it never covers the thing you steer —
      // every game parks its player around the middle of the canvas.
      const y = height * 0.13;

      ctx.fillStyle = theme.panel;
      roundedRect(x, y, cardWidth, cardHeight, 16);
      ctx.fill();
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = theme.title;
      ctx.font = '700 25px Outfit, sans-serif';
      ctx.fillText(state.phase === 'over' ? 'Game over' : 'Ready?', width / 2, y + 44);
      ctx.fillStyle = theme.body;
      ctx.font = '500 16px Outfit, sans-serif';
      ctx.fillText(
        state.phase === 'over' ? `Score: ${state.score} · go again to retry` : 'Use your controller, keys, or tap',
        width / 2,
        y + 80,
      );
      if (state.phase === 'ready') ctx.fillText(hint, width / 2, y + 106);
    }

    return { roundedRect, drawScore, drawOverlay };
  }

  function resize() {
    if (!current) return;
    const { width, height } = current.game.rules;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    ui.canvas.width = width * scale;
    ui.canvas.height = height * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // --- UI sync --------------------------------------------------------------
  function primaryControl() {
    return current.game.controls.find((control) => control.primary) ?? current.game.controls[0];
  }

  function readyHint() {
    const control = primaryControl();
    const key = keyLabel(control.keys?.[0] ?? '');
    const verb = control.kind === 'hold' ? 'Hold' : 'Press';
    return `${verb} ${key} or wire up your controller.`;
  }

  function syncUi() {
    const { state } = current.engine;
    ui.score.textContent = String(state.score);
    ui.best.textContent = String(state.best);
    if (state.phase === 'ready') {
      ui.status.textContent = `Ready — ${readyHint()}`;
    } else if (state.phase === 'playing') {
      ui.status.textContent = `Playing — score ${state.score}.`;
    } else {
      ui.status.textContent = `Game over — score ${state.score}. Go again to retry.`;
    }
  }

  // One choice out of four, and picking it rewrites the controls listed under
  // it — so it reads as the heading of that list rather than a gallery of cards
  // competing with the board for attention.
  function renderPicker() {
    ui.picker.replaceChildren();
    for (const game of GAMES) {
      const option = document.createElement('option');
      option.value = game.id;
      option.textContent = `${game.emoji}  ${game.label} · ${game.scheme}`;
      option.selected = game.id === current?.game.id;
      ui.picker.appendChild(option);
    }
  }

  function renderControls() {
    ui.buttons.replaceChildren();
    for (const control of current.game.controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn game-action';
      button.dataset.control = control.id;
      button.dataset.kind = control.kind;
      button.textContent = control.label;
      ui.buttons.appendChild(button);
    }
  }

  // --- Input ----------------------------------------------------------------
  const held = new Set();

  function releaseAll() {
    for (const id of held) current?.engine.hold(id, false);
    held.clear();
  }

  function activate(control, phase) {
    if (!current || ui.panel.hidden) return;
    if (control.kind === 'hold') {
      if (phase === 'down' && !held.has(control.id)) {
        held.add(control.id);
        current.engine.hold(control.id, true);
      } else if (phase === 'up' && held.delete(control.id)) {
        current.engine.hold(control.id, false);
      }
      return;
    }
    if (phase === 'down') current.engine.press(control.id);
  }

  function controlForKey(code) {
    return current?.game.controls.find((control) => control.keys?.includes(code)) ?? null;
  }

  function controlById(id) {
    return current?.game.controls.find((control) => control.id === id) ?? null;
  }

  document.addEventListener('keydown', (event) => {
    if (ui.panel.hidden || event.repeat) return;
    const control = controlForKey(event.code);
    const hasNativeKeyboardAction = event.target.closest?.(
      'button, a, input, select, textarea, [contenteditable="true"]',
    );
    if (!control || hasNativeKeyboardAction) return;
    event.preventDefault();
    activate(control, 'down');
  });
  document.addEventListener('keyup', (event) => {
    const control = controlForKey(event.code);
    if (control) activate(control, 'up');
  });
  window.addEventListener('blur', releaseAll);

  ui.buttons.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.game-action');
    if (!button) return;
    const control = controlById(button.dataset.control);
    if (!control) return;
    if (control.kind === 'hold') event.preventDefault();
    activate(control, 'down');
  });
  ui.buttons.addEventListener('pointerup', (event) => {
    const control = controlById(event.target.closest('.game-action')?.dataset.control);
    if (control) activate(control, 'up');
  });
  ui.buttons.addEventListener('pointerleave', releaseAll);
  ui.buttons.addEventListener('pointercancel', releaseAll);

  ui.canvas.addEventListener('pointerdown', (event) => {
    ui.canvas.focus();
    event.preventDefault();
    activate(primaryControl(), 'down');
  });
  ui.canvas.addEventListener('pointerup', () => activate(primaryControl(), 'up'));
  ui.canvas.addEventListener('pointerleave', releaseAll);

  ui.reset.addEventListener('click', () => {
    releaseAll();
    current.engine.reset();
  });

  ui.picker.addEventListener('change', (event) => selectGame(event.target.value));

  window.addEventListener('resize', resize);

  // --- Game switching -------------------------------------------------------
  function selectGame(id, { persist = true } = {}) {
    const game = findGame(id);
    if (!game || game.id === current?.game.id) return;

    releaseAll();
    unsubscribe?.();

    const engine = game.createEngine();
    current = { game, engine, render: game.createRenderer(ctx, makeHelpers(game.rules)) };
    unsubscribe = engine.subscribe(syncUi);

    ui.canvas.setAttribute('aria-label', `Sidescroller. ${game.scheme} controls — ${game.label}.`);
    ui.tagline.textContent = game.tagline;
    ui.scheme.textContent = game.scheme;
    renderPicker();
    renderControls();
    resize();
    syncUi();

    if (persist) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, game.id);
      } catch {
        // Persistence may be blocked; the picker still works for this session.
      }
    }
    gameChangeListeners.forEach((listener) => listener(game));
  }

  let wasVisible = false;

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.035);
    lastFrame = now;
    const visible = Boolean(current) && !ui.panel.hidden;
    if (visible) {
      // Wiring on the Config tab drives this same engine, so testing a wire can
      // wake a round up with nobody watching. Arriving at the game hands the
      // player a fresh one rather than whatever was left mid-air.
      if (!wasVisible) {
        releaseAll();
        current.engine.reset();
      }
      current.engine.update(dt);
      ctx.clearRect(0, 0, current.game.rules.width, current.game.rules.height);
      current.render(current.engine.state, now);
    }
    wasVisible = visible;
    requestAnimationFrame(frame);
  }

  let saved = null;
  try {
    saved = globalThis.localStorage?.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  selectGame(findGame(saved) ? saved : DEFAULT_GAME_ID, { persist: false });
  requestAnimationFrame(frame);

  return {
    // The control surface the wiring engine drives — deliberately generic, so
    // whichever game is loaded receives the same three calls.
    actions: {
      setValue: (node, port, value) => current?.engine.setValue(node, port, value),
      fire: (node, port) => current?.engine.fire(node, port),
      setWiredPorts: (ports) => current?.engine.setWiredPorts(ports),
      setControlOptions: (node, port, options) =>
        current?.engine.setControlOptions?.(node, port, options),
    },
    activeGame: () => current?.game ?? null,
    selectGame,
    onGameChange(listener) {
      gameChangeListeners.add(listener);
      return () => gameChangeListeners.delete(listener);
    },
  };
}
