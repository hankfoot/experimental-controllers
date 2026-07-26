import assert from 'node:assert/strict';
import test from 'node:test';

import { GAMES } from '../js/games/index.js';
import {
  RULES,
  SidescrollerGame,
  gateBars,
  sharedTargets,
  trackY,
} from '../js/games/sidescroller.js';

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

const portsOf = (game) =>
  game.targets.flatMap((target) => target.ports.map((port) => `${target.id}.${port.id}`));

test('every scheme exposes only the ports its own control scheme uses', () => {
  const ports = Object.fromEntries(GAMES.map((game) => {
    const shared = new Set(sharedTargets(game.motion).map((target) => target.id));
    return [game.id, portsOf(game).filter((port) => !shared.has(port.split('.')[0]))];
  }));

  assert.deepEqual(ports, {
    flappy: ['flap.trigger'],
    helicopter: ['lift.thrust', 'lift.sink'],
    pong: ['paddle.y'],
  });
});

test('every scheme carries the same extras and course settings', () => {
  for (const game of GAMES) {
    const ports = portsOf(game);
    for (const shared of ['assist.restart', 'assist.brake', 'world.obstacles', 'world.pace']) {
      assert.ok(ports.includes(shared), `${game.id} is missing ${shared}`);
    }
  }
});

test('only the schemes that fall have a weight to set', () => {
  for (const game of GAMES) {
    assert.equal(
      portsOf(game).includes('world.weight'),
      game.motion !== 'track',
      `${game.id} disagrees about whether it falls`,
    );
  }
});

test('a setting is a port with no connector, so nothing can be wired into it', () => {
  const settings = GAMES.flatMap((game) => game.targets
    .flatMap((target) => target.ports.filter((port) => port.type === 'setting')));

  assert.ok(settings.length, 'no settings to check');
  for (const port of settings) {
    assert.ok(port.options?.length, `${port.id} is a setting with nothing to set`);
    assert.equal(port.defaultValue, undefined, `${port.id} carries a value it can never be sent`);
  }
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

// --- Held inputs (thrust) ---------------------------------------------------

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

test('a held descend sinks faster than gravity alone', () => {
  const fall = (sinking) => {
    const game = engineFor('helicopter');
    game.setWiredPorts(['lift.thrust', 'lift.sink']);
    game.setValue('lift', 'thrust', 1); // start the round
    game.setValue('lift', 'thrust', 0);
    if (sinking) game.setValue('lift', 'sink', 1);
    run(game, 15);
    return game.state.player.velocity;
  };

  assert.ok(fall(true) > fall(false), 'holding descend should add to gravity');
});

test('with gravity off the craft holds its height until something is held', () => {
  const game = engineFor('helicopter');
  game.setControlOptions('lift', 'thrust', { lift: 'normal', sink: 'hold' });
  game.setWiredPorts(['lift.thrust', 'lift.sink']);

  game.setValue('lift', 'thrust', 1);
  run(game, 10);
  assert.ok(game.state.player.velocity < 0, 'held climb should still climb');

  game.setValue('lift', 'thrust', 0);
  run(game, 60);
  assert.ok(Math.abs(game.state.player.velocity) < 1, 'letting go should come to a stop');
  const parked = game.state.player.y;

  run(game, 60);
  assert.ok(Math.abs(game.state.player.y - parked) < 1, 'a weightless craft should not drift');
});

test('with gravity off the second input is what brings the craft down', () => {
  const game = engineFor('helicopter');
  game.setControlOptions('lift', 'thrust', { lift: 'normal', sink: 'hold' });
  game.setWiredPorts(['lift.thrust', 'lift.sink']);

  game.setValue('lift', 'sink', 1);
  assert.equal(game.state.phase, 'playing', 'descend alone should start the round');
  const start = game.state.player.y;

  run(game, 20);
  assert.ok(game.state.player.y > start, 'holding descend should push the craft down');
});

test('the manual keys still drive whichever held port is not wired', () => {
  const game = engineFor('helicopter');
  game.setWiredPorts(['lift.thrust']); // climb is on a wire, descend is not

  game.hold('sink', true);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.player.sinking, true);

  // The wired one ignores the keyboard, so its wire stays in charge.
  game.hold('thrust', true);
  assert.equal(game.state.player.thrusting, false);
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

// --- Extras: restart and brake ----------------------------------------------

test('a wired restart puts the round back to the start', () => {
  const game = engineFor('flappy');
  game.restart();
  game.state.score = 5;

  game.fire('assist', 'restart');
  assert.equal(game.state.phase, 'ready');
  assert.equal(game.state.score, 0);
});

test('a restart can be set to answer only after a crash', () => {
  const game = engineFor('flappy');
  game.setControlOptions('assist', 'restart', { when: 'over' });
  game.restart();

  game.fire('assist', 'restart');
  assert.equal(game.state.phase, 'playing', 'mid-round it should do nothing');

  game.end();
  game.fire('assist', 'restart');
  assert.equal(game.state.phase, 'ready');
});

test('the brake slows the world while it is held', () => {
  const game = engineFor('flappy');
  game.restart();
  const full = game.speed();
  game.setWiredPorts(['assist.brake']);

  game.setValue('assist', 'brake', 1);
  assert.ok(game.speed() < full, 'a held brake should slow the world');

  game.setValue('assist', 'brake', 0);
  assert.equal(game.speed(), full);
});

test('the brake never starts a round by itself', () => {
  const game = engineFor('flappy');
  game.setWiredPorts(['assist.brake']);

  game.setValue('assist', 'brake', 1);
  assert.equal(game.state.phase, 'ready');
});

test('the brake key stands in until the port is wired', () => {
  const game = engineFor('flappy');
  game.restart();
  const full = game.speed();

  game.hold('brake', true);
  assert.ok(game.speed() < full, 'the key should brake while nothing is wired');

  game.hold('brake', false);
  game.setWiredPorts(['assist.brake']);
  game.hold('brake', true);
  assert.equal(game.speed(), full, 'a wired brake ignores the key');
});

// --- The course -------------------------------------------------------------

// The stretches of open field an obstacle leaves, top to bottom.
const freeRuns = (gate) => {
  const runs = [];
  let cursor = 0;
  for (const bar of gateBars(gate).sort((a, b) => a.top - b.top)) {
    runs.push(bar.top - cursor);
    cursor = Math.max(cursor, bar.bottom);
  }
  runs.push(RULES.groundY - cursor);
  return runs;
};

test('every obstacle shape leaves a way past it, at every gap setting', () => {
  for (const shape of ['columns', 'floating', 'ceiling', 'slalom']) {
    for (const gap of ['tight', 'normal', 'roomy']) {
      for (const at of [0, 0.25, 0.5, 0.75, 1]) {
        const game = engineFor('flappy', () => at);
        game.setControlOptions('world', 'obstacles', { shape, gap, spacing: 'normal' });
        game.restart();
        game.spawnGate(RULES.width);
        game.spawnGate(RULES.width); // the slalom's other half

        for (const gate of game.state.gates) {
          const widest = Math.max(...freeRuns(gate));
          assert.ok(
            widest >= gate.gap * 0.6 - 1,
            `${shape} at ${gap}/${at} left only ${Math.round(widest)}px to fly through`,
          );
        }
      }
    }
  }
});

test('the slalom alternates the side its bars come from', () => {
  const game = engineFor('flappy');
  game.setControlOptions('world', 'obstacles', { shape: 'slalom', gap: 'normal', spacing: 'normal' });
  game.restart();
  game.spawnGate(RULES.width);
  game.spawnGate(RULES.width);
  game.spawnGate(RULES.width);

  assert.deepEqual(game.state.gates.map((gate) => gate.kind), ['ceiling', 'floor', 'ceiling']);
});

test('a floating block leaves both the ceiling and the floor open', () => {
  const game = engineFor('flappy');
  game.setControlOptions('world', 'obstacles', { shape: 'floating', gap: 'normal', spacing: 'normal' });
  game.restart();
  game.spawnGate(RULES.width);

  const [gate] = game.state.gates;
  assert.equal(gateBars(gate).length, 1);
  for (const run of freeRuns(gate)) assert.ok(run > RULES.playerRadius * 2, 'both ways past must fit');
});

test('the course settings change the room, the spacing and the pace', () => {
  const game = engineFor('flappy');
  const fair = game.gapSize();

  game.setControlOptions('world', 'obstacles', { shape: 'columns', gap: 'tight', spacing: 'normal' });
  assert.ok(game.gapSize() < fair, 'a tight squeeze should be tighter');

  game.setControlOptions('world', 'obstacles', { shape: 'columns', gap: 'roomy', spacing: 'wide' });
  assert.ok(game.gapSize() > fair);
  assert.ok(game.spacing() > RULES.gateSpacing);

  game.setControlOptions('world', 'pace', { speed: 'quick', ramp: 'gentle' });
  assert.ok(game.speed() > RULES.speedStart, 'a quick world starts faster');
});

test('with no ramp the world never speeds up, however high the score', () => {
  const game = engineFor('flappy');
  game.setControlOptions('world', 'pace', { speed: 'normal', ramp: 'none' });
  game.state.score = 500;

  assert.equal(game.speed(), RULES.speedStart);
});

test('a heavier craft falls faster, a floaty one slower', () => {
  const fall = (gravity) => {
    const game = engineFor('flappy');
    game.setControlOptions('world', 'weight', { gravity });
    game.restart();
    run(game, 10);
    return game.state.player.velocity;
  };

  assert.ok(fall('heavy') > fall('normal'));
  assert.ok(fall('floaty') < fall('normal'));
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
