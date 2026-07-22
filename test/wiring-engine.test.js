import assert from 'node:assert/strict';
import test from 'node:test';

import { createWiringEngine } from '../js/wiring-engine.js';

const SIGNALS = [
  { channel: 'p0', label: 'Pin 0', kind: 'binary', min: 0, max: 1 },
  { channel: 'mic', label: 'Sound', kind: 'number', min: 0, max: 255 },
  { channel: 'light', label: 'Light', kind: 'number', min: 0, max: 255 },
  { channel: 'shake', label: 'Shake', kind: 'event', min: 0, max: 1 },
];

function harness(memory = new Map()) {
  const catalog = new Map(SIGNALS.map((signal) => [signal.channel, signal]));
  const calls = [];
  const wired = [];
  let receive = () => {};
  const signalStore = {
    get: (channel) => catalog.get(channel) || null,
    subscribe(listener) {
      receive = listener;
      return () => {};
    },
    setWiredChannels(channels) {
      wired.splice(0, wired.length, ...channels);
    },
  };
  const actions = {
    flap: (options) => calls.push(['flap', options]),
    restartGame: () => calls.push(['restart']),
    setGameSpeed: (value) => calls.push(['speed', value]),
    setPosition: (value) => calls.push(['position', value]),
    setGravity: (value) => calls.push(['gravity', value]),
    setPositionEnabled: (value) => calls.push(['position-enabled', value]),
  };
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  };
  const engine = createWiringEngine({ signalStore, actions, storage });
  const emit = (channel, value, lastSeen) => receive({
    type: 'value',
    signal: { ...catalog.get(channel), value, lastSeen },
  });
  return { engine, calls, wired, emit, memory };
}

test('binary trigger samples the latest wired flap magnitude', () => {
  const { engine, calls, emit } = harness();
  calls.length = 0;
  engine.addConnection('p0', { node: 'flap', port: 'trigger' });
  engine.addConnection('p0', { node: 'flap', port: 'trigger' });
  engine.addConnection('mic', { node: 'flap', port: 'magnitude' });
  assert.equal(engine.listConnections().length, 2, 'an identical wire is not added twice');

  emit('mic', 255, 10);
  emit('p0', 0, 20);
  emit('p0', 1, 30);
  assert.deepEqual(calls.findLast(([name]) => name === 'flap'), ['flap', { magnitude: 1 }]);

  engine.addConnection('light', { node: 'speed', port: 'value' });
  emit('p0', 1, 300);
  assert.equal(
    calls.filter(([name]) => name === 'flap').length,
    1,
    'held binary input must not repeat when an unrelated wire changes',
  );
});

test('numeric trigger crosses its configured threshold with per-wire cooldown', () => {
  const { engine, calls, emit } = harness();
  calls.length = 0;
  engine.addConnection('light', { node: 'restart', port: 'trigger' });

  emit('light', 100, 10);
  emit('light', 200, 20);
  assert.equal(calls.filter(([name]) => name === 'restart').length, 1);

  emit('light', 100, 40);
  emit('light', 200, 60);
  assert.equal(calls.filter(([name]) => name === 'restart').length, 1, 'cooldown suppresses a fast repeat');

  emit('light', 100, 300);
  emit('light', 200, 500);
  assert.equal(calls.filter(([name]) => name === 'restart').length, 2);
});

test('value ports normalize readings and manage direct-position mode', () => {
  const { engine, calls, emit } = harness();
  calls.length = 0;
  const connection = engine.addConnection('mic', { node: 'position', port: 'y' });
  assert.ok(calls.some(([name, enabled]) => name === 'position-enabled' && enabled));

  emit('mic', 127.5, 10);
  assert.deepEqual(calls.findLast(([name]) => name === 'position'), ['position', 0.5]);

  engine.removeConnection(connection.id);
  assert.ok(calls.some(([name, enabled]) => name === 'position-enabled' && !enabled));
  assert.equal(engine.addConnection('shake', { node: 'speed', port: 'value' }), null);
});

test('connections persist with enough source metadata to restore the editor', () => {
  const memory = new Map();
  const first = harness(memory);
  first.engine.addConnection('p0', { node: 'flap', port: 'trigger' });
  first.engine.destroy();

  const restored = harness(memory);
  assert.equal(restored.engine.listConnections().length, 1);
  assert.deepEqual(restored.wired, [{ channel: 'p0', kind: 'binary' }]);
});
