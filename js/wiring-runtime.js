import { holdDirection } from './wiring-config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// A gate holds its state across a small dead band on either side of the
// threshold, so a reading that hovers right on the line doesn't chatter the
// control on and off. Not configurable — it exists to make the control usable,
// not to be tuned.
const GATE_HYSTERESIS = 0.03;

export function createRuntimeState() {
  return {
    previousRaw: null,
    filtered: null,
    gateOn: false,
    lastFiredAt: -Infinity,
  };
}

// Every on/off input — button, logo, touch pad, switch — is polled inside the
// micro:bit's 100 ms loop and sent as a level, so contact bounce never reaches
// us: the board isn't looking during the few milliseconds a contact rattles.
// Debouncing in the usual sense is already done, at the source, for free.
//
// What survives the poll is the opposite fault, and the one homemade
// controllers actually suffer from: a single tick that catches an intermittent
// contact open and reads 0 in the middle of a press — foil flexing, a clip
// sitting half on, a finger resting light on a piece of fruit. One dropped tick
// drops the control for 100 ms, which reads as the game ignoring you.
//
// So the filter is asymmetric, because the two directions aren't equally
// suspicious. On is taken immediately: a press has to land the instant it
// happens or the control feels broken. Off has to say so twice before the
// control lets go, spending 100 ms on every genuine release — invisible in a
// game — to make a dropped tick cost nothing. A tap short enough to land on
// only one tick still registers, which is why this shape and not a symmetric
// one: requiring two ticks in both directions would swallow the quick tap
// entirely. Like the gate's dead band, it exists to make homemade contacts
// usable and isn't offered as a setting.
export function createChannelFilter() {
  return { held: false, pendingOff: false };
}

export function filterBinary(rawValue, state) {
  if (rawValue > 0) {
    state.held = true;
    state.pendingOff = false;
  } else if (state.held) {
    // The first off reading after a run of on readings might be a dropped tick;
    // only a second one in a row is a release.
    if (state.pendingOff) {
      state.held = false;
      state.pendingOff = false;
    } else {
      state.pendingOff = true;
    }
  }
  return state.held ? 1 : 0;
}

function signalRange(signal) {
  return signal.kind === 'binary' ? { min: 0, max: 1 } : { min: signal.min, max: signal.max };
}

export function createDefaultTransform(signal, port, outputId) {
  const range = signalRange(signal);
  if (port.type === 'level') {
    return { type: 'range', ...range, invert: false, smoothing: 0 };
  }
  if (port.type === 'hold') {
    // Only an analog reading needs squaring off; a button's 0/1 already holds.
    // Which side of the line it holds on comes from the jack, so the two gated
    // jacks start life pointing opposite ways.
    return signal.kind === 'number'
      ? {
        type: 'gate',
        ...range,
        direction: holdDirection(outputId),
        threshold: (range.min + range.max) / 2,
      }
      : { type: 'hold', invert: false };
  }
  if (signal.kind === 'event') return { type: 'event', cooldownMs: 160 };
  if (signal.kind === 'binary') return { type: 'edge', edge: 'rising', cooldownMs: 160 };
  return {
    type: 'threshold',
    ...range,
    direction: 'above',
    threshold: (range.min + range.max) / 2,
    cooldownMs: 160,
  };
}

export function sampleRange(rawValue, transform, state) {
  const normalized = normalize(rawValue, transform);
  const smoothing = clamp01(transform.smoothing || 0);
  const output = state.filtered == null
    ? normalized
    : state.filtered * smoothing + normalized * (1 - smoothing);
  state.filtered = output;
  return output;
}

// A button already sends the held state; the only choice is which way round to
// read it, so this is the whole transform.
export function sampleHold(rawValue, transform) {
  const on = rawValue > 0;
  return (transform.invert ? !on : on) ? 1 : 0;
}

// The threshold is in the signal's own units, so a gate compares raw readings
// directly — min/max survive only to size the dead band and bound the input.
export function sampleGate(rawValue, transform, state) {
  const band = Math.abs(transform.max - transform.min) * GATE_HYSTERESIS;
  // Move the line in whichever direction keeps the state we're already in, so
  // leaving costs more than staying.
  const offset = state.gateOn ? -band : band;
  const line = transform.direction === 'below'
    ? transform.threshold - offset
    : transform.threshold + offset;
  state.gateOn = transform.direction === 'below' ? rawValue < line : rawValue > line;
  return state.gateOn ? 1 : 0;
}

export function sampleTrigger(rawValue, transform, state, now) {
  let value = rawValue;
  let candidate = false;

  if (transform.type === 'event') {
    candidate = rawValue > 0;
  } else if (transform.type === 'edge') {
    candidate = transform.edge === 'falling'
      ? state.previousRaw === 1 && rawValue === 0
      : rawValue === 1 && state.previousRaw !== 1;
  } else {
    // Thresholds are in the signal's own units, like a gate's — so what the
    // settings say is what the readings say.
    if (transform.type === 'change') {
      candidate = state.previousRaw != null
        && Math.abs(rawValue - state.previousRaw) >= Math.abs(transform.amount);
    } else {
      const { threshold } = transform;
      candidate = state.previousRaw != null && (transform.direction === 'below'
        ? state.previousRaw >= threshold && rawValue < threshold
        : state.previousRaw <= threshold && rawValue > threshold);
    }
    // Activity is reported as a proportion, whatever the raw scale.
    value = normalize(rawValue, transform);
  }
  state.previousRaw = rawValue;

  const fired = candidate && now - state.lastFiredAt >= Math.max(0, transform.cooldownMs || 0);
  if (fired) state.lastFiredAt = now;
  return { fired, value };
}

export function migrateTransformForSignal(transform, signal) {
  // A level only exists on an analog reading, so a signal that turns out to be
  // a button loses the jack entirely and the wire is dropped by the engine.
  if (transform.type === 'range') {
    return signal.kind === 'number' ? { ...transform, ...signalRange(signal) } : transform;
  }

  if (transform.type === 'gate') {
    // The threshold is raw, so a widening range leaves it exactly where it was.
    if (signal.kind === 'number') return { ...transform, ...signalRange(signal) };
    // Nothing left to gate once the source only ever reads 0 or 1 — the raw
    // reading already is the held state. Holding "below" the line is holding
    // while it is off, which is what inverting says.
    if (signal.kind === 'binary') {
      return { type: 'hold', invert: transform.direction === 'below' };
    }
    return transform; // event: the wire itself is dropped, having no hold output
  }

  if (transform.type === 'hold') {
    // The other way round: a button that turns out to be analog needs a line to
    // compare against, and the side it holds on is the one it already held on.
    if (signal.kind === 'number') {
      const range = signalRange(signal);
      return {
        type: 'gate',
        ...range,
        direction: transform.invert ? 'below' : 'above',
        threshold: (range.min + range.max) / 2,
      };
    }
    return transform;
  }

  if (signal.kind === 'event') {
    return { type: 'event', cooldownMs: transform.cooldownMs };
  }
  if (signal.kind === 'binary') {
    if (transform.type === 'threshold' || transform.type === 'change') {
      return { type: 'edge', edge: 'rising', cooldownMs: transform.cooldownMs };
    }
    return transform;
  }

  const range = signalRange(signal);
  if (transform.type === 'edge' || transform.type === 'event') {
    return {
      type: 'threshold',
      ...range,
      direction: transform.type === 'edge' && transform.edge === 'falling' ? 'below' : 'above',
      threshold: (range.min + range.max) / 2,
      cooldownMs: transform.cooldownMs,
    };
  }
  return { ...transform, ...range };
}

function normalize(value, transform) {
  const span = transform.max - transform.min;
  // A span of nothing has no direction to map along. That happens mid-edit,
  // between typing one end of a reversed range and typing the other, so it sits
  // in the middle rather than pinning the control to an end it never chose.
  if (!span) return 0.5;
  const normalized = clamp01((value - transform.min) / span);
  return transform.invert ? 1 - normalized : normalized;
}
