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

export function signalRange(signal) {
  return signal.kind === 'binary' ? { min: 0, max: 1 } : { min: signal.min, max: signal.max };
}

export function createDefaultTransform(signal, port, outputId) {
  const range = signalRange(signal);
  if (port.type === 'value') {
    // Only an analog reading needs squaring off; a button's 0/1 already holds.
    return outputId === 'hold' && signal.kind === 'number'
      ? { type: 'gate', ...range, direction: 'above', threshold: (range.min + range.max) / 2 }
      : { type: 'range', ...range, invert: false, smoothing: 0 };
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
  if (transform.type === 'range') {
    return signal.kind === 'number' ? { ...transform, ...signalRange(signal) } : transform;
  }

  if (transform.type === 'gate') {
    // The threshold is raw, so a widening range leaves it exactly where it was.
    if (signal.kind === 'number') return { ...transform, ...signalRange(signal) };
    // Nothing left to gate once the source only ever reads 0 or 1 — the raw
    // reading already is the held state.
    if (signal.kind === 'binary') {
      return { type: 'range', ...signalRange(signal), invert: false, smoothing: 0 };
    }
    return transform; // event: the wire itself is dropped, having no value output
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
  const span = transform.max - transform.min || 1;
  const normalized = clamp01((value - transform.min) / span);
  return transform.invert ? 1 - normalized : normalized;
}
