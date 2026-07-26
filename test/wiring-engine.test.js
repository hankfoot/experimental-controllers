import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalStore } from '../js/signal-store.js';
import { createWiringEngine } from '../js/wiring-engine.js';

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
        { id: 'magnitude', label: 'Strength', type: 'value', defaultValue: 0.57 },
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
      id: 'speed',
      label: 'Speed',
      emoji: '💨',
      description: 'test',
      ports: [{ id: 'value', label: 'Speed', type: 'value', defaultValue: 0.5 }],
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
    ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
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

function memoryStorage() {
  const saved = new Map();
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
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
  context.engine.addConnection('custom', { node: 'speed', port: 'value' });

  context.emit('custom', 200);
  const [trigger, value] = context.engine.listConnections();

  assert.equal(trigger.sourceKind, 'number');
  assert.deepEqual(
    { type: trigger.transform.type, min: trigger.transform.min, max: trigger.transform.max },
    { type: 'threshold', min: 0, max: 200 },
  );
  assert.equal(value.sourceKind, 'number');
  assert.deepEqual(
    { type: value.transform.type, min: value.transform.min, max: value.transform.max },
    { type: 'range', min: 0, max: 200 },
  );
  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.value'),
    ['value', 'speed.value', 1],
  );
  assert.match(storage.saved.values().next().value, /"sourceKind":"number"/);
});

test('an analog hold gates a value port into a held on/off', () => {
  const context = setup();
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'speed', port: 'value' }, 'hold');
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
  const [connection] = [context.engine.addConnection('light', { node: 'speed', port: 'value' }, 'hold')];

  // light is 0..255, so the default sits at the midpoint rather than at "50%".
  assert.equal(connection.transform.threshold, 127.5);
  assert.equal(connection.transform.invert, undefined);
});

test('an analog hold rides through chatter at its threshold', () => {
  const context = setup();
  context.emit('light', 0);
  const connection = context.engine.addConnection('light', { node: 'speed', port: 'value' }, 'hold');
  context.engine.updateConnection(connection.id, { transform: { min: 0, max: 100, threshold: 50 } });
  context.emit('light', 80); // clearly on
  context.calls.length = 0;

  // Readings that hover right on the 50 line must not flap the control.
  context.emit('light', 49);
  context.emit('light', 51);
  context.emit('light', 49);

  assert.deepEqual(
    context.calls.filter(([name]) => name === 'value').map(([, , value]) => value),
    [1, 1, 1],
  );
});

test('a gated wire survives a reload and keeps holding', () => {
  const storage = memoryStorage();
  const first = setup(storage);
  first.emit('light', 0);
  first.engine.addConnection('light', { node: 'speed', port: 'value' }, 'hold');

  const second = setup(storage);
  second.emit('light', 0);
  const [restored] = second.engine.listConnections();
  assert.equal(restored.transform.type, 'gate');

  second.calls.length = 0;
  second.emit('light', 255);
  assert.deepEqual(
    second.calls.findLast(([name, port]) => name === 'value' && port === 'speed.value'),
    ['value', 'speed.value', 1],
  );
});

test('a saved gate falls back to a plain range when its source only reads 0/1', () => {
  // btna is a known on/off channel, so this wire was saved against a kind the
  // registry disagrees with — there is nothing left for a gate to threshold.
  const stored = JSON.stringify({
    version: 2,
    games: {
      test: [{
        id: 'stale-gate',
        source: 'btna',
        sourceKind: 'number',
        target: { node: 'speed', port: 'value' },
        transform: { type: 'gate', min: 0, max: 255, direction: 'above', threshold: 128 },
      }],
    },
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });
  const [connection] = context.engine.listConnections();

  assert.equal(connection.sourceKind, 'binary');
  assert.deepEqual(connection.transform, {
    type: 'range', min: 0, max: 1, invert: false, smoothing: 0,
  });
});

test('re-patching a value port from one jack to the other swaps the transform', () => {
  const context = setup();
  context.emit('light', 0);
  context.engine.addConnection('light', { node: 'speed', port: 'value' }, 'level');
  assert.equal(context.engine.listConnections()[0].transform.type, 'range');

  context.engine.addConnection('light', { node: 'speed', port: 'value' }, 'hold');

  const connections = context.engine.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].transform.type, 'gate');
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
  assert.equal(context.engine.addConnection('shake', { node: 'speed', port: 'value' }), null);
});

test('games are told which ports are under wire control', () => {
  const context = setup();
  context.emit('btna', 0);
  context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });
  context.engine.addConnection('btna', { node: 'speed', port: 'value' });

  assert.deepEqual(
    context.calls.findLast(([name]) => name === 'wired'),
    ['wired', ['flap.trigger', 'speed.value']],
  );
});

test('unwired value ports fall back to their declared default', () => {
  const context = setup();
  context.emit('light', 0);
  const connection = context.engine.addConnection('light', { node: 'speed', port: 'value' });
  context.calls.length = 0;
  context.engine.removeConnection(connection.id);

  assert.deepEqual(
    context.calls.findLast(([name, port]) => name === 'value' && port === 'speed.value'),
    ['value', 'speed.value', 0.5],
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
  context.engine.addConnection('light', { node: 'speed', port: 'value' });
  assert.equal(context.engine.listConnections().length, 1);

  context.engine.setGame(OTHER_GAME);
  assert.equal(context.engine.gameId, 'other');
  assert.deepEqual(context.engine.listConnections(), []);

  context.engine.addConnection('light', { node: 'paddle', port: 'y' });
  context.engine.setGame(TEST_GAME);

  const restored = context.engine.listConnections();
  assert.deepEqual(restored.map(({ target }) => `${target.node}.${target.port}`), ['speed.value']);
});

test('a game only loads connections that match its own ports', () => {
  const stored = JSON.stringify({
    version: 2,
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
    version: 2,
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
          target: { node: 'speed', port: 'value' },
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
    version: 2,
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
