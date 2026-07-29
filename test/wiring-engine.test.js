import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalStore } from '../js/signal-store.js';
import { createWiringEngine } from '../js/wiring-engine.js';
import { key } from '../js/storage-keys.js';
import { memoryStorage } from './helpers/memory-storage.js';

// A stand-in game with one of each port type. The wiring engine is generic, so
// these names are arbitrary — that is exactly what these tests pin down.
const TEST_GAME = {
  id: 'test',
  targets: [
    {
      id: 'flap',
      label: 'Flap',
      emoji: '🐤',
      description: 'test',
      ports: [
        { id: 'trigger', label: 'Trigger', type: 'trigger' },
        { id: 'magnitude', label: 'Strength', type: 'level', defaultValue: 0.57 },
      ],
    },
    {
      id: 'restart',
      label: 'Restart',
      emoji: '↻',
      description: 'test',
      ports: [{ id: 'trigger', label: 'Trigger', type: 'trigger' }],
    },
    {
      id: 'fixed',
      label: 'Fixed',
      emoji: '⏱️',
      description: 'test',
      // Fixes its own pace instead of offering it, the way a restart does.
      ports: [{ id: 'trigger', label: 'Trigger', type: 'trigger', pace: 1000 }],
    },
    {
      id: 'speed',
      label: 'Speed',
      emoji: '💨',
      description: 'test',
      ports: [
        { id: 'level', label: 'Speed', type: 'level', defaultValue: 0.5 },
        { id: 'hold', label: 'Boost', type: 'hold', defaultValue: 0 },
        { id: 'brake', label: 'Brake', type: 'hold', defaultValue: 0 },
      ],
    },
  ],
};

const OTHER_GAME = {
  id: 'other',
  targets: [{
    id: 'paddle',
    label: 'Paddle',
    emoji: '🏓',
    description: 'test',
    ports: [{ id: 'y', label: 'Height', type: 'level', defaultValue: 0.5 }],
  }],
};

function setup(storage = null, { useBrowserStorage = false, game = TEST_GAME } = {}) {
  let now = 0;
  let receiveInput = () => {};
  const calls = [];
  const signalStore = createSignalStore({
    now: () => now,
    subscribeInput(listener) {
      receiveInput = listener;
      return () => { receiveInput = () => {}; };
    },
  });
  const actions = {
    setValue: (node, port, value) => calls.push(['value', `${node}.${port}`, value]),
    fire: (node, port) => calls.push(['fire', `${node}.${port}`]),
    setWiredPorts: (ports) => calls.push(['wired', [...ports].sort()]),
  };
  const engine = createWiringEngine({
    signalStore,
    actions,
    game,
    ...(useBrowserStorage ? {} : { storage }),
  });
  return {
    actions,
    calls,
    engine,
    signalStore,
    emit(channel, value, time = now + 200) {
      now = time;
      receiveInput({ channel, value });
    },
  };
}


test('value wires update before same-sample triggers regardless of insertion order', () => {
  const context = setup();
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'flap', port: 'trigger' });
  context.engine.addConnection('light', { node: 'flap', port: 'magnitude' });

  context.emit('light', 0);
  context.calls.length = 0;
  context.emit('light', 255);

  assert.deepEqual(context.calls, [
    ['value', 'flap.magnitude', 1],
    ['fire', 'flap.trigger'],
  ]);
});

test('custom binary wires migrate when their source becomes numeric', () => {
  const storage = memoryStorage();
  const context = setup(storage);
  context.emit('custom', 0);
  context.engine.addConnection('custom', { node: 'flap', port: 'trigger' });
  context.engine.addConnection('custom', { node: 'speed', port: 'hold' });

  context.emit('custom', 200);
  const [trigger, held] = context.engine.listConnections();

  assert.equal(trigger.sourceKind, 'number');
  assert.deepEqual(
    { type: trigger.transform.type, min: trigger.transform.min, max: trigger.transform.max },
    { type: 'threshold', min: 0, max: 200 },
  );
  // A button's pass-through hold has no line to compare against; once the source
  // turns out to read a range, it needs one, and it lands at the midpoint.
  assert.equal(held.sourceKind, 'number');
  assert.deepEqual(held.transform, {
    type: 'gate', min: 0, max: 200, direction: 'above', threshold: 100,
  });
  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.hold'),
    ['value', 'speed.hold', 1],
  );
  assert.match(storage.saved.values().next().value, /"sourceKind":"number"/);
});

test('an analog hold gates a hold port into a held on/off', () => {
  const context = setup();
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above');
  context.calls.length = 0;

  // Range is 0..255, so the default 50% threshold sits at ~128.
  context.emit('light', 40);
  context.emit('light', 200);
  context.emit('light', 90);

  assert.deepEqual(
    context.calls.filter(([name]) => name === 'value').map(([, , value]) => value),
    [0, 1, 0],
  );
});

test('an analog hold reads its threshold in the signal\'s own units', () => {
  const context = setup();
  context.emit('light', 0);
  const [connection] = [context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above')];

  // light is 0..255, so the default sits at the midpoint rather than at "50%".
  assert.equal(connection.transform.threshold, 127.5);
  assert.equal(connection.transform.invert, undefined);
});

test('an analog hold rides through chatter at its threshold', () => {
  const context = setup();
  context.emit('light', 0);
  const connection = context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above');
  context.engine.updateConnection(connection.id, { transform: { min: 0, max: 100, threshold: 50 } });
  context.emit('light', 80); // clearly on
  context.calls.length = 0;

  // Readings that hover right on the 50 line must not flap the control.
  context.emit('light', 49);
  context.emit('light', 51);
  context.emit('light', 49);

  // Nothing at all is reported, because nothing changed: the hold was already 1
  // and stayed 1 throughout. A release appearing here is the failure.
  assert.deepEqual(context.calls.filter(([name]) => name === 'value'), []);
});

test('a gated wire survives a reload and keeps holding', () => {
  const storage = memoryStorage();
  const first = setup(storage);
  first.emit('light', 0);
  first.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above');

  const second = setup(storage);
  second.emit('light', 0);
  const [restored] = second.engine.listConnections();
  assert.equal(restored.transform.type, 'gate');

  second.calls.length = 0;
  second.emit('light', 255);
  assert.deepEqual(
    second.calls.findLast(([name, port]) => name === 'value' && port === 'speed.hold'),
    ['value', 'speed.hold', 1],
  );
});

test('a saved gate falls back to a pass-through when its source only reads 0/1', () => {
  // btna is a known on/off channel, so this wire was saved against a kind the
  // registry disagrees with — there is nothing left for a gate to threshold.
  const stored = JSON.stringify({
    version: 3,
    games: {
      test: [{
        id: 'stale-gate',
        source: 'btna',
        sourceKind: 'number',
        target: { node: 'speed', port: 'hold' },
        transform: { type: 'gate', min: 0, max: 255, direction: 'above', threshold: 128 },
      }],
    },
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });
  const [connection] = context.engine.listConnections();

  assert.equal(connection.sourceKind, 'binary');
  assert.deepEqual(connection.transform, { type: 'hold', invert: false });
});

test('re-patching a hold port from one gated jack to the other flips its direction', () => {
  const context = setup();
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above');
  assert.equal(context.engine.listConnections()[0].transform.direction, 'above');

  context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-below');

  const connections = context.engine.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].transform.direction, 'below');
});

test('a proportional level cannot drive a held control', () => {
  const context = setup();
  context.emit('light', 128);
  assert.equal(
    context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'level').transform.type,
    'gate',
    'asking for a hold port gates the reading rather than passing it through',
  );
  // And a button, which has no level at all, cannot reach a level port.
  context.emit('btna', 0);
  assert.equal(context.engine.addConnection('btna', { node: 'speed', port: 'level' }), null);
});

test('one dial can hold two controls with a dead zone between them', () => {
  const context = setup();
  context.emit('light', 128);
  const high = context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-above');
  const low = context.engine.addConnection('light', { node: 'speed', port: 'brake' }, 'hold-below');
  // 0..255, so these leave 102–153 driving neither.
  context.engine.updateConnection(high.id, { transform: { threshold: 153 } });
  context.engine.updateConnection(low.id, { transform: { threshold: 102 } });
  assert.equal(context.engine.listConnections().length, 2, 'both jacks stay wired');

  const readingAt = (value) => {
    context.emit('light', value);
    return ['speed.hold', 'speed.brake'].map((port) =>
      context.calls.findLast(([name, target]) => name === 'value' && target === port)?.[2]);
  };

  assert.deepEqual(readingAt(255), [1, 0], 'the top of the dial holds only the high one');
  assert.deepEqual(readingAt(128), [0, 0], 'the middle holds neither');
  assert.deepEqual(readingAt(0), [0, 1], 'the bottom holds only the low one');
});

test('numeric threshold crossings honor each wire cooldown', () => {
  const context = setup();
  context.emit('light', 0, 0);
  context.engine.addConnection('light', { node: 'restart', port: 'trigger' });
  context.emit('light', 0, 100);
  context.emit('light', 255, 200);
  context.emit('light', 0, 250);
  context.emit('light', 255, 300);
  context.emit('light', 0, 500);
  context.emit('light', 255, 700);

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'restart.trigger').length,
    2,
  );
});

// A port that fixes its own pace is the only place that number lives. Saved
// wiring carrying a faster one — set before the port fixed it, or under a game
// that offered the choice — must not be what actually runs, since nothing on
// screen would admit to it.
test('a port that fixes its pace overrides the one saved on the wire', () => {
  const context = setup();
  context.emit('light', 0, 0);
  const connection = context.engine.addConnection('light', { node: 'fixed', port: 'trigger' });
  context.engine.updateConnection(connection.id, { transform: { cooldownMs: 0 } });

  // Four crossings inside one second: the wire says every one of them may fire,
  // the port says one of them may.
  context.emit('light', 0, 100);
  context.emit('light', 255, 200);
  context.emit('light', 0, 250);
  context.emit('light', 255, 300);
  context.emit('light', 0, 500);
  context.emit('light', 255, 700);

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'fixed.trigger').length,
    1,
  );
});

test('repeated custom event samples can each trigger', () => {
  const context = setup();
  context.emit('custom', 1, 0);
  const connection = context.engine.addConnection('custom', { node: 'flap', port: 'trigger' });
  context.engine.updateConnection(connection.id, { transform: { type: 'event' } });

  context.emit('custom', 1, 200);
  context.emit('custom', 1, 400);

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'flap.trigger').length,
    2,
  );
});

test('event signals cannot connect to continuous values', () => {
  const context = setup();
  context.emit('shake', 1);
  assert.equal(context.engine.addConnection('shake', { node: 'speed', port: 'level' }), null);
  assert.equal(context.engine.addConnection('shake', { node: 'speed', port: 'hold' }), null);
});

test('games are told which ports are under wire control', () => {
  const context = setup();
  context.emit('btna', 0);
  context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });
  context.engine.addConnection('btna', { node: 'speed', port: 'hold' });

  assert.deepEqual(
    context.calls.findLast(([name]) => name === 'wired'),
    ['wired', ['flap.trigger', 'speed.hold']],
  );
});

test('unwired value ports fall back to their declared default', () => {
  const context = setup();
  context.emit('light', 0);
  const connection = context.engine.addConnection('light', { node: 'speed', port: 'level' });
  context.calls.length = 0;
  context.engine.removeConnection(connection.id);

  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.level'),
    ['value', 'speed.level', 0.5],
  );
});

// A board that walks out of range sends no release — there is nothing left to
// send it with — so the last thing it said stays true until somebody says
// otherwise. This is somebody saying otherwise.
test('losing the board lets go of everything a wire was holding', () => {
  const context = setup();
  context.emit('btna', 0);
  context.emit('light', 0);
  context.engine.addConnection('btna', { node: 'speed', port: 'hold' }, 'hold');
  context.engine.addConnection('light', { node: 'speed', port: 'level' });
  context.emit('btna', 1);
  context.emit('light', 255);
  context.calls.length = 0;

  context.engine.release();

  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.hold'),
    ['value', 'speed.hold', 0],
  );
  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.level'),
    ['value', 'speed.level', 0.5],
  );
});

test('a released gate does not remember which side of the line it was on', () => {
  const context = setup();
  context.emit('light', 0);
  const connection = context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold');
  context.engine.updateConnection(connection.id, {
    transform: { type: 'gate', min: 0, max: 255, direction: 'above', threshold: 128 },
  });
  context.emit('light', 255); // over the line and holding
  context.engine.release();
  context.calls.length = 0;

  // Back at the same reading, the gate has to take hold again from scratch
  // rather than carrying its old state across the gap.
  context.emit('light', 255);
  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.hold'),
    ['value', 'speed.hold', 1],
  );
});

test('transform updates must match their target port', () => {
  const context = setup();
  context.emit('btna', 0);
  const connection = context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });
  context.engine.updateConnection(connection.id, {
    transform: { type: 'range', min: 0, max: 1, invert: false, smoothing: 0 },
  });

  assert.equal(context.engine.listConnections()[0].transform.type, 'edge');
});

test('each game keeps its own independent wiring', () => {
  const storage = memoryStorage();
  const context = setup(storage);
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'speed', port: 'level' });
  assert.equal(context.engine.listConnections().length, 1);

  context.engine.setGame(OTHER_GAME);
  assert.equal(context.engine.gameId, 'other');
  assert.deepEqual(context.engine.listConnections(), []);

  context.engine.addConnection('light', { node: 'paddle', port: 'y' });
  context.engine.setGame(TEST_GAME);

  const restored = context.engine.listConnections();
  assert.deepEqual(restored.map(({ target }) => `${target.node}.${target.port}`), ['speed.level']);
});

test('a game only loads connections that match its own ports', () => {
  const stored = JSON.stringify({
    version: 3,
    games: {
      test: [{
        id: 'stale',
        source: 'light',
        sourceKind: 'number',
        target: { node: 'paddle', port: 'y' }, // belongs to a different game
        transform: { type: 'range', min: 0, max: 255, invert: false, smoothing: 0 },
      }],
    },
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });

  assert.deepEqual(context.engine.listConnections(), []);
});

test('saved wires are validated and only a mapped range keeps an invert', () => {
  const stored = JSON.stringify({
    version: 3,
    games: {
      test: [
        {
          id: 'threshold',
          source: 'light',
          sourceKind: 'number',
          target: { node: 'flap', port: 'trigger' },
          transform: {
            type: 'threshold', min: 0, max: 255, direction: 'above', threshold: 0.5, cooldownMs: 160,
          },
        },
        {
          id: 'change',
          source: 'pitch',
          sourceKind: 'number',
          target: { node: 'restart', port: 'trigger' },
          transform: { type: 'change', min: -90, max: 90, amount: 0.2, cooldownMs: 160 },
        },
        {
          id: 'mapped',
          source: 'mic',
          sourceKind: 'number',
          target: { node: 'speed', port: 'level' },
          transform: { type: 'range', min: 0, max: 255, smoothing: 0 },
        },
        {
          id: 'invalid',
          source: 'light',
          sourceKind: 'number',
          target: { node: 'flap', port: 'magnitude' },
          transform: { type: 'range', min: 'oops', max: 255, invert: false, smoothing: 0 },
        },
      ],
    },
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });
  const connections = context.engine.listConnections();

  assert.deepEqual(connections.map(({ id }) => id), ['threshold', 'change', 'mapped']);
  // Comparing raw readings needs no invert; only a mapped span can be reversed.
  assert.deepEqual(
    connections.map(({ transform }) => transform.invert),
    [undefined, undefined, false],
  );
});

test('saved source kinds reconcile with authoritative channel metadata', () => {
  const stored = JSON.stringify({
    version: 3,
    games: {
      test: [{
        id: 'shake-wire',
        source: 'shake',
        sourceKind: 'binary',
        target: { node: 'flap', port: 'trigger' },
        transform: { type: 'edge', edge: 'rising', cooldownMs: 160 },
      }],
    },
  });
  let persisted = '';
  const context = setup({ getItem: () => stored, setItem: (_key, value) => { persisted = value; } });
  const [connection] = context.engine.listConnections();

  assert.equal(connection.sourceKind, 'event');
  assert.equal(connection.transform.type, 'event');
  assert.match(persisted, /"sourceKind":"event"/);
});

test('blocked browser storage falls back to in-memory wiring', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('blocked', 'SecurityError'); },
  });

  try {
    const context = setup(null, { useBrowserStorage: true });
    assert.equal(context.engine.listConnections().length, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('trigger thresholds are read in the signal\'s own units', () => {
  const context = setup();
  context.emit('light', 0, 0);
  const connection = context.engine.addConnection('light', { node: 'restart', port: 'trigger' });
  // light is 0..255, so the default crossing sits at the midpoint, not at "50%".
  assert.equal(connection.transform.threshold, 127.5);

  context.engine.updateConnection(connection.id, { transform: { threshold: 200 } });
  context.emit('light', 150, 200); // up, but not past 200
  context.emit('light', 255, 400); // crosses
  context.emit('light', 10, 600);
  context.emit('light', 255, 800); // crosses again

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'restart.trigger').length,
    2,
  );
});

// Smoothing is measured against elapsed time, not against samples. Per sample,
// the same setting meant whatever the input's rate happened to be — barely
// anything on a fast input, which is exactly where it was needed most.
test('smoothing means the same thing however fast the readings arrive', () => {
  const slow = setup();
  slow.emit('light', 0, 0);
  const wire = slow.engine.addConnection('light', { node: 'speed', port: 'level' });
  slow.engine.updateConnection(wire.id, {
    transform: { type: 'range', min: 0, max: 255, invert: false, smoothing: 0.6 },
  });

  // One second of a board polling ten times a second.
  for (let i = 1; i <= 10; i += 1) slow.emit('light', 255, i * 100);
  const after = slow.calls.findLast(([name]) => name === 'value')[2];

  // The same second, at sixty samples. It must land in the same place, not
  // sixty times further along.
  const fast = setup();
  fast.emit('light', 0, 0);
  const other = fast.engine.addConnection('light', { node: 'speed', port: 'level' });
  fast.engine.updateConnection(other.id, {
    transform: { type: 'range', min: 0, max: 255, invert: false, smoothing: 0.6 },
  });
  for (let i = 1; i <= 60; i += 1) fast.emit('light', 255, i * (1000 / 60));
  const alsoAfter = fast.calls.findLast(([name]) => name === 'value')[2];

  assert.ok(Math.abs(after - alsoAfter) < 0.02,
    `same second of readings should land together: ${after} vs ${alsoAfter}`);
  assert.ok(after > 0.9, 'and both should have most of the way there');
});

test('no smoothing follows the reading exactly', () => {
  const context = setup();
  context.emit('light', 0, 0);
  context.engine.addConnection('light', { node: 'speed', port: 'level' });
  context.calls.length = 0;

  context.emit('light', 255, 100);
  assert.equal(context.calls.findLast(([name]) => name === 'value')[2], 1);
});

// --- On/off contacts --------------------------------------------------------
// A button, pad, switch or logo reports its two edges and nothing in between:
// one 1 when it goes down, one 0 when it comes up. Nothing on this path may
// wait for a reading to be repeated, because it never will be.

test('a press and its release each land once', () => {
  const context = setup();
  context.emit('btna', 0, 0);
  context.engine.addConnection('btna', { node: 'speed', port: 'hold' }, 'hold');
  context.calls.length = 0;

  context.emit('btna', 1, 100); // down
  context.emit('btna', 0, 200); // up, and this is the only 0 there will be

  assert.deepEqual(
    context.calls.filter(([name, port]) => name === 'value' && port === 'speed.hold'),
    [['value', 'speed.hold', 1], ['value', 'speed.hold', 0]],
  );
});

test('a trigger fires on every press, not just the first', () => {
  const context = setup();
  context.emit('btna', 0, 0);
  context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });

  context.emit('btna', 1, 100);
  context.emit('btna', 0, 200);
  context.emit('btna', 1, 1000); // far enough apart to clear any cooldown
  context.emit('btna', 0, 1100);
  context.emit('btna', 1, 2000);

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'flap.trigger').length,
    3,
  );
});

test('holding a contact down does not re-fire its trigger', () => {
  const context = setup();
  context.emit('btna', 0, 0);
  context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });

  context.emit('btna', 1, 100); // one press, held for a while
  context.emit('btna', 1, 1000); // a redundant edge, should it ever arrive
  context.emit('btna', 0, 2000);

  assert.equal(
    context.calls.filter(([name, port]) => name === 'fire' && port === 'flap.trigger').length,
    1,
  );
});

test('two controls on one contact both let go together', () => {
  const context = setup();
  context.emit('btna', 0, 0);
  context.engine.addConnection('btna', { node: 'speed', port: 'hold' }, 'hold');
  context.engine.addConnection('btna', { node: 'speed', port: 'brake' }, 'hold');
  context.emit('btna', 1, 100);
  context.calls.length = 0;

  context.emit('btna', 0, 200);

  const released = context.calls.filter(([name]) => name === 'value');
  assert.equal(released.length, 2);
  assert.ok(released.every(([, , value]) => value === 0));
});

test('a gesture fires on the single 1 it sends', () => {
  const context = setup();
  context.emit('shake', 1, 0);
  context.engine.addConnection('shake', { node: 'flap', port: 'trigger' });
  context.calls.length = 0;

  context.emit('shake', 1, 1000);

  assert.deepEqual(context.calls.filter(([name]) => name === 'fire'), [['fire', 'flap.trigger']]);
});

test('a reading is passed through unfiltered', () => {
  const context = setup();
  context.emit('light', 0, 0);
  context.engine.addConnection('light', { node: 'speed', port: 'level' });
  context.calls.length = 0;

  context.emit('light', 255, 100);
  context.emit('light', 0, 200); // a reading may legitimately snap back at once

  assert.deepEqual(
    context.calls.filter(([name, port]) => name === 'value' && port === 'speed.level'),
    [['value', 'speed.level', 1], ['value', 'speed.level', 0]],
  );
});

// --- Bearings ---------------------------------------------------------------
// A heading is a circle, and every other numeric transform in the runtime
// measures along a line. These pin down the difference.

test('a bearing offers only the two jacks a direction can answer', () => {
  const context = setup();
  context.emit('heading', 90);

  // No level: mapping a circle onto a control would need a seam for it to jump
  // across. No above/below: a direction has no high end and no low end.
  assert.equal(context.engine.addConnection('heading', { node: 'speed', port: 'level' }), null);
  assert.deepEqual(context.engine.listConnections(), []);
  assert.equal(context.signalStore.get('heading').kind, 'bearing');

  // The two it does offer both take, and land on the right transforms.
  const held = context.engine.addConnection('heading', { node: 'speed', port: 'hold' });
  const fired = context.engine.addConnection('heading', { node: 'flap', port: 'trigger' });
  assert.equal(held.transform.type, 'facing');
  assert.equal(fired.transform.type, 'faces');
});

test('facing north is measured the short way round, not from zero', () => {
  const context = setup();
  context.emit('heading', 180);
  context.engine.addConnection('heading', { node: 'speed', port: 'hold' });
  context.calls.length = 0;

  // 350° is ten degrees shy of north. Read as a plain number it is nowhere near
  // the value 0, which is exactly the mistake a linear transform would make.
  context.emit('heading', 350);
  assert.deepEqual(context.calls.filter(([, port]) => port === 'speed.hold').at(-1),
    ['value', 'speed.hold', 1]);

  context.emit('heading', 10);
  assert.deepEqual(context.calls.filter(([, port]) => port === 'speed.hold').at(-1),
    ['value', 'speed.hold', 1]);
});

test('spinning past the seam does not fire a trigger', () => {
  const context = setup();
  context.emit('heading', 180);
  const [wire] = [context.engine.addConnection('heading', { node: 'restart', port: 'trigger' })];
  context.engine.updateConnection(wire.id, { transform: { bearing: 180 } });
  context.calls.length = 0;

  // A sweep right through 0°/360°, nowhere near south. A threshold watching for
  // a crossing would fire on the wrap; a bearing has nothing to cross.
  for (const degrees of [300, 350, 359, 0, 1, 10, 60]) context.emit('heading', degrees);

  assert.deepEqual(context.calls.filter(([name]) => name === 'fire'), []);
});

test('a facing trigger fires on arrival and not again while it is held there', () => {
  const context = setup();
  context.emit('heading', 180);
  context.engine.addConnection('heading', { node: 'restart', port: 'trigger' });
  context.calls.length = 0;

  context.emit('heading', 5);   // arrives at north
  context.emit('heading', 0);   // still north
  context.emit('heading', 10);  // still north
  assert.deepEqual(context.calls.filter(([name]) => name === 'fire'), [['fire', 'restart.trigger']]);

  context.emit('heading', 180); // turned properly away
  context.emit('heading', 0);   // and back again
  assert.equal(context.calls.filter(([name]) => name === 'fire').length, 2);
});

test('resting on the edge of a sector does not chatter the hold', () => {
  const context = setup();
  context.emit('heading', 0);
  context.engine.addConnection('heading', { node: 'speed', port: 'hold' });
  context.emit('heading', 0); // pointing north, so the hold is on
  context.calls.length = 0;

  // Between the enter band and the exit band: whatever it was, it stays. This is
  // an object sitting on a sector boundary, which is where chatter would come
  // from without the two bands.
  for (const degrees of [45, 40, 50, 45]) context.emit('heading', degrees);

  // Nothing is reported at all: it was on, and it stayed on. Any entry here is
  // the hold moving inside its own dead band, which is the chatter.
  assert.deepEqual(context.calls.filter(([, port]) => port === 'speed.hold'), []);

  // Properly away, though, and it does let go.
  context.emit('heading', 90);
  assert.deepEqual(context.calls.filter(([, port]) => port === 'speed.hold').at(-1),
    ['value', 'speed.hold', 0]);
});

test('a saved bearing survives a reload and refuses a direction it does not offer', () => {
  const storage = memoryStorage();
  const context = setup(storage);
  context.emit('heading', 0);
  const wire = context.engine.addConnection('heading', { node: 'speed', port: 'hold' });
  context.engine.updateConnection(wire.id, { transform: { bearing: 270 } });

  const reloaded = setup(storage);
  assert.deepEqual(reloaded.engine.listConnections().map((c) => c.transform),
    [{ type: 'facing', bearing: 270 }]);

  // 45° is not one of the four, so the wire is dropped rather than snapped to
  // the nearest — the same as any other unreadable setting.
  //
  // Both halves are written the same way on purpose. This assertion used to run
  // against a key and a payload shape the loader never reads, so the wire was
  // "refused" only because storage was empty — the positive control below is
  // what stops that being true again without anybody noticing.
  const saved = (bearing) => {
    const store = memoryStorage();
    store.setItem(key('wiring', 'v3'), JSON.stringify({
      version: 3,
      games: {
        test: [{
          id: 'x',
          source: 'heading',
          sourceKind: 'bearing',
          target: { node: 'speed', port: 'hold' },
          transform: { type: 'facing', bearing },
        }],
      },
    }));
    return setup(store).engine.listConnections();
  };

  assert.equal(saved(270).length, 1, 'a direction it does offer is read back');
  assert.deepEqual(saved(45), [], 'and one it does not is dropped');
});

// --- "Is it lying flat" -----------------------------------------------------
// A gate asks which side of a line a reading is on, which cannot say "near the
// middle": level is pitch at zero, and zero is not past anything.

test('a near hold is on around its centre and off either side of it', () => {
  const context = setup();
  context.emit('pitch', 0);
  const wire = context.engine.addConnection('pitch', { node: 'speed', port: 'hold' }, 'hold-near');

  // pitch is -90..90, so it spans zero and the band centres there.
  assert.equal(wire.transform.type, 'near');
  assert.equal(wire.transform.center, 0);
  context.engine.updateConnection(wire.id, { transform: { center: 0, width: 10 } });
  context.calls.length = 0;

  for (const [degrees, expected] of [[0, 1], [8, 1], [-8, 1], [40, 0], [-40, 0], [2, 1]]) {
    context.calls.length = 0;
    context.emit('pitch', degrees);
    const last = context.calls.findLast(([name]) => name === 'value');
    if (last) assert.equal(last[2], expected, `${degrees}° should be ${expected}`);
  }
});

test('a near hold does not chatter on the edge of its band', () => {
  const context = setup();
  context.emit('pitch', 0);
  const wire = context.engine.addConnection('pitch', { node: 'speed', port: 'hold' }, 'hold-near');
  context.engine.updateConnection(wire.id, { transform: { center: 0, width: 10 } });
  context.emit('pitch', 0); // clearly on
  context.calls.length = 0;

  // Resting right on 10°, which is where a band with no slack would flap.
  for (const degrees of [10, 10.5, 9.5, 11, 10]) context.emit('pitch', degrees);
  assert.deepEqual(context.calls.filter(([name]) => name === 'value'), [],
    'nothing reported, because it never left');

  // Properly outside, though, and it does let go.
  context.emit('pitch', 30);
  assert.deepEqual(context.calls.findLast(([name]) => name === 'value'),
    ['value', 'speed.hold', 0]);
});

test('a near wire survives a reload', () => {
  const storage = memoryStorage();
  const first = setup(storage);
  first.emit('pitch', 0);
  const wire = first.engine.addConnection('pitch', { node: 'speed', port: 'hold' }, 'hold-near');
  first.engine.updateConnection(wire.id, { transform: { center: 0, width: 12 } });

  const second = setup(storage);
  second.emit('pitch', 0);
  const [restored] = second.engine.listConnections();
  assert.equal(restored.transform.type, 'near', 'not dropped as unreadable');
  assert.deepEqual(
    { center: restored.transform.center, width: restored.transform.width },
    { center: 0, width: 12 },
  );
});

// A reading that only ever climbs has no meaningful middle, so it starts where
// a gate would rather than at a zero it never reaches.
test('a near hold on a one-sided reading centres on its midpoint', () => {
  const context = setup();
  context.emit('light', 0); // 0..255
  const wire = context.engine.addConnection('light', { node: 'speed', port: 'hold' }, 'hold-near');
  assert.equal(wire.transform.center, 127.5);
});

test('a saved near wire falls back to a pass-through on an on/off source', () => {
  // btna is a declared on/off channel, so this wire was saved against a kind the
  // registry disagrees with — there is no middle left to be near.
  const stored = JSON.stringify({
    version: 3,
    games: {
      test: [{
        id: 'stale-near',
        source: 'btna',
        sourceKind: 'number',
        target: { node: 'speed', port: 'hold' },
        transform: { type: 'near', min: -90, max: 90, center: 0, width: 10 },
      }],
    },
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });
  context.emit('btna', 1);

  const [migrated] = context.engine.listConnections();
  assert.equal(migrated.transform.type, 'hold');
  // Centred on zero means it was holding while the reading was *low*, so the
  // pass-through it becomes has to be the inverted one to mean the same thing.
  assert.equal(migrated.transform.invert, true);
});
