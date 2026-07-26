// Coordinates persisted wire configuration, live signals, and the active game.
// It knows nothing about any particular control: a wired level or hold port
// becomes actions.setValue(node, port, 0..1) — a hold simply only ever sends the
// two ends — and a wired trigger becomes actions.fire(node, port). Each game
// interprets those however it likes.

import {
  canConnect,
  findPort,
  isValuePort,
  outputIdOf,
  portTypeForTransform,
} from './wiring-config.js';
import {
  createChannelFilter,
  createDefaultTransform,
  createRuntimeState,
  filterBinary,
  migrateTransformForSignal,
  sampleGate,
  sampleHold,
  sampleRange,
  sampleTrigger,
} from './wiring-runtime.js';
import {
  browserStorage,
  loadConnections,
  loadPortOptions,
  normalizeTransform,
  saveConnections,
  savePortOptions,
} from './wiring-storage.js';

export { canConnect } from './wiring-config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const portKey = (node, port) => `${node}.${port}`;

export function createWiringEngine({ signalStore, actions, storage, game } = {}) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const listeners = new Set();
  const runtime = new Map();
  // Keyed by channel, not by wire: a dropped tick is a fact about the contact,
  // so two controls wired to the same pad must agree on whether it is held.
  const filters = new Map();
  let targets = game?.targets ?? [];
  let gameId = game?.id ?? '';
  let connections = loadConnections(resolvedStorage, gameId, targets);
  let chosen = loadPortOptions(resolvedStorage, gameId);
  let idCounter = 0;

  function notify(event) {
    listeners.forEach((listener) => listener(event));
  }

  // --- Control options ------------------------------------------------------
  // What a control does with what it's given. The game declares the choices on
  // its own ports; the engine only remembers which one is picked and hands the
  // resolved set back, so the game never has to read storage itself.
  function optionsFor(node, port) {
    const definition = findPort(targets, { node, port });
    const picked = chosen[portKey(node, port)] ?? {};
    const resolved = {};
    for (const option of definition?.options ?? []) {
      const value = picked[option.id];
      const known = option.choices.some(([id]) => id === value);
      resolved[option.id] = known ? value : option.value;
    }
    return resolved;
  }

  function publishOptions() {
    for (const target of targets) {
      for (const port of target.ports) {
        if (!port.options?.length) continue;
        actions.setControlOptions?.(target.id, port.id, optionsFor(target.id, port.id));
      }
    }
  }

  function persist() {
    saveConnections(resolvedStorage, gameId, connections);
  }

  function applyValue(node, port, value) {
    actions.setValue(node, port, clamp01(value));
  }

  function syncDestinations() {
    // Games use this to decide whether a control is under wire control or still
    // following its manual fallback.
    actions.setWiredPorts(new Set(
      connections.map(({ target }) => portKey(target.node, target.port)),
    ));

    for (const target of targets) {
      for (const port of target.ports) {
        // Only a port that carries a running value has one to fall back to: a
        // trigger is a moment, and a setting is never driven by anything.
        if (!isValuePort(port.type)) continue;
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

  const SAMPLERS = { gate: sampleGate, hold: sampleHold, range: sampleRange };

  function processValue(connection, value) {
    const { transform } = connection;
    const sample = SAMPLERS[transform.type];
    if (!sample) return;
    const output = sample(value, transform, runtimeState(connection.id));
    applyValue(connection.target.node, connection.target.port, output);
    notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
  }

  function processTrigger(connection, signal, value) {
    if (portTypeForTransform(connection.transform.type) !== 'trigger') return;
    const result = sampleTrigger(
      value,
      connection.transform,
      runtimeState(connection.id),
      Number.isFinite(signal.lastSeen) ? signal.lastSeen : performance.now(),
    );
    if (result.fired) actions.fire(connection.target.node, connection.target.port);
    notify({ type: 'activity', connectionId: connection.id, value: result.value, fired: result.fired });
  }

  // What the wiring acts on, which is not always what arrived. An on/off contact
  // gets its dropped ticks filled in before any wire sees it; a reading and a
  // gesture are passed through untouched — a reading has its own smoothing and
  // dead band, and a gesture is a single 1 with no second tick to confirm it.
  // The signal store keeps the raw value either way, so the plots stay honest
  // about what the board actually sent.
  function actedValue(signal) {
    const raw = signal.value ?? 0;
    if (signal.kind !== 'binary') return raw;
    if (!filters.has(signal.channel)) filters.set(signal.channel, createChannelFilter());
    return filterBinary(raw, filters.get(signal.channel));
  }

  function processSignal(signal) {
    // Tracked for every channel, wired or not, so a pad that is already being
    // held when you wire it up is held as far as the new wire is concerned.
    const value = actedValue(signal);
    const matching = connections.filter((connection) => connection.source === signal.channel);
    // Continuous values must use the current sample before a trigger wired to
    // the same source fires, regardless of connection insertion order.
    matching.forEach((connection) => {
      if (isValuePort(findPort(targets, connection.target)?.type)) processValue(connection, value);
    });
    matching.forEach((connection) => {
      if (findPort(targets, connection.target)?.type === 'trigger') processTrigger(connection, signal, value);
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
  publishOptions();
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
      connections = loadConnections(resolvedStorage, gameId, targets);
      chosen = loadPortOptions(resolvedStorage, gameId);
      syncSources();
      reconcileSourceKinds();
      syncDestinations();
      publishOptions();
      notify({ type: 'connections' });
    },
    /** The resolved choices for one control, falling back to its declared default. */
    controlOptions: (node, port) => optionsFor(node, port),
    setControlOption(node, port, id, value) {
      const key = portKey(node, port);
      chosen = { ...chosen, [key]: { ...chosen[key], [id]: value } };
      savePortOptions(resolvedStorage, gameId, chosen);
      actions.setControlOptions?.(node, port, optionsFor(node, port));
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

      // One wire per value port: the new one replaces whatever was there, and the
      // port goes back to its default in the gap before the new wire's first
      // sample. A trigger simply stacks — several moments can fire one control.
      if (isValuePort(port.type)) {
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
      if (!port || !transform || port.type !== portTypeForTransform(transform.type)) return;
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
