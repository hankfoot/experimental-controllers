// One board at a time, over Bluetooth.
//
// This was a facade over two interchangeable transports, Bluetooth and USB
// serial. The wire is gone: writing to serial blocks whenever nothing is
// draining it, which is what a board on a battery always looks like, and the
// handshake needed to know whether anything *was* draining it destabilised the
// board outright. The radio is also the only one of the two that matches what
// the workshop is for — a controller you can pick up and carry.
//
// The shape is kept rather than collapsed into direct imports of bluetooth.js,
// because callers already speak it and it is where a second transport would go
// back if one is ever worth having.

import * as wireless from './bluetooth.js';

/** How the connection describes itself in the status chip, beside the board's name. */
export const VIA = 'Bluetooth';

/** How the live connection describes itself, or null when there isn't one. */
export function activeVia() {
  return wireless.isActive() ? VIA : null;
}

/** Whether this browser can connect at all. */
export const isSupported = () => wireless.isSupported();

/** Whether a board is currently held. */
export const isActive = () => wireless.isActive();

// Two clicks in quick succession must not interleave two attempts.
let inFlight = null;

/** Connects to a board, prompting for one. */
export async function connect() {
  const work = wireless.connect();
  inFlight = work.catch(() => {});
  try {
    await work;
  } finally {
    inFlight = null;
  }
}

/** Lets go of the board, if there is one. Safe to call when there isn't. */
export function disconnect() {
  wireless.disconnect();
}

/** Resolves once any connect in progress has settled. For tests, mostly. */
export const settled = () => inFlight ?? Promise.resolve();
