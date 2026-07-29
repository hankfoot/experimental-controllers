// Persistence for wiring. Each game keeps its own independent set of
// connections, keyed by game id, so switching games never disturbs the wiring
// you set up for another one.

import { findPort, isBearing, portTypeForTransform } from './wiring-config.js';
import { key } from './storage-keys.js';

// v3 split the single "value" connector into a level and a hold, which changed
// both the shape of a saved transform and what a jack is called. Nothing from
// v2 can be read as either one with confidence, so the old key is simply left
// behind and the board opens empty.
const STORAGE_KEY = key('wiring', 'v3');
const CONFIG_VERSION = 3;

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
const DRAFT_KEY = key('jacks', 'v2');

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

// How a control will act on whatever reaches it, held per port so the setting
// is there to read before a wire exists — and still there after one is cut. Two
// ports answer that differently and each keeps only its own answer:
//   cooldownMs — how often a trigger will let itself be fired
//   smoothing  — how closely a level follows the reading driving it
// The wire's own transform is what actually carries these once something is
// patched in; this is only what an empty port says, and what the next wire to
// land on it starts from.
//
// Saved payloads were a bare number back when pacing was the only thing a port
// held, so a lone number still reads as the pace it was.
const PORT_KEY = key('ports', 'v1');

const PORT_SETTINGS = Object.freeze({
  cooldownMs: (value) => value >= 0,
  smoothing: (value) => value >= 0 && value < 1,
});

/** Whether a value is one this port setting is allowed to hold. */
export function isPortSetting(name, value) {
  const accepts = PORT_SETTINGS[name];
  return Boolean(accepts) && finiteNumber(value) != null && accepts(value);
}

export function loadPortDefaults(storage) {
  const defaults = new Map();
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(PORT_KEY) ?? 'null');
  } catch {
    return defaults;
  }
  if (!isRecord(saved)) return defaults;
  for (const [key, value] of Object.entries(saved)) {
    const stored = isRecord(value) ? value : { cooldownMs: value };
    const settings = {};
    for (const name of Object.keys(PORT_SETTINGS)) {
      if (isPortSetting(name, stored[name])) settings[name] = stored[name];
    }
    // A port that kept nothing readable is a port with nothing saved, so it
    // falls back to the same defaults an untouched one gets.
    if (Object.keys(settings).length) defaults.set(key, settings);
  }
  return defaults;
}

// How each control is set up, per game — the choices a game offers about what
// its own ports do with what they're given. Stored under the game id, like the
// connections, since the ports belong to the game.
const OPTION_KEY = key('controls', 'v1');

export function loadPortOptions(storage, gameId) {
  try {
    const saved = JSON.parse(storage?.getItem(OPTION_KEY) ?? 'null');
    const forGame = isRecord(saved) ? saved[gameId] : null;
    return isRecord(forGame) ? forGame : {};
  } catch {
    return {};
  }
}

/**
 * Every game's wiring at once. Only an exported bundle wants this — a file that
 * carried the drawings and the course but not the wiring handed somebody a game
 * that looked right and answered to nothing.
 */
export function loadAllConnections(storage) {
  return readAll(storage);
}

export function saveAllConnections(storage, games) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({
      version: CONFIG_VERSION,
      games: isRecord(games) ? games : {},
    }));
  } catch {
    // Persistence may be blocked; the wiring still works for this session.
  }
}

/**
 * Every game's options at once. Only an exported theme wants these — it carries
 * the course you set up along with the look of it, since the two together are
 * what somebody actually made.
 */
export function loadAllPortOptions(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(OPTION_KEY) ?? 'null');
    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function saveAllPortOptions(storage, games) {
  try {
    storage?.setItem(OPTION_KEY, JSON.stringify(isRecord(games) ? games : {}));
  } catch {
    // Persistence may be blocked; the controls still work for this session.
  }
}

export function savePortOptions(storage, gameId, options) {
  try {
    const saved = JSON.parse(storage?.getItem(OPTION_KEY) ?? 'null');
    const games = isRecord(saved) ? saved : {};
    games[gameId] = options;
    storage?.setItem(OPTION_KEY, JSON.stringify(games));
  } catch {
    // Persistence may be blocked; the controls still work for this session.
  }
}

export function savePortDefaults(storage, defaults) {
  try {
    storage?.setItem(PORT_KEY, JSON.stringify(Object.fromEntries(defaults)));
  } catch {
    // Persistence may be blocked; the ports still work for this session.
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
  // A button's hold has no span to carry: the reading is already the state, and
  // inverting is the only thing there is to say about it.
  if (value.type === 'hold') {
    const invert = value.invert === undefined ? false : value.invert;
    return typeof invert === 'boolean' ? { type: 'hold', invert } : null;
  }
  // A bearing carries only which way it is asking about. A saved direction that
  // isn't one of the offered ones is refused rather than snapped to the nearest,
  // the same as any other unreadable setting.
  if (value.type === 'facing' || value.type === 'faces') {
    const bearing = finiteNumber(value.bearing);
    if (bearing == null || !isBearing(bearing)) return null;
    if (value.type === 'facing') return { type: 'facing', bearing };
    return cooldownMs == null ? null : { type: 'faces', bearing, cooldownMs };
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
  // A band around a value: where the middle is, and how far off it still counts.
  // A width of zero is a band nothing can be inside, so it is refused rather
  // than saved as a hold that can never come on.
  if (value.type === 'near') {
    const center = finiteNumber(value.center);
    const width = finiteNumber(value.width);
    if (center == null || width == null || width <= 0) return null;
    return { type: 'near', ...span, center, width };
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
  if (portDefinition.type !== portTypeForTransform(transform.type)) return null;
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
  return value === 'event' || value === 'binary' || value === 'number' || value === 'bearing';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
