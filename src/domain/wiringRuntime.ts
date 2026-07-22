import type { Signal } from './signalStore';
import type {
  EdgeTransform,
  RangeTransform,
  TargetPort,
  TransformRange,
  TriggerTransform,
  WireTransform,
} from './wiringTypes';

export interface WireRuntimeState {
  previousRaw: number | null;
  previousNormalized: number | null;
  filtered: number | null;
  lastFiredAt: number;
}

interface TriggerResult {
  fired: boolean;
  value: number;
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function createRuntimeState(): WireRuntimeState {
  return {
    previousRaw: null,
    previousNormalized: null,
    filtered: null,
    lastFiredAt: -Infinity,
  };
}

export function signalRange(signal: Signal): Pick<TransformRange, 'min' | 'max'> {
  return signal.kind === 'binary' ? { min: 0, max: 1 } : { min: signal.min, max: signal.max };
}

export function createDefaultTransform(signal: Signal, port: TargetPort): WireTransform {
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

export function sampleRange(
  rawValue: number,
  transform: RangeTransform,
  state: WireRuntimeState,
): number {
  const normalized = normalize(rawValue, transform);
  const smoothing = clamp01(transform.smoothing || 0);
  const output = state.filtered == null
    ? normalized
    : state.filtered * smoothing + normalized * (1 - smoothing);
  state.filtered = output;
  return output;
}

export function sampleTrigger(
  rawValue: number,
  transform: TriggerTransform,
  state: WireRuntimeState,
  now: number,
): TriggerResult {
  let value = rawValue;
  let candidate = false;

  if (transform.type === 'event') {
    candidate = rawValue > 0;
  } else if (transform.type === 'edge') {
    candidate = edgeCrossed(rawValue, state.previousRaw, transform);
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

export function migrateTransformForSignal(transform: WireTransform, signal: Signal): WireTransform {
  if (signal.kind === 'event' && transform.type === 'edge') {
    return { type: 'event', cooldownMs: transform.cooldownMs };
  }
  if (signal.kind !== 'number') return transform;
  const range = signalRange(signal);
  if (transform.type === 'edge') {
    return {
      type: 'threshold',
      ...range,
      invert: false,
      direction: transform.edge === 'falling' ? 'below' : 'above',
      threshold: 0.5,
      cooldownMs: transform.cooldownMs,
    };
  }
  return transform.type === 'range' ? { ...transform, ...range } : transform;
}

function normalize(value: number, transform: TransformRange): number {
  const span = transform.max - transform.min || 1;
  const normalized = clamp01((value - transform.min) / span);
  return transform.invert ? 1 - normalized : normalized;
}

function edgeCrossed(value: number, previous: number | null, transform: EdgeTransform): boolean {
  return transform.edge === 'falling'
    ? previous === 1 && value === 0
    : value === 1 && previous !== 1;
}
