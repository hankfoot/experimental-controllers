// Shared input bus.
//
// Everything that PRODUCES input (the real micro:bit over Bluetooth, or Demo mode)
// calls emitInput(). Everything that CONSUMES input (visualizer, game) listens with
// onInput(). This keeps the browser side fully sensor-agnostic: consumers never care
// whether a message came from real hardware or a demo button.

const bus = new EventTarget();

/**
 * A parsed input message. `type` is one of the three protocol types:
 *   { type: 'trigger', value: null }
 *   { type: 'state',   value: true | false }
 *   { type: 'value',   value: 0.0 .. 1.0 }
 * @typedef {{ type: 'trigger'|'state'|'value', value: (null|boolean|number), raw?: string }} InputMsg
 */

/** Broadcast an input message to every consumer. @param {InputMsg} msg */
export function emitInput(msg) {
  bus.dispatchEvent(new CustomEvent('input', { detail: msg }));
}

/** Subscribe to input messages. @param {(msg: InputMsg) => void} handler */
export function onInput(handler) {
  bus.addEventListener('input', (e) => handler(e.detail));
}

// Connection status is broadcast the same way so the UI can react.
/** @typedef {{ state: 'disconnected'|'connecting'|'connected', message?: string }} StatusMsg */

/** @param {StatusMsg} status */
export function emitStatus(status) {
  bus.dispatchEvent(new CustomEvent('status', { detail: status }));
}

/** @param {(status: StatusMsg) => void} handler */
export function onStatus(handler) {
  bus.addEventListener('status', (e) => handler(e.detail));
}
