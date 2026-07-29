import assert from 'node:assert/strict';
import test from 'node:test';

import { GAMES } from '../js/games/index.js';
import {
  FALLS,
  RULES,
  SidescrollerGame,
  courseFrom,
  createRenderer,
  gateBars,
  gateSpan,
  sharedTargets,
  trackY,
  wholeTiles,
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
const settingsOf = (game) =>
  game.settings.flatMap((group) => group.ports.map((port) => `${group.id}.${port.id}`));

test('every scheme exposes only the ports its own control scheme uses', () => {
  const ports = Object.fromEntries(GAMES.map((game) => {
    const shared = new Set(sharedTargets(game.motion).map((target) => target.id));
    return [game.id, portsOf(game).filter((port) => !shared.has(port.split('.')[0]))];
  }));

  assert.deepEqual(ports, {
    flappy: ['flap.trigger'],
    jetpack: ['lift.thrust'],
    spaceship: ['slide.up', 'slide.down'],
    brickbreaker: ['paddle.y'],
  });
});

test('every scheme carries the same extras and course settings', () => {
  for (const game of GAMES) {
    assert.ok(portsOf(game).includes('ui.advance'), `${game.id} is missing ui.advance`);
    const settings = settingsOf(game);
    for (const setting of ['speed.pace', 'world.obstacles']) {
      assert.ok(settings.includes(setting), `${game.id} is missing ${setting}`);
    }
    // The pace is a setting and the modifiers are controls: one is what the
    // course is like, the other is something your object does to it. Neither
    // should turn up on the other's screen.
    assert.ok(
      !portsOf(game).some((port) => port.startsWith('speed.')),
      `${game.id} puts the pace setting back on the wiring board`,
    );
    for (const jack of ['shift.hold', 'shift.level']) {
      assert.ok(portsOf(game).includes(jack), `${game.id} is missing ${jack}`);
    }
    assert.ok(
      !settings.some((setting) => setting.startsWith('shift.')),
      `${game.id} puts a modifier on the Design screen`,
    );
  }
});

// Speed reads first on the Design screen, ahead of what you are flying through.
test('the pace is the first thing the Design screen has to say', () => {
  for (const game of GAMES) {
    assert.equal(game.settings[0].id, 'speed', `${game.id} buries the pace`);
  }
});

// Every scheme names the controls that have to be wired before a controller can
// fly the craft, so the Game screen can say which one is still empty.
test('every scheme names the controls a controller has to reach', () => {
  const steering = Object.fromEntries(GAMES.map((game) =>
    [game.id, game.steering.flatMap((control) => control.keys)]));

  assert.deepEqual(steering, {
    flappy: ['flap.trigger'],
    jetpack: ['lift.thrust'],
    spaceship: ['slide.up', 'slide.down'],
    brickbreaker: ['paddle.y'],
  });

  for (const game of GAMES) {
    const ports = new Set(portsOf(game));
    for (const control of game.steering) {
      assert.ok(control.label, `${game.id} has an unnamed steering control`);
      for (const key of control.keys) {
        assert.ok(ports.has(key), `${game.id} steers with ${key}, which is not on its board`);
      }
    }
  }
});

// Weight belongs to the movement port rather than the course, so the schemes
// with nothing to fall under simply never offer it.
test('only the schemes that fall have a weight to set, and it sits on the movement port', () => {
  for (const game of GAMES) {
    const falls = game.targets.some((target) => target.ports.some((port) =>
      port.options?.some((option) => option.id === 'gravity')));
    assert.equal(falls, FALLS.has(game.motion), `${game.id} disagrees about whether it falls`);
    assert.ok(!settingsOf(game).includes('world.weight'), `${game.id} still sets weight as course`);
  }
});

// What the board rests on: every port it renders declares what it is, so a jack
// is drawn only where a cable can actually land. A `setting` says outright that
// nothing can reach it — it is on the board to be read beside the jack it shares
// a subject with, not to be patched into. The Customize groups are the other
// half of the split: settings only, and never carrying a connector.
test('every port declares whether it can be wired, on the board and off it', () => {
  const isSetting = (port, where) => {
    assert.ok(port.options?.length, `${where} is a setting with nothing to set`);
    assert.equal(port.defaultValue, undefined, `${where} carries a value it can never be sent`);
  };

  for (const game of GAMES) {
    assert.ok(game.settings.length, `${game.id} has no settings`);

    for (const group of game.settings) {
      for (const port of group.ports) {
        assert.equal(port.type, undefined, `${port.id} is a setting claiming a connector`);
        isSetting(port, port.id);
      }
    }

    for (const target of game.targets) {
      for (const port of target.ports) {
        assert.ok(port.type, `${target.id}.${port.id} is on the board with no connector`);
        if (port.type === 'setting') isSetting(port, `${target.id}.${port.id}`);
      }
    }
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

// --- Jetpack (thrust) -------------------------------------------------------

test('thrust climbs while held and falls once released', () => {
  const game = engineFor('jetpack');
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
  const game = crashedJetpack();
  // Past the card's own settling time, so this tests the latch and only the
  // latch — the two refusals are separate and both have to hold.
  game.now += 5000;

  // Still held — the round must stay over until the input actually releases.
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'over');

  game.setValue('lift', 'thrust', 0);
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'playing');
});

// The card carries the score and the record, and the input that crashed you is
// very often still being mashed on the frame it appears — so it refuses to be
// dismissed for a moment, or nobody ever sees what they got.
test('the game-over card cannot be skipped the instant it appears', () => {
  const game = crashedJetpack();

  game.setValue('lift', 'thrust', 0);
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'over', 'a fresh press is refused while it settles');

  game.now += 1000;
  game.setValue('lift', 'thrust', 0);
  game.setValue('lift', 'thrust', 1);
  assert.equal(game.state.phase, 'playing', 'and taken once it has been read');
});

// --- Invaders (slide) ------------------------------------------------------

test('a slide moves at a steady rate and stops dead when released', () => {
  const game = engineFor('spaceship');
  game.setWiredPorts(['slide.up', 'slide.down']);

  game.setValue('slide', 'up', 1);
  assert.equal(game.state.phase, 'playing');
  const start = game.state.player.y;

  run(game, 10);
  const climbed = start - game.state.player.y;
  assert.ok(climbed > 0, 'holding up should climb');

  run(game, 10);
  const again = start - game.state.player.y - climbed;
  assert.ok(Math.abs(again - climbed) < 1, 'the rate should not build up');

  game.setValue('slide', 'up', 0);
  const parked = game.state.player.y;
  run(game, 60);
  assert.equal(game.state.player.y, parked, 'letting go should stop the craft dead');
});

test('holding both slide inputs is a standstill', () => {
  const game = engineFor('spaceship');
  game.setWiredPorts(['slide.up', 'slide.down']);

  game.setValue('slide', 'up', 1);
  game.setValue('slide', 'down', 1);
  const start = game.state.player.y;

  run(game, 30);
  assert.equal(game.state.player.y, start);
});

test('a slide stops at the field edge rather than crashing into it', () => {
  const game = engineFor('spaceship');
  game.setWiredPorts(['slide.down']);
  game.setValue('slide', 'down', 1);
  game.state.distanceUntilGate = Infinity; // no gates to run into on the way

  run(game, 240);
  assert.equal(game.state.phase, 'playing', 'the floor should not end the round');
  assert.equal(game.state.player.y, RULES.groundY - RULES.playerRadius);
});

test('each slide direction carries its own speed', () => {
  const game = engineFor('spaceship');
  game.setControlOptions('slide', 'up', { speed: 'fast' });
  game.setControlOptions('slide', 'down', { speed: 'slow' });
  game.setWiredPorts(['slide.up', 'slide.down']);

  game.setValue('slide', 'up', 1);
  const start = game.state.player.y;
  run(game, 10);
  const up = start - game.state.player.y;

  game.setValue('slide', 'up', 0);
  game.setValue('slide', 'down', 1);
  const turned = game.state.player.y;
  run(game, 10);
  const down = game.state.player.y - turned;

  assert.ok(up > down, 'a fast climb should cover more ground than a slow drop');
});

test('the manual keys drive a held port that is already wired', () => {
  const game = engineFor('spaceship');
  game.setWiredPorts(['slide.up']); // up is on a wire, down is not

  game.hold('down', true);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.player.sinking, true);

  // Wiring a port does not take its key away — a half-finished controller has
  // to stay playable, and the two simply drive the same craft.
  game.hold('up', true);
  assert.equal(game.state.player.thrusting, true);

  // And the wire still has the last word when it says something.
  game.setValue('slide', 'up', 0);
  assert.equal(game.state.player.thrusting, false);
});

// --- Breaker (track) --------------------------------------------------

test('the craft tracks the analog value', () => {
  const game = engineFor('brickbreaker');
  game.setWiredPorts(['paddle.y']);
  game.setValue('paddle', 'y', 1);

  run(game, 90);
  assert.ok(Math.abs(game.state.player.y - trackY(1)) < 1);
});

test('a parked dial does not start the round but moving it does', () => {
  const game = engineFor('brickbreaker');
  game.setWiredPorts(['paddle.y']);

  game.setValue('paddle', 'y', 0.4);
  game.setValue('paddle', 'y', 0.42);
  assert.equal(game.state.phase, 'ready');

  game.setValue('paddle', 'y', 0.8);
  assert.equal(game.state.phase, 'playing');
});

// --- Extras: restart and the speed hold --------------------------------------

test('a wired restart puts the round back to the start', () => {
  const game = engineFor('flappy');
  game.restart();
  game.state.score = 5;

  game.fire('ui', 'advance');
  assert.equal(game.state.phase, 'ready');
  assert.equal(game.state.score, 0);
});

// The UI trigger is the button on whatever card is showing, which is the same
// thing tapping the canvas does. It used to be a restart and only a restart, so
// a controller with no keyboard beside it could reset a round it couldn't begin.
test('the UI trigger presses the button on whichever card is up', () => {
  const game = engineFor('flappy');
  game.now = 0;
  game.clock = () => game.now;

  game.fire('ui', 'advance');
  assert.equal(game.state.phase, 'playing', 'on the ready card it starts');

  game.end();
  game.now += 1000; // past the card's settling time
  game.fire('ui', 'advance');
  assert.equal(game.state.phase, 'playing', 'on the defeat card it goes again');
});

test('the UI trigger can be set to answer only after a crash', () => {
  const game = engineFor('flappy');
  game.now = 0;
  game.clock = () => game.now;
  game.setControlOptions('ui', 'advance', { when: 'over' });
  game.restart();

  game.fire('ui', 'advance');
  assert.equal(game.state.phase, 'playing', 'mid-round it should do nothing');

  game.end();
  game.now += 1000;
  game.fire('ui', 'advance');
  assert.equal(game.state.phase, 'playing', 'and after a crash it starts the next one');
});

test('the pace setting scales the world', () => {
  const game = engineFor('flappy');
  game.restart();
  const usual = game.speed();

  game.setControlOptions('speed', 'pace', { speed: 'calm', ramp: 'gentle' });
  assert.ok(game.speed() < usual, 'calm should slow the world');

  game.setControlOptions('speed', 'pace', { speed: 'quick', ramp: 'gentle' });
  assert.ok(game.speed() > usual, 'quick should hurry it along');
});

// The Design screen's preview runs the real renderer over a made-up round, and
// reads the course through this — so a setting that moves the game and not the
// preview is a setting that looks broken while you are choosing it.
test('the course settings resolve to numbers the preview can run on', () => {
  const gaps = ['tight', 'normal', 'roomy'].map((gap) => courseFrom({ gap }).gap);
  assert.deepEqual([...gaps].sort((a, b) => a - b), gaps, 'tight < normal < roomy');
  assert.equal(courseFrom({}).gap, RULES.gateGap, 'and nothing set is the plain course');

  const spacings = ['tight', 'normal', 'wide'].map((spacing) => courseFrom({ spacing }).spacing);
  assert.deepEqual([...spacings].sort((a, b) => a - b), spacings);

  const paces = ['calm', 'normal', 'quick'].map((speed) => courseFrom({ speed }).speed);
  assert.deepEqual([...paces].sort((a, b) => a - b), paces);

  // Ramp only says anything once there is a score to ramp against, which is why
  // the preview pretends to be part-way through a round rather than at zero.
  const flat = ['none', 'gentle', 'steep'].map((ramp) => courseFrom({ ramp }, 0).speed);
  assert.equal(new Set(flat).size, 1, 'at no score every ramp is the same');
  const climbed = ['none', 'gentle', 'steep'].map((ramp) => courseFrom({ ramp }, 8).speed);
  assert.equal(new Set(climbed).size, 3, 'and they separate once you have scored');

  assert.equal(courseFrom({ shape: 'slalom' }).shape, 'slalom');
  assert.equal(courseFrom({}).shape, 'columns', 'an unset shape is the plain one');
});

// Speed modifiers: two jacks that bend the pace while your controller says so.
// They multiply, so wiring neither leaves the pace exactly as the setting says.
test('a held modifier bends the world both ways and lets go cleanly', () => {
  const game = engineFor('flappy');
  game.restart();
  const plain = game.speed();

  game.setValue('shift', 'hold', 1);
  assert.ok(game.speed() < plain, 'the default is a brake');

  game.setValue('shift', 'hold', 0);
  assert.equal(game.speed(), plain, 'and letting go puts it back exactly');

  // The same jack, the other way round: a multiplier over 1 is a boost, and it
  // is allowed past the ceiling that scoring alone stops at.
  game.setControlOptions('shift', 'hold', { change: 'double' });
  game.setValue('shift', 'hold', 1);
  assert.equal(game.speed(), plain * 2);
});

// A dial is read as the two ends it maps between, which is the only way to know
// what the middle of it does.
test('a level modifier maps its two ends to the speeds you picked', () => {
  const game = engineFor('flappy');
  game.restart();
  const plain = game.speed();
  game.setControlOptions('shift', 'level', { low: 'normal', high: 'quadruple' });

  game.setValue('shift', 'level', 0);
  assert.equal(game.speed(), plain, 'the low end is what you said it was');

  game.setValue('shift', 'level', 1);
  assert.equal(game.speed(), plain * 4, 'and so is the high end');

  // Half way between 1x and 4x is 2x — these are ratios, so the midpoint is
  // geometric. A linear reading would put it at 2.5x.
  game.setValue('shift', 'level', 0.5);
  assert.ok(Math.abs(game.speed() - plain * 2) < 1e-9);
});

// The point of naming both ends: a dial set to brake at one end and boost at
// the other passes through the world's normal pace in the middle, which a
// single "sweeps all the way to X" could never express.
test('a dial set to brake and boost runs normally in the middle', () => {
  const game = engineFor('flappy');
  game.restart();
  const plain = game.speed();
  game.setControlOptions('shift', 'level', { low: 'half', high: 'double' });

  game.setValue('shift', 'level', 0);
  assert.ok(Math.abs(game.speed() - plain / 2) < 1e-9, 'the low end brakes');
  game.setValue('shift', 'level', 1);
  assert.ok(Math.abs(game.speed() - plain * 2) < 1e-9, 'the high end boosts');
  game.setValue('shift', 'level', 0.5);
  assert.ok(Math.abs(game.speed() - plain) < 1e-9, 'and the middle is left alone');
});

test('a modifier never starts a round by itself', () => {
  const game = engineFor('flappy');
  game.setValue('shift', 'hold', 1);
  game.setValue('shift', 'level', 1);
  assert.equal(game.state.phase, 'ready');
});

// Your best score, as a line through the world you fly through rather than a
// number to read afterwards.
test('the obstacle that ties your record is the one that carries the line', () => {
  const game = engineFor('flappy');
  game.state.best = 3;
  game.restart();
  game.state.distanceUntilGate = 0;

  // Spawn a run of them and see which one is marked.
  for (let i = 0; i < 6; i += 1) game.spawnGate(0);
  const marked = game.state.gates
    .map((gate, index) => (gate.record ? index : -1))
    .filter((index) => index >= 0);

  // Clearing an obstacle scores one, so a best of three is beaten by clearing
  // the fourth — index three, counting from zero.
  assert.deepEqual(marked, [3]);
});

test('with no record yet there is no line to draw', () => {
  const game = engineFor('flappy');
  game.restart();
  for (let i = 0; i < 4; i += 1) game.spawnGate(0);
  assert.ok(game.state.gates.every((gate) => !gate.record));
});

// The record climbs as you pass your old one, and a line that moved with it
// would be a line nobody could ever cross.
test('the line stays where the round started, however high the score climbs', () => {
  const game = engineFor('flappy');
  game.state.best = 2;
  game.restart();

  game.spawnGate(0);
  game.spawnGate(0);
  game.spawnGate(0);
  assert.equal(game.state.gates[2].record, true);

  game.addScore(10); // a new record, mid-round
  game.spawnGate(0);
  game.spawnGate(0);
  assert.ok(game.state.gates.slice(3).every((gate) => !gate.record), 'and it does not move');
});

// A direction still held at the moment of death used to keep the craft sliding
// across the defeat card — the two falling motions were guarded and the two
// positional ones were not.
test('the craft stops dead when the round is over, under every scheme', () => {
  for (const id of ['flappy', 'jetpack', 'spaceship', 'brickbreaker']) {
    const game = engineFor(id);
    game.restart();

    // Push it, whichever way this scheme is pushed.
    if (id === 'spaceship') game.hold('down', true);
    else if (id === 'brickbreaker') game.hold('down', true);
    else if (id === 'jetpack') game.hold('thrust', true);
    else game.press();

    const start = game.state.player.y;
    run(game, 20);
    const moved = game.state.player.y;
    assert.ok(Math.abs(moved - start) > 1, `${id} never moved while playing`);

    // Still held, and now dead.
    game.end();
    run(game, 30);
    assert.equal(game.state.player.y, moved, `${id} kept moving after the round ended`);
  }
});

// A tracked craft *should* keep following its input between rounds — that is
// what starts it where your hand actually is — so the guard is on `over`
// specifically, not on "not playing".
test('a steered craft still follows its input while waiting to start', () => {
  const game = engineFor('brickbreaker');
  const start = game.state.player.y;
  game.setWiredPorts([]);
  game.hold('down', true);
  run(game, 30);

  assert.equal(game.state.phase, 'playing', 'moving it is also what starts the round');
  assert.ok(game.state.player.y > start, 'and it moved');
});

// The craft grew by a quarter, and the gap grew by exactly the extra diameter —
// so a course set up before the resize still plays the way it was set up. This
// is the number that says so.
test('a bigger craft did not make every gap tighter', () => {
  const clearance = RULES.gateGap - RULES.playerRadius * 2;
  assert.equal(clearance, 144, 'the free space through a fair gap is unchanged');

  // And it scales with the setting, rather than the setting scaling around it.
  for (const gap of ['tight', 'normal', 'roomy']) {
    const free = courseFrom({ gap }).gap - RULES.playerRadius * 2;
    assert.ok(free > 0, `${gap} has to leave room for the craft`);
  }
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

test('a column is laid in whole tiles that land on both its ends', () => {
  // Any bar length, any drawing: the tiles must come out whole and add up to
  // exactly the bar, or the column finishes on half a picture.
  for (const span of [40, 128, 201, 333, 530]) {
    for (const natural of [17, 48.5, 90, 400]) {
      const { count, tileHeight } = wholeTiles(span, natural);
      assert.ok(Number.isInteger(count) && count >= 1, `whole count for ${span}/${natural}`);
      assert.ok(Math.abs(count * tileHeight - span) < 1e-9, 'the tiles fill the bar exactly');
      // And where there is room for a tile at all, the stretch stays mild
      // enough to read as the drawing it is. A bar shorter than half a tile is
      // the one case with no choice: it gets one tile, squashed to fit.
      // Rounding puts span/natural within half a tile of the count, so a tile
      // is never squashed below half its size nor stretched past half again.
      if (span >= natural / 2) {
        assert.ok(tileHeight >= natural / 2 - 1e-9 && tileHeight <= natural * 1.5 + 1e-9,
          `${tileHeight} is not far off ${natural}`);
      }
    }
  }
});

test('a bar shorter than one tile still draws a whole one', () => {
  const { count, tileHeight } = wholeTiles(12, 48);
  assert.equal(count, 1);
  assert.equal(tileHeight, 12);
});

test('a floating block is its own width, and the bars share theirs', () => {
  assert.equal(gateSpan({ kind: 'floating' }), RULES.blockWidth);
  for (const kind of ['columns', 'ceiling', 'floor']) {
    assert.equal(gateSpan({ kind }), RULES.gateWidth);
  }
  // Square, so one drawing fits it without being squashed into a slot.
  assert.equal(RULES.blockWidth, RULES.blockHeight);
});

test('the craft can still be hit by a block across its whole width', () => {
  const game = engineFor('flappy');
  game.setControlOptions('world', 'obstacles', { shape: 'floating', gap: 'normal', spacing: 'normal' });
  game.restart();
  // Parked level with the block, at its trailing edge — inside the wider box,
  // and outside the narrower one a column would have had.
  const gate = { kind: 'floating', gapY: game.state.player.y, gap: RULES.gateGap };
  // Far enough back that a column would be behind the craft, near enough that
  // the wider block still reaches it.
  gate.x = 30;
  game.state.gates = [gate];
  assert.ok(gate.x + RULES.gateWidth < RULES.playerX - RULES.playerRadius,
    'a column this far back would already have been passed');
  assert.ok(game.hitsGate(gate), 'but the block is wider, so it still hits');
});

test('the course settings change the room, the spacing and the pace', () => {
  const game = engineFor('flappy');
  const fair = game.gapSize();

  game.setControlOptions('world', 'obstacles', { shape: 'columns', gap: 'tight', spacing: 'normal' });
  assert.ok(game.gapSize() < fair, 'a tight squeeze should be tighter');

  game.setControlOptions('world', 'obstacles', { shape: 'columns', gap: 'roomy', spacing: 'wide' });
  assert.ok(game.gapSize() > fair);
  assert.ok(game.spacing() > RULES.gateSpacing);

  game.setControlOptions('speed', 'pace', { speed: 'quick', ramp: 'gentle' });
  assert.ok(game.speed() > RULES.speedStart, 'a quick world starts faster');
});

test('with no ramp the world never speeds up, however high the score', () => {
  const game = engineFor('flappy');
  game.setControlOptions('speed', 'pace', { speed: 'normal', ramp: 'none' });
  game.state.score = 500;

  assert.equal(game.speed(), RULES.speedStart);
});

test('a heavier craft falls faster, a floaty one slower', () => {
  const fall = (gravity) => {
    const game = engineFor('flappy');
    game.setControlOptions('flap', 'trigger', { gravity });
    game.restart();
    run(game, 10);
    return game.state.player.velocity;
  };

  assert.ok(fall('heavy') > fall('normal'));
  assert.ok(fall('floaty') < fall('normal'));
});

test('a steered craft cannot fly off the field', () => {
  const game = engineFor('brickbreaker');
  game.setWiredPorts(['paddle.y']);
  game.setValue('paddle', 'y', 0.5); // arms the wiggle-to-start gesture
  game.setValue('paddle', 'y', 1);
  game.state.distanceUntilGate = Infinity;

  run(game, 120);
  assert.equal(game.state.phase, 'playing');
  assert.ok(game.state.player.y + RULES.playerRadius <= RULES.groundY);
});

// --- How the craft is drawn --------------------------------------------------
// The renderer is given a stub context and asked only what it did to the
// coordinate system before drawing the craft, because that is the whole of the
// animation: a rotation and a pair of scales, chasing what the craft is doing.

/**
 * Answers to anything a canvas context is asked, and does none of it.
 *
 * `rotate` and `scale` are the craft's carriage, and the only two calls anybody
 * asserts on. `scale` writes onto the last thing `rotate` pushed, so anything
 * else the renderer draws must not reach for either — it would overwrite the
 * craft's transform, or find nothing there to overwrite.
 */
const stubContext = (moves) => new Proxy({
  canvas: { width: RULES.width, height: RULES.height },
  createLinearGradient: () => ({ addColorStop() {} }),
  rotate: (angle) => moves.push({ tilt: angle }),
  scale: (x, y) => Object.assign(moves.at(-1), { along: x, across: y }),
}, {
  get: (target, key) => (key in target ? target[key] : (target[key] = () => {})),
  set: (target, key, value) => { target[key] = value; return true; },
});

/** Runs `frames` of the renderer over states from `at(i)`, at 60fps. */
// The scheme matters to the renderer now: the kick belongs to the one control
// that is a shove, so which motion is being drawn changes what it does.
const carriageOver = (frames, at, motion = 'impulse') => {
  const moves = [];
  const ctx = stubContext(moves);
  const render = createRenderer(ctx, { drawOverlay() {} }, { motion });
  for (let i = 0; i < frames; i += 1) render(at(i), 1000 + i * (1000 / 60));
  return moves;
};

/**
 * A jetpack round that has just crashed, with a clock the test drives itself.
 * `game.now += ms` is how a test steps past the game-over card's settling time
 * without a timer, and without the suite taking a second per assertion.
 */
function crashedJetpack() {
  const game = engineFor('jetpack');
  game.now = 0;
  game.clock = () => game.now;
  game.setWiredPorts(['lift.thrust']);
  game.setValue('lift', 'thrust', 1);
  game.state.player.y = 5; // fly into the ceiling
  run(game, 2);
  assert.equal(game.state.phase, 'over');
  return game;
}

const flying = (y, extra = {}) => ({
  phase: 'playing',
  score: 0,
  distance: 0,
  gates: [],
  player: { y, velocity: 0, value: 0.5, thrusting: false, sinking: false, ...extra },
});

test('the craft leans into a dive and rounds out of it a beat later', () => {
  // Twenty frames falling, then held level: the lean has to build up while it
  // drops and still be unwinding after the drop stops.
  const moves = carriageOver(40, (i) => flying(200 + Math.min(i, 20) * 6));
  const diving = moves[20].tilt;
  const after = moves[22].tilt;

  assert.ok(diving > 0.2, `a dive should lean nose-down, got ${diving}`);
  assert.ok(after > 0 && after < diving, 'the lean should unwind rather than snap back');
  assert.ok(Math.abs(moves.at(-1).tilt) < 0.05, 'level flight should end up level');
});

test('a held control leans the craft before it has picked up any speed', () => {
  const still = carriageOver(6, () => flying(200));
  const lifting = carriageOver(6, () => flying(200, { thrusting: true }));

  assert.ok(Math.abs(still.at(-1).tilt) < 0.01, 'nothing held, nothing to show');
  assert.ok(lifting.at(-1).tilt < -0.05, 'a held climb should lean nose-up on its own');
});

test('the craft stretches along its travel without gaining any size', () => {
  const moves = carriageOver(30, (i) => flying(120 + i * 6));
  const { along, across } = moves.at(-1);

  assert.ok(along > 1.05, `moving fast should stretch the craft, got ${along}`);
  assert.ok(Math.abs(along * across - 1) < 1e-9, 'a stretch has to be paid for across');
});

test('a kick squashes the craft, and only an upward one', () => {
  // A flap: the craft is dropped for a few frames, then thrown upward.
  const kicked = carriageOver(10, (i) => flying(i < 5 ? 200 + i * 3 : 215 - (i - 4) * 7));
  assert.ok(kicked[5].along < 0.8, `a kick should squash the craft, got ${kicked[5].along}`);
  assert.ok(kicked.at(-1).along > kicked[5].along, 'and spring back out of it');

  // A crash drops it just as sharply the other way, and must not be a flourish.
  const crashed = carriageOver(10, (i) => flying(i < 5 ? 200 : 200 + (i - 4) * 7));
  assert.ok(crashed[5].along >= 1, 'falling hard is not a flourish');
});

// The pop is the flap's, and the flap belongs to one scheme. A slide or a
// steered height snapping upward moves the craft just as sharply, so without
// this the animation read as the game's rather than the control's.
test('only the shoving scheme pops; the rest keep the lean and the stretch', () => {
  // The same movement the test above proves is a kick — dropped, then thrown
  // upward — so the only thing differing between these two is the scheme.
  const shove = (i) => flying(i < 5 ? 200 + i * 3 : 215 - (i - 4) * 7);

  assert.ok(carriageOver(10, shove, 'impulse')[5].along < 0.8, 'the flapping scheme squashes');
  const slid = carriageOver(10, shove, 'slide')[5].along;
  assert.ok(slid >= 1, `the sliding one does not pop: ${slid}`);

  // It still leans and stretches with its travel, like every other scheme.
  const climbing = carriageOver(30, (i) => flying(400 - i * 8), 'slide');
  assert.ok(climbing.at(-1).tilt < -0.05, 'and it still leans into the climb');
  assert.ok(climbing.at(-1).along > 1.02, 'and stretches along it');
});

test('between rounds the craft sits level however the last one ended', () => {
  const moves = carriageOver(60, (i) => (i < 20
    ? flying(120 + i * 6)
    : { ...flying(240), phase: 'over' }));

  assert.ok(moves[20].tilt > 0.2, 'it was diving when the round ended');
  assert.ok(Math.abs(moves.at(-1).tilt) < 0.02, 'and settles level once it is over');
  assert.ok(Math.abs(moves.at(-1).along - 1) < 0.02, 'at its own size, too');
});
