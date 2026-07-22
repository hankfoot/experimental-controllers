// Turns raw controller messages into a single, debounced "flap" action.

import { channelInfo, channelKind, isBinaryValue } from './channels.js';

const CHANGE_RATIO = 0.18;
const COOLDOWN_MS = 160;

export function createControllerFlapDetector() {
  const channels = new Map();
  let lastFlapAt = -Infinity;

  return function detectFlap({ channel, value }, now = performance.now()) {
    if (!Number.isFinite(value)) return null;

    const info = channelInfo(channel);
    let shouldFlap = info.kind === 'event' && value > 0;

    if (info.kind !== 'event') {
      let state = channels.get(channel);
      if (!state) {
        state = { kind: channelKind(channel, value), previous: null };
        channels.set(channel, state);
      } else if (state.kind === 'binary' && !isBinaryValue(value)) {
        state.kind = 'number';
      }

      const previous = state.previous;
      state.previous = value;

      if (state.kind === 'binary') {
        shouldFlap = value === 1 && previous !== 1;
      } else if (previous != null) {
        const hintedRange = info.min != null || info.max != null
          ? Math.max((info.max ?? value) - (info.min ?? 0), 1)
          : null;
        const threshold = hintedRange != null
          ? hintedRange * CHANGE_RATIO
          : Math.max(Math.abs(previous) * CHANGE_RATIO, 1);
        shouldFlap = Math.abs(value - previous) >= threshold;
      }
    }

    if (!shouldFlap || now - lastFlapAt < COOLDOWN_MS) return null;
    lastFlapAt = now;
    return `${info.label} (${channel})`;
  };
}
