import type { Signal } from './signalStore';
import type {
  GameTarget,
  TargetPort,
  TransformRange,
  WireConnection,
  WireTarget,
  WireTransform,
} from './wiringTypes';

export const GAME_TARGETS: GameTarget[] = [
  {
    id: 'flap', label: 'Flap', emoji: '🐤', description: 'Push the bird upward.',
    ports: [
      { id: 'trigger', label: 'When to flap', type: 'trigger' },
      { id: 'magnitude', label: 'Flap strength', type: 'value', defaultValue: 0.57 },
    ],
  },
  {
    id: 'restart', label: 'Restart', emoji: '↻', description: 'Start a fresh round.',
    ports: [{ id: 'trigger', label: 'When to restart', type: 'trigger' }],
  },
  {
    id: 'speed', label: 'Game speed', emoji: '💨', description: 'Set how quickly pipes move.',
    ports: [{ id: 'value', label: 'Speed', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'position', label: 'Bird position', emoji: '↕️', description: 'Steer height directly instead of flapping.',
    ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'gravity', label: 'Gravity', emoji: '🪨', description: 'Make the bird floaty or heavy.',
    ports: [{ id: 'value', label: 'Weight', type: 'value', defaultValue: 0.5 }],
  },
];

export function targetPort(target: WireTarget): TargetPort | null {
  return GAME_TARGETS.find((node) => node.id === target.node)?.ports.find(
    (port) => port.id === target.port,
  ) ?? null;
}

export function signalRange(signal: Signal): Pick<TransformRange, 'min' | 'max'> {
  return signal.kind === 'binary' ? { min: 0, max: 1 } : { min: signal.min, max: signal.max };
}

export function defaultTransform(signal: Signal, port: TargetPort): WireTransform {
  const range = signalRange(signal);
  if (port.type === 'value') return { type: 'range', ...range, invert: false, smoothing: 0 };
  if (signal.kind === 'event') return { type: 'event', cooldownMs: 160 };
  if (signal.kind === 'binary') return { type: 'edge', edge: 'rising', cooldownMs: 160 };
  return {
    type: 'threshold', ...range, invert: false, direction: 'above', threshold: 0.5, cooldownMs: 160,
  };
}

export function canConnect(signal: Signal | null, port: TargetPort | null): boolean {
  return Boolean(signal && port && (port.type === 'trigger' || signal.kind !== 'event'));
}

export function isStoredConnection(value: unknown): value is WireConnection {
  if (!value || typeof value !== 'object') return false;
  const connection = value as Partial<WireConnection>;
  const port = connection.target ? targetPort(connection.target) : null;
  if (!port || !isTransform(connection.transform)) return false;
  return typeof connection.id === 'string'
    && typeof connection.source === 'string'
    && ['event', 'binary', 'number'].includes(connection.sourceKind ?? '')
    && (port.type === 'value') === (connection.transform.type === 'range');
}

function isTransform(value: unknown): value is WireTransform {
  if (!value || typeof value !== 'object') return false;
  const transform = value as Partial<WireTransform> & Partial<TransformRange>;
  const finite = (number: unknown) => typeof number === 'number' && Number.isFinite(number);
  const cooldown = 'cooldownMs' in transform && finite(transform.cooldownMs);

  if (transform.type === 'event') return cooldown;
  if (transform.type === 'edge') {
    return cooldown && (transform.edge === 'rising' || transform.edge === 'falling');
  }
  const hasRange = finite(transform.min) && finite(transform.max) && typeof transform.invert === 'boolean';
  if (transform.type === 'range') return hasRange && finite(transform.smoothing);
  if (transform.type === 'change') return hasRange && cooldown && finite(transform.amount);
  if (transform.type === 'threshold') {
    return hasRange && cooldown && finite(transform.threshold)
      && (transform.direction === 'above' || transform.direction === 'below');
  }
  return false;
}
