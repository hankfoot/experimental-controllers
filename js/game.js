// DOM adapter for the testable game engine. Controller interpretation stays in
// the wiring engine; this module handles only browser input and rendering.

import { GAME_RULES, GameEngine } from './game-engine.js';
import { createGameRenderer } from './game-renderer.js';

export function initGame() {
  const byId = (id) => document.getElementById(id);
  const ui = {
    canvas: byId('game-canvas'),
    panel: byId('panel-game'),
    flap: byId('game-flap'),
    reset: byId('game-reset'),
    score: byId('game-score'),
    best: byId('game-best'),
    status: byId('game-status'),
  };
  if (Object.values(ui).some((element) => !element)) return null;

  const renderer = createGameRenderer(ui.canvas, GAME_RULES);
  if (!renderer) return null;

  const game = new GameEngine();
  let lastFrame = performance.now();

  function syncUi() {
    ui.score.textContent = String(game.state.score);
    ui.best.textContent = String(game.state.best);
    if (game.state.phase === 'ready') {
      ui.status.textContent = 'Ready — press Space, tap the game, or trigger your controller.';
    } else if (game.state.phase === 'playing') {
      ui.status.textContent = 'Playing — keep the bird in the air.';
    } else {
      ui.status.textContent = `Game over — score ${game.state.score}. Flap to try again.`;
    }
  }

  function flap(options) {
    if (!ui.panel.hidden) game.flap(options);
  }

  function restartGame() {
    if (!ui.panel.hidden) game.restartGame();
  }

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.035);
    lastFrame = now;
    if (!ui.panel.hidden) {
      game.update(dt);
      renderer.render(game.state, now);
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', (event) => {
    const isFlapKey = event.code === 'Space' || event.code === 'ArrowUp';
    const hasNativeKeyboardAction = event.target.closest?.(
      'button, a, input, select, textarea, [contenteditable="true"]',
    );
    if (ui.panel.hidden || !isFlapKey || event.repeat || hasNativeKeyboardAction) return;
    event.preventDefault();
    flap();
  });
  ui.canvas.addEventListener('pointerdown', () => {
    ui.canvas.focus();
    flap();
  });
  ui.flap.addEventListener('click', () => flap());
  ui.reset.addEventListener('click', () => game.reset());
  window.addEventListener('resize', renderer.resize);
  game.subscribe(syncUi);

  renderer.resize();
  syncUi();
  requestAnimationFrame(frame);

  return {
    flap,
    restartGame,
    setGameSpeed: (value) => game.setGameSpeed(value),
    setGravity: (value) => game.setGravity(value),
    setPosition: (value) => game.setPosition(value),
    setPositionEnabled: (enabled) => game.setPositionEnabled(enabled),
  };
}
