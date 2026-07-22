import { expect, it } from 'vitest';
import { GAME_RULES, GameEngine } from '../src/game/gameEngine';

function advanceUntil(engine: GameEngine, condition: () => boolean): void {
  for (let frame = 0; frame < 2000 && !condition(); frame += 1) engine.update(1 / 60);
  expect(condition()).toBe(true);
}

it('keeps pipe spacing constant when speed changes between spawns', () => {
  const engine = new GameEngine(() => 0.5);
  engine.setPositionEnabled(true);
  engine.setGameSpeed(1);
  engine.restartGame();
  advanceUntil(engine, () => engine.state.pipes.length === 1);

  engine.setGameSpeed(0);
  advanceUntil(engine, () => engine.state.pipes.length === 2);

  const [first, second] = engine.state.pipes;
  expect(second.x - first.x).toBeCloseTo(GAME_RULES.pipeSpacing, 5);
});

it('preserves flap velocity when position mode is already disabled', () => {
  const engine = new GameEngine();
  engine.flap({ magnitude: 1 });
  expect(engine.state.bird.velocity).toBe(-GAME_RULES.flapMax);
  engine.setPositionEnabled(false);
  expect(engine.state.bird.velocity).toBe(-GAME_RULES.flapMax);
});
