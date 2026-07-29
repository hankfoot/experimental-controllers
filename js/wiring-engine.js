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
  createDefaultTransform,
  createRuntimeState,
  migrateTransformForSignal,
  sampleFacing,
  sampleGate,
  sampleHold,
  sampleNear,
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
  let targets = game?.targets ?? [];
  // Settings are shaped like targets but carry no port types, so nothing can be
  // wired to one. They are held apart from `targets` rather than marked inside
  // it: the wiring board renders targets, and a list it never sees is a
  // stronger guarantee than a flag it has to remember to check.
  let settings = game?.settings ?? [];
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
    const definition = findPort(targets, { node, port })
      ?? findPort(settings, { node, port });
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
    for (const target of [...targets, ...settings]) {
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

  /** Every value port back to the value it has when nothing is driving it. */
  function restValuePorts({ wired }) {
    // Ports are written directly below, behind the back of the bookkeeping that
    // skips repeat values. Left alone, a wire whose last output was 1 would
    // decline to re-apply that 1 after a rest had quietly put the port back to
    // 0, and the control would stay at rest with the wire believing otherwise.
    for (const state of runtime.values()) state.lastApplied = undefined;

    for (const target of targets) {
      for (const port of target.ports) {
        // Only a port that carries a running value has one to fall back to —
        // a trigger is a moment, with nothing to hold between them.
        if (!isValuePort(port.type)) continue;
        const connected = connections.some((connection) => targetsEqual(connection.target, {
          node: target.id,
          port: port.id,
        }));
        if (wired || !connected) applyValue(target.id, port.id, port.defaultValue ?? 0);
      }
    }
  }

  function syncDestinations() {
    // Games use this to decide whether a control is under wire control or still
    // following its manual fallback.
    actions.setWiredPorts(new Set(
      connections.map(({ target }) => portKey(target.node, target.port)),
    ));

    restValuePorts({ wired: false });
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

  const SAMPLERS = {
    facing: sampleFacing, gate: sampleGate, hold: sampleHold, near: sampleNear, range: sampleRange,
  };

  function processValue(connection, value, now) {
    const { transform } = connection;
    const sample = SAMPLERS[transform.type];
    if (!sample) return;
    const state = runtimeState(connection.id);
    const output = sample(value, transform, state, now);
    // A reading that does not change the output is not worth reporting. Without
    // this a contact breaking mid-hold still announces itself — the value it
    // announces is the one already in force, but the announcement is what the
    // activity meter draws, so the wire would flicker while the control it
    // drives sat perfectly still.
    if (state.lastApplied !== output) {
      state.lastApplied = output;
      applyValue(connection.target.node, connection.target.port, output);
      notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
    }

  }

  // A port may fix its own pace instead of offering it, in which case the port
  // is where that number lives and the wire's copy is ignored — a transform
  // saved before the port fixed it, or under a game that offered the choice,
  // can't leave a control running at a rate nothing on screen admits to.
  function pacedTransform(connection) {
    const pace = findPort(targets, connection.target)?.pace;
    return pace == null ? connection.transform : { ...connection.transform, cooldownMs: pace };
  }

  function processTrigger(connection, signal, value) {
    if (portTypeForTransform(connection.transform.type) !== 'trigger') return;
    const result = sampleTrigger(
      value,
      pacedTransform(connection),
      runtimeState(connection.id),
      Number.isFinite(signal.lastSeen) ? signal.lastSeen : performance.now(),
    );
    if (result.fired) actions.fire(connection.target.node, connection.target.port);
    notify({ type: 'activity', connectionId: connection.id, value: result.value, fired: result.fired });
  }

  // Every reading is acted on exactly as it arrived. There was once a filter
  // here that held an on/off contact through a single 0, back when the board
  // polled its contacts inside the forever loop and one tick catching a flexing
  // piece of foil open read as a release. The board no longer polls them: a
  // button, pad, switch or logo now reports its two edges and says nothing in
  // between (see js/builder.js), so a 0 is the release, arrives once, and is
  // never repeated. Waiting for a second one meant waiting forever — every
  // contact latched on after its first press, which is worth remembering before
  // anyone reaches for smoothing on this path again.
  function processSignal(signal) {
    // Tracked for every channel, wired or not, so a pad that is already being
    // held when you wire it up is held as far as the new wire is concerned.
    const value = signal.value ?? 0;
    const matching = connections.filter((connection) => connection.source === signal.channel);
    // Continuous values must use the current sample before a trigger wired to
    // the same source fires, regardless of connection insertion order.
    // The same clock the triggers use, so a wire's smoothing is measured against
    // when the board actually spoke rather than when we got round to it.
    const now = Number.isFinite(signal.lastSeen) ? signal.lastSeen : performance.now();
    matching.forEach((connection) => {
      if (isValuePort(findPort(targets, connection.target)?.type)) {
        processValue(connection, value, now);
      }
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
    get settings() {
      return settings;
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
      settings = next.settings ?? [];
      runtime.clear();
      connections = loadConnections(resolvedStorage, gameId, targets);
      chosen = loadPortOptions(resolvedStorage, gameId);
      syncSources();
      reconcileSourceKinds();
      syncDestinations();
      publishOptions();
      notify({ type: 'connections' });
    },
    /**
     * Re-reads the saved wiring for the game already loaded.
     *
     * The counterpart to `reloadOptions`, and it exists for the same reason:
     * importing rewrites the record from outside without the game changing, and
     * `setGame` refuses that on purpose — a swap to the game you are already on
     * is a no-op everywhere else and should stay one.
     */
    reloadWiring() {
      runtime.clear();
      connections = loadConnections(resolvedStorage, gameId, targets);
      syncSources();
      reconcileSourceKinds();
      syncDestinations();
      notify({ type: 'connections' });
    },

    /**
     * Re-reads the saved choices for the game already loaded. Everything else
     * that changes them comes through `setControlOption`, which keeps this copy
     * and the stored one in step; importing a theme is the exception, since it
     * rewrites the record wholesale from outside without the game changing —
     * and `setGame` would refuse it for exactly that reason.
     */
    reloadOptions() {
      chosen = loadPortOptions(resolvedStorage, gameId);
      publishOptions();
      notify({ type: 'connections' });
    },
    /**
     * Lets go of everything a wire is holding down.
     *
     * A held port keeps its last value until the next one arrives, which is the
     * whole point of a hold and is exactly wrong the moment the board stops
     * sending. A controller that goes out of range mid-climb sends no release —
     * there is nothing left to send it — so the craft flies into the ceiling and
     * sits there while the top of the screen says Not Connected. The runtime
     * state goes too: a gate that was over its line has no business remembering
     * that across a reconnect.
     */
    release() {
      runtime.clear();
      restValuePorts({ wired: true });
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
