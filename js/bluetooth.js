// Web Bluetooth connection to a micro:bit's UART (Nordic UART Service).
//
// The micro:bit, running one of the MakeCode starters with the Bluetooth UART
// service enabled, sends newline-delimited text. We buffer bytes, split on '\n',
// and parse each line into a protocol message, then push it onto the shared bus.

import { emitInput, emitStatus } from './bus.js';

// Nordic UART Service UUIDs. NOTE: the micro:bit's UART profile assigns TX/RX
// the OPPOSITE way to the common Nordic nRF example — the micro:bit *transmits*
// on 6e400002 (notify → browser) and *receives* on 6e400003 (write). Subscribing
// to 6e400003 for notifications (the nRF convention) connects fine but delivers
// no data, which is the bug this fixes.
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // micro:bit -> browser (notifications)
const UART_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // browser -> micro:bit (write)

let device = null;
let rxChar = null;
const decoder = new TextDecoder();
let buffer = '';

/** Is Web Bluetooth available in this browser? */
export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/** Prompt the user to pick a micro:bit and start streaming its input. */
export async function connect() {
  if (!isSupported()) {
    emitStatus({ state: 'disconnected', message: 'Web Bluetooth not supported' });
    throw new Error('Web Bluetooth not supported in this browser.');
  }

  emitStatus({ state: 'connecting' });
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [UART_SERVICE],
    });
    device.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE);

    const txChar = await service.getCharacteristic(UART_TX);
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', onNotify);

    // RX is optional — only needed if we ever want to send data back to the micro:bit.
    rxChar = await service.getCharacteristic(UART_RX).catch(() => null);

    buffer = '';
    emitStatus({ state: 'connected', message: device.name || 'micro:bit' });
  } catch (err) {
    // User cancelling the chooser also lands here — treat as a clean disconnect.
    emitStatus({ state: 'disconnected', message: err?.message });
    throw err;
  }
}

/** Disconnect the current device, if any. */
export function disconnect() {
  if (device?.gatt?.connected) device.gatt.disconnect();
}

/** Optionally send a line of text back to the micro:bit (appends newline). */
export async function send(text) {
  if (!rxChar) return;
  await rxChar.writeValue(new TextEncoder().encode(text + '\n'));
}

function onDisconnected() {
  emitStatus({ state: 'disconnected', message: 'micro:bit disconnected' });
}

function onNotify(event) {
  buffer += decoder.decode(event.target.value);
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) parseLine(line);
  }
}

/**
 * Parse one protocol line ("<channel>:<number>") into a message and push it
 * onto the bus. Any channel name is valid; malformed lines are ignored so a
 * noisy starter can't crash the page.
 */
export function parseLine(raw) {
  const sep = raw.indexOf(':');
  if (sep <= 0) return; // no channel name — not part of the protocol
  const channel = raw.slice(0, sep).trim().toLowerCase();
  const value = parseFloat(raw.slice(sep + 1));
  if (!channel || Number.isNaN(value)) return;
  emitInput({ channel, value, raw });
}
