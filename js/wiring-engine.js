// Coordinates persisted wire configuration, live signals, and the active game.
// It knows nothing about any particular control: a wired value port becomes
// actions.setValue(node, port, 0..1) and a wired trigger becomes
// actions.fire(node, port). Each game interprets those however it likes.

import { canConnect, findPort, isValueTransform, outputIdOf } from './wiring-config.js';
import {
  createDefaultTransform,
  createRuntimeState,
  migrateTransformForSignal,
  sampleGate,
  sampleRange,
  sampleTrigger,
} from './wiring-runtime.js';
import {
  browserStorage,
  loadConnections,
  normalizeTransform,
  saveConnections,
} from './wiring-storage.js';

export { canConnect } from './wiring-config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const portKey = (node, port) => `${node}.${port}`;

export function createWiringEngine({ signalStore, actions, storage, game } = {}) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const listeners = new Set();
  const runtime = new Map();
  const values = new Map();
  let targets = game?.targets ?? [];
  let gameId = game?.id ?? '';
  let connections = loadConnections(resolvedStorage, gameId, targets);
  let idCounter = 0;

  function notify(event) {
    listeners.forEach((listener) => listener(event));
  }

  function persist() {
    saveConnections(resolvedStorage, gameId, connections);
  }

  function applyValue(node, port, value) {
    const normalized = clamp01(value);
    values.set(portKey(node, port), normalized);
    actions.setValue(node, port, normalized);
  }

  function syncDestinations() {
    // Games use this to decide whether a control is under wire control or still
    // following its manual fallback.
    actions.setWiredPorts(new Set(
      connections.map(({ target }) => portKey(target.node, target.port)),
    ));

    for (const target of targets) {
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
      const port = findPort(targets, connection.target);
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
    const { transform } = connection;
    if (!isValueTransform(transform.type)) return;
    const sample = transform.type === 'gate' ? sampleGate : sampleRange;
    const output = sample(signal.value ?? 0, transform, runtimeState(connection.id));
    applyValue(connection.target.node, connection.target.port, output);
    notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
  }

  function processTrigger(connection, signal) {
    if (isValueTransform(connection.transform.type)) return;
    const result = sampleTrigger(
      signal.value ?? 0,
      connection.transform,
      runtimeState(connection.id),
      Number.isFinite(signal.lastSeen) ? signal.lastSeen : performance.now(),
    );
    if (result.fired) actions.fire(connection.target.node, connection.target.port);
    notify({ type: 'activity', connectionId: connection.id, value: result.value, fired: result.fired });
  }

  function processSignal(signal) {
    const matching = connections.filter((connection) => connection.source === signal.channel);
    // Continuous values must use the current sample before a trigger wired to
    // the same source fires, regardless of connection insertion order.
    matching.forEach((connection) => {
      if (findPort(targets, connection.target)?.type === 'value') processValue(connection, signal);
    });
    matching.forEach((connection) => {
      if (findPort(targets, connection.target)?.type === 'trigger') processTrigger(connection, signal);
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
    get targets() {
      return targets;
    },
    get gameId() {
      return gameId;
    },
    // Swaps in another game's ports and its own saved connections. Nothing is
    // carried across — each game's wiring is independent.
    setGame(next) {
      if (!next || next.id === gameId) return;
      gameId = next.id;
      targets = next.targets ?? [];
      runtime.clear();
      values.clear();
      connections = loadConnections(resolvedStorage, gameId, targets);
      syncSources();
      reconcileSourceKinds();
      syncDestinations();
      notify({ type: 'connections' });
    },
    listConnections: () => structuredClone(connections),
    // `outputId` picks which of the source's jacks drives the port — it only
    // decides the starting transform, since the transform is what the output is
    // read back from afterwards. Omitting it takes the port's first fit.
    addConnection(source, target, outputId) {
      const signal = signalStore.get(source);
      const port = findPort(targets, target);
      if (!canConnect(signal, port)) return null;

      // Re-picking the same jack is a no-op, but swapping a port from one jack
      // to another must fall through and rebuild the transform.
      const existing = connections.find((connection) =>
        connection.source === source
        && targetsEqual(connection.target, target)
        && (outputId === undefined
          || outputIdOf(signal, port, connection.transform) === outputId));
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
        transform: createDefaultTransform(signal, port, outputId),
      };
      connections.push(connection);
      connectionsChanged();
      return structuredClone(connection);
    },
    updateConnection(id, patch) {
      const connection = connections.find((item) => item.id === id);
      if (!connection || !patch?.transform) return;
      const port = findPort(targets, connection.target);
      const transform = normalizeTransform({ ...connection.transform, ...patch.transform });
      if (!port || !transform || (port.type === 'value') !== isValueTransform(transform.type)) return;
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
