import type { InputBus, SignalKind } from './bus';
import { channelInfo, inferChannelKind, isBinaryValue } from './channels';

export interface ChannelDescriptor {
  channel: string;
  kind?: SignalKind;
}

export interface Signal extends ChannelDescriptor {
  label: string;
  emoji: string;
  kind: SignalKind;
  value: number | null;
  min: number;
  max: number;
  observedMin: number | null;
  observedMax: number | null;
  live: boolean;
  planned: boolean;
  wired: boolean;
  lastSeen: number;
}

export type SignalStoreEvent =
  | { type: 'catalog'; signal: null }
  | { type: 'kind'; signal: Signal; previousKind: SignalKind }
  | { type: 'value'; signal: Signal };

type SignalFlag = 'planned' | 'wired';

function mergeKind(current: SignalKind, next?: SignalKind): SignalKind {
  if (!next || current === next) return current;
  if (current === 'event' || next === 'event') return current;
  return current === 'number' || next === 'number' ? 'number' : 'binary';
}

export class SignalStore {
  private readonly signals = new Map<string, Signal>();
  private readonly listeners = new Set<(event: SignalStoreEvent) => void>();
  private readonly unsubscribeInput: () => void;
  private revision = 0;

  constructor(bus: InputBus, private readonly now: () => number = () => performance.now()) {
    this.unsubscribeInput = bus.onInput(({ channel, value }) => this.receive(channel, value));
  }

  get(channel: string): Signal | null {
    return this.signals.get(channel) ?? null;
  }

  all(): Signal[] {
    return [...this.signals.values()];
  }

  subscribe(listener: (event: SignalStoreEvent) => void, emitCurrent = false): () => void {
    this.listeners.add(listener);
    if (emitCurrent) listener({ type: 'catalog', signal: null });
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  setPlannedChannels(descriptors: ChannelDescriptor[]): void {
    this.reconcileFlag('planned', descriptors);
  }

  setWiredChannels(descriptors: ChannelDescriptor[]): void {
    this.reconcileFlag('wired', descriptors);
  }

  destroy(): void {
    this.unsubscribeInput();
    this.listeners.clear();
  }

  private notify(event: SignalStoreEvent): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener(event));
  }

  private create(channel: string, kind: SignalKind): Signal {
    const info = channelInfo(channel);
    const signal: Signal = {
      channel,
      label: info.label,
      emoji: info.emoji,
      kind: info.kind ?? kind,
      value: null,
      min: info.min ?? 0,
      max: info.max ?? 1,
      observedMin: null,
      observedMax: null,
      live: false,
      planned: false,
      wired: false,
      lastSeen: 0,
    };
    this.signals.set(channel, signal);
    return signal;
  }

  private ensure(channel: string, kind: SignalKind = 'binary'): Signal {
    const existing = this.signals.get(channel);
    if (!existing) return this.create(channel, kind);
    const merged = mergeKind(existing.kind, kind);
    if (merged !== existing.kind) {
      const previousKind = existing.kind;
      existing.kind = merged;
      this.notify({ type: 'kind', signal: existing, previousKind });
    }
    return existing;
  }

  private receive(channel: string, value: number): void {
    const isNew = !this.signals.has(channel);
    const inferredKind = inferChannelKind(channel, value);
    const signal = this.signals.get(channel) ?? this.create(channel, inferredKind);
    const nextKind = mergeKind(signal.kind, inferredKind);
    let previousKind: SignalKind | null = nextKind === signal.kind ? null : signal.kind;
    if (previousKind) {
      signal.kind = nextKind;
    } else if (signal.kind === 'binary' && !isBinaryValue(value)) {
      previousKind = signal.kind;
      signal.kind = 'number';
    }

    signal.value = value;
    signal.live = true;
    signal.lastSeen = this.now();
    if (signal.kind === 'number') {
      signal.min = Math.min(signal.min, value);
      signal.max = Math.max(signal.max, value);
      signal.observedMin = signal.observedMin == null ? value : Math.min(signal.observedMin, value);
      signal.observedMax = signal.observedMax == null ? value : Math.max(signal.observedMax, value);
    }

    if (previousKind) this.notify({ type: 'kind', signal, previousKind });
    if (isNew) this.notify({ type: 'catalog', signal: null });
    this.notify({ type: 'value', signal });
  }

  private reconcileFlag(flag: SignalFlag, descriptors: ChannelDescriptor[]): void {
    this.signals.forEach((signal) => {
      signal[flag] = false;
    });

    descriptors.forEach(({ channel, kind }) => {
      this.ensure(channel, kind)[flag] = true;
    });

    this.signals.forEach((signal, channel) => {
      if (!signal.live && !signal.planned && !signal.wired) this.signals.delete(channel);
    });
    this.notify({ type: 'catalog', signal: null });
  }
}
