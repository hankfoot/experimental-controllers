import { targetPort } from './wiring-config.js';

const STORAGE_KEY = 'experimental-game-controllers:wiring:v1';
const CONFIG_VERSION = 1;

export function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadConnections(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.version !== CONFIG_VERSION || !Array.isArray(saved.connections)) return [];
    return saved.connections.flatMap((value) => {
      const connection = decodeConnection(value);
      return connection ? [connection] : [];
    });
  } catch {
    return [];
  }
}

export function saveConnections(storage, connections) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: CONFIG_VERSION, connections }));
  } catch {
    // Persistence may be blocked; the in-memory editor remains fully usable.
  }
}

export function normalizeTransform(value) {
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
    return cooldownMs == null || amount == null
      ? null
      : { type: 'change', ...range, amount, cooldownMs };
  }
  if (value.type === 'threshold') {
    const threshold = finiteNumber(value.threshold);
    if (cooldownMs == null || threshold == null
      || (value.direction !== 'above' && value.direction !== 'below')) return null;
    return { type: 'threshold', ...range, direction: value.direction, threshold, cooldownMs };
  }
  return null;
}

function decodeConnection(value) {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const { id, source, sourceKind } = value;
  const { node, port } = value.target;
  if (typeof id !== 'string' || typeof source !== 'string' || !isSignalKind(sourceKind)) return null;
  if (typeof node !== 'string' || typeof port !== 'string') return null;

  const target = { node, port };
  const portDefinition = targetPort(target);
  const transform = normalizeTransform(value.transform);
  if (!portDefinition || !transform) return null;
  if ((portDefinition.type === 'value') !== (transform.type === 'range')) return null;
  return { id, source, sourceKind, target, transform };
}

function decodeRange(value) {
  const min = finiteNumber(value.min);
  const max = finiteNumber(value.max);
  if (min == null || max == null) return null;
  // Early v1 numeric triggers omitted invert. Missing means their original,
  // non-inverted behavior.
  const invert = value.invert === undefined ? false : value.invert;
  return typeof invert === 'boolean' ? { min, max, invert } : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object';
}

function isSignalKind(value) {
  return value === 'event' || value === 'binary' || value === 'number';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
