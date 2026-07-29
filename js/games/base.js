// Shared scaffolding for the games. Each game owns its own physics and drawing;
// this holds what all of them need — round bookkeeping, change notification, and
// the small control surface the wiring engine drives.
//
// Every game exposes the same four control methods so the wiring engine never
// needs to know which game is loaded:
//   setValue(node, port, value)  continuous 0..1 from a wired range
//   fire(node, port)             a wired trigger fired
//   press(id)                    a manual button/key press
//   hold(id, down)               a manual button/key held or released

export const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
export const lerp = (min, max, value) => min + (max - min) * clamp01(value);

export class BaseGame {
  constructor(random = Math.random) {
    this.random = random;
    this.listeners = new Set();
    this.wired = new Set();
    this.state = null; // subclasses call reset() once their own fields exist
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  // --- Round lifecycle -------------------------------------------------------
  // Subclasses implement newRound() and return their own per-round fields.
  reset() {
    this.state = {
      phase: 'ready',
      score: 0,
      best: this.state?.best ?? 0,
      ...this.newRound(),
    };
    this.notify();
  }

  start() {
    if (this.state.phase !== 'ready') return;
    this.state.phase = 'playing';
    this.notify();
  }

  end() {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'over';
    this.overSince = this.clock();
    this.notify();
  }

  restart() {
    this.reset();
    this.start();
  }

  addScore(points = 1) {
    this.state.score += points;
    this.state.best = Math.max(this.state.best, this.state.score);
    this.notify();
  }

  /**
   * How long the game-over card refuses to be dismissed.
   *
   * The same input that crashed you is very often still held, or being mashed,
   * on the frame you crash — so without this the card appears and is gone
   * again inside a frame or two and the round restarts with nobody having read
   * the score. Short enough not to feel like a lock-out, long enough to see.
   */
  static OVER_LOCK_MS = 900;

  /** Overridable so a test can drive the lock-out without waiting on a clock. */
  clock() {
    return typeof performance === 'undefined' ? Date.now() : performance.now();
  }

  /** Whether the game-over card is still insisting on being looked at. */
  settling() {
    return this.state.phase === 'over'
      && this.clock() - (this.overSince ?? -Infinity) < BaseGame.OVER_LOCK_MS;
  }

  // Most games advance from `ready` and retry from `over` on the same input, so
  // the flow reads as one button. Returns true when the round is now running.
  engage() {
    if (this.settling()) return false;
    if (this.state.phase === 'over') this.reset();
    if (this.state.phase === 'ready') this.start();
    return this.state.phase === 'playing';
  }

  // --- Wiring ---------------------------------------------------------------
  isWired(node, port) {
    return this.wired.has(`${node}.${port}`);
  }

  setWiredPorts(ports) {
    this.wired = new Set(ports);
  }

  setValue() {}

  fire() {}

  press() {}

  hold() {}

  update() {}
}
