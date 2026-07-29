// Stateful catalog for controller channels. It merges planned, persisted, and
// live inputs and reports kind changes so existing wires can migrate safely.

import { onInput } from './bus.js';
import { channelInfo, channelKind, isBinaryValue } from './channels.js';

function mergeKind(current, next) {
  if (!next || current === next) return current;
  // A bearing reads as a plain number on the wire, so only the registry knows it
  // is one — an inferred kind must never talk it back down into a number, or the
  // wrap-aware jacks would silently become linear ones.
  if (current === 'event' || next === 'event' || current === 'bearing') return current;
  if (next === 'bearing') return next;
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
      // What this reading actually is, in one line, and what its numbers are in.
      // A channel invented in MakeCode has neither, and simply says less.
      desc: info.desc ?? null,
      unit: info.unit ?? null,
      // What to call this reading mid-sentence, when that isn't its label.
      subject: info.subject ?? null,
      // How a gesture reads mid-sentence, for the ones that have a set wording.
      phrase: info.phrase ?? null,
      kind: info.kind ?? kind,
      value: null,
      min: info.min ?? 0,
      max: info.max ?? 1,
      observedMin: null,
      observedMax: null,
      live: false,
      planned: false,
      wired: false,
      // How this input was set up, when that was a choice — a pin read as a
      // touch pad and the same pin read as a switch are wired differently.
      mode: null,
      // What it physically is: a button, a logo, a pad, a switch. Decides how
      // it reads in a sentence, since all four send the same 1s and 0s.
      form: null,
      // Where this input sits on the Sensing page, so the wiring board can list
      // the inputs you picked in the order that page listed them.
      order: null,
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

  function reconcileFlag(flag, descriptors, { ordered = false } = {}) {
    signals.forEach((signal) => {
      signal[flag] = false;
      if (ordered) signal.order = null;
    });
    for (const [index, descriptor] of descriptors.entries()) {
      const channel = typeof descriptor === 'string' ? descriptor : descriptor.channel;
      const kind = typeof descriptor === 'string' ? undefined : descriptor.kind;
      const signal = ensure(channel, kind);
      signal[flag] = true;
      if (ordered) signal.order = index;
      // Only the side that owns the choice sets it, so a live sample arriving
      // for a planned pin never blanks out the mode it was planned as.
      if (typeof descriptor === 'object' && descriptor.mode !== undefined) {
        signal.mode = descriptor.mode;
        signal.form = descriptor.form ?? null;
      }
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
      reconcileFlag('planned', descriptors, { ordered: true });
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
