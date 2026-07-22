// Shared, stateful view of controller channels. Bluetooth and demo controls still
// emit raw messages on the bus; this store adds discovery, live values, inferred
// kinds, and range hints for the visualizer and wiring UI.

import { onInput } from './bus.js';
import { channelInfo, channelKind, isBinaryValue } from './channels.js';

export function createSignalStore() {
  const signals = new Map();
  const listeners = new Set();

  function notify(type, signal = null) {
    const event = { type, signal };
    listeners.forEach((listener) => listener(event));
  }

  function makeSignal(channel, kind = null) {
    const info = channelInfo(channel);
    const signal = {
      channel,
      label: info.label,
      emoji: info.emoji,
      kind: info.kind || kind,
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

  function ensure(channel, kind = null) {
    const signal = signals.get(channel) || makeSignal(channel, kind);
    if (!signal.kind && kind) signal.kind = kind;
    return signal;
  }

  function reconcileFlag(flag, descriptors) {
    signals.forEach((signal) => { signal[flag] = false; });
    for (const descriptor of descriptors) {
      const channel = typeof descriptor === 'string' ? descriptor : descriptor.channel;
      const kind = typeof descriptor === 'string' ? null : descriptor.kind;
      ensure(channel, kind)[flag] = true;
    }
    for (const [channel, signal] of signals) {
      if (!signal.live && !signal.planned && !signal.wired) signals.delete(channel);
    }
    notify('catalog');
  }

  onInput(({ channel, value }) => {
    let signal = signals.get(channel);
    const isNew = !signal;
    if (!signal) signal = makeSignal(channel, channelKind(channel, value));
    if (!signal.kind) signal.kind = channelKind(channel, value);
    if (signal.kind === 'binary' && !isBinaryValue(value)) signal.kind = 'number';

    signal.value = value;
    signal.live = true;
    signal.lastSeen = performance.now();
    if (signal.kind === 'number') {
      signal.min = Math.min(signal.min, value);
      signal.max = Math.max(signal.max, value);
      signal.observedMin = signal.observedMin == null ? value : Math.min(signal.observedMin, value);
      signal.observedMax = signal.observedMax == null ? value : Math.max(signal.observedMax, value);
    }

    if (isNew) notify('catalog');
    notify('value', signal);
  });

  return {
    get: (channel) => signals.get(channel) || null,
    all: () => [...signals.values()],
    subscribe(listener, { emitCurrent = false } = {}) {
      listeners.add(listener);
      if (emitCurrent) listener({ type: 'catalog', signal: null });
      return () => listeners.delete(listener);
    },
    setPlannedChannels(descriptors) {
      reconcileFlag('planned', descriptors);
    },
    setWiredChannels(channels) {
      reconcileFlag('wired', channels);
    },
  };
}
