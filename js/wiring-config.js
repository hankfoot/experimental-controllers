// Helpers over a game's target list. The targets themselves live beside each
// game in js/games/, because a game's control scheme is what defines its ports —
// the wiring layer stays generic and never names a specific control.

export function findPort(targets, target) {
  return targets.find((node) => node.id === target?.node)
    ?.ports.find((port) => port.id === target?.port) ?? null;
}

// There are exactly two kinds of connection, and both ends must match:
//   value   — "Level", carries a whole range
//   trigger — "Trigger", fires at an instant
export const CONNECTORS = Object.freeze({
  value: { label: 'Level' },
  trigger: { label: 'Trigger' },
});

export const connectorLabel = (type) => CONNECTORS[type]?.label ?? type;

// What an input is able to drive. Outputs are named after the behaviour they
// produce, not the connector type, because the behaviour is the thing you're
// choosing between: a button can be held or it can fire on press, and an analog
// reading can be passed through as a level, gated into a held on/off, or watched
// for a crossing. A momentary input has no state to read, so it offers a trigger
// only. Rendering each as its own jack is what makes the options visible — you
// can see what an input can do before you wire it, and which ends fit.
const OUTPUTS = Object.freeze({
  event: [
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires the instant it happens' },
  ],
  binary: [
    { id: 'hold', type: 'value', label: 'Hold', hint: 'On while held, off when released' },
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires on press, or on release' },
  ],
  number: [
    { id: 'level', type: 'value', label: 'Level', hint: 'The reading mapped across the control' },
    { id: 'hold', type: 'value', label: 'Hold', hint: 'On while past a threshold, off otherwise' },
    { id: 'trigger', type: 'trigger', label: 'Trigger', hint: 'Fires when it crosses a threshold' },
  ],
});

export function sourceOutputs(signal) {
  return signal ? OUTPUTS[signal.kind] ?? OUTPUTS.binary : [];
}

export function findOutput(signal, outputId) {
  return sourceOutputs(signal).find((output) => output.id === outputId) ?? null;
}

// Which jack a live connection hangs off. This is derived rather than stored,
// so saved wiring and kind migrations can never disagree with the transform
// that is actually running: the transform is the single source of truth and the
// jack is just its name. A binary signal has only one value output, so its
// pass-through range reads as "Hold"; the same range on an analog signal is a
// proportional "Level".
export function outputIdOf(signal, port, transform) {
  if (port?.type !== 'value') return 'trigger';
  if (transform?.type === 'gate') return 'hold';
  return signal?.kind === 'binary' ? 'hold' : 'level';
}

export function canConnect(signal, port) {
  return Boolean(port && sourceOutputs(signal).some((output) => output.type === port.type));
}

// Value ports are fed by either transform: `range` passes the reading through,
// `gate` squares it off into a held 0/1. Trigger ports use all the others.
export function isValueTransform(type) {
  return type === 'range' || type === 'gate';
}
