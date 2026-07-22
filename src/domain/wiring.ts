import type { SignalKind } from './bus';
import type { Signal, SignalStore, SignalStoreEvent } from './signalStore';
import {
  canConnect,
  defaultTransform,
  GAME_TARGETS,
  isStoredConnection,
  signalRange,
  targetPort,
} from './wiringConfig';
import type {
  GameActions,
  GameTarget,
  StorageLike,
  TransformRange,
  WireConnection,
  WireTarget,
  WireTransform,
  WiringEvent,
} from './wiringTypes';

export { canConnect, GAME_TARGETS } from './wiringConfig';
export type {
  ChangeTransform,
  EdgeTransform,
  EventTransform,
  GameActions,
  GameTarget,
  RangeTransform,
  StorageLike,
  TargetPort,
  ThresholdTransform,
  WireConnection,
  WireTarget,
  WireTransform,
  WiringEvent,
} from './wiringTypes';

const STORAGE_KEY = 'experimental-game-controllers:wiring:v1';
const CONFIG_VERSION = 1;

interface RuntimeState {
  previousRaw: number | null;
  previousNormalized: number | null;
  filtered: number | null;
  lastFiredAt: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const portKey = (node: string, port: string): string => `${node}.${port}`;

function safeBrowserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function freshRuntimeState(): RuntimeState {
  return {
    previousRaw: null,
    previousNormalized: null,
    filtered: null,
    lastFiredAt: -Infinity,
  };
}

export class WiringEngine {
  readonly targets = GAME_TARGETS;

  private readonly listeners = new Set<(event: WiringEvent) => void>();
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly values = new Map<string, number>();
  private readonly storage: StorageLike | null;
  private readonly unsubscribeSignals: () => void;
  private connections: WireConnection[] = [];
  private nextId = 0;
  private positionEnabled: boolean | null = null;

  constructor(
    private readonly signalStore: SignalStore,
    private readonly actions: GameActions,
    options: { storage?: StorageLike | null } = {},
  ) {
    this.storage = options.storage === undefined ? safeBrowserStorage() : options.storage;

    GAME_TARGETS.forEach((target) => {
      target.ports.forEach((port) => {
        if (port.type === 'value') {
          this.values.set(portKey(target.id, port.id), port.defaultValue ?? 0);
        }
      });
    });

    this.load();
    this.syncSources();
    this.syncDestinations();
    this.unsubscribeSignals = signalStore.subscribe((event) => this.handleSignalEvent(event));
  }

  listConnections(): WireConnection[] {
    return structuredClone(this.connections);
  }

  addConnection(source: string, target: WireTarget): WireConnection | null {
    const signal = this.signalStore.get(source);
    const port = targetPort(target);
    if (!signal || !port || !canConnect(signal, port)) return null;

    const duplicate = this.connections.find(
      (connection) => connection.source === source && this.targetsEqual(connection.target, target),
    );
    if (duplicate) return structuredClone(duplicate);

    if (port.type === 'value') {
      const replaced = this.connections.filter((connection) => this.targetsEqual(connection.target, target));
      replaced.forEach((connection) => this.runtime.delete(connection.id));
      this.connections = this.connections.filter((connection) => !replaced.includes(connection));
      this.applyValue(target.node, target.port, port.defaultValue ?? 0);
    }

    const connection: WireConnection = {
      id: `wire-${Date.now().toString(36)}-${++this.nextId}`,
      source,
      sourceKind: signal.kind,
      target: { ...target },
      transform: defaultTransform(signal, port),
    };
    this.connections.push(connection);
    this.connectionsChanged();
    return structuredClone(connection);
  }

  updateConnection(id: string, transform: WireTransform): void {
    const connection = this.connections.find((item) => item.id === id);
    if (!connection) return;
    connection.transform = structuredClone(transform);
    this.runtime.delete(id);
    this.connectionsChanged();
  }

  removeConnection(id: string): void {
    const next = this.connections.filter((connection) => connection.id !== id);
    if (next.length === this.connections.length) return;
    this.connections = next;
    this.runtime.delete(id);
    this.connectionsChanged();
  }

  reset(): void {
    if (this.connections.length === 0) return;
    this.connections = [];
    this.runtime.clear();
    this.connectionsChanged();
  }

  subscribe(listener: (event: WiringEvent) => void, emitCurrent = false): () => void {
    this.listeners.add(listener);
    if (emitCurrent) listener({ type: 'connections' });
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribeSignals();
    this.listeners.clear();
  }

  private handleSignalEvent(event: SignalStoreEvent): void {
    if (event.type === 'kind') this.migrateSourceKind(event.signal);
    if (event.type === 'value') this.processSignal(event.signal);
  }

  private processSignal(signal: Signal): void {
    const matching = this.connections.filter((connection) => connection.source === signal.channel);

    // Sample every continuous destination first. A flap trigger wired to the same
    // sensor then sees this sample's strength, regardless of connection order.
    matching.forEach((connection) => {
      if (targetPort(connection.target)?.type === 'value') this.processValueConnection(connection, signal);
    });
    matching.forEach((connection) => {
      if (targetPort(connection.target)?.type === 'trigger') this.processTriggerConnection(connection, signal);
    });
  }

  private processValueConnection(connection: WireConnection, signal: Signal): void {
    if (connection.transform.type !== 'range') return;
    const state = this.runtimeState(connection.id);
    let output = this.normalize(signal.value ?? 0, connection.transform);
    const smoothing = clamp01(Number(connection.transform.smoothing) || 0);
    if (state.filtered != null) output = state.filtered * smoothing + output * (1 - smoothing);
    state.filtered = output;
    this.applyValue(connection.target.node, connection.target.port, output);
    this.notify({ type: 'activity', connectionId: connection.id, value: output, fired: false });
  }

  private processTriggerConnection(connection: WireConnection, signal: Signal): void {
    if (connection.transform.type === 'range') return;
    const state = this.runtimeState(connection.id);
    const transform = connection.transform;
    const value = signal.value ?? 0;
    let output = value;
    let fired = false;

    if (transform.type === 'event') {
      fired = value > 0;
    } else if (transform.type === 'edge') {
      fired = transform.edge === 'falling'
        ? state.previousRaw === 1 && value === 0
        : value === 1 && state.previousRaw !== 1;
    } else {
      output = this.normalize(value, transform);
      if (transform.type === 'change') {
        fired = state.previousNormalized != null
          && Math.abs(output - state.previousNormalized) >= clamp01(transform.amount);
      } else {
        const threshold = clamp01(transform.threshold);
        fired = state.previousNormalized != null && (transform.direction === 'below'
          ? state.previousNormalized >= threshold && output < threshold
          : state.previousNormalized <= threshold && output > threshold);
      }
      state.previousNormalized = output;
    }
    state.previousRaw = value;

    const cooldown = Math.max(0, transform.cooldownMs || 0);
    if (fired && signal.lastSeen - state.lastFiredAt >= cooldown) {
      state.lastFiredAt = signal.lastSeen;
      if (connection.target.node === 'flap') {
        this.actions.flap({ magnitude: this.values.get(portKey('flap', 'magnitude')) });
      } else if (connection.target.node === 'restart') {
        this.actions.restartGame();
      }
    } else {
      fired = false;
    }
    this.notify({ type: 'activity', connectionId: connection.id, value: output, fired });
  }

  private migrateSourceKind(signal: Signal): void {
    let changed = false;
    this.connections.forEach((connection) => {
      if (connection.source !== signal.channel || connection.sourceKind === signal.kind) return;
      connection.sourceKind = signal.kind;
      const range = signalRange(signal);

      if (signal.kind === 'number' && connection.transform.type === 'edge') {
        connection.transform = {
          type: 'threshold',
          ...range,
          invert: false,
          direction: connection.transform.edge === 'falling' ? 'below' : 'above',
          threshold: 0.5,
          cooldownMs: connection.transform.cooldownMs,
        };
      } else if (signal.kind === 'number' && connection.transform.type === 'range') {
        connection.transform = { ...connection.transform, ...range };
      }
      this.runtime.delete(connection.id);
      changed = true;
    });

    if (changed) {
      this.syncSources();
      this.persist();
      this.notify({ type: 'connections' });
    }
  }

  private normalize(value: number, transform: TransformRange): number {
    const span = transform.max - transform.min || 1;
    const normalized = clamp01((value - transform.min) / span);
    return transform.invert ? 1 - normalized : normalized;
  }

  private applyValue(node: GameTarget['id'], port: string, value: number): void {
    const normalized = clamp01(value);
    this.values.set(portKey(node, port), normalized);
    if (node === 'speed') this.actions.setGameSpeed(normalized);
    if (node === 'position') this.actions.setPosition(normalized);
    if (node === 'gravity') this.actions.setGravity(normalized);
  }

  private syncDestinations(): void {
    const positionConnected = this.connections.some(
      ({ target }) => target.node === 'position' && target.port === 'y',
    );
    if (positionConnected !== this.positionEnabled) {
      this.positionEnabled = positionConnected;
      this.actions.setPositionEnabled(positionConnected);
    }

    GAME_TARGETS.forEach((target) => {
      target.ports.forEach((port) => {
        if (port.type !== 'value') return;
        const connected = this.connections.some((connection) => this.targetsEqual(connection.target, {
          node: target.id,
          port: port.id,
        }));
        if (!connected) this.applyValue(target.id, port.id, port.defaultValue ?? 0);
      });
    });
  }

  private syncSources(): void {
    const sources = new Map<string, SignalKind>();
    this.connections.forEach(({ source, sourceKind }) => sources.set(source, sourceKind));
    this.signalStore.setWiredChannels(
      [...sources].map(([channel, kind]) => ({ channel, kind })),
    );
  }

  private connectionsChanged(): void {
    this.syncSources();
    this.syncDestinations();
    this.persist();
    this.notify({ type: 'connections' });
  }

  private runtimeState(id: string): RuntimeState {
    const existing = this.runtime.get(id);
    if (existing) return existing;
    const state = freshRuntimeState();
    this.runtime.set(id, state);
    return state;
  }

  private targetsEqual(left: WireTarget, right: WireTarget): boolean {
    return left.node === right.node && left.port === right.port;
  }

  private notify(event: WiringEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({
        version: CONFIG_VERSION,
        connections: this.connections,
      }));
    } catch {
      // Persistence may be blocked; the in-memory editor remains fully usable.
    }
  }

  private load(): void {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null') as {
        version?: number;
        connections?: unknown[];
      } | null;
      if (saved?.version !== CONFIG_VERSION || !Array.isArray(saved.connections)) return;
      this.connections = saved.connections.filter(isStoredConnection);
    } catch {
      this.connections = [];
    }
  }
}
