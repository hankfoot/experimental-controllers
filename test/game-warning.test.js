import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnose } from '../js/game-warning.js';
import { GAMES } from '../js/games/index.js';

const steeringOf = (id) => GAMES.find((game) => game.id === id).steering;

// A wire, in the shape the engine hands them out in.
const wire = (source, key) => {
  const [node, port] = key.split('.');
  return { source, target: { node, port } };
};
const heard = (channel, label = channel) => ({ channel, label, planned: true, live: true });
const picked = (channel, label = channel) => ({ channel, label, planned: true, live: false });

test('nothing picked anywhere is the first thing worth saying', () => {
  const found = diagnose({ steering: steeringOf('flappy'), connections: [], signals: [] });
  assert.equal(found.reason, 'no-inputs');
  assert.equal(found.level, 'empty');
});

test('inputs picked but none wired names what has to be steered', () => {
  const found = diagnose({
    steering: steeringOf('jetpack'),
    connections: [],
    signals: [picked('btna')],
  });
  assert.equal(found.reason, 'nothing-wired');
  assert.deepEqual(found.controls.map((control) => control.label), ['Thrust']);
});

// The case the whole check exists for: Invaders looks wired and flies one way.
test('half of a two-input scheme is called out ahead of anything else', () => {
  const found = diagnose({
    steering: steeringOf('spaceship'),
    connections: [wire('btna', 'slide.up')],
    signals: [heard('btna')],
  });
  assert.equal(found.reason, 'half-wired');
  assert.equal(found.control.label, 'Move');
  assert.equal(found.control.done, 1);
  assert.equal(found.control.total, 2);
});

test('a fully wired controller that has been heard from says nothing at all', () => {
  const found = diagnose({
    steering: steeringOf('spaceship'),
    connections: [wire('btna', 'slide.up'), wire('btnb', 'slide.down')],
    signals: [heard('btna'), heard('btnb')],
  });
  assert.equal(found, null);
});

// Wiring a channel you picked on Sensing but left out of the flashed code looks
// exactly like a finished controller until the board is asked to speak.
test('a wire to a reading the board has never sent is caught last', () => {
  const found = diagnose({
    steering: steeringOf('brickbreaker'),
    connections: [wire('pitch', 'paddle.y')],
    signals: [picked('pitch', 'Pitch')],
  });
  assert.equal(found.reason, 'silent');
  assert.deepEqual(found.signals.map((signal) => signal.channel), ['pitch']);
});

test('a silent wire is only mentioned once the wiring is otherwise done', () => {
  // Same silent channel, but half the scheme is still empty — that comes first.
  const found = diagnose({
    steering: steeringOf('spaceship'),
    connections: [wire('pitch', 'slide.up')],
    signals: [picked('pitch', 'Pitch')],
  });
  assert.equal(found.reason, 'half-wired');
});

test('every scheme can be got into a state that says nothing', () => {
  for (const game of GAMES) {
    const connections = game.steering.flatMap((control) =>
      control.keys.map((key) => wire('btna', key)));
    const found = diagnose({
      steering: game.steering,
      connections,
      signals: [heard('btna')],
    });
    assert.equal(found, null, `${game.id} still complains about a finished controller`);
  }
});
