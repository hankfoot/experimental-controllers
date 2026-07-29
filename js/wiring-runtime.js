import { holdDirection, outputIdOf, portTypeForTransform } from './wiring-config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// A gate holds its state across a small dead band on either side of the
// threshold, so a reading that hovers right on the line doesn't chatter the
// control on and off. Not configurable — it exists to make the control usable,
// not to be tuned.
const GATE_HYSTERESIS = 0.03;

// How near a bearing counts as facing it, and how far away it takes to stop.
// Two numbers rather than one for the same reason a gate has a dead band: an
// object sitting on the edge of a sector would otherwise flicker on and off.
// ENTER sits inside the 45° a quarter-turn allows, EXIT outside it.
const FACING_ENTER = 35;
const FACING_EXIT = 55;

/**
 * How far a heading is from a bearing, going the short way round. This is the
 * whole reason a bearing isn't a number: 350° is 10° from north, not 350°, and
 * every linear comparison in this file would get that wrong.
 */
export function bearingOffset(value, bearing) {
  const heading = ((value % 360) + 360) % 360;
  const offset = Math.abs(heading - bearing);
  return offset > 180 ? 360 - offset : offset;
}

export function createRuntimeState() {
  return {
    previousRaw: null,
    filtered: null,
    smoothedAt: null,
    gateOn: false,
    facingOn: false,
    lastFiredAt: -Infinity,
  };
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
    // A bearing holds while it points somewhere, which is a sector rather than
    // a side of a line — so it has one hold jack, not a high one and a low one.
    if (signal.kind === 'bearing') return { type: 'facing', bearing: 0 };
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
  if (signal.kind === 'bearing') return { type: 'faces', bearing: 0, cooldownMs: 160 };
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

// The rate the smoothing numbers are quoted against: the micro:bit's own tick.
// `smoothing` is "how much of the old reading survives one tick", so 0.9 means
// a tenth of the way to the new value every 100 ms, whatever is actually
// sending. Without a reference rate the same setting means different things on
// different inputs — see below.
const TICK_SECONDS = 0.1;

/**
 * A reading, mapped into 0..1 and eased toward.
 *
 * The easing is against elapsed *time*, not against samples. It used to be per
 * sample, which quietly made the setting mean whatever the input's rate
 * happened to be: a polled sensor arriving ten times a second was smoothed a
 * tenth as hard as a mouse arriving at the display's refresh rate, so the one
 * control that exists to stop a twitchy input twitching did almost nothing on
 * the twitchiest inputs. Raising it to compensate then made the slow inputs
 * unusably sluggish, which is what "no matter how hard I try" looks like.
 */
export function sampleRange(rawValue, transform, state, now = null) {
  const normalized = normalize(rawValue, transform);
  const smoothing = clamp01(transform.smoothing || 0);
  if (state.filtered == null || smoothing === 0) {
    state.filtered = normalized;
    state.smoothedAt = now;
    return normalized;
  }

  const elapsed = now == null || state.smoothedAt == null
    ? TICK_SECONDS
    : Math.max(0, (now - state.smoothedAt) / 1000);
  state.smoothedAt = now;
  // How much of the old value survives this gap. At exactly one tick this is
  // `smoothing` itself, so every saved wire keeps the feel it was set up with.
  const keep = smoothing ** (elapsed / TICK_SECONDS);
  const output = state.filtered * keep + normalized * (1 - keep);
  state.filtered = output;
  return output;
}

// A button already sends the held state; the only choice is which way round to
// read it, so this is the whole transform.
//
// Nothing is debounced here. Contact bounce is removed once, above the bus, in
// js/contact-settle.js — a contact bounces because of what it is made of, not
// because of what it is wired to, and cleaning it per-wire left the live readout
// and every trigger looking at the raw chatter.
export function sampleHold(rawValue, transform) {
  const on = rawValue > 0;
  return (transform.invert ? !on : on) ? 1 : 0;
}

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

// Held while the board points a given way. The band it lets go at is wider than
// the one it takes hold at, so resting on the edge of a sector doesn't chatter.
export function sampleFacing(rawValue, transform, state) {
  const limit = state.gateOn ? FACING_EXIT : FACING_ENTER;
  state.gateOn = bearingOffset(rawValue, transform.bearing) <= limit;
  return state.gateOn ? 1 : 0;
}

export function sampleTrigger(rawValue, transform, state, now) {
  let value = rawValue;
  let candidate = false;

  if (transform.type === 'faces') {
    // Fires on arrival only: once it counts as facing this way it stays latched
    // until it has turned properly away, so holding a direction is one event and
    // a wobble on the boundary is none.
    const offset = bearingOffset(rawValue, transform.bearing);
    if (offset <= FACING_ENTER) {
      candidate = !state.facingOn;
      state.facingOn = true;
    } else if (offset > FACING_EXIT) {
      state.facingOn = false;
    }
    // Activity reads as nearness to the bearing, so the meter fills as the
    // object comes round rather than jumping only when it fires.
    value = 1 - clamp01(offset / 180);
  } else if (transform.type === 'event') {
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
  // A bearing only has the two jacks, so anything arriving on it becomes the
  // one its port allows, keeping the direction if it already had one. Going the
  // other way, a facing transform on a signal that is no longer a bearing has
  // no circle left to measure on and falls back to that kind's own default.
  if (signal.kind === 'bearing') {
    const bearing = transform.bearing ?? 0;
    if (portTypeForTransform(transform.type) === 'hold') return { type: 'facing', bearing };
    if (portTypeForTransform(transform.type) === 'level') return transform; // dropped: no level jack
    return { type: 'faces', bearing, cooldownMs: transform.cooldownMs ?? 160 };
  }
  if (transform.type === 'faces' || transform.type === 'facing') {
    const port = { type: portTypeForTransform(transform.type) };
    return createDefaultTransform(signal, port, outputIdOf(signal, port, transform));
  }

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
