import assert from 'node:assert/strict';
import test from 'node:test';

import { GAMES } from '../js/games/index.js';
import { RULES, SidescrollerGame, stepY, trackY } from '../js/games/sidescroller.js';

const frame = 1 / 60;
const run = (game, frames) => {
  for (let i = 0; i < frames; i += 1) game.update(frame);
};
// A scheme's engine, built the way the registry builds it.
const engineFor = (id, random = () => 0.5) => {
  const entry = GAMES.find((game) => game.id === id);
  return entry.createEngine(random);
};

// --- Registry ---------------------------------------------------------------

test('every scheme exposes only the ports its own control scheme uses', () => {
  const ports = Object.fromEntries(GAMES.map((game) => [
    game.id,
    game.targets.flatMap((target) => target.ports.map((port) => `${target.id}.${port.id}`)),
  ]));

  assert.deepEqual(ports, {
    flappy: ['flap.trigger'],
    helicopter: ['lift.thrust'],
    lanes: ['lane.up', 'lane.down'],
    pong: ['paddle.y'],
  });
});

test('every scheme declares a primary manual control with a key binding', () => {
  for (const game of GAMES) {
    const primary = game.controls.find((control) => control.primary);
    assert.ok(primary, `${game.id} has no primary control`);
    assert.ok(primary.keys?.length, `${game.id} primary control has no keys`);
  }
});

test('every scheme drives the same game over the same rules', () => {
  for (const game of GAMES) {
    assert.equal(game.rules, RULES);
    assert.ok(game.createEngine() instanceof SidescrollerGame, `${game.id} is not the sidescroller`);
  }
});

// --- Shared world -----------------------------------------------------------

test('clearing a gate scores exactly once', () => {
  const game = engineFor('flappy');
  game.restart();
  game.state.distanceUntilGate = Infinity; // isolate the gate under test
  game.state.gates = [{ x: 65, gapY: game.state.player.y, scored: false }];

  run(game, 1);
  assert.equal(game.state.score, 1);
  run(game, 1);
  assert.equal(game.state.score, 1);
});

test('flying into a gate ends the round under every scheme', () => {
  for (const { id } of GAMES) {
    const game = engineFor(id);
    game.restart();
    game.state.distanceUntilGate = Infinity;
    // A gap at the very top of the field, with the craft parked at the bottom.
    game.state.gates = [{ x: RULES.playerX, gapY: RULES.gateGap / 2, scored: false }];
    game.state.player.y = RULES.groundY - RULES.playerRadius - 1;

    run(game, 1);
    assert.equal(game.state.phase, 'over', `${id} flew straight through a gate`);
  }
});

test('the world speeds up with the score but stops at its ceiling', () => {
  const game = engineFor('flappy');
  game.restart();
  assert.equal(game.speed(), RULES.speedStart);

  game.state.score = 10;
  assert.ok(game.speed() > RULES.speedStart, 'scoring should speed the world up');

  game.state.score = 10_000;
  assert.equal(game.speed(), RULES.speedMax);
});

// --- Single trigger (impulse) -----------------------------------------------

test('a trigger starts the round and pushes the craft upward', () => {
  const game = engineFor('flappy');
  game.fire('flap', 'trigger');

  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.player.velocity, -RULES.riseVelocity);

  run(game, 1);
  assert.ok(game.state.player.velocity > -RULES.riseVelocity, 'gravity should bleed off the rise');
});

test('touching the ground ends the round', () => {
  const game = engineFor('flappy');
  game.restart();
  game.state.player.y = RULES.groundY - RULES.playerRadius - 1;

  run(game, 2);
  assert.equal(game.state.phase, 'over');
});

// --- Held trigger (thrust) --------------------------------------------------

test('thrust climbs while held and falls once released', () => {
  const game = engineFor('helicopter');
  game.setWiredPorts(['lift.thrust']);
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'playing');

  run(game, 10);
  assert.ok(game.state.player.velocity < 0, 'held thrust should climb');

  game.setValue('lift', 'thrust', 0);
  run(game, 20);
  assert.ok(game.state.player.velocity > 0, 'releasing should fall');
});

test('a wire parked at full thrust cannot instantly restart after a crash', () => {
  const game = engineFor('helicopter');
  game.setWiredPorts(['lift.thrust']);
  game.setValue('lift', 'thrust', 1);
  game.state.player.y = 5; // fly into the ceiling
  run(game, 2);
  assert.equal(game.state.phase, 'over');

  // Still held — the round must stay over until the input actually releases.
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'over');

  game.setValue('lift', 'thrust', 0);
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'playing');
});

// --- Two buttons (step) -----------------------------------------------------

test('the first press starts the round without moving the craft', () => {
  const game = engineFor('lanes');
  const start = game.state.player.step;
  game.fire('lane', 'up');

  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.player.step, start);

  game.fire('lane', 'up');
  assert.equal(game.state.player.step, start - 1);
});

test('steps clamp at the top and bottom of the field', () => {
  const game = engineFor('lanes');
  game.restart();
  for (let i = 0; i < 5; i += 1) game.fire('lane', 'up');
  assert.equal(game.state.player.step, 0);

  for (let i = 0; i < 9; i += 1) game.fire('lane', 'down');
  assert.equal(game.state.player.step, RULES.stepCount - 1);
});

test('a stepped round only ever spawns gaps a step can reach', () => {
  let roll = 0;
  const game = engineFor('lanes', () => {
    roll += 0.37;
    return roll % 1;
  });
  game.restart();

  const reachable = new Set(
    Array.from({ length: RULES.stepCount }, (unused, step) => stepY(step)),
  );
  for (let i = 0; i < 60; i += 1) {
    game.state.gates = [];
    game.spawnGate(500);
    assert.ok(reachable.has(game.state.gates[0].gapY), 'gap was off the steps');
  }
});

test('the craft is judged where it is drawn, not where it is heading', () => {
  const game = engineFor('lanes');
  game.restart();
  game.state.player.step = 0;
  game.state.player.y = stepY(2); // mid-move, still visually at the bottom

  const gate = (step) => ({ x: RULES.playerX, gapY: stepY(step), scored: false });
  assert.equal(game.hitsGate(gate(2)), false, 'the gap it is drawn in should be clear');
  assert.equal(game.hitsGate(gate(0)), true, 'the gap it is heading for should hit');
});

// --- Analog (track) ---------------------------------------------------------

test('the craft tracks the analog value', () => {
  const game = engineFor('pong');
  game.setWiredPorts(['paddle.y']);
  game.setValue('paddle', 'y', 1);

  run(game, 90);
  assert.ok(Math.abs(game.state.player.y - trackY(1)) < 1);
});

test('a parked dial does not start the round but moving it does', () => {
  const game = engineFor('pong');
  game.setWiredPorts(['paddle.y']);

  game.setValue('paddle', 'y', 0.4);
  game.setValue('paddle', 'y', 0.42);
  assert.equal(game.state.phase, 'ready');

  game.setValue('paddle', 'y', 0.8);
  assert.equal(game.state.phase, 'playing');
});

test('a steered craft cannot fly off the field', () => {
  const game = engineFor('pong');
  game.setWiredPorts(['paddle.y']);
  game.setValue('paddle', 'y', 0.5); // arms the wiggle-to-start gesture
  game.setValue('paddle', 'y', 1);
  game.state.distanceUntilGate = Infinity;

  run(game, 120);
  assert.equal(game.state.phase, 'playing');
  assert.ok(game.state.player.y + RULES.playerRadius <= RULES.groundY);
});
