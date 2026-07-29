// Web Bluetooth connection to a micro:bit's UART (Nordic UART Service).
//
// The micro:bit, running one of the MakeCode starters with the Bluetooth UART
// service enabled, sends newline-delimited text. We buffer bytes, split on '\n',
// and parse each line into a protocol message, then push it onto the shared bus.
//
// The link drops. Batteries sag, someone walks their controller out of range,
// someone else stands between the two, the board resets when a crocodile clip
// shorts something. None of that is worth a person's attention, so a drop is
// picked back up here rather than reported: the browser is allowed to reconnect
// to a device it has already been given without asking again, and the retries
// below are the difference between "it broke" and a couple of dropped frames.

import { emitStatus } from './bus.js';
import { createLineBuffer } from './line-protocol.js';

// Nordic UART Service UUIDs. The micro:bit transmits on 6e400002; subscribing
// to the Nordic example's opposite characteristic connects but yields no data.
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // micro:bit -> browser (notifications)

// How long to keep trying after an unexpected drop, and how long to wait between
// tries. Front-loaded because most drops are momentary — a board that browns out
// for an instant is usually back before the first wait is over — and stopping
// after four because by then it is something a person has to go and fix.
const RETRY_DELAYS = [400, 1200, 3000, 6000];

let device = null;
// Whether we have already hooked this device's disconnect event. Chrome hands
// back the same BluetoothDevice object for the same board, so connecting twice
// without this stacks a second identical listener on the same object.
let watching = null;
let retryTimer = null;
let attempt = 0;
// What the last status said, so a failure with nothing to report — the chooser
// being dismissed, most of all — can put it back rather than inventing one.
let state = { state: 'disconnected' };

const lines = createLineBuffer();

function announce(next) {
  state = next;
  emitStatus(next);
}

/** Is Web Bluetooth available in this browser? */
export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/** Opens the UART stream on an already-chosen device. */
async function openStream(target) {
  const server = await target.gatt.connect();
  const service = await server.getPrimaryService(UART_SERVICE);
  const txChar = await service.getCharacteristic(UART_TX);
  await txChar.startNotifications();
  txChar.addEventListener('characteristicvaluechanged', onNotify);
  // Anything left over belongs to a session that has ended; a line cut in half
  // by a drop would otherwise be glued to the first line of the next one.
  lines.reset();
}

/** Prompt the user to pick a micro:bit and start streaming its input. */
export async function connect() {
  if (!isSupported()) {
    announce({ state: 'disconnected', message: 'Web Bluetooth not supported' });
    throw new Error('Web Bluetooth not supported in this browser.');
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
    chosen = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [UART_SERVICE],
    });
  } catch (err) {
    // Dismissing the chooser is not a failure and must not report one — doing
    // that while a board is already streaming used to blank a live connection.
    announce(before);
    throw err;
  }

  // Pairing a second board while one is already on: let the first one go rather
  // than leaving the OS holding a link nothing is listening to.
  if (device && device !== chosen && device.gatt?.connected) device.gatt.disconnect();

  device = chosen;
  if (watching !== chosen) {
    chosen.addEventListener('gattserverdisconnected', onDisconnected);
    watching = chosen;
  }

  try {
    await openStream(chosen);
  } catch (err) {
    // The link can be up while the service handshake fails — the board is still
    // booting, or the UART service isn't running in what was flashed. Left half
    // open, the OS keeps holding the connection and the next attempt hangs on it.
    try {
      chosen.gatt?.disconnect();
    } catch {
      /* already down, which is the state we were asking for */
    }
    announce({ state: 'disconnected', message: err?.message });
    throw err;
  }

  attempt = 0;
  announce({ state: 'connected', message: chosen.name || 'micro:bit' });
}

/** Disconnect the current device, if any. Stops us trying to get it back. */
export function disconnect() {
  // Nothing held and nothing pending means nothing to say. The facade tears
  // down every transport before opening one, so without this the transport you
  // are *not* using would announce a disconnect over the one you are.
  if (!device && !retryTimer) return;
  cancelRetry();
  const target = device;
  device = null;
  attempt = 0;
  lines.reset();
  if (target?.gatt?.connected) target.gatt.disconnect();
  announce({ state: 'disconnected' });
}

function cancelRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

function onDisconnected(event) {
  // Pairing a second board leaves the first one's listener installed on an
  // object we no longer hold. Its eventual drop is not our connection ending,
  // and reporting it as one is a disconnect out of nowhere while data is still
  // arriving from the board that is actually plugged in.
  if (event?.target && event.target !== device) return;
  if (!device) return; // we asked for this one
  lines.reset();
  retry();
}

function retry() {
  const target = device;
  const wait = RETRY_DELAYS[attempt];
  if (wait == null) {
    device = null;
    attempt = 0;
    announce({ state: 'lost', message: target?.name || 'micro:bit' });
    return;
  }

  attempt += 1;
  // `retrying` is what tells the UI there is still a board to give up on: the
  // first connect has nothing to disconnect from, a reconnect very much does.
  announce({ state: 'connecting', retrying: true });
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (device !== target) return; // disconnected, or paired with something else
    try {
      await openStream(target);
    } catch {
      // Still down. `gattserverdisconnected` does not fire for an attempt that
      // never landed, so the next try is booked here rather than waited for.
      if (device === target) retry();
      return;
    }
    attempt = 0;
    announce({ state: 'connected', message: target.name || 'micro:bit' });
  }, wait);
}

function onNotify(event) {
  lines.push(event.target.value);
}

/** Whether this transport currently holds a board. */
export function isActive() {
  return Boolean(device);
}
