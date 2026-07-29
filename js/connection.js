// One board at a time, over whichever cable or radio you picked.
//
// The two transports are interchangeable from up here — same four calls, same
// statuses on the same bus — so everything above this line stays ignorant of
// which one is running. What this file adds is the one rule neither transport
// can enforce alone: only one of them may be live, because two streams pushing
// onto one bus is two controllers fighting over the same game.

import * as wireless from './bluetooth.js';
import * as wired from './serial.js';

/**
 * The transports, in the order the menu offers them, with the words it uses.
 *
 * Wireless first because it is what the workshop is about — a controller you
 * can carry — and because it is the one that works on a phone. Wired is the
 * answer when the readings are too many for the radio, which is most of the
 * analog ones.
 */
export const TRANSPORTS = Object.freeze([
  Object.freeze({
    id: 'wireless',
    label: 'Wireless',
    emoji: '📡',
    hint: 'Bluetooth. Needs a battery pack.',
    // What the status chip says alongside the board's name. Worth saying: the
    // two connections behave differently enough — one needs a battery, one
    // needs a cable, and only one of them can be walked out of range — that
    // "connected" on its own leaves out the useful half.
    via: 'Bluetooth',
    module: wireless,
  }),
  Object.freeze({
    id: 'wired',
    label: 'Wired',
    emoji: '🔌',
    hint: 'The USB cable you flashed with.',
    via: 'USB',
    module: wired,
  }),
]);

/** How the live connection describes itself, or null when there isn't one. */
export function activeVia() {
  return TRANSPORTS.find((transport) => transport.module.isActive())?.via ?? null;
}

const find = (id) => TRANSPORTS.find((transport) => transport.id === id);

/** Which transports this browser can offer at all. */
export const supported = () => TRANSPORTS.filter((transport) => transport.module.isSupported());

export const anySupported = () => supported().length > 0;

/** Which transport is holding a board, or null. */
export function active() {
  return TRANSPORTS.find((transport) => transport.module.isActive())?.id ?? null;
}

// Two clicks in quick succession must not interleave two swaps, which would
// leave the teardown of one racing the opening of the other.
let inFlight = null;

/**
 * Connects `id`, letting go of whatever was connected first.
 *
 * Swapping rather than refusing: a menu with two items where picking the other
 * one does nothing is a menu that appears broken, and there is nowhere in a top
 * bar to explain why. Tearing down first rather than after is not optional —
 * the overlap is the window in which both streams are live.
 *
 * The teardown runs even when the old transport is only *retrying* rather than
 * connected. Only `disconnect` cancels a pending retry timer, so skipping it
 * would leave Bluetooth to quietly reconnect on top of a live serial stream
 * several seconds later.
 */
export async function connect(id) {
  const next = find(id);
  if (!next) throw new Error(`No such connection: ${id}`);

  const work = (async () => {
    for (const transport of TRANSPORTS) {
      if (transport !== next) transport.module.disconnect();
    }
    await next.module.connect();
  })();

  inFlight = work.catch(() => {});
  try {
    await work;
  } finally {
    inFlight = null;
  }
}

/** Lets go of whatever is connected. Safe to call when nothing is. */
export function disconnect() {
  for (const transport of TRANSPORTS) transport.module.disconnect();
}

/** Resolves once any connect in progress has settled. For tests, mostly. */
export const settled = () => inFlight ?? Promise.resolve();
