// Minimal Flappy Bird-style gameplay. Raw controller interpretation lives in
// the wiring engine; this module exposes a small normalized game-action API.

import { createGameRenderer } from './game-renderer.js';

const RULES = Object.freeze({
  width: 480,
  height: 600,
  groundY: 530,
  birdX: 130,
  birdRadius: 16,
  pipeWidth: 66,
  pipeGap: 168,
  pipeSpacing: 240,
  firstPipeDelay: 1.2,
  pipeMargin: 70,
  gravityMin: 500,
  gravityMax: 2000,
  flapMin: 220,
  flapMax: 520,
  pipeSpeedMin: 70,
  pipeSpeedMax: 220,
});

const DEFAULT_CONTROLS = Object.freeze({
  magnitude: 0.57,
  gravity: 0.5,
  speed: 0.5,
  position: 0.5,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const lerp = (min, max, value) => min + (max - min) * clamp01(value);

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

  const controls = { ...DEFAULT_CONTROLS, positionEnabled: false };
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
    if (controls.positionEnabled) game.bird.y = positionY(controls.position);
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

  function flap({ magnitude = DEFAULT_CONTROLS.magnitude } = {}) {
    if (ui.panel.hidden) return;
    if (game.phase === 'over') reset();
    if (game.phase === 'ready') start();
    if (!controls.positionEnabled) {
      game.bird.velocity = -lerp(RULES.flapMin, RULES.flapMax, magnitude);
    }
  }

  function restartGame() {
    if (ui.panel.hidden) return;
    reset();
    start();
  }

  function positionY(value) {
    const margin = RULES.birdRadius + 2;
    return margin + clamp01(value) * (RULES.groundY - margin * 2);
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
    if (controls.positionEnabled) {
      const blend = 1 - Math.exp(-dt * 14);
      game.bird.y += (positionY(controls.position) - game.bird.y) * blend;
      game.bird.velocity = 0;
    } else {
      game.bird.velocity += lerp(RULES.gravityMin, RULES.gravityMax, controls.gravity) * dt;
      game.bird.y += game.bird.velocity * dt;
    }

    const pipeSpeed = lerp(RULES.pipeSpeedMin, RULES.pipeSpeedMax, controls.speed);
    game.nextPipeIn -= dt;
    if (game.nextPipeIn <= 0) {
      game.nextPipeIn += RULES.pipeSpacing / pipeSpeed;
      spawnPipe();
    }

    let collided = false;
    for (const pipe of game.pipes) {
      pipe.x -= pipeSpeed * dt;
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

  return {
    flap,
    restartGame,
    setGameSpeed(value) {
      controls.speed = clamp01(value);
    },
    setGravity(value) {
      controls.gravity = clamp01(value);
    },
    setPosition(value) {
      controls.position = clamp01(value);
    },
    setPositionEnabled(enabled) {
      controls.positionEnabled = Boolean(enabled);
      game.bird.velocity = 0;
      if (controls.positionEnabled) game.bird.y = positionY(controls.position);
    },
  };
}
