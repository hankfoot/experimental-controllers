// Shared input bus.
//
// Everything that PRODUCES input (the real micro:bit over Bluetooth, or the test
// controls) calls emitInput(). Everything that CONSUMES input (visualizer, game)
// listens with onInput(). Consumers never care whether a message came from real
// hardware or a demo button.

const bus = new EventTarget();

/**
 * A parsed input message — one reading from one channel.
 * The wire protocol is "<channel>:<number>\n"; channels are raw sensor streams
 * (btna, light, pitch, p0, shake, …) with raw values. See js/channels.js for
 * known-channel metadata; unknown channel names are perfectly valid.
 * @typedef {{ channel: string, value: number, raw?: string }} InputMsg
 */

/** Broadcast an input message to every consumer. @param {InputMsg} msg */
export function emitInput(msg) {
  bus.dispatchEvent(new CustomEvent('input', { detail: msg }));
}

/** Subscribe to input messages. @param {(msg: InputMsg) => void} handler */
export function onInput(handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener('input', listener);
  return () => bus.removeEventListener('input', listener);
}

// Connection status is broadcast the same way so the UI can react.
/** @typedef {{ state: 'disconnected'|'connecting'|'connected', message?: string }} StatusMsg */

/** @param {StatusMsg} status */
export function emitStatus(status) {
  bus.dispatchEvent(new CustomEvent('status', { detail: status }));
}

/** @param {(status: StatusMsg) => void} handler */
export function onStatus(handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener('status', listener);
  return () => bus.removeEventListener('status', listener);
}
