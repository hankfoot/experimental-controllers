import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalStore } from '../js/signal-store.js';
import { createWiringEngine } from '../js/wiring-engine.js';

function setup(storage = null, { useBrowserStorage = false } = {}) {
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
    flap: (options) => calls.push(['flap', options]),
    restartGame: () => calls.push(['restart']),
    setGameSpeed: (value) => calls.push(['speed', value]),
    setGravity: (value) => calls.push(['gravity', value]),
    setPosition: (value) => calls.push(['position', value]),
    setPositionEnabled: (value) => calls.push(['position-enabled', value]),
  };
  const engine = createWiringEngine({
    signalStore,
    actions,
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
  context.emit('light', 255);

  assert.deepEqual(
    context.calls.findLast(([name]) => name === 'flap'),
    ['flap', { magnitude: 1 }],
  );
});

test('custom binary wires migrate when their source becomes numeric', () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
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
  assert.deepEqual(context.calls.findLast(([name]) => name === 'speed'), ['speed', 1]);
  assert.match(saved.values().next().value, /"sourceKind":"number"/);
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

  assert.equal(context.calls.filter(([name]) => name === 'restart').length, 2);
});

test('repeated custom event samples can each trigger', () => {
  const context = setup();
  context.emit('custom', 1, 0);
  const connection = context.engine.addConnection('custom', { node: 'flap', port: 'trigger' });
  context.engine.updateConnection(connection.id, { transform: { type: 'event' } });

  context.emit('custom', 1, 200);
  context.emit('custom', 1, 400);

  assert.equal(context.calls.filter(([name]) => name === 'flap').length, 2);
});

test('event signals cannot connect to continuous values', () => {
  const context = setup();
  context.emit('shake', 1);
  assert.equal(context.engine.addConnection('shake', { node: 'speed', port: 'value' }), null);
});

test('unrelated wiring edits do not reapply position mode', () => {
  const context = setup();
  context.emit('btna', 0);
  context.engine.addConnection('btna', { node: 'flap', port: 'trigger' });
  context.engine.addConnection('btna', { node: 'restart', port: 'trigger' });

  assert.deepEqual(
    context.calls.filter(([name]) => name === 'position-enabled'),
    [['position-enabled', false]],
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

test('saved wires are validated and early v1 numeric triggers are migrated', () => {
  const stored = JSON.stringify({
    version: 1,
    connections: [
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
        id: 'invalid',
        source: 'light',
        sourceKind: 'number',
        target: { node: 'speed', port: 'value' },
        transform: { type: 'range', min: 'oops', max: 255, invert: false, smoothing: 0 },
      },
    ],
  });
  const context = setup({ getItem: () => stored, setItem: () => {} });
  const connections = context.engine.listConnections();

  assert.deepEqual(connections.map(({ id }) => id), ['threshold', 'change']);
  assert.deepEqual(connections.map(({ transform }) => transform.invert), [false, false]);
});

test('saved source kinds reconcile with authoritative channel metadata', () => {
  const stored = JSON.stringify({
    version: 1,
    connections: [{
      id: 'shake-wire',
      source: 'shake',
      sourceKind: 'binary',
      target: { node: 'flap', port: 'trigger' },
      transform: { type: 'edge', edge: 'rising', cooldownMs: 160 },
    }],
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
