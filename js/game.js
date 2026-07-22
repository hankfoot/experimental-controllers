// Minimal Flappy Bird-style gameplay. Rendering and controller interpretation
// are kept separate so this module only coordinates state, physics, and UI.

import { onInput } from './bus.js';
import { createControllerFlapDetector } from './game-input.js';
import { createGameRenderer } from './game-renderer.js';

const RULES = Object.freeze({
  width: 480,
  height: 600,
  groundY: 530,
  birdX: 130,
  birdRadius: 16,
  gravity: 1250,
  flapVelocity: -390,
  pipeSpeed: 145,
  pipeWidth: 66,
  pipeGap: 168,
  pipeInterval: 1.65,
  firstPipeDelay: 1.2,
  pipeMargin: 70,
});

function newRound(best = 0) {
  return {
    phase: 'ready',
    bird: { y: RULES.height * 0.43, velocity: 0 },
    pipes: [],
    nextPipeIn: RULES.firstPipeDelay,
    score: 0,
    best,
  };
}

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
  if (Object.values(ui).some((element) => !element)) return;

  const renderer = createGameRenderer(ui.canvas, RULES);
  if (!renderer) return;

  const detectControllerFlap = createControllerFlapDetector();
  let game = newRound();
  let lastFrame = performance.now();

  function setStatus(message) {
    ui.status.textContent = message;
  }

  function syncScore() {
    ui.score.textContent = String(game.score);
    ui.best.textContent = String(game.best);
  }

  function reset() {
    game = newRound(game.best);
    syncScore();
    setStatus('Ready — press Space, tap the game, or trigger your controller.');
  }

  function start() {
    game.phase = 'playing';
    setStatus('Playing — keep the bird in the air.');
  }

  function end() {
    if (game.phase !== 'playing') return;
    game.phase = 'over';
    setStatus(`Game over — score ${game.score}. Flap to try again.`);
  }

  function flap(source = '') {
    if (ui.panel.hidden) return;
    if (game.phase === 'over') reset();
    if (game.phase === 'ready') start();
    game.bird.velocity = RULES.flapVelocity;
    if (source) setStatus(`Playing — flap received from ${source}.`);
  }

  function spawnPipe() {
    const margin = RULES.pipeGap / 2 + RULES.pipeMargin;
    game.pipes.push({
      x: RULES.width + 20,
      gapY: margin + Math.random() * (RULES.groundY - margin * 2),
      scored: false,
    });
  }

  function hitsPipe(pipe) {
    const overlapsX = RULES.birdX + RULES.birdRadius > pipe.x
      && RULES.birdX - RULES.birdRadius < pipe.x + RULES.pipeWidth;
    if (!overlapsX) return false;

    const gapTop = pipe.gapY - RULES.pipeGap / 2;
    const gapBottom = pipe.gapY + RULES.pipeGap / 2;
    return game.bird.y - RULES.birdRadius < gapTop
      || game.bird.y + RULES.birdRadius > gapBottom;
  }

  function update(dt) {
    game.bird.velocity += RULES.gravity * dt;
    game.bird.y += game.bird.velocity * dt;

    game.nextPipeIn -= dt;
    if (game.nextPipeIn <= 0) {
      game.nextPipeIn += RULES.pipeInterval;
      spawnPipe();
    }

    let collided = false;
    for (const pipe of game.pipes) {
      pipe.x -= RULES.pipeSpeed * dt;
      if (!pipe.scored && pipe.x + RULES.pipeWidth < RULES.birdX) {
        pipe.scored = true;
        game.score += 1;
        game.best = Math.max(game.best, game.score);
        syncScore();
      }
      collided ||= hitsPipe(pipe);
    }
    game.pipes = game.pipes.filter((pipe) => pipe.x + RULES.pipeWidth > -10);

    const outsidePlayfield = game.bird.y - RULES.birdRadius <= 0
      || game.bird.y + RULES.birdRadius >= RULES.groundY;
    if (collided || outsidePlayfield) end();
  }

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.035);
    lastFrame = now;
    if (!ui.panel.hidden) {
      if (game.phase === 'playing') update(dt);
      renderer.render(game, now);
    }
    requestAnimationFrame(frame);
  }

  onInput((message) => {
    const source = detectControllerFlap(message);
    if (source) flap(source);
  });

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
  ui.reset.addEventListener('click', reset);
  window.addEventListener('resize', renderer.resize);

  renderer.resize();
  reset();
  requestAnimationFrame(frame);
}
