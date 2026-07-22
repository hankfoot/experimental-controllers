// Runtime for connecting controller signals to typed game-action ports. The
// configuration is plain JSON so the patch bay can persist and edit it safely.

const STORAGE_KEY = 'experimental-game-controllers:wiring:v1';
const CONFIG_VERSION = 1;

export const GAME_TARGETS = [
  {
    id: 'flap', label: 'Flap', emoji: '🐤', description: 'Give the bird an upward push.',
    ports: [
      { id: 'trigger', label: 'Trigger', type: 'trigger' },
      { id: 'magnitude', label: 'Strength', type: 'value', defaultValue: 0.57 },
    ],
  },
  {
    id: 'restart', label: 'Restart game', emoji: '↻', description: 'Start immediately from the beginning.',
    ports: [{ id: 'trigger', label: 'Trigger', type: 'trigger' }],
  },
  {
    id: 'speed', label: 'Game speed', emoji: '💨', description: 'Control how quickly the pipes move.',
    ports: [{ id: 'value', label: 'Speed', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'position', label: 'Bird position', emoji: '↕️', description: 'Direct steering from top to bottom; replaces flap physics.',
    ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'gravity', label: 'Gravity', emoji: '🪨', description: 'Make flap controls floaty or heavy.',
    ports: [{ id: 'value', label: 'Weight', type: 'value', defaultValue: 0.5 }],
  },
];

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const portKey = (node, port) => `${node}.${port}`;

function targetPort(target) {
  return GAME_TARGETS.find((node) => node.id === target.node)
    ?.ports.find((port) => port.id === target.port) || null;
}

function defaultTransform(signal, port) {
  const min = signal?.kind === 'binary' ? 0 : signal?.min ?? 0;
  const max = signal?.kind === 'binary' ? 1 : signal?.max ?? 1;
  if (port.type === 'value') {
    return { type: 'range', min, max, invert: false, smoothing: 0 };
  }
  if (signal?.kind === 'event') return { type: 'event', cooldownMs: 160 };
  if (signal?.kind === 'binary') return { type: 'edge', edge: 'rising', cooldownMs: 160 };
  return { type: 'threshold', min, max, direction: 'above', threshold: 0.5, cooldownMs: 160 };
}

export function canConnect(signal, port) {
  if (!signal || !port) return false;
  return port.type === 'trigger' || signal.kind !== 'event';
}

export function createWiringEngine({ signalStore, actions, storage = globalThis.localStorage }) {
  const listeners = new Set();
  const runtime = new Map();
  const values = new Map();
  let connections = [];
  let idCounter = 0;

  for (const target of GAME_TARGETS) {
    for (const port of target.ports) {
      if (port.type === 'value') values.set(portKey(target.id, port.id), port.defaultValue);
    }
  }

  function notify(event) {
    listeners.forEach((listener) => listener(event));
  }

  function persist() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: CONFIG_VERSION, connections }));
    } catch {
      // Storage can be blocked in private browsing; wiring still works in memory.
    }
  }

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (saved?.version !== CONFIG_VERSION || !Array.isArray(saved.connections)) return;
      connections = saved.connections.filter((connection) =>
        typeof connection?.source === 'string' && targetPort(connection.target));
    } catch {
      connections = [];
    }
  }

  function applyValue(node, port, value) {
    const normalized = clamp01(value);
    values.set(portKey(node, port), normalized);
    if (node === 'speed') actions.setGameSpeed(normalized);
    if (node === 'position') actions.setPosition(normalized);
    if (node === 'gravity') actions.setGravity(normalized);
  }

  function syncDestinations() {
    const positionConnected = connections.some(({ target }) =>
      target.node === 'position' && target.port === 'y');
    actions.setPositionEnabled(positionConnected);

    for (const target of GAME_TARGETS) {
      for (const port of target.ports) {
        if (port.type !== 'value') continue;
        const connected = connections.some((connection) =>
          connection.target.node === target.id && connection.target.port === port.id);
        if (!connected) applyValue(target.id, port.id, port.defaultValue);
      }
    }
  }

  function syncSources() {
    const sources = new Map();
    connections.forEach(({ source, sourceKind }) => sources.set(source, { channel: source, kind: sourceKind }));
    signalStore.setWiredChannels([...sources.values()]);
  }

  function normalize(value, transform) {
    const min = Number(transform.min);
    const max = Number(transform.max);
    const span = max - min || 1;
    const normalized = clamp01((value - min) / span);
    return transform.invert ? 1 - normalized : normalized;
  }

  function processValue(connection, signal, state) {
    let output = normalize(signal.value, connection.transform);
    const smoothing = clamp01(Number(connection.transform.smoothing) || 0);
    if (state.filtered != null) output = state.filtered * smoothing + output * (1 - smoothing);
    state.filtered = output;
    applyValue(connection.target.node, connection.target.port, output);
    return output;
  }

  function processTrigger(connection, signal, state, now) {
    const transform = connection.transform;
    const cooldown = Math.max(0, Number(transform.cooldownMs) || 0);
    let fired = false;
    let output = signal.value;

    if (transform.type === 'event') {
      fired = signal.value > 0;
    } else if (transform.type === 'edge') {
      fired = transform.edge === 'falling'
        ? state.previousRaw === 1 && signal.value === 0
        : signal.value === 1 && state.previousRaw !== 1;
    } else {
      output = normalize(signal.value, transform);
      if (transform.type === 'change') {
        fired = state.previousNormalized != null
          && Math.abs(output - state.previousNormalized) >= clamp01(Number(transform.amount) || 0);
      } else {
        const threshold = clamp01(Number(transform.threshold) || 0);
        fired = state.previousNormalized != null && (transform.direction === 'below'
          ? state.previousNormalized >= threshold && output < threshold
          : state.previousNormalized <= threshold && output > threshold);
      }
      state.previousNormalized = output;
    }
    state.previousRaw = signal.value;

    if (!fired || now - state.lastFiredAt < cooldown) return { fired: false, output };
    state.lastFiredAt = now;
    if (connection.target.node === 'flap') {
      actions.flap({ magnitude: values.get(portKey('flap', 'magnitude')) });
    }
    if (connection.target.node === 'restart') actions.restartGame();
    return { fired: true, output };
  }

  function processSignal(signal) {
    const now = signal.lastSeen || performance.now();
    for (const connection of connections) {
      if (connection.source !== signal.channel) continue;
      const port = targetPort(connection.target);
      if (!port) continue;
      let state = runtime.get(connection.id);
      if (!state) {
        state = { previousRaw: null, previousNormalized: null, filtered: null, lastFiredAt: -Infinity };
        runtime.set(connection.id, state);
      }
      if (port.type === 'value') {
        const output = processValue(connection, signal, state);
        notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
      } else {
        const result = processTrigger(connection, signal, state, now);
        notify({ type: 'activity', connectionId: connection.id, value: result.output, fired: result.fired });
      }
    }
  }

  function connectionsChanged() {
    syncSources();
    syncDestinations();
    persist();
    notify({ type: 'connections' });
  }

  load();
  syncSources();
  syncDestinations();
  const unsubscribeSignals = signalStore.subscribe(({ type, signal }) => {
    if (type === 'value') processSignal(signal);
  });

  return {
    targets: GAME_TARGETS,
    listConnections: () => connections.map((connection) => structuredClone(connection)),
    addConnection(source, target) {
      const signal = signalStore.get(source);
      const port = targetPort(target);
      if (!canConnect(signal, port)) return null;
      const existing = connections.find((connection) =>
        connection.source === source
        && connection.target.node === target.node
        && connection.target.port === target.port);
      if (existing) return structuredClone(existing);
      if (port.type === 'value') {
        const replaced = connections.filter((connection) =>
          connection.target.node === target.node && connection.target.port === target.port);
        replaced.forEach((connection) => runtime.delete(connection.id));
        connections = connections.filter((connection) => !replaced.includes(connection));
        applyValue(target.node, target.port, port.defaultValue);
      }
      const connection = {
        id: `wire-${Date.now().toString(36)}-${++idCounter}`,
        source,
        sourceKind: signal.kind,
        target: { node: target.node, port: target.port },
        transform: defaultTransform(signal, port),
      };
      connections.push(connection);
      connectionsChanged();
      return structuredClone(connection);
    },
    updateConnection(id, patch) {
      const connection = connections.find((item) => item.id === id);
      if (!connection) return;
      if (patch.transform) connection.transform = { ...connection.transform, ...patch.transform };
      runtime.delete(id);
      connectionsChanged();
    },
    removeConnection(id) {
      connections = connections.filter((connection) => connection.id !== id);
      runtime.delete(id);
      connectionsChanged();
    },
    reset() {
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
