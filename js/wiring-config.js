// Helpers over a game's target list. The targets themselves live beside each
// game in js/games/, because a game's control scheme is what defines its ports —
// the wiring layer stays generic and never names a specific control.

export function findPort(targets, target) {
  return targets.find((node) => node.id === target?.node)
    ?.ports.find((port) => port.id === target?.port) ?? null;
}

// There are exactly three kinds of connection, and both ends must match:
//   level   — carries a whole range
//   hold    — carries an on/off that stays on while something is true
//   trigger — fires at an instant
//
// A held on/off used to travel as a level whose ends happened to be 0 and 1,
// which meant a proportional reading could land anywhere a held one could. They
// are different things to wire — "how far" versus "whether" — so they are
// different connectors, and the board refuses the mismatch rather than
// thresholding a range behind your back.
//
// What an input is able to drive. Outputs are named after the behaviour they
// produce, not the connector type, because the behaviour is the thing you're
// choosing between: a button can be held or it can fire on press, and an analog
// reading can be passed through as a level, gated into a held on/off, or watched
// for a crossing. A momentary input has no state to read, so it offers a trigger
// only. Rendering each as its own jack is what makes the options visible — you
// can see what an input can do before you wire it, and which ends fit.
//
// An analog reading gets its two gated holds as separate jacks rather than one
// jack with an above/below switch, because the ends of a dial are two different
// things you might want to wire to two different controls. Set the high one to
// 0.6 and the low one to 0.4 and the middle of the range drives neither — a dead
// zone you build by where you put the two thresholds, not by a setting.
const OUTPUTS = Object.freeze({
  event: [
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires the instant it happens' },
  ],
  binary: [
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires on press, or on release' },
    { id: 'hold', type: 'hold', label: 'Hold', hint: 'On while held, off when released' },
  ],
  number: [
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires when it crosses a threshold' },
    { id: 'hold-above', type: 'hold', label: 'Hold above', hint: 'On while the reading is past a threshold' },
    { id: 'hold-below', type: 'hold', label: 'Hold below', hint: 'On while the reading is under a threshold' },
    { id: 'level', type: 'level', label: 'Level', hint: 'The reading mapped across the control' },
  ],
});

/** Which way a gated hold compares, read off the jack it hangs from. */
export const holdDirection = (outputId) => (outputId === 'hold-below' ? 'below' : 'above');

export function sourceOutputs(signal) {
  return signal ? OUTPUTS[signal.kind] ?? OUTPUTS.binary : [];
}

// Every on/off input sends the same 1s and 0s, but none of them is called the
// same thing by the person who built it: a button is pressed, a pad is touched,
// a switch is connected. The sentence names what they actually made.
//   on/off  — the two instants a trigger can fire at
//   while/until — the two states a hold can be active in
const PHRASING = Object.freeze({
  button: {
    subject: 'the button',
    on: 'pressed', off: 'released', while: 'held down', until: 'not held down',
  },
  logo: {
    subject: 'the logo',
    on: 'touched', off: 'released', while: 'touched', until: 'not being touched',
  },
  pad: {
    subject: 'the pad',
    on: 'touched', off: 'released', while: 'touched', until: 'not being touched',
  },
  switch: {
    subject: 'the switch',
    on: 'connected', off: 'disconnected', while: 'connected', until: 'disconnected',
  },
});

const ANONYMOUS = Object.freeze({
  subject: 'it', on: 'on', off: 'off', while: 'on', until: 'off',
});

/** How a given on/off input should be spoken about. */
export function phrasingOf(signal) {
  return PHRASING[signal?.form] ?? ANONYMOUS;
}

/**
 * What to call an input in the middle of a sentence. On/off inputs are named by
 * what they physically are; a reading is named by what it reads, which its own
 * label already says.
 */
export function subjectOf(signal) {
  if (PHRASING[signal?.form]) return PHRASING[signal.form].subject;
  return signal?.label ? `the ${signal.label.toLowerCase()}` : 'it';
}

export function findOutput(signal, outputId) {
  return sourceOutputs(signal).find((output) => output.id === outputId) ?? null;
}

// Which jack a live connection hangs off. This is derived rather than stored,
// so saved wiring and kind migrations can never disagree with the transform
// that is actually running: the transform is the single source of truth and the
// jack is just its name. A gated hold reads its jack back from the direction it
// compares in, which is why that direction is fixed by the jack and not offered
// as a setting — editing it would move the wire.
export function outputIdOf(signal, port, transform) {
  if (port?.type === 'trigger' || !port) return 'trigger';
  // The inverse of holdDirection: the jack a gate hangs from is the side it
  // compares on.
  if (transform?.type === 'gate') {
    return transform.direction === 'below' ? 'hold-below' : 'hold-above';
  }
  return transform?.type === 'hold' ? 'hold' : 'level';
}

export function canConnect(signal, port) {
  return Boolean(port && sourceOutputs(signal).some((output) => output.type === port.type));
}

// The ports a wire drives with a continuous stream, as opposed to a trigger that
// fires at instants or a `setting`, which has no jack and is never driven at all.
// Asking this rather than "not a trigger" is what keeps a jack-less port from
// being handed a value it has no meaning for.
export function isValuePort(type) {
  return type === 'level' || type === 'hold';
}

// Which kind of port a transform is able to feed. Each transform belongs to
// exactly one, so the port type and the transform can never drift apart:
//   range — maps a span onto a level
//   gate  — squares an analog reading off into a held 0/1
//   hold  — passes a button's own 0/1 through as a hold
// Everything else names a moment, and moments go to triggers.
export function portTypeForTransform(type) {
  if (type === 'range') return 'level';
  return type === 'gate' || type === 'hold' ? 'hold' : 'trigger';
}
