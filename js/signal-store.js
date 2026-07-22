// Stateful catalog for controller channels. It merges planned, persisted, and
// live inputs and reports kind changes so existing wires can migrate safely.

import { onInput } from './bus.js';
import { channelInfo, channelKind, isBinaryValue } from './channels.js';

function mergeKind(current, next) {
  if (!next || current === next) return current;
  if (current === 'event' || next === 'event') return current;
  return current === 'number' || next === 'number' ? 'number' : 'binary';
}

export function createSignalStore({ subscribeInput = onInput, now = () => performance.now() } = {}) {
  const signals = new Map();
  const listeners = new Set();
  const unsubscribeInput = subscribeInput(({ channel, value }) => receive(channel, value));

  function notify(type, signal = null, extra = {}) {
    const event = { type, signal, ...extra };
    listeners.forEach((listener) => listener(event));
  }

  function makeSignal(channel, kind = 'binary') {
    const info = channelInfo(channel);
    const signal = {
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
    signals.set(channel, signal);
    return signal;
  }

  function ensure(channel, kind = 'binary') {
    const existing = signals.get(channel);
    if (!existing) return makeSignal(channel, kind);
    const merged = mergeKind(existing.kind, kind);
    if (merged !== existing.kind) {
      const previousKind = existing.kind;
      existing.kind = merged;
      notify('kind', existing, { previousKind });
    }
    return existing;
  }

  function receive(channel, value) {
    const isNew = !signals.has(channel);
    const inferredKind = channelKind(channel, value);
    const signal = signals.get(channel) ?? makeSignal(channel, inferredKind);
    const nextKind = mergeKind(signal.kind, inferredKind);
    let previousKind = nextKind === signal.kind ? null : signal.kind;
    if (previousKind) {
      signal.kind = nextKind;
    } else if (signal.kind === 'binary' && !isBinaryValue(value)) {
      previousKind = signal.kind;
      signal.kind = 'number';
    }

    signal.value = value;
    signal.live = true;
    signal.lastSeen = now();
    if (signal.kind === 'number') {
      signal.min = Math.min(signal.min, value);
      signal.max = Math.max(signal.max, value);
      signal.observedMin = signal.observedMin == null ? value : Math.min(signal.observedMin, value);
      signal.observedMax = signal.observedMax == null ? value : Math.max(signal.observedMax, value);
    }

    if (previousKind) notify('kind', signal, { previousKind });
    if (isNew) notify('catalog');
    notify('value', signal);
  }

  function reconcileFlag(flag, descriptors) {
    signals.forEach((signal) => { signal[flag] = false; });
    for (const descriptor of descriptors) {
      const channel = typeof descriptor === 'string' ? descriptor : descriptor.channel;
      const kind = typeof descriptor === 'string' ? undefined : descriptor.kind;
      ensure(channel, kind)[flag] = true;
    }
    for (const [channel, signal] of signals) {
      if (!signal.live && !signal.planned && !signal.wired) signals.delete(channel);
    }
    notify('catalog');
  }

  return {
    get: (channel) => signals.get(channel) ?? null,
    all: () => [...signals.values()],
    subscribe(listener, { emitCurrent = false } = {}) {
      listeners.add(listener);
      if (emitCurrent) listener({ type: 'catalog', signal: null });
      return () => listeners.delete(listener);
    },
    setPlannedChannels(descriptors) {
      reconcileFlag('planned', descriptors);
    },
    setWiredChannels(descriptors) {
      reconcileFlag('wired', descriptors);
    },
    destroy() {
      unsubscribeInput();
      listeners.clear();
    },
  };
}
