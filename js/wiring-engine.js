// Coordinates persisted wire configuration, live signals, and game actions.
// Transform math and storage validation live in focused, testable modules.

import { canConnect, GAME_TARGETS, targetPort } from './wiring-config.js';
import {
  createDefaultTransform,
  createRuntimeState,
  migrateTransformForSignal,
  sampleRange,
  sampleTrigger,
} from './wiring-runtime.js';
import {
  browserStorage,
  loadConnections,
  normalizeTransform,
  saveConnections,
} from './wiring-storage.js';

export { canConnect, GAME_TARGETS } from './wiring-config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const portKey = (node, port) => `${node}.${port}`;

export function createWiringEngine({ signalStore, actions, storage } = {}) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const listeners = new Set();
  const runtime = new Map();
  const values = new Map();
  let connections = loadConnections(resolvedStorage);
  let idCounter = 0;
  let positionEnabled = null;

  for (const target of GAME_TARGETS) {
    for (const port of target.ports) {
      if (port.type === 'value') values.set(portKey(target.id, port.id), port.defaultValue ?? 0);
    }
  }

  function notify(event) {
    listeners.forEach((listener) => listener(event));
  }

  function persist() {
    saveConnections(resolvedStorage, connections);
  }

  function applyValue(node, port, value) {
    const normalized = clamp01(value);
    values.set(portKey(node, port), normalized);
    if (node === 'speed') actions.setGameSpeed(normalized);
    if (node === 'position') actions.setPosition(normalized);
    if (node === 'gravity') actions.setGravity(normalized);
  }

  function syncDestinations() {
    const nextPositionEnabled = connections.some(
      ({ target }) => target.node === 'position' && target.port === 'y',
    );
    if (nextPositionEnabled !== positionEnabled) {
      positionEnabled = nextPositionEnabled;
      actions.setPositionEnabled(positionEnabled);
    }

    for (const target of GAME_TARGETS) {
      for (const port of target.ports) {
        if (port.type !== 'value') continue;
        const connected = connections.some((connection) => targetsEqual(connection.target, {
          node: target.id,
          port: port.id,
        }));
        if (!connected) applyValue(target.id, port.id, port.defaultValue ?? 0);
      }
    }
  }

  function syncSources() {
    const sources = new Map();
    connections.forEach(({ source, sourceKind }) => sources.set(source, { channel: source, kind: sourceKind }));
    signalStore.setWiredChannels([...sources.values()]);
  }

  function reconcileSourceKinds() {
    let changed = false;
    connections = connections.filter((connection) => {
      const signal = signalStore.get(connection.source);
      const port = targetPort(connection.target);
      if (!signal || !port) return true;
      if (!canConnect(signal, port)) {
        runtime.delete(connection.id);
        changed = true;
        return false;
      }
      if (connection.sourceKind !== signal.kind) {
        connection.sourceKind = signal.kind;
        connection.transform = migrateTransformForSignal(connection.transform, signal);
        runtime.delete(connection.id);
        changed = true;
      }
      return true;
    });
    if (changed) {
      syncSources();
      persist();
      notify({ type: 'connections' });
    }
  }

  function migrateSourceKind(signal) {
    let changed = false;
    for (const connection of connections) {
      if (connection.source !== signal.channel || connection.sourceKind === signal.kind) continue;
      connection.sourceKind = signal.kind;
      connection.transform = migrateTransformForSignal(connection.transform, signal);
      runtime.delete(connection.id);
      changed = true;
    }
    if (changed) {
      syncSources();
      persist();
      notify({ type: 'connections' });
    }
  }

  function runtimeState(id) {
    if (!runtime.has(id)) runtime.set(id, createRuntimeState());
    return runtime.get(id);
  }

  function processValue(connection, signal) {
    if (connection.transform.type !== 'range') return;
    const output = sampleRange(signal.value ?? 0, connection.transform, runtimeState(connection.id));
    applyValue(connection.target.node, connection.target.port, output);
    notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
  }

  function processTrigger(connection, signal) {
    if (connection.transform.type === 'range') return;
    const result = sampleTrigger(
      signal.value ?? 0,
      connection.transform,
      runtimeState(connection.id),
      Number.isFinite(signal.lastSeen) ? signal.lastSeen : performance.now(),
    );
    if (result.fired) {
      if (connection.target.node === 'flap') {
        actions.flap({ magnitude: values.get(portKey('flap', 'magnitude')) });
      } else if (connection.target.node === 'restart') {
        actions.restartGame();
      }
    }
    notify({ type: 'activity', connectionId: connection.id, value: result.value, fired: result.fired });
  }

  function processSignal(signal) {
    const matching = connections.filter((connection) => connection.source === signal.channel);
    // Continuous values must use the current sample before a trigger wired to
    // the same source fires, regardless of connection insertion order.
    matching.forEach((connection) => {
      if (targetPort(connection.target)?.type === 'value') processValue(connection, signal);
    });
    matching.forEach((connection) => {
      if (targetPort(connection.target)?.type === 'trigger') processTrigger(connection, signal);
    });
  }

  function connectionsChanged() {
    syncSources();
    syncDestinations();
    persist();
    notify({ type: 'connections' });
  }

  function targetsEqual(left, right) {
    return left.node === right.node && left.port === right.port;
  }

  syncSources();
  reconcileSourceKinds();
  syncDestinations();
  const unsubscribeSignals = signalStore.subscribe(({ type, signal }) => {
    if (type === 'kind') migrateSourceKind(signal);
    if (type === 'value') processSignal(signal);
  });

  return {
    targets: GAME_TARGETS,
    listConnections: () => structuredClone(connections),
    addConnection(source, target) {
      const signal = signalStore.get(source);
      const port = targetPort(target);
      if (!canConnect(signal, port)) return null;

      const existing = connections.find(
        (connection) => connection.source === source && targetsEqual(connection.target, target),
      );
      if (existing) return structuredClone(existing);

      if (port.type === 'value') {
        const replaced = connections.filter((connection) => targetsEqual(connection.target, target));
        replaced.forEach((connection) => runtime.delete(connection.id));
        connections = connections.filter((connection) => !replaced.includes(connection));
        applyValue(target.node, target.port, port.defaultValue ?? 0);
      }

      const connection = {
        id: `wire-${Date.now().toString(36)}-${++idCounter}`,
        source,
        sourceKind: signal.kind,
        target: { ...target },
        transform: createDefaultTransform(signal, port),
      };
      connections.push(connection);
      connectionsChanged();
      return structuredClone(connection);
    },
    updateConnection(id, patch) {
      const connection = connections.find((item) => item.id === id);
      if (!connection || !patch?.transform) return;
      const port = targetPort(connection.target);
      const transform = normalizeTransform({ ...connection.transform, ...patch.transform });
      if (!port || !transform || (port.type === 'value') !== (transform.type === 'range')) return;
      connection.transform = transform;
      runtime.delete(id);
      connectionsChanged();
    },
    removeConnection(id) {
      const next = connections.filter((connection) => connection.id !== id);
      if (next.length === connections.length) return;
      connections = next;
      runtime.delete(id);
      connectionsChanged();
    },
    reset() {
      if (connections.length === 0) return;
      connections = [];
      runtime.clear();
      connectionsChanged();
    },
    subscribe(listener, { emitCurrent = false } = {}) {
      listeners.add(listener);
      if (emitCurrent) listener({ type: 'connections' });
      return () => listeners.delete(listener);
    },
    destroy() {
      unsubscribeSignals();
      listeners.clear();
    },
  };
}
