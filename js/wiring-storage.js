// Persistence for wiring. Each game keeps its own independent set of
// connections, keyed by game id, so switching games never disturbs the wiring
// you set up for another one.

import { findPort, isValueTransform } from './wiring-config.js';

const STORAGE_KEY = 'experimental-game-controllers:wiring:v2';
const CONFIG_VERSION = 2;

export function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readAll(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.version !== CONFIG_VERSION || !isRecord(saved.games)) return {};
    return saved.games;
  } catch {
    return {};
  }
}

export function loadConnections(storage, gameId, targets) {
  const saved = readAll(storage)[gameId];
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((value) => {
    const connection = decodeConnection(value, targets);
    return connection ? [connection] : [];
  });
}

export function saveConnections(storage, gameId, connections) {
  try {
    const games = readAll(storage);
    games[gameId] = connections;
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: CONFIG_VERSION, games }));
  } catch {
    // Persistence may be blocked; the in-memory editor remains fully usable.
  }
}

// What each jack is set to before anything is patched into it. These belong to
// the input rather than to any one game, so they are stored flat rather than
// under a game id.
const DRAFT_KEY = 'experimental-game-controllers:jacks:v1';

export function loadDrafts(storage) {
  const drafts = new Map();
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(DRAFT_KEY) ?? 'null');
  } catch {
    return drafts;
  }
  if (!isRecord(saved)) return drafts;
  for (const [key, value] of Object.entries(saved)) {
    const transform = normalizeTransform(value?.transform);
    if (transform && isSignalKind(value.kind)) drafts.set(key, { kind: value.kind, transform });
  }
  return drafts;
}

export function saveDrafts(storage, drafts) {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // Persistence may be blocked; the jacks still work for this session.
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

  // Everything that compares raw readings carries a bare span and no invert:
  // above/below already covers the direction, and the numbers mean what they say.
  const span = decodeSpan(value);
  if (!span) return null;

  if (value.type === 'gate') {
    const threshold = finiteNumber(value.threshold);
    if (threshold == null || (value.direction !== 'above' && value.direction !== 'below')) return null;
    return { type: 'gate', ...span, direction: value.direction, threshold };
  }
  if (value.type === 'change') {
    const amount = finiteNumber(value.amount);
    return cooldownMs == null || amount == null
      ? null
      : { type: 'change', ...span, amount, cooldownMs };
  }
  if (value.type === 'threshold') {
    const threshold = finiteNumber(value.threshold);
    if (cooldownMs == null || threshold == null
      || (value.direction !== 'above' && value.direction !== 'below')) return null;
    return { type: 'threshold', ...span, direction: value.direction, threshold, cooldownMs };
  }
  // Only a range maps its span onto a control, so only a range can invert it.
  if (value.type === 'range') {
    const smoothing = finiteNumber(value.smoothing);
    const invert = value.invert === undefined ? false : value.invert;
    return smoothing == null || typeof invert !== 'boolean'
      ? null
      : { type: 'range', ...span, invert, smoothing };
  }
  return null;
}

function decodeConnection(value, targets) {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const { id, source, sourceKind } = value;
  const { node, port } = value.target;
  if (typeof id !== 'string' || typeof source !== 'string' || !isSignalKind(sourceKind)) return null;
  if (typeof node !== 'string' || typeof port !== 'string') return null;

  const target = { node, port };
  const portDefinition = findPort(targets, target);
  const transform = normalizeTransform(value.transform);
  if (!portDefinition || !transform) return null;
  if ((portDefinition.type === 'value') !== isValueTransform(transform.type)) return null;
  return { id, source, sourceKind, target, transform };
}

function decodeSpan(value) {
  const min = finiteNumber(value.min);
  const max = finiteNumber(value.max);
  return min == null || max == null ? null : { min, max };
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
