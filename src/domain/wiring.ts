import type { SignalKind } from './bus';
import type { GameActions } from '../game/gameActions';
import type { Signal, SignalStore, SignalStoreEvent } from './signalStore';
import {
  canConnect,
  GAME_TARGETS,
  targetPort,
} from './wiringConfig';
import {
  clamp01,
  createDefaultTransform,
  createRuntimeState,
  migrateTransformForSignal,
  sampleRange,
  sampleTrigger,
  type WireRuntimeState,
} from './wiringRuntime';
import {
  browserStorage,
  loadConnections,
  normalizeTransform,
  saveConnections,
} from './wiringStorage';
import type {
  GameTarget,
  StorageLike,
  WireConnection,
  WireTarget,
  WireTransform,
} from './wiringTypes';

export { canConnect, GAME_TARGETS } from './wiringConfig';
export type { GameActions } from '../game/gameActions';
export type {
  ChangeTransform,
  EdgeTransform,
  EventTransform,
  GameTarget,
  RangeTransform,
  StorageLike,
  TargetPort,
  ThresholdTransform,
  TriggerTransform,
  WireConnection,
  WireTarget,
  WireTransform,
} from './wiringTypes';
const portKey = (node: string, port: string): string => `${node}.${port}`;

export class WiringEngine {
  readonly targets = GAME_TARGETS;

  private readonly listeners = new Set<() => void>();
  private readonly runtime = new Map<string, WireRuntimeState>();
  private readonly values = new Map<string, number>();
  private readonly storage: StorageLike | null;
  private unsubscribeSignals: (() => void) | null = null;
  private connections: WireConnection[] = [];
  private nextId = 0;
  private positionEnabled: boolean | null = null;
  private revision = 0;

  constructor(
    private readonly signalStore: SignalStore,
    private readonly actions: GameActions,
    options: { storage?: StorageLike | null } = {},
  ) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;

    GAME_TARGETS.forEach((target) => {
      target.ports.forEach((port) => {
        if (port.type === 'value') {
          this.values.set(portKey(target.id, port.id), port.defaultValue ?? 0);
        }
      });
    });

    this.connections = loadConnections(this.storage);
  }

  start(): () => void {
    if (!this.unsubscribeSignals) {
      this.syncSources();
      this.reconcileSourceKinds();
      this.syncDestinations();
      this.unsubscribeSignals = this.signalStore.subscribe((event) => this.handleSignalEvent(event));
    }
    return () => this.stop();
  }

  stop(): void {
    this.unsubscribeSignals?.();
    this.unsubscribeSignals = null;
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
      transform: createDefaultTransform(signal, port),
    };
    this.connections.push(connection);
    this.connectionsChanged();
    return structuredClone(connection);
  }

  updateConnection(id: string, transform: WireTransform): void {
    const connection = this.connections.find((item) => item.id === id);
    if (!connection) return;
    const port = targetPort(connection.target);
    const normalized = normalizeTransform(transform);
    if (!port || !normalized || (port.type === 'value') !== (normalized.type === 'range')) return;
    connection.transform = normalized;
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

  subscribe(listener: () => void, emitCurrent = false): () => void {
    this.listeners.add(listener);
    if (emitCurrent) listener();
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  destroy(): void {
    this.stop();
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
    const output = sampleRange(signal.value ?? 0, connection.transform, state);
    this.applyValue(connection.target.node, connection.target.port, output);
  }

  private processTriggerConnection(connection: WireConnection, signal: Signal): void {
    if (connection.transform.type === 'range') return;
    const state = this.runtimeState(connection.id);
    const result = sampleTrigger(signal.value ?? 0, connection.transform, state, signal.lastSeen);
    if (result.fired) {
      if (connection.target.node === 'flap') {
        this.actions.flap({ magnitude: this.values.get(portKey('flap', 'magnitude')) });
      } else if (connection.target.node === 'restart') {
        this.actions.restartGame();
      }
    }
  }

  private migrateSourceKind(signal: Signal): void {
    let changed = false;
    this.connections.forEach((connection) => {
      if (connection.source !== signal.channel || connection.sourceKind === signal.kind) return;
      connection.sourceKind = signal.kind;
      connection.transform = migrateTransformForSignal(connection.transform, signal);
      this.runtime.delete(connection.id);
      changed = true;
    });

    if (changed) {
      this.syncSources();
      this.persist();
      this.notify();
    }
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

  private reconcileSourceKinds(): void {
    let changed = false;
    this.connections = this.connections.filter((connection) => {
      const signal = this.signalStore.get(connection.source);
      const port = targetPort(connection.target);
      if (!signal || !port) return true;
      if (!canConnect(signal, port)) {
        this.runtime.delete(connection.id);
        changed = true;
        return false;
      }
      if (connection.sourceKind !== signal.kind) {
        connection.sourceKind = signal.kind;
        connection.transform = migrateTransformForSignal(connection.transform, signal);
        this.runtime.delete(connection.id);
        changed = true;
      }
      return true;
    });
    if (changed) {
      this.syncSources();
      this.persist();
      this.notify();
    }
  }

  private connectionsChanged(): void {
    this.syncSources();
    this.syncDestinations();
    this.persist();
    this.notify();
  }

  private runtimeState(id: string): WireRuntimeState {
    const existing = this.runtime.get(id);
    if (existing) return existing;
    const state = createRuntimeState();
    this.runtime.set(id, state);
    return state;
  }

  private targetsEqual(left: WireTarget, right: WireTarget): boolean {
    return left.node === right.node && left.port === right.port;
  }

  private notify(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }

  private persist(): void {
    saveConnections(this.storage, this.connections);
  }
}
