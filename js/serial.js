// Web Serial connection to a micro:bit over the USB cable it was flashed with.
//
// The same protocol as Bluetooth, and deliberately the same four exports, so
// the facade over both can treat them as interchangeable. What is not the same
// is how a connection ends, and that is the whole reason this is its own file:
// Bluetooth fires an event you can subscribe to, while a serial port simply
// stops answering. One is a notification, the other is the absence of one, and
// squeezing both into one state machine makes both harder to read.
//
// Why anybody wants this: the analog readings — tilt, compass, light, sound —
// are exactly the ones that saturate the micro:bit's Bluetooth UART, and a
// cable has no such ceiling. A controller that feels laggy wirelessly is
// usually fine plugged in.

import { emitStatus } from './bus.js';
import { createLineBuffer } from './line-protocol.js';

// What the micro:bit's USB serial runs at. MakeCode's default, and the value
// `serial.setBaudRate` in the generated program names explicitly.
const BAUD = 115200;

// The same ladder Bluetooth uses, for the same reason: most interruptions are
// momentary, and after four tries it is something a person has to go and fix.
const RETRY_DELAYS = [400, 1200, 3000, 6000];

let port = null;
let reader = null;
let retryTimer = null;
let attempt = 0;
let state = { state: 'disconnected' };

function announce(next) {
  state = next;
  emitStatus(next);
}

/** Is Web Serial available in this browser? */
export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.serial;
}

/** Whether this transport currently holds a board. */
export function isActive() {
  return Boolean(port);
}

function cancelRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

/**
 * Reads until the stream ends, however it ends.
 *
 * Three ways out, and they all land in the same place, which is the point:
 * `read()` resolving `{ done: true }` because someone closed it, `read()`
 * rejecting because the cable was pulled mid-read, and — separately, below —
 * the `disconnect` event on `navigator.serial`. Only the first two are
 * guaranteed; the event is a fast path, not the ground truth.
 */
async function pump(target) {
  // `midStream`, because opening a port does not start the board writing — it
  // has been writing all along, into a buffer we have only now begun reading.
  const lines = createLineBuffer({ midStream: true });
  reader = target.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lines.push(value);
    }
  } catch {
    // A cable pulled mid-read rejects rather than resolving. Same ending.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already gone */
    }
    reader = null;
  }
  streamEnded(target);
}

/** Opens the port and starts reading. Shared by the first connect and retries. */
async function openStream(target) {
  // A port that is still open from a previous session throws InvalidStateError
  // on `open`, and the retry ladder would then burn all four delays in
  // milliseconds on a board that was about to come back.
  if (target.readable) {
    try {
      await target.close();
    } catch {
      /* it was not really open; opening below will say so properly */
    }
  }
  await target.open({ baudRate: BAUD });
  // Deliberately not awaited: it runs until the stream ends, and awaiting it
  // would mean `connect` never resolving.
  pump(target);
}

/** Prompt the user to pick a port and start streaming its input. */
export async function connect() {
  if (!isSupported()) {
    announce({ state: 'disconnected', message: 'Web Serial not supported' });
    throw new Error('Web Serial not supported in this browser.');
  }

  cancelRetry();
  // Kept before the announcement, because `announce` overwrites `state` — so by
  // the time the chooser is dismissed below, `state` is already 'connecting' and
  // restoring it would re-announce the very thing we are trying to back out of.
  // That is what left the button reading "Connecting…", disabled, forever.
  const before = state;
  announce({ state: 'connecting' });

  let chosen = null;
  try {
    // No `filters`. Filtering to the micro:bit's DAPLink vendor id would give a
    // tidy one-item chooser, but a v1 board or a clone with a different id
    // would produce an *empty* one — and an empty chooser in a room of unknown
    // hardware is a much worse failure than a chooser with three entries in it.
    chosen = await navigator.serial.requestPort();
  } catch (err) {
    // Dismissing the chooser is not a failure and must not report one — doing
    // that while a board is already streaming used to blank a live connection.
    announce(before);
    throw err;
  }

  port = chosen;
  try {
    await openStream(chosen);
  } catch (err) {
    port = null;
    announce({ state: 'disconnected', message: err?.message });
    throw err;
  }

  attempt = 0;
  // A serial port has no name to show — `getInfo()` is a vendor and product id
  // and nothing else — so the label says what it is rather than which one.
  announce({ state: 'connected', message: 'micro:bit (USB)' });
}

/** Disconnect the current port, if any. Stops us trying to get it back. */
export function disconnect() {
  // See the same guard in bluetooth.js: a transport with nothing to let go of
  // stays quiet, so tearing down the unused one cannot blank a live status.
  if (!port && !retryTimer) return;
  cancelRetry();
  const target = port;
  port = null; // before closing, so the pump ending stays silent
  attempt = 0;
  if (!target) {
    announce({ state: 'disconnected' });
    return;
  }
  // Cancelling the reader is what makes the pending `read()` resolve, and
  // closing without it leaves the OS holding the handle so the next `open`
  // fails. Both are fire-and-forget; nothing downstream waits on the port.
  Promise.resolve(reader?.cancel())
    .catch(() => {})
    .then(() => target.close())
    .catch(() => {});
  announce({ state: 'disconnected' });
}

function streamEnded(target) {
  // The same two guards Bluetooth's disconnect handler carries: an ending that
  // belongs to a port we no longer hold is not our connection ending, and one
  // we asked for is not worth reporting.
  if (port !== target) return;
  if (!port) return;
  retry();
}

function retry() {
  const target = port;
  const wait = RETRY_DELAYS[attempt];
  if (wait == null) {
    port = null;
    attempt = 0;
    announce({ state: 'lost', message: 'micro:bit (USB)' });
    return;
  }

  attempt += 1;
  announce({ state: 'connecting', retrying: true });
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (port !== target) return; // disconnected, or swapped for another transport
    try {
      await openStream(target);
    } catch {
      // Nothing fires for an attempt that never landed, so the next try is
      // booked here rather than waited for.
      if (port === target) retry();
      return;
    }
    attempt = 0;
    announce({ state: 'connected', message: 'micro:bit (USB)' });
  }, wait);
}

// Physical removal, which the browser does tell us about. Only a fast path:
// it does not fire for a board that resets or a program that stops, so the
// pump above remains the thing that actually decides a stream has ended. What
// this buys is promptness — cancelling the reader makes a pending `read()`
// return now rather than whenever the OS gets round to failing it.
if (typeof navigator !== 'undefined' && navigator.serial?.addEventListener) {
  navigator.serial.addEventListener('disconnect', (event) => {
    if (event.target !== port) return;
    reader?.cancel().catch(() => {});
  });
}

// There is deliberately no watchdog on a silent stream. A board whose program
// crashed and a controller made entirely of buttons and gestures look identical
// from in here — both hold the port open and send nothing — and a controller
// that is quiet until touched is the whole point of reporting edges. The
// staleness chip in js/main.js is the honest version of that check, because it
// knows whether anything was expected to be streaming in the first place.
