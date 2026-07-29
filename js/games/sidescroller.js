// The game. There is exactly one of them — a craft flying rightward past
// scrolling gates — and four control schemes that decide how you steer it. The
// picker changes nothing but the scheme: same world, same gates, same scoring,
// a different way of moving through it.
//
// A scheme owns a `motion`, which is the only thing the engine branches on:
//   impulse  every trigger kicks the craft upward, gravity does the rest
//   thrust   climb while an input is held, fall under gravity when it is let go
//   slide    two held inputs move the craft up or down at a steady rate
//   track    a continuous 0..1 reading is the craft's height
//
// The first two fly: the craft carries momentum and the field edges are walls
// you can crash into. The last two are positional — the craft goes where it is
// put, stops when nothing is asked of it, and the edges simply stop it.
//
// Everything below the input layer is shared, so a gate that is fair under one
// scheme is fair under all of them.

import { BaseGame, clamp01, lerp } from './base.js';
import { createSceneRenderer } from '../theme/scene.js';
import { defaultTheme } from '../theme/theme-store.js';

export const RULES = Object.freeze({
  // Widescreen: only the width moved, and it doubled. Every vertical number
  // below — the floor, the gaps, gravity, how hard a kick lifts you — is what
  // it always was, so the game plays exactly as it did and simply shows more of
  // what is coming. Gates are in view for longer before they arrive, which is
  // what a sidescroller wants anyway, and the time between them is unchanged
  // because that is measured in distance travelled rather than in screens.
  width: 960,
  height: 600,
  groundY: 530,
  playerX: 130,
  playerRadius: 20,
  gateWidth: 66,
  // Widened by exactly the growth in the craft's diameter, so the free space
  // through a gap is what it always was — 144px — and "a fair gap" still means
  // what it meant in every course anybody has already set up.
  gateGap: 184,
  gateSpacing: 250,
  gateMargin: 74,
  firstGateDistance: 300,
  speedStart: 150,
  speedPerPoint: 3.2,
  speedMax: 300,
  gravity: 1250,
  riseVelocity: 400,
  thrustAccel: 2100,
  slideSpeed: 340, // pixels per second a held slide input moves the craft
  maxFallSpeed: 430,
  // How fast the craft chases a steered height. Tuned against the rate a board
  // actually sends at: at 18 the craft settled in about 55ms, well inside the
  // 100ms between samples, so it arrived and then sat still until the next one
  // — which reads as stepping rather than as steering. Slower than the sample
  // interval, the steps blend into a glide.
  trackBlend: 7,
  manualSpeed: 0.95, // range units per second when using keys instead of a dial
  wakeDelta: 0.12, // how far a wired dial must move to start the round
  barSkirt: 8, // how far an obstacle runs past the edge, so it has no visible end
  // A floating block is one object rather than a length of something, so it is
  // square: a column's width by a column's tiling height made a tall slot that
  // no single drawing fits, and squashing one into it was the reason a block
  // never looked like a thing you had drawn.
  blockWidth: 108,
  blockHeight: 108,
});

/**
 * How wide an obstacle stands. Every shape but the floating block is a bar cut
 * from the same column, so they share a width; the block is its own object and
 * has its own.
 */
export const gateSpan = (gate) =>
  (gate?.kind === 'floating' ? RULES.blockWidth : RULES.gateWidth);

/**
 * How to lay a repeating drawing along `span` in whole copies: the nearest
 * count to the drawing's own size, and the height each one is then drawn at.
 * Whole copies rather than a cropped last one, so a column ends where the
 * drawing ends instead of halfway through it.
 */
export function wholeTiles(span, natural) {
  const count = Math.max(1, Math.round(span / Math.max(1, natural)));
  return { count, tileHeight: span / count };
}

// What the strength choices multiply their effect by. A kick is a one-off you
// either time right or don't, so its ends spread wider than a sustained push,
// where the difference is felt the whole time it is held.
const KICK = Object.freeze({ soft: 0.72, normal: 1, hard: 1.32 });
const PUSH = Object.freeze({ soft: 0.78, normal: 1, hard: 1.24 });
// A slide has no momentum to build, so its ends are the speed itself.
const SLIDE = Object.freeze({ slow: 0.65, normal: 1, fast: 1.45 });

// What the course settings multiply the built-in numbers by. Every one of them
// is a plain multiplier on a RULES value, and every default is 1 — so a game
// nobody has touched the settings of plays exactly as it did before they existed.
const GAP = Object.freeze({ tight: 0.72, normal: 1, roomy: 1.3 });
const SPACING = Object.freeze({ tight: 0.74, normal: 1, wide: 1.34 });
const PACE = Object.freeze({ calm: 0.72, normal: 1, quick: 1.34 });
const RAMP = Object.freeze({ none: 0, gentle: 1, steep: 2.5 });
const WEIGHT = Object.freeze({ floaty: 0.68, normal: 1, heavy: 1.4 });

// What a speed modifier multiplies the world's pace by. It runs both ways from
// 1, so the same jack is a brake or a boost depending only on what you chose —
// and each pair multiplies to 1, so the slow end and the fast end are the same
// move read the other way round. A multiplier is a ratio, which is why the
// mirror of 2× is ½ rather than 0.
const SHIFT = Object.freeze({
  quarter: 1 / 4,
  half: 1 / 2,
  slower: 2 / 3,
  normal: 1,
  faster: 3 / 2,
  double: 2,
  quadruple: 4,
});

// The same list, worded as what the *world* does — so one set of choices reads
// correctly whether it is describing a held brake or one end of a dial.
const SHIFT_CHOICES = Object.freeze([
  ['quarter', 'at a quarter of the speed'],
  ['half', 'at half speed'],
  ['slower', 'a little slower'],
  ['normal', 'at its normal speed'],
  ['faster', 'a little faster'],
  ['double', 'at double speed'],
  ['quadruple', 'at four times the speed'],
]);

// The motions that are subject to gravity, and so the only ones that can fly
// the craft out of the field. Each one's fall is set on the port that pushes
// back against it, since how hard you fall only means anything next to that.
export const FALLS = Object.freeze(new Set(['impulse', 'thrust']));

// Where each falling motion's weight setting lives: the movement port itself.
const WEIGHT_PORT = Object.freeze({
  impulse: ['flap', 'trigger'],
  thrust: ['lift', 'thrust'],
});

/**
 * What a set of course options actually comes to, in the numbers the world runs
 * on. Exported so the Design screen's preview can show the settings sitting
 * above it rather than a fixed course that ignores them — and exported as a
 * function rather than as the tables, so there is still exactly one place that
 * decides what "a tight squeeze" means.
 *
 * `score` is there because the pace ramps with it: at zero, choosing between
 * "holds that pace" and "speeds up sharply" would look identical.
 */
export function courseFrom(options = {}, score = 0) {
  const pace = PACE[options.speed] ?? 1;
  const ramp = RAMP[options.ramp] ?? 1;
  const climbed = RULES.speedStart + score * RULES.speedPerPoint * ramp;
  return {
    speed: Math.min(RULES.speedMax, climbed) * pace,
    gap: RULES.gateGap * (GAP[options.gap] ?? 1),
    spacing: RULES.gateSpacing * (SPACING[options.spacing] ?? 1),
    shape: options.shape ?? 'columns',
  };
}

export const trackY = (value) => lerp(
  RULES.playerRadius,
  RULES.groundY - RULES.playerRadius,
  value,
);

/**
 * The solid parts of one obstacle, as spans of the field it fills. Every shape
 * is one or two bars in a vertical slice of the world, so what you crash into
 * and what gets drawn are read from the same place and can never disagree.
 *
 * `gapY` is the line the shape is built around, which each one reads its own
 * way: the middle of the gap between two columns, the middle of a floating
 * block, or the open end of a bar that only comes from one side.
 */
export function gateBars(gate) {
  const { groundY, barSkirt, blockHeight } = RULES;
  const gap = gate.gap ?? RULES.gateGap;
  if (gate.kind === 'floating') {
    return [{ top: gate.gapY - blockHeight / 2, bottom: gate.gapY + blockHeight / 2 }];
  }
  if (gate.kind === 'ceiling') return [{ top: -barSkirt, bottom: gate.gapY }];
  if (gate.kind === 'floor') return [{ top: gate.gapY, bottom: groundY + barSkirt }];
  return [
    { top: -barSkirt, bottom: gate.gapY - gap / 2 },
    { top: gate.gapY + gap / 2, bottom: groundY + barSkirt },
  ];
}

export class SidescrollerGame extends BaseGame {
  constructor(random, motion = 'impulse') {
    super(random);
    this.motion = motion;
    // Deliberately not reset with the round: a wire parked on has to be let go
    // and pressed again before it can start the next one.
    this.holdLatch = { thrust: false, up: false, down: false };
    this.manual = { up: false, down: false };
    // Held rather than latched: a modifier only scales the world's pace, so
    // there is no round for a parked wire to start by accident. `level` is the
    // continuous version, which sits at its own neutral until something drives it.
    this.shifting = false;
    this.shiftLevel = null;
    // How each control is set up. The wiring screen owns the choices; the game
    // only ever reads the resolved value, so an unset control plays as before.
    this.options = new Map();
    this.reset();
  }

  setControlOptions(node, port, options) {
    this.options.set(`${node}.${port}`, options ?? {});
  }

  option(node, port, id, fallback) {
    return this.options.get(`${node}.${port}`)?.[id] ?? fallback;
  }

  newRound() {
    // Cleared so the next wired reading re-arms the "wiggle to start" gesture.
    this.wakeValue = null;
    // Which obstacle, counting from the first, is the one that ties your record
    // — so clearing it is the moment you beat it. Read here rather than at spawn
    // time because `best` climbs during the round, and a line that kept moving
    // ahead of you would be a line you could never cross. Zero means there is no
    // record yet, and nothing is marked.
    this.recordGate = this.state?.best ?? 0;
    const y = this.motion === 'track' ? trackY(0.5) : RULES.groundY * 0.45;
    return {
      player: { y, velocity: 0, value: 0.5, thrusting: false, sinking: false },
      gates: [],
      // Counted rather than measured off the list, since gates are dropped once
      // they leave the field and the slalom still has to keep alternating.
      gateCount: 0,
      distanceUntilGate: RULES.firstGateDistance,
      distance: 0,
    };
  }

  // --- Input ----------------------------------------------------------------
  // Each scheme feeds exactly one of these three; from `update` onward the game
  // only reads the resulting player position.
  rise() {
    if (!this.engage()) return;
    const scale = KICK[this.option('flap', 'trigger', 'lift', 'normal')] ?? 1;
    this.state.player.velocity = -RULES.riseVelocity * scale;
  }

  /**
   * A held port going on or off. `port` is 'thrust' under the jetpack, or 'up'
   * / 'down' under the slide; either way it resolves to one of the two
   * directions the craft can be pushed.
   */
  setHold(port, active) {
    const running = this.state.phase === 'playing';
    if (active && !this.holdLatch[port]) {
      // Rising edge only, so a wire parked at full throttle can't instantly
      // restart the round the moment you crash.
      this.holdLatch[port] = true;
      if (!running) this.engage();
    } else if (!active) {
      this.holdLatch[port] = false;
    }
    const flag = port === 'down' ? 'sinking' : 'thrusting';
    this.state.player[flag] = active && this.state.phase === 'playing';
  }

  // Which way up the range reads is the wire's business, not the control's:
  // reversing it is what inverting a level means, and it is set in the same
  // sentence as the ends being reversed. A second flip here could only disagree
  // with that one.
  track(value) {
    const next = clamp01(value);
    this.state.player.value = next;
    if (this.wakeValue == null) this.wakeValue = next;
    // A parked dial shouldn't auto-start a round; a deliberate move should.
    if (this.state.phase !== 'playing' && Math.abs(next - this.wakeValue) > RULES.wakeDelta) {
      this.wakeValue = next;
      this.engage();
    }
  }

  // How long a wired reading keeps the mouse out. Long enough to cover the gap
  // between samples from a board polling ten times a second, short enough that
  // unplugging hands control straight back.
  static STEER_HOLD_MS = 600;

  /**
   * Steered by hand rather than by a wire — the mouse over the game window.
   *
   * It gives way to a wire that is actually sending. Letting both through meant
   * the craft was dragged between two positions on alternate frames, which does
   * not read as two controls sharing — it reads as the game being broken. The
   * test is recency rather than "is it wired", so a board that has been
   * unplugged, or one wired to a reading it never sends, leaves the mouse
   * working instead of leaving nothing working.
   */
  steer(value) {
    if (this.motion !== 'track') return;
    if (this.clock() - (this.steeredAt ?? -Infinity) < SidescrollerGame.STEER_HOLD_MS) return;
    this.track(value);
  }

  /** Whether a wire is currently driving the steering, for the UI to say so. */
  steeredByWire() {
    return this.clock() - (this.steeredAt ?? -Infinity) < SidescrollerGame.STEER_HOLD_MS;
  }

  /**
   * The button on the game's own screens, on your controller.
   *
   * Whatever card is up, this is the thing that gets past it — start on the
   * ready card, go again on the defeat card — which is exactly what tapping the
   * canvas does. It used to be a restart and only a restart, so a controller
   * with no keyboard beside it could reset a round it had no way to begin.
   *
   * `abandon` is for anyone who would rather it only ever be an escape hatch
   * out of a crash, which is what the old wording promised.
   */
  advance() {
    const when = this.option('ui', 'advance', 'when', 'always');
    if (when === 'over' && this.state.phase !== 'over') return;
    if (this.state.phase === 'playing') {
      this.reset();
      return;
    }
    this.engage();
  }

  setValue(node, port, value) {
    // A hold port only ever sends the two ends, so this is reading which end.
    if (node === 'shift' && port === 'hold') this.shifting = clamp01(value) > 0.5;
    if (node === 'shift' && port === 'level') this.shiftLevel = clamp01(value);
    if (this.motion === 'thrust' && node === 'lift') this.setHold(port, clamp01(value) > 0.5);
    if (this.motion === 'slide' && node === 'slide') this.setHold(port, clamp01(value) > 0.5);
    if (this.motion === 'track' && node === 'paddle' && port === 'y') {
      // Noted before steering, so `steer` can tell a wire's reading from a
      // hand's on the very next frame.
      this.steeredAt = this.clock();
      this.track(value);
    }
  }

  fire(node, port) {
    if (this.motion === 'impulse' && node === 'flap') this.rise();
    if (node === 'ui' && port === 'advance') this.advance();
  }

  press() {
    if (this.motion === 'impulse') this.rise();
    else this.engage();
  }

  // The manual controls carry the same ids as the ports they stand in for, and
  // they work whether or not that port is wired. They used to step aside for a
  // wire, which was tidy and wrong: half a workshop's wiring is half-finished at
  // any moment, and a keyboard that goes dead the instant you patch something in
  // takes away the one control you know still works. Both drive the same craft,
  // and the last thing to say something wins.
  hold(id, down) {
    if (this.motion === 'thrust') this.setHold(id, Boolean(down));
    if (this.motion === 'slide') this.setHold(id, Boolean(down));
    if (this.motion === 'track') {
      if (id in this.manual) this.manual[id] = Boolean(down);
      if (down) this.engage();
    }
  }

  // --- Simulation -----------------------------------------------------------
  update(dt) {
    const frameTime = Math.max(0, Math.min(dt, 0.035));
    this.movePlayer(frameTime);
    if (this.state.phase !== 'playing') return;
    this.scroll(frameTime);
  }

  movePlayer(frameTime) {
    // Nothing moves after a crash. The two falling motions were already guarded;
    // the other two were not, so a direction still held at the moment of death
    // kept the craft sliding across the defeat card.
    //
    // Guarded on `over` rather than on "not playing", because a tracked craft
    // *should* keep following its input while the round is `ready` — that is
    // what starts it where your hand actually is.
    if (this.state.phase === 'over') return;

    if (this.motion === 'impulse' || this.motion === 'thrust') {
      if (this.state.phase === 'playing') this.fly(frameTime);
      return;
    }
    if (this.motion === 'slide') {
      this.slide(frameTime);
      return;
    }

    const { player } = this.state;
    // A tracked height keeps following the input between rounds, so the craft
    // starts each round where the player is actually holding it. The arrow keys
    // nudge that same height whether or not a dial is wired to it: a wired
    // reading overwrites it on its next sample, so the wire wins whenever it has
    // anything to say, and the keys work in the gaps when it doesn't.
    const direction = (this.manual.down ? 1 : 0) - (this.manual.up ? 1 : 0);
    if (direction) {
      player.value = clamp01(player.value + direction * RULES.manualSpeed * frameTime);
    }
    // How loosely the craft chases the reading is smoothing, and smoothing
    // belongs to the wire — a twitchy input is a fact about the object you
    // built, so damping it there fixes it for every control at once.
    const blend = 1 - Math.exp(-frameTime * RULES.trackBlend);
    player.y += (trackY(player.value) - player.y) * blend;
  }

  // Free flight, shared by the two falling schemes. Gravity is always pulling;
  // the schemes differ only in what pushes back — a kick from rise(), or a held
  // thrust that keeps pushing for as long as it is held.
  fly(frameTime) {
    const { player } = this.state;
    const [node, port] = WEIGHT_PORT[this.motion] ?? [];
    const weight = WEIGHT[this.option(node, port, 'gravity', 'normal')] ?? 1;
    let accel = RULES.gravity * weight;
    if (this.motion === 'thrust' && player.thrusting) {
      accel -= RULES.thrustAccel * (PUSH[this.option('lift', 'thrust', 'lift', 'normal')] ?? 1);
    }
    player.velocity += accel * frameTime;

    player.velocity = Math.max(-RULES.maxFallSpeed, Math.min(RULES.maxFallSpeed, player.velocity));
    player.y += player.velocity * frameTime;
  }

  // A steady slide, with no momentum either side of the hold: the craft moves
  // while an input is held and stops the instant it is let go. Holding both is
  // the same standstill, reached from both sides at once. The field edges are
  // where the craft stops rather than where it dies — nothing is falling, so
  // there is nothing to crash into.
  slide(frameTime) {
    const { player } = this.state;
    const direction = (player.sinking ? 1 : 0) - (player.thrusting ? 1 : 0);
    const port = direction < 0 ? 'up' : 'down';
    const speed = RULES.slideSpeed * (SLIDE[this.option('slide', port, 'speed', 'normal')] ?? 1);

    player.velocity = direction * speed;
    player.y = Math.max(
      RULES.playerRadius,
      Math.min(RULES.groundY - RULES.playerRadius, player.y + player.velocity * frameTime),
    );
  }

  scroll(frameTime) {
    const travel = this.speed() * frameTime;
    this.state.distance += travel;

    let collided = false;
    for (const gate of this.state.gates) {
      gate.x -= travel;
      if (!gate.scored && gate.x + RULES.gateWidth < RULES.playerX) {
        gate.scored = true;
        this.addScore();
      }
      collided ||= this.hitsGate(gate);
    }

    this.state.distanceUntilGate -= travel;
    while (this.state.distanceUntilGate <= 0) {
      // Account for the fraction of this frame after the spacing threshold.
      this.spawnGate(RULES.width + 20 + this.state.distanceUntilGate);
      this.state.distanceUntilGate += this.spacing() * this.spacingJitter();
    }
    this.state.gates = this.state.gates.filter((gate) => gate.x + RULES.gateWidth > -10);

    if (collided || this.outsideField()) this.end();
  }

  // --- The course -----------------------------------------------------------
  // What you fly through and how fast it arrives. Neither is a control, so both
  // are read straight off the options — the pace only differs in that one wired
  // hold is allowed to scale it while it is down.
  gapSize() {
    return RULES.gateGap * (GAP[this.option('world', 'obstacles', 'gap', 'normal')] ?? 1);
  }

  /**
   * A little unevenness in when the next obstacle arrives.
   *
   * Only for the floating block: it is one object rather than a length of
   * something, so a run of them landing on an exact beat is the shape that most
   * reads as a loop. The bars have their own variety in where the gap sits.
   */
  spacingJitter() {
    if (this.option('world', 'obstacles', 'shape', 'columns') !== 'floating') return 1;
    return 0.88 + this.random() * 0.24;
  }

  spacing() {
    return RULES.gateSpacing * (SPACING[this.option('world', 'obstacles', 'spacing', 'normal')] ?? 1);
  }

  /**
   * What the modifiers multiply the pace by right now.
   *
   * The held one is all or nothing; the level one sweeps between the same two
   * ends a dial can reach, so a slider bends the world continuously rather than
   * flipping it. Both are off by default, and both multiply, so wiring neither
   * leaves the pace exactly as the setting says.
   */
  shiftFactor() {
    const held = this.shifting
      ? SHIFT[this.option('shift', 'hold', 'change', 'half')] ?? 1
      : 1;
    if (this.shiftLevel == null) return held;
    // A dial reads as the two ends it maps between, which is the only way to
    // know what the middle of it does. "Sweeps all the way to double" left the
    // other end unsaid, and so left the whole control unreadable.
    const low = SHIFT[this.option('shift', 'level', 'low', 'normal')] ?? 1;
    const high = SHIFT[this.option('shift', 'level', 'high', 'double')] ?? 1;
    // Geometric rather than linear, because these are ratios: half way between
    // ½× and 2× is 1×, not 1.25×, and only the geometric reading puts the
    // world's normal pace in the middle of a dial set to brake and boost evenly.
    return held * low * (high / low) ** this.shiftLevel;
  }

  speed() {
    const pace = PACE[this.option('speed', 'pace', 'speed', 'normal')] ?? 1;
    const ramp = RAMP[this.option('speed', 'pace', 'ramp', 'gentle')] ?? 1;
    // The ceiling applies to what scoring earned, so the settings can push the
    // world past it deliberately — a slowed "fast" is still quicker than "calm",
    // and a boost is meant to outrun anything scoring alone could reach.
    const climbed = RULES.speedStart + this.state.score * RULES.speedPerPoint * ramp;
    return Math.min(RULES.speedMax, climbed) * pace * this.shiftFactor();
  }

  // Only the schemes that can fly the craft off the field can crash into it —
  // the positional ones are inside it by construction.
  outsideField() {
    if (!FALLS.has(this.motion)) return false;
    const { y } = this.state.player;
    return y - RULES.playerRadius <= 0 || y + RULES.playerRadius >= RULES.groundY;
  }

  spawnGate(x) {
    const shape = this.option('world', 'obstacles', 'shape', 'columns');
    // The slalom is the two one-sided shapes taking turns, which is the only
    // thing about a gate that depends on the gate before it.
    const kind = shape === 'slalom'
      ? (this.state.gateCount % 2 ? 'floor' : 'ceiling')
      : shape;
    const gap = this.gapSize();
    const record = this.recordGate > 0 && this.state.gateCount === this.recordGate;
    this.state.gateCount += 1;
    this.state.gates.push({
      x, gap, kind, record, scored: false, gapY: this.gapLine(kind, gap),
    });
  }

  /**
   * Where to build the next obstacle, kept far enough from the edges that the
   * way past it is always at least `gap` wide — whichever side that way is on.
   */
  gapLine(kind, gap) {
    const { groundY, gateMargin, blockHeight } = RULES;
    const span = (low, high) => lerp(low, high, this.random());
    if (kind === 'floating') {
      // A block leaves sky above *and* below, so only one of the two has to be
      // comfortable — which means the generous clearance this used to keep on
      // both sides was buying nothing and costing everything. It pinned every
      // block into a 211px band down the middle of a 530px field, and a run of
      // them read as one obstacle repeated.
      //
      // The whole field is fair here: both sides are too tight only when
      // 2 x (gap x 0.6) + blockHeight exceeds groundY, which even at the
      // roomiest setting is 383 against 530. The 8px is only to keep a block
      // off the ceiling and the floor.
      const edge = blockHeight / 2 + 8;
      // Alternating halves the way the slalom alternates its bars. Widening
      // alone still lets two blocks land side by side by chance; alternating is
      // what guarantees the craft has to move between them.
      const middle = groundY / 2;
      return this.state.gateCount % 2
        ? span(middle, groundY - edge)
        : span(edge, middle);
    }
    // A one-sided bar stops short of the far wall by the gap, and pokes out from
    // its own by enough to be worth flying around.
    if (kind === 'ceiling') return span(gap * 0.4, groundY - gap);
    if (kind === 'floor') return span(gap, groundY - gap * 0.4);
    const edge = gap / 2 + gateMargin;
    return span(edge, groundY - edge);
  }

  hitsGate(gate) {
    const overlapsX = RULES.playerX + RULES.playerRadius > gate.x
      && RULES.playerX - RULES.playerRadius < gate.x + gateSpan(gate);
    if (!overlapsX) return false;
    const { y } = this.state.player;
    return gateBars(gate).some((bar) =>
      y + RULES.playerRadius > bar.top && y - RULES.playerRadius < bar.bottom);
  }
}

// Standing in for the image cache when the game is built without a theme — in
// a test, say. Every draw site already copes with having no picture.
const NO_IMAGES = { get: () => null };

/**
 * `look` is `{ theme(), images }` — read fresh on every frame rather than
 * captured, so a sprite you redraw on the Design tab is on the canvas by the
 * next frame without anything having to rebuild the renderer.
 */
// How wide the craft is drawn, along its longest side. Comfortably larger than
// the hit circle, which is deliberate and only ever forgiving: a near miss that
// looked like a graze passes, and nothing that looked clear ever kills you.
// Going the other way — art smaller than the circle it crashes with — is what
// feels broken, so the mismatch is kept on this side of the line.
const PLAYER_SIZE = 65;

export function createRenderer(ctx, helpers, scheme = {}, look = null) {
  const { playerX, gateWidth } = RULES;
  const { drawOverlay } = helpers;
  const scenery = createSceneRenderer(ctx, RULES);
  const plain = defaultTheme();
  const themeNow = () => look?.theme?.() ?? plain;
  const images = look?.images ?? NO_IMAGES;

  /**
   * Repeats a sprite down a bar, in whole copies.
   *
   * The tile used to be laid at the drawing's own aspect and the last one cut
   * off wherever the bar ended, which left every column finishing on half a
   * picture — a face with no chin, a segment with no cap. So the bar picks the
   * nearest whole number of tiles that fits and stretches them to land exactly
   * on its ends. That costs a few percent of the drawing's proportions and buys
   * a column that begins and ends where the drawing does.
   */
  function tileDown(image, x, top, bottom) {
    const span = bottom - top;
    const natural = image.height * (gateWidth / image.width);
    const { count, tileHeight } = wholeTiles(span, natural);
    for (let i = 0; i < count; i += 1) {
      ctx.drawImage(image, x, top + i * tileHeight, gateWidth, tileHeight);
    }
  }

  /** The drawing itself, filling a box, cropped rather than squashed to fit. */
  function drawCovering(image, x, y, width, height) {
    const box = image.content;
    const [bx, by, bw, bh] = box
      ? [box.x, box.y, box.width, box.height]
      : [0, 0, image.width, image.height];
    const scale = Math.max(width / bw, height / bh);
    const sw = Math.min(bw, width / scale);
    const sh = Math.min(bh, height / scale);
    ctx.drawImage(image, bx + (bw - sw) / 2, by + (bh - sh) / 2, sw, sh, x, y, width, height);
  }

  // Every shape is bars, so this draws bars — the obstacle sprite tiled down
  // each one. Its own art is the shape, which is why there are no lips or
  // outlines left here to argue with whatever you have drawn.
  function drawGate(gate, pillar, block) {
    // The block is its own drawing as well as its own shape: it is one object
    // hanging in the air, where every other shape is a length of something
    // stacked. One sprite had to work both ways and did neither well.
    if (gate.kind === 'floating') {
      if (!block) return;
      const [bar] = gateBars(gate);
      drawCovering(block, gate.x, bar.top, RULES.blockWidth, bar.bottom - bar.top);
      return;
    }
    if (!pillar) return;
    for (const bar of gateBars(gate)) tileDown(pillar, gate.x, bar.top, bar.bottom);
  }

  /**
   * The line where your best score stands, drawn on the obstacle that ties it.
   *
   * Drawn over the obstacles rather than behind them, because the point is to
   * see it coming — and drawn as a line through the world rather than as a
   * number somewhere, because then beating your record is something you fly
   * through rather than something you read about afterwards.
   */
  function drawRecordLine(gate) {
    if (!gate.record) return;
    const x = Math.round(gate.x + gateSpan(gate) / 2) + 0.5;

    ctx.save();
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 3;
    // A dark line under a light one, so it reads against a pale sky and a dark
    // one alike without knowing which it is over.
    ctx.strokeStyle = 'rgba(27, 28, 32, .35)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RULES.groundY);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(27, 28, 32, .45)';
    ctx.strokeText('BEST', x, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('BEST', x, 26);
    ctx.restore();
  }

  // --- How the craft carries itself ------------------------------------------
  // None of this is physics. The craft is drawn exactly where the game put it,
  // on the frame the game put it there; all that happens here is that the
  // *attitude* of the drawing — its lean, and how stretched it is — arrives a
  // beat late. That lag is the whole effect. An angle that snapped straight to
  // the current velocity reads as a cursor being dragged; one that leans into a
  // climb, keeps leaning for a moment after the climb stops, and rounds out of
  // it reads as something with mass.
  //
  // Kept here rather than in the game state because it is appearance and not
  // rules: a replay of the same inputs plays the same game whatever this does,
  // and nothing that decides a crash can ever read it.
  const carry = { tilt: 0, stretch: 0, kick: 0, speed: 0, y: null, at: 0 };

  // Whether this scheme's control is a shove. Only the impulse one is, and the
  // pop belongs to it — every scheme keeps the lean and the stretch.
  const kicks = scheme?.motion === 'impulse';

  // Radians of lean at full speed each way, and how quickly the drawing chases
  // that. Down leans further than up because a dive should look committed while
  // a climb still has to show you the gap you are aiming at.
  const LEAN = Object.freeze({ up: 0.36, down: 0.66, ease: 9 });
  // How far the craft stretches along its travel at full speed, and how far a
  // kick squashes it at the moment it lands. The kick is the bigger number and
  // the shorter-lived one: that mismatch is what makes a flap feel like a shove
  // rather than a change of number.
  const SQUASH = Object.freeze({ speed: 0.16, kick: 0.31, ease: 14, decay: 7 });
  // A velocity swing sharper than this in one frame is a kick rather than
  // gravity — comfortably above what gravity can manage between frames, and
  // comfortably below the softest flap.
  const KICK_EDGE = 200;

  /** Approaches a target at a rate, framerate-independently. */
  const chase = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-dt * rate));

  /**
   * Advances the lean and squash to match what the craft is doing, and returns
   * them as a rotation and a pair of scales. Timed off the clock the renderer is
   * already handed, so a paused tab resumes without a lurch and a preview that
   * never moves simply sits at rest.
   */
  function carriage(player, phase, now) {
    const dt = carry.at ? Math.min((now - carry.at) / 1000, 0.05) : 0;
    carry.at = now;
    // Measured off the craft's own movement rather than read from
    // `player.velocity`, which only the two falling schemes keep — this way a
    // dial swung upward leans the craft exactly as a flap does, and the four
    // schemes look like one game rather than two that animate and two that
    // don't.
    const moved = dt && carry.y != null ? (player.y - carry.y) / dt : 0;
    carry.y = player.y;

    // Between rounds the craft is bobbing on its own; anything carried over from
    // the crash would still be leaning while it does.
    if (phase !== 'playing') {
      carry.tilt = chase(carry.tilt, 0, LEAN.ease, dt);
      carry.stretch = chase(carry.stretch, 0, SQUASH.ease, dt);
      carry.kick = 0;
      carry.speed = 0;
    } else {
      // Only an upward shove pops, and only in the scheme where a shove is what
      // the control *is*. The kick is measured off the craft's own movement
      // rather than off its velocity, so a slide or a steered height snapping
      // upward past the same edge was getting a flap's squash out of a control
      // that never flaps — which read as the animation belonging to the game
      // rather than to the scheme.
      //
      // Gaining this much downward speed in a frame means you have already hit
      // something, and the frame after a crash is no place for a flourish.
      if (kicks && moved - carry.speed < -KICK_EDGE) carry.kick = 1;
      carry.speed = moved;
      carry.kick = chase(carry.kick, 0, SQUASH.decay, dt);

      // A held control leans the craft further than its speed alone would —
      // which is what tells you a hold is on now the jets are gone, and it shows
      // the moment the input does rather than once the craft has picked up
      // enough speed to be obvious.
      const held = (player.sinking ? 1 : 0) - (player.thrusting ? 1 : 0);
      const rate = moved / RULES.maxFallSpeed;
      const aim = Math.max(-1, Math.min(1, rate + held * 0.34));
      carry.tilt = chase(carry.tilt, aim * (aim < 0 ? LEAN.up : LEAN.down), LEAN.ease, dt);
      carry.stretch = chase(carry.stretch, Math.min(1, Math.abs(rate)) * SQUASH.speed,
        SQUASH.ease, dt);
    }

    // Volume is held roughly constant — the craft only ever swaps width for
    // height, never gains area — because a drawing that quietly grows while it
    // moves stops matching the circle it crashes with.
    const kicked = carry.kick * SQUASH.kick;
    const along = 1 + carry.stretch - kicked;
    return { tilt: carry.tilt, along, across: 1 / along };
  }

  function drawPlayer(player, phase, now, sprite, { tilt, along, across }) {
    const y = phase === 'ready' ? player.y + Math.sin(now / 260) * 6 : player.y;
    ctx.save();
    ctx.translate(playerX, y);
    ctx.rotate(tilt);
    // Along the craft's own nose-to-tail axis, which the rotation has already
    // pointed into the direction of travel — so one scale does the stretching
    // and the squashing whichever way it is going.
    ctx.scale(along, across);

    if (sprite) {
      // The drawing itself, not the canvas it was drawn on. Almost nobody fills
      // that canvas, and the empty margin used to be scaled up along with the
      // picture — so a craft drawn small arrived on screen smaller still, and
      // two people who drew the same size craft in different corners got
      // different sized craft. Cropping to the ink is also what the thumbnail
      // on the Design screen does, so the two now agree.
      const box = sprite.content;
      const [sx, sy, sw, sh] = box
        ? [box.x, box.y, box.width, box.height]
        : [0, 0, sprite.width, sprite.height];
      // Longest side to the box, so a wide craft and a tall one both come out
      // the size they were drawn rather than the shape of their canvas.
      const scale = PLAYER_SIZE / Math.max(sw, sh);
      const drawWidth = sw * scale;
      const drawHeight = sh * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
  }

  return function render(state, now) {
    const theme = themeNow();
    const { scene } = theme;
    scenery.drawBackdrop(scene, images, state.distance, now);
    const pillar = images.get(scene.obstacle.sprite, 'obstacle');
    const block = images.get(scene.block.sprite, 'block');
    state.gates.forEach((gate) => drawGate(gate, pillar, block));
    state.gates.forEach(drawRecordLine);
    scenery.drawGround(scene, images, state.distance);
    const motion = carriage(state.player, state.phase, now);
    drawPlayer(state.player, state.phase, now, images.get(scene.player.sprite, 'player'), motion);
    drawOverlay(state);
  };
}

/**
 * What you are flying through and how fast it arrives, as choices rather than
 * wiring. These belong to the game and not to any controller, and nothing your
 * controller does touches them — so they live on the Design screen instead of
 * the wiring board.
 *
 * The shape is a target's — a node with ports — because the engine stores and
 * publishes a choice by `node.port` either way. Only the absence of a `type`
 * says these can't be wired.
 *
 * Speed comes first: it is the one setting here you feel immediately, and the
 * Design screen reads top to bottom.
 */
export function courseSettings() {
  const pace = [
    {
      id: 'pace',
      label: 'Pace',
      options: [
        {
          id: 'speed',
          lead: 'The world scrolls',
          trail: '',
          choices: [['calm', 'slowly'], ['normal', 'at the usual pace'], ['quick', 'fast']],
          value: 'normal',
        },
        {
          id: 'ramp',
          lead: 'and',
          trail: 'as your score climbs',
          choices: [
            ['none', 'holds that pace'],
            ['gentle', 'speeds up gently'],
            ['steep', 'speeds up sharply'],
          ],
          value: 'gentle',
        },
      ],
    },
  ];

  const course = [
    {
      id: 'obstacles',
      label: 'Obstacles',
      options: [
        {
          id: 'shape',
          lead: 'You fly past',
          trail: '',
          choices: [
            ['columns', 'columns with a gap'],
            ['floating', 'floating blocks'],
            ['ceiling', 'bars hanging from above'],
            ['slalom', 'alternating high and low bars'],
          ],
          value: 'columns',
        },
        {
          id: 'gap',
          lead: 'with',
          trail: 'to get through',
          choices: [['tight', 'a tight squeeze'], ['normal', 'a fair gap'], ['roomy', 'plenty of room']],
          value: 'normal',
        },
        {
          id: 'spacing',
          lead: 'arriving',
          trail: '',
          choices: [['tight', 'close together'], ['normal', 'at a steady spacing'], ['wide', 'far apart']],
          value: 'normal',
        },
      ],
    },
  ];

  return [
    {
      id: 'speed',
      label: 'Speed',
      emoji: '⏩',
      description: 'How fast the world comes at you, and whether that changes as you score.',
      ports: pace,
    },
    {
      id: 'world',
      label: 'The course',
      emoji: '🏞️',
      description: 'What you are flying through. The same course under every scheme.',
      ports: course,
    },
  ];
}

/**
 * The parts of the game that are the same whatever you steer it with. Every
 * scheme gets these on top of its own control, so a restart wired under one
 * scheme is a restart under all of them.
 *
 * Only the board's jacks live here. How fast the world runs is a choice and not
 * a control, so it is a setting on the Design screen alongside what you are
 * flying through — see `courseSettings`.
 */
export function sharedTargets() {
  return [
    {
      id: 'shift',
      label: 'Speed modifiers',
      emoji: '⏩',
      description: 'Bend how fast the world comes at you, while your controller says so.',
      ports: [
        {
          id: 'hold',
          label: 'Hold',
          type: 'hold',
          defaultValue: 0,
          options: [{
            id: 'change',
            // The choices are what the *world* does, not what the input is, so
            // one jack covers the brake and the boost. Listed slowest to
            // fastest, so each pair sits the same distance either side of the
            // middle.
            lead: 'Runs the world',
            trail: 'while it is held',
            choices: [
              ['quarter', 'at a quarter of the speed'],
              ['half', 'at half speed'],
              ['slower', 'a little slower'],
              ['faster', 'a little faster'],
              ['double', 'at double speed'],
              ['quadruple', 'at four times the speed'],
            ],
            value: 'half',
          }],
        },
        {
          id: 'level',
          label: 'Level',
          type: 'level',
          // Neutral is the bottom of the range rather than the middle: a dial
          // resting where it was left should leave the world alone, and the
          // sweep is toward the end you picked.
          defaultValue: 0,
          phrase: 'how far the world is bent',
          options: [
            {
              id: 'low',
              lead: 'At the low end the world runs',
              trail: '',
              choices: SHIFT_CHOICES,
              value: 'normal',
            },
            {
              id: 'high',
              lead: 'and at the high end,',
              trail: '',
              choices: SHIFT_CHOICES,
              value: 'double',
            },
          ],
        },
      ],
    },
    {
      id: 'ui',
      label: 'UI',
      emoji: '🖲️',
      description: 'Clicking through the game\'s own screens, without reaching for the keyboard.',
      ports: [
        {
          id: 'advance',
          label: 'Trigger',
          type: 'trigger',
          // Fixed rather than offered: there is one sensible rate for pressing
          // the button on a screen and it is "not twice". A second is slow
          // enough that a wire left parked on can't spin the game, and nobody
          // wiring this wants to reason about the difference between that and
          // half a second.
          pace: 1000,
          options: [{
            id: 'when',
            lead: 'Presses the button on the screen',
            trail: '',
            choices: [['always', 'whenever it fires'], ['over', 'only after a crash']],
            value: 'always',
          }],
        },
      ],
    },
  ];
}

// How hard the craft falls, worded once and spliced into each falling motion's
// own port with the lead and trail that finish that port's sentence. It reads as
// the second half of what pushing back does, because that is what it is: the two
// halves of the same fight, set in the same place.
const FALL_OPTION = Object.freeze({
  id: 'gravity',
  choices: Object.freeze([
    ['floaty', 'drifts down slowly'],
    ['normal', 'falls the usual way'],
    ['heavy', 'drops like a stone'],
  ]),
  value: 'normal',
});

// Keys are split by the *shape* of the control rather than given out alike:
// a scheme with one button takes Space, and a scheme with two directions takes
// the arrow and WASD pairs and no Space. They were all bound to everything,
// which made every mode answer to the same three keys and so made choosing a
// mode look like it changed nothing.
//
// The four control schemes. `targets` are the ports the scheme exposes to the
// wiring board — the whole point of the picker — and `controls` are the manual
// keyboard and on-screen fallbacks for the same thing.
//
// Each is named after the game whose control its input feels like, since that
// is what tells you at a glance what wiring into it will be like. The ids are
// the keys saved wiring is stored under, so once a scheme ships its id stays
// put; everything the player reads is the label.
//
// A port's label names the kind of input it takes — Trigger, Hold, Level — and
// not the job it does, because that little title sits in the same slot as an
// output's on the other side of the board, where it has always meant exactly
// that. What the port does is the sentence inside the box, which is where it
// reads the same wired and unwired. The manual `controls` still carry function
// names: those are buttons you press, not jacks you patch into.
const CONTROL_SCHEMES = [
  {
    id: 'flappy',
    motion: 'impulse',
    label: 'Flappy',
    emoji: '🐤',
    scheme: 'Tap to rise',
    hint: 'Tap to rise.',
    tagline: 'One trigger input. Each tap pushes the craft up, and gravity pulls it back down.',
    targets: [
      {
        id: 'flap',
        label: 'Rise',
        emoji: '⚡',
        description: 'Push the craft upward.',
        ports: [{
          id: 'trigger',
          label: 'Trigger',
          type: 'trigger',
          options: [
            {
              id: 'lift', lead: 'Kicks the craft up', trail: '',
              choices: [['soft', 'gently'], ['normal', 'the usual amount'], ['hard', 'hard']],
              value: 'normal',
            },
            { ...FALL_OPTION, lead: 'and then it', trail: '' },
          ],
        }],
      },
    ],
    controls: [{ id: 'flap', label: 'Rise', kind: 'press', keys: ['Space'], primary: true }],
  },
  // The same fall as the flappy scheme, pushed back against continuously rather
  // than in kicks — so the one thing that matters is how long you hold it.
  {
    id: 'jetpack',
    motion: 'thrust',
    label: 'Jetpack',
    emoji: '🚀',
    scheme: 'Hold to rise',
    hint: 'Hold to climb.',
    tagline: 'One held input. The craft climbs for as long as you hold it, and falls when you let go.',
    targets: [
      {
        id: 'lift',
        label: 'Thrust',
        emoji: '🚀',
        description: 'Climb while an input is held. Let go and gravity takes over.',
        ports: [{
          id: 'thrust',
          label: 'Hold',
          type: 'hold',
          defaultValue: 0,
          options: [
            {
              id: 'lift', lead: 'Climbs', trail: 'while it is held',
              choices: [['soft', 'gently'], ['normal', 'steadily'], ['hard', 'hard']],
              value: 'normal',
            },
            { ...FALL_OPTION, lead: 'and', trail: 'once it is let go' },
          ],
        }],
      },
    ],
    controls: [
      { id: 'thrust', label: 'Thrust', kind: 'hold', keys: ['Space'], primary: true },
    ],
  },
  // Two holds and no gravity at all: the craft sits still until told to move,
  // then moves at one steady rate, the way a ship slides across the bottom of a
  // shooter. Nothing carries over once you let go.
  {
    id: 'spaceship',
    motion: 'slide',
    label: 'Invaders',
    emoji: '👾',
    scheme: 'Hold to slide',
    hint: 'Hold up or down to move.',
    tagline: 'Two held inputs and no gravity. The craft moves at a steady rate while held and stops when released.',
    targets: [
      {
        id: 'slide',
        label: 'Move',
        emoji: '🛸',
        description: 'Move the craft up or down at a steady rate. Hold neither and it stops.',
        ports: [
          // Both jacks are just 'Hold'. Which one you are looking at is the
          // sentence in the box — one climbs, one drops — the same way a port's
          // job is told everywhere else on this board.
          {
            id: 'up',
            label: 'Hold',
            type: 'hold',
            defaultValue: 0,
            options: [{
              id: 'speed', lead: 'Climbs', trail: 'while it is held',
              choices: [['slow', 'slowly'], ['normal', 'at a steady rate'], ['fast', 'quickly']],
              value: 'normal',
            }],
          },
          {
            id: 'down',
            label: 'Hold',
            type: 'hold',
            defaultValue: 0,
            options: [{
              id: 'speed', lead: 'Drops', trail: 'while it is held',
              choices: [['slow', 'slowly'], ['normal', 'at a steady rate'], ['fast', 'quickly']],
              value: 'normal',
            }],
          },
        ],
      },
    ],
    // Ids match the ports these stand in for, so wiring one still leaves the
    // other on the keyboard.
    controls: [
      { id: 'up', label: 'Move up', kind: 'hold', keys: ['ArrowUp', 'KeyW'], primary: true },
      { id: 'down', label: 'Move down', kind: 'hold', keys: ['ArrowDown', 'KeyS'] },
    ],
  },
  {
    id: 'brickbreaker',
    motion: 'track',
    label: 'Breaker',
    emoji: '🧱',
    scheme: 'Steer directly',
    hint: 'Steer to the gap.',
    tagline: 'One continuous input. Its reading maps directly to height, so a dial or slider works better than a button.',
    targets: [
      {
        id: 'paddle',
        label: 'Height',
        emoji: '🎚️',
        description: 'Steer the craft from top to bottom across the input range.',
        // No options: which way up a steered height reads is already a property
        // of the level wired into it, and says so in the wire's own sentence.
        // `phrase` is what this port sets, in the words the game would use for
        // it — "Level" is the connector, and a sentence wants the thing.
        ports: [{
          id: 'y',
          label: 'Level',
          type: 'level',
          phrase: 'the vertical position',
          defaultValue: 0.5,
        }],
      },
    ],
    controls: [
      { id: 'up', label: 'Up', kind: 'hold', keys: ['ArrowUp', 'KeyW'], primary: true },
      { id: 'down', label: 'Down', kind: 'hold', keys: ['ArrowDown', 'KeyS'] },
    ],
  },
];

// A scheme is its own control plus everything every scheme has. The shared part
// comes last on purpose: the picker lives in the first card, and what you steer
// with should be read before what you are steering through.
//
// `steering` is taken here rather than written out by hand, because a scheme's
// own targets already are exactly the ports you have to wire before a
// controller can fly the craft — the shared ones are extras by definition. It
// is what the Game screen checks before telling you your controller isn't
// finished, so it has to stay true of a scheme added later without anybody
// remembering to update a second list.
export const SCHEMES = Object.freeze(CONTROL_SCHEMES.map((scheme) => Object.freeze({
  ...scheme,
  // Kept per control rather than per jack: the two halves of the slide are both
  // labelled "Hold" and tell themselves apart only by the sentence inside them,
  // so naming a particular one in a warning would say less than counting them.
  steering: Object.freeze(scheme.targets.map((target) => Object.freeze({
    label: target.label,
    keys: Object.freeze(target.ports.map((port) => `${target.id}.${port.id}`)),
  }))),
  targets: [...scheme.targets, ...sharedTargets()],
  settings: courseSettings(),
})));
