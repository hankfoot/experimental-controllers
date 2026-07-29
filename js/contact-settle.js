// Bounce removal for on/off channels, at the point the readings arrive.
//
// A contact does not close once. Two pieces of foil, or a clip touched to 3V,
// make and break the circuit repeatedly — while it is being pressed, and for as
// long as it is held — and the board reports every one of those edges honestly.
// One press therefore arrives as a stream of 1s and 0s.
//
// This lives here, above the bus, rather than in a wire's own sampler, because
// bounce is a property of the contact and not of what the contact is wired to.
// Cleaned per-wire it was still raw everywhere else: the live readout, the
// meters on the Controls page, and every trigger all saw the chatter, and only a
// held control was spared. Cleaned here, everything downstream sees one press.
//
// The rules are asymmetric on purpose. Closing is reported immediately, because
// latency on the press is what makes a controller feel bad. Opening waits for
// the contact to stay open, because that is the half you cannot trust.

import { channelKind } from './channels.js';

// How long a contact has to stay open before the release is believed. Wide
// enough for foil, which breaks for far longer than a switch's bounce; at 80ms
// a release is still under five frames and not something you can feel.
export const SETTLE_MS = 80;

/**
 * Wraps `emit` with bounce removal for binary channels.
 *
 * The release is delivered by a timer and is never conditional on another
 * reading arriving. That is the whole safety property: the board sends a
 * release once and then says nothing at all, so anything waiting for a second
 * reading waits forever — which is how every contact used to latch on after its
 * first press. A release waiting only on a clock cannot do that.
 */
export function createContactSettle({
  emit,
  settleMs = SETTLE_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const channels = new Map();

  const stateFor = (channel) => {
    if (!channels.has(channel)) channels.set(channel, { on: false, timer: null });
    return channels.get(channel);
  };

  function accept(message) {
    // Only on/off channels bounce. A number is a reading, not a contact, and a
    // gesture only ever sends a 1 — holding either of those back would be
    // inventing a delay for something that never chattered. `channelKind` falls
    // back to the value when a channel does not declare itself, which is what a
    // pin does: it is whatever it has been wired up as.
    if (channelKind(message.channel, message.value) !== 'binary') {
      emit(message);
      return;
    }
    const state = stateFor(message.channel);

    if (message.value === 1) {
      // A contact coming back cancels the release it was heading for; as far as
      // anything downstream is concerned it was never let go.
      if (state.timer != null) {
        cancel(state.timer);
        state.timer = null;
      }
      if (state.on) return; // already held: this is bounce, and says nothing new
      state.on = true;
      emit(message);
      return;
    }

    if (!state.on || state.timer != null) return; // already open, or already settling
    state.timer = schedule(() => {
      state.timer = null;
      state.on = false;
      emit(message);
    }, settleMs);
  }

  /**
   * Forget everything, without emitting the releases.
   *
   * For a board going away rather than a contact opening: the reason its
   * contacts are no longer held is that there is no board, and whatever holds
   * the state downstream is being reset by the same disconnect.
   */
  accept.reset = () => {
    for (const state of channels.values()) if (state.timer != null) cancel(state.timer);
    channels.clear();
  };

  return accept;
}
