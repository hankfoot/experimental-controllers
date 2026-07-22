const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function createRuntimeState() {
  return {
    previousRaw: null,
    previousNormalized: null,
    filtered: null,
    lastFiredAt: -Infinity,
  };
}

export function signalRange(signal) {
  return signal.kind === 'binary' ? { min: 0, max: 1 } : { min: signal.min, max: signal.max };
}

export function createDefaultTransform(signal, port) {
  const range = signalRange(signal);
  if (port.type === 'value') return { type: 'range', ...range, invert: false, smoothing: 0 };
  if (signal.kind === 'event') return { type: 'event', cooldownMs: 160 };
  if (signal.kind === 'binary') return { type: 'edge', edge: 'rising', cooldownMs: 160 };
  return {
    type: 'threshold',
    ...range,
    invert: false,
    direction: 'above',
    threshold: 0.5,
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
    value = normalize(rawValue, transform);
    if (transform.type === 'change') {
      candidate = state.previousNormalized != null
        && Math.abs(value - state.previousNormalized) >= clamp01(transform.amount);
    } else {
      const threshold = clamp01(transform.threshold);
      candidate = state.previousNormalized != null && (transform.direction === 'below'
        ? state.previousNormalized >= threshold && value < threshold
        : state.previousNormalized <= threshold && value > threshold);
    }
    state.previousNormalized = value;
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
      invert: false,
      direction: transform.type === 'edge' && transform.edge === 'falling' ? 'below' : 'above',
      threshold: 0.5,
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
