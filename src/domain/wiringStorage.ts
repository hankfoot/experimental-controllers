import { targetPort } from './wiringConfig';
import type {
  GameTargetId,
  StorageLike,
  TransformRange,
  WireConnection,
  WireTransform,
} from './wiringTypes';

const STORAGE_KEY = 'experimental-game-controllers:wiring:v1';
const CONFIG_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadConnections(storage: StorageLike | null): WireConnection[] {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as UnknownRecord | null;
    if (saved?.version !== CONFIG_VERSION || !Array.isArray(saved.connections)) return [];
    return saved.connections.flatMap((value) => {
      const connection = decodeConnection(value);
      return connection ? [connection] : [];
    });
  } catch {
    return [];
  }
}

export function saveConnections(storage: StorageLike | null, connections: WireConnection[]): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: CONFIG_VERSION, connections }));
  } catch {
    // Persistence may be blocked; the in-memory editor remains fully usable.
  }
}

function decodeConnection(value: unknown): WireConnection | null {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const { id, source, sourceKind } = value;
  const { node, port } = value.target;
  if (typeof id !== 'string' || typeof source !== 'string' || !isSignalKind(sourceKind)) return null;
  if (typeof node !== 'string' || typeof port !== 'string') return null;

  const target = { node: node as GameTargetId, port };
  const targetDefinition = targetPort(target);
  const transform = normalizeTransform(value.transform);
  if (!targetDefinition || !transform) return null;
  if ((targetDefinition.type === 'value') !== (transform.type === 'range')) return null;
  return { id, source, sourceKind, target, transform };
}

export function normalizeTransform(value: unknown): WireTransform | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const cooldownMs = finiteNumber(value.cooldownMs);

  if (value.type === 'event') {
    return cooldownMs == null ? null : { type: 'event', cooldownMs };
  }
  if (value.type === 'edge') {
    if (cooldownMs == null || (value.edge !== 'rising' && value.edge !== 'falling')) return null;
    return { type: 'edge', edge: value.edge, cooldownMs };
  }

  const range = decodeRange(value);
  if (!range) return null;
  if (value.type === 'range') {
    const smoothing = finiteNumber(value.smoothing);
    return smoothing == null ? null : { type: 'range', ...range, smoothing };
  }
  if (value.type === 'change') {
    const amount = finiteNumber(value.amount);
    return cooldownMs == null || amount == null ? null : { type: 'change', ...range, amount, cooldownMs };
  }
  if (value.type === 'threshold') {
    const threshold = finiteNumber(value.threshold);
    if (cooldownMs == null || threshold == null || (value.direction !== 'above' && value.direction !== 'below')) {
      return null;
    }
    return { type: 'threshold', ...range, direction: value.direction, threshold, cooldownMs };
  }
  return null;
}

function decodeRange(value: UnknownRecord): TransformRange | null {
  const min = finiteNumber(value.min);
  const max = finiteNumber(value.max);
  if (min == null || max == null) return null;
  // Early v1 numeric triggers did not persist this field. Missing means the
  // original, non-inverted behavior; range transforms always stored it.
  const invert = value.invert === undefined ? false : value.invert;
  return typeof invert === 'boolean' ? { min, max, invert } : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object';
}

function isSignalKind(value: unknown): value is WireConnection['sourceKind'] {
  return value === 'event' || value === 'binary' || value === 'number';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
