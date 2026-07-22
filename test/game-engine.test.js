import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_RULES, GameEngine } from '../js/game-engine.js';

function advanceUntil(engine, condition) {
  for (let frame = 0; frame < 2000 && !condition(); frame += 1) engine.update(1 / 60);
  assert.equal(condition(), true);
}

test('pipe spacing stays constant when speed changes between spawns', () => {
  const engine = new GameEngine(() => 0.5);
  engine.setPositionEnabled(true);
  engine.setGameSpeed(1);
  engine.restartGame();
  advanceUntil(engine, () => engine.state.pipes.length === 1);

  engine.setGameSpeed(0);
  advanceUntil(engine, () => engine.state.pipes.length === 2);

  const [first, second] = engine.state.pipes;
  assert.ok(Math.abs(second.x - first.x - GAME_RULES.pipeSpacing) < 1e-8);
});

test('unchanged position mode preserves flap velocity', () => {
  const engine = new GameEngine();
  engine.flap({ magnitude: 1 });
  assert.equal(engine.state.bird.velocity, -GAME_RULES.flapMax);
  engine.setPositionEnabled(false);
  assert.equal(engine.state.bird.velocity, -GAME_RULES.flapMax);
});
