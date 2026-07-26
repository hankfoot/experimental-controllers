// The game. There is exactly one of them — a craft flying rightward past
// scrolling gates — and three control schemes that decide how you steer it. The
// picker changes nothing but the scheme: same world, same gates, same scoring,
// a different way of moving through it.
//
// A scheme owns a `motion`, which is the only thing the engine branches on:
//   impulse  every trigger kicks the craft upward, gravity does the rest
//   thrust   climb while an input is held; sink under gravity, or while a
//            second input is held, or both
//   track    a continuous 0..1 reading is the craft's height
//
// Everything below the input layer is shared, so a gate that is fair under one
// scheme is fair under all of them.

import { BaseGame, clamp01, lerp } from './base.js';

export const RULES = Object.freeze({
  width: 480,
  height: 600,
  groundY: 530,
  playerX: 130,
  playerRadius: 16,
  gateWidth: 66,
  gateGap: 176,
  gateSpacing: 250,
  gateMargin: 74,
  firstGateDistance: 300,
  speedStart: 150,
  speedPerPoint: 3.2,
  speedMax: 300,
  gravity: 1250,
  riseVelocity: 400,
  thrustAccel: 2100,
  diveAccel: 1500, // what a held descend input adds, alongside gravity or alone
  hoverDrag: 9, // how fast a weightless craft gives up its speed, per second
  maxFallSpeed: 430,
  trackBlend: 18,
  manualSpeed: 0.95, // range units per second when using keys instead of a dial
  wakeDelta: 0.12, // how far a wired dial must move to start the round
  barSkirt: 8, // how far an obstacle runs past the edge, so it has no visible end
  blockHeight: 128, // a floating block's height
});

// What the strength choices multiply their effect by. A kick is a one-off you
// either time right or don't, so its ends spread wider than a sustained push,
// where the difference is felt the whole time it is held.
const KICK = Object.freeze({ soft: 0.72, normal: 1, hard: 1.32 });
const PUSH = Object.freeze({ soft: 0.78, normal: 1, hard: 1.24 });

// What the course settings multiply the built-in numbers by. Every one of them
// is a plain multiplier on a RULES value, and every default is 1 — so a game
// nobody has touched the settings of plays exactly as it did before they existed.
const GAP = Object.freeze({ tight: 0.72, normal: 1, roomy: 1.3 });
const SPACING = Object.freeze({ tight: 0.74, normal: 1, wide: 1.34 });
const PACE = Object.freeze({ calm: 0.72, normal: 1, quick: 1.34 });
const RAMP = Object.freeze({ none: 0, gentle: 1, steep: 2.5 });
const WEIGHT = Object.freeze({ floaty: 0.68, normal: 1, heavy: 1.4 });
const BRAKE = Object.freeze({ light: 0.78, half: 0.5, crawl: 0.24 });

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
    this.holdLatch = { thrust: false, sink: false };
    this.manual = { up: false, down: false };
    // Held rather than latched: the brake does nothing but slow the world, so
    // there is no round for a parked wire to start by accident.
    this.braking = false;
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

  /** One of the two held ports going on or off. `port` is 'thrust' or 'sink'. */
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
    const flag = port === 'sink' ? 'sinking' : 'thrusting';
    this.state.player[flag] = active && this.state.phase === 'playing';
  }

  track(value) {
    const flipped = this.option('paddle', 'y', 'flip', 'no') === 'yes';
    const next = clamp01(flipped ? 1 - value : value);
    this.state.player.value = next;
    if (this.wakeValue == null) this.wakeValue = next;
    // A parked dial shouldn't auto-start a round; a deliberate move should.
    if (this.state.phase !== 'playing' && Math.abs(next - this.wakeValue) > RULES.wakeDelta) {
      this.wakeValue = next;
      this.engage();
    }
  }

  /** Start over. Wired, this is a button on your controller; it never scores. */
  requestRestart() {
    const when = this.option('assist', 'restart', 'when', 'always');
    if (when === 'over' && this.state.phase !== 'over') return;
    this.reset();
  }

  setValue(node, port, value) {
    // A hold port only ever sends the two ends, so this is reading which end.
    if (node === 'assist' && port === 'brake') this.braking = clamp01(value) > 0.5;
    if (this.motion === 'thrust' && node === 'lift') this.setHold(port, clamp01(value) > 0.5);
    if (this.motion === 'track' && node === 'paddle' && port === 'y') this.track(value);
  }

  fire(node, port) {
    if (this.motion === 'impulse' && node === 'flap') this.rise();
    if (node === 'assist' && port === 'restart') this.requestRestart();
  }

  press() {
    if (this.motion === 'impulse') this.rise();
    else this.engage();
  }

  // The manual controls carry the same ids as the ports they stand in for, so
  // each one steps aside exactly when its own port is wired — you can drive
  // Climb from a button and still hold Descend on the keyboard.
  hold(id, down) {
    // The brake belongs to no scheme, so it steps aside on its own port rather
    // than falling through to whichever control shares the scheme's ids.
    if (id === 'brake') {
      if (!this.isWired('assist', 'brake')) this.braking = Boolean(down);
      return;
    }
    if (this.motion === 'thrust' && !this.isWired('lift', id)) this.setHold(id, Boolean(down));
    if (this.motion === 'track' && !this.isWired('paddle', 'y')) {
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
    if (this.motion === 'impulse' || this.motion === 'thrust') {
      if (this.state.phase === 'playing') this.fly(frameTime);
      return;
    }

    const { player } = this.state;
    // A tracked height keeps following the input between rounds, so the craft
    // starts each round where the player is actually holding it.
    if (!this.isWired('paddle', 'y')) {
      const direction = (this.manual.down ? 1 : 0) - (this.manual.up ? 1 : 0);
      if (direction) {
        player.value = clamp01(player.value + direction * RULES.manualSpeed * frameTime);
      }
    }
    const ease = { snap: 3, normal: 1, smooth: 0.4 }[this.option('paddle', 'y', 'ease', 'normal')] ?? 1;
    const blend = 1 - Math.exp(-frameTime * RULES.trackBlend * ease);
    player.y += (trackY(player.value) - player.y) * blend;
  }

  // Free flight, shared by the two falling schemes. Impulse flight is this with
  // nothing ever held — gravity alone acts, and rise() is what pushes back.
  fly(frameTime) {
    const { player } = this.state;
    const held = this.motion === 'thrust';
    // Turning gravity off is what makes the second input load-bearing: without
    // it there is nothing but the two holds deciding where the craft goes.
    const falls = !held || this.option('lift', 'thrust', 'sink', 'gravity') === 'gravity';

    const weight = WEIGHT[this.option('world', 'weight', 'gravity', 'normal')] ?? 1;
    let accel = falls ? RULES.gravity * weight : 0;
    if (held && player.thrusting) {
      accel -= RULES.thrustAccel * (PUSH[this.option('lift', 'thrust', 'lift', 'normal')] ?? 1);
    }
    if (held && player.sinking) {
      accel += RULES.diveAccel * (PUSH[this.option('lift', 'sink', 'dive', 'normal')] ?? 1);
    }
    player.velocity += accel * frameTime;

    // Weightless, letting go has to mean stopping — otherwise the craft keeps
    // whatever speed it last had and drifts off on its own. Holding both is the
    // same standstill, reached by pushing equally from each side, which is why
    // this asks whether they agree rather than whether either is on.
    if (!falls && player.thrusting === player.sinking) {
      player.velocity *= Math.exp(-frameTime * RULES.hoverDrag);
    }

    player.velocity = Math.max(-RULES.maxFallSpeed, Math.min(RULES.maxFallSpeed, player.velocity));
    player.y += player.velocity * frameTime;
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
      this.state.distanceUntilGate += this.spacing();
    }
    this.state.gates = this.state.gates.filter((gate) => gate.x + RULES.gateWidth > -10);

    if (collided || this.outsideField()) this.end();
  }

  // --- The course -----------------------------------------------------------
  // Four settings, none of them wired to anything: they belong to the world
  // rather than to any control, so they are read straight off the options.
  gapSize() {
    return RULES.gateGap * (GAP[this.option('world', 'obstacles', 'gap', 'normal')] ?? 1);
  }

  spacing() {
    return RULES.gateSpacing * (SPACING[this.option('world', 'obstacles', 'spacing', 'normal')] ?? 1);
  }

  speed() {
    const pace = PACE[this.option('world', 'pace', 'speed', 'normal')] ?? 1;
    const ramp = RAMP[this.option('world', 'pace', 'ramp', 'gentle')] ?? 1;
    // The ceiling applies to what scoring earned, so the settings can push the
    // world past it deliberately — a braked "fast" is still slower than "calm".
    const climbed = RULES.speedStart + this.state.score * RULES.speedPerPoint * ramp;
    const brake = this.braking
      ? BRAKE[this.option('assist', 'brake', 'strength', 'half')] ?? 1
      : 1;
    return Math.min(RULES.speedMax, climbed) * pace * brake;
  }

  // Only the schemes that can fly the craft off the field can crash into it — a
  // tracked height is inside the field by construction.
  outsideField() {
    if (this.motion === 'track') return false;
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
    this.state.gateCount += 1;
    this.state.gates.push({ x, gap, kind, gapY: this.gapLine(kind, gap), scored: false });
  }

  /**
   * Where to build the next obstacle, kept far enough from the edges that the
   * way past it is always at least `gap` wide — whichever side that way is on.
   */
  gapLine(kind, gap) {
    const { groundY, gateMargin, blockHeight } = RULES;
    const span = (low, high) => lerp(low, high, this.random());
    if (kind === 'floating') {
      const clear = blockHeight / 2 + gap * 0.6;
      return span(clear, groundY - clear);
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
      && RULES.playerX - RULES.playerRadius < gate.x + RULES.gateWidth;
    if (!overlapsX) return false;
    const { y } = this.state.player;
    return gateBars(gate).some((bar) =>
      y + RULES.playerRadius > bar.top && y - RULES.playerRadius < bar.bottom);
  }
}

export function createRenderer(ctx, helpers, scheme = {}) {
  const { width, height, groundY, playerX, playerRadius, gateWidth } = RULES;
  const { roundedRect, drawOverlay } = helpers;
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#eaf1ff');
  sky.addColorStop(1, '#f4fbf5');

  function drawCloud(x, y, scale) {
    ctx.fillStyle = 'rgba(255, 255, 255, .78)';
    ctx.beginPath();
    ctx.arc(x, y, 22 * scale, 0, Math.PI * 2);
    ctx.arc(x + 24 * scale, y - 8 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.arc(x + 53 * scale, y, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(distance) {
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);
    // Clouds drift slower than the ground, which is what sells the depth.
    const drift = (distance * 0.16) % (width + 120);
    drawCloud(40 - drift + width + 120, 105, 0.8);
    drawCloud(330 - drift, 175, 0.65);

    ctx.fillStyle = '#dff1d7';
    ctx.beginPath();
    ctx.moveTo(0, 475);
    ctx.quadraticCurveTo(90, 410, 180, 475);
    ctx.quadraticCurveTo(300, 395, 480, 475);
    ctx.lineTo(width, groundY);
    ctx.lineTo(0, groundY);
    ctx.fill();
  }

  function paintSlab(x, y, slabWidth, slabHeight, radius) {
    roundedRect(x, y, slabWidth, slabHeight, radius);
    ctx.fill();
    ctx.stroke();
  }

  // Every shape is bars, so this draws bars: a slab for the body, and a wider
  // lip on whichever ends are actually in the field. An end that runs off the
  // top or past the ground has no mouth to mark, so it gets none.
  function drawGate(gate) {
    ctx.fillStyle = '#34b24a';
    ctx.strokeStyle = '#238b37';
    ctx.lineWidth = 3;

    for (const bar of gateBars(gate)) {
      paintSlab(gate.x, bar.top, gateWidth, bar.bottom - bar.top, 6);
      if (bar.top > 0) paintSlab(gate.x - 6, bar.top - 2, gateWidth + 12, 24, 5);
      if (bar.bottom < groundY) paintSlab(gate.x - 6, bar.bottom - 22, gateWidth + 12, 24, 5);
    }
  }

  function drawGround(distance) {
    ctx.fillStyle = '#f4d35e';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#d8b53d';
    ctx.fillRect(0, groundY, width, 9);
    ctx.strokeStyle = 'rgba(165, 118, 15, .28)';
    ctx.lineWidth = 2;
    for (let x = -30 - (distance % 34); x < width + 30; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 10);
      ctx.lineTo(x + 28, groundY + 38);
      ctx.stroke();
    }
  }

  function drawPlayer(player, phase, now) {
    const y = phase === 'ready' ? player.y + Math.sin(now / 260) * 6 : player.y;
    // Velocity only exists under the falling schemes, so the steered ones simply
    // fly level — no branch needed.
    const tilt = Math.max(-0.4, Math.min(0.9, player.velocity / 700));
    ctx.save();
    ctx.translate(playerX, y);
    ctx.rotate(tilt);

    if (player.thrusting) {
      ctx.fillStyle = '#f4b400';
      ctx.beginPath();
      ctx.moveTo(-18, -5);
      ctx.lineTo(-18, 5);
      ctx.lineTo(-34 - Math.abs(Math.sin(now / 40)) * 8, 0);
      ctx.closePath();
      ctx.fill();
    }

    // A held descend pushes down, so its jet points up out of the craft's back —
    // the same flame read the other way round, so which one is on is obvious.
    if (player.sinking) {
      ctx.fillStyle = '#7fb2ff';
      ctx.beginPath();
      ctx.moveTo(-6, -12);
      ctx.lineTo(6, -12);
      ctx.lineTo(0, -26 - Math.abs(Math.sin(now / 40)) * 6);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#2f6bff';
    ctx.strokeStyle = '#1a3f9e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, playerRadius + 4, playerRadius - 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tail fin, drawn behind the body's outline so the two read as one shape.
    ctx.beginPath();
    ctx.moveTo(-12, -3);
    ctx.lineTo(-20, -17);
    ctx.lineTo(-4, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#cfe4ff';
    ctx.beginPath();
    ctx.arc(5, -3, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1c20';
    ctx.beginPath();
    ctx.arc(7, -3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return function render(state, now) {
    drawBackground(state.distance);
    state.gates.forEach(drawGate);
    drawGround(state.distance);
    drawPlayer(state.player, state.phase, now);
    drawOverlay(state, scheme.hint ?? 'Fly through the gaps.');
  };
}

/**
 * The parts of the game that are the same whatever you steer it with. Every
 * scheme gets these on top of its own control, so a restart wired under one
 * scheme is a restart under all of them.
 *
 * Two of them take an input like any other control; the rest are settings —
 * type `setting`, which is a port with no jack. Nothing can be patched into
 * one, so it is a choice about the game rather than a thing to wire, and it
 * sits in the same column reading the same kind of sentence.
 */
export function sharedTargets(motion) {
  const course = [
    {
      id: 'obstacles',
      label: 'Obstacles',
      type: 'setting',
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
    {
      id: 'pace',
      label: 'Pace',
      type: 'setting',
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
  // Nothing falls under a steered height, so there is no weight to set: the
  // craft goes exactly where the input puts it.
  if (motion !== 'track') {
    course.push({
      id: 'weight',
      label: 'Weight',
      type: 'setting',
      options: [{
        id: 'gravity',
        lead: 'The craft',
        trail: '',
        choices: [
          ['floaty', 'drifts down slowly'],
          ['normal', 'falls the usual way'],
          ['heavy', 'drops like a stone'],
        ],
        value: 'normal',
      }],
    });
  }

  return [
    {
      id: 'assist',
      label: 'Extras',
      emoji: '🧰',
      description: 'Two more things your controller can do, beyond steering.',
      ports: [
        {
          id: 'restart',
          label: 'Restart',
          type: 'trigger',
          options: [{
            id: 'when',
            lead: 'Starts a fresh round',
            trail: '',
            choices: [['always', 'whenever it fires'], ['over', 'only after a crash']],
            value: 'always',
          }],
        },
        {
          id: 'brake',
          label: 'Brake',
          type: 'hold',
          defaultValue: 0,
          options: [{
            id: 'strength',
            lead: 'Slows the world',
            trail: 'while it is held',
            choices: [['light', 'a little'], ['half', 'by half'], ['crawl', 'to a crawl']],
            value: 'half',
          }],
        },
      ],
    },
    {
      id: 'world',
      label: 'The course',
      emoji: '🏞️',
      description: 'What you are flying through. Settings, not wiring — nothing to patch in.',
      ports: course,
    },
  ];
}

// The manual stand-ins for the shared ports, appended to every scheme's own.
// Restart has one already — the Reset button above the canvas — so only the
// brake needs a key.
const SHARED_CONTROLS = Object.freeze([
  { id: 'brake', label: 'Brake', kind: 'hold', keys: ['KeyB'] },
]);

// The three control schemes. `targets` are the ports the scheme exposes to the
// wiring board — the whole point of the picker — and `controls` are the manual
// keyboard and on-screen fallbacks for the same thing.
//
// The ids here (and the target/port ids inside them) are the names these
// schemes carried when each was its own game. They are the keys saved wiring is
// stored under, so they stay put; everything the player reads is the label.
const CONTROL_SCHEMES = [
  {
    id: 'flappy',
    motion: 'impulse',
    label: 'Tap to rise',
    emoji: '⚡',
    scheme: 'Single trigger',
    hint: 'Tap to rise — gravity does the rest.',
    tagline: 'One input, one job. Every trigger kicks the craft upward and gravity pulls it straight back down, so this is all about rhythm.',
    targets: [
      {
        id: 'flap',
        label: 'Rise',
        emoji: '⚡',
        description: 'Give the craft an upward kick.',
        ports: [{
          id: 'trigger',
          label: 'Trigger',
          type: 'trigger',
          options: [{
            id: 'lift', lead: 'Kicks the craft up', trail: '',
            choices: [['soft', 'gently'], ['normal', 'the usual amount'], ['hard', 'hard']],
            value: 'normal',
          }],
        }],
      },
    ],
    controls: [{ id: 'flap', label: 'Rise', kind: 'press', keys: ['Space', 'ArrowUp'], primary: true }],
  },
  // One or two held inputs. Wiring only Climb gives you the helicopter — hold to
  // go up, gravity takes you down. Wire Descend as well and you have a craft
  // pushed from both sides, and gravity becomes optional: switch it off and
  // letting go means holding still rather than falling.
  {
    id: 'helicopter',
    motion: 'thrust',
    label: 'Hold to move',
    emoji: '✊',
    scheme: 'Held inputs',
    hint: 'Hold to climb — wire a second input to push down.',
    tagline: 'One input you hold rather than tap, so it matters how long you hold it. Add a second and you push the craft down as deliberately as you lift it — at which point gravity is yours to keep or switch off.',
    targets: [
      {
        id: 'lift',
        label: 'Lift',
        emoji: '✊',
        description: 'Climb while an input is held. A second one pushes back down; without it, gravity does.',
        ports: [
          {
            id: 'thrust',
            label: 'Climb',
            type: 'hold',
            defaultValue: 0,
            options: [
              {
                id: 'lift', lead: 'Climbs', trail: 'while it is held',
                choices: [['soft', 'gently'], ['normal', 'steadily'], ['hard', 'hard']],
                value: 'normal',
              },
              {
                id: 'sink', lead: 'Let go and it', trail: '',
                choices: [['gravity', 'falls'], ['hold', 'holds its height']],
                value: 'gravity',
              },
            ],
          },
          {
            id: 'sink',
            label: 'Descend',
            type: 'hold',
            defaultValue: 0,
            options: [{
              id: 'dive', lead: 'Pushes down', trail: 'while it is held',
              choices: [['soft', 'gently'], ['normal', 'steadily'], ['hard', 'hard']],
              value: 'normal',
            }],
          },
        ],
      },
    ],
    // Ids match the ports these stand in for, so wiring one still leaves the
    // other on the keyboard.
    controls: [
      { id: 'thrust', label: 'Climb', kind: 'hold', keys: ['Space', 'ArrowUp'], primary: true },
      { id: 'sink', label: 'Descend', kind: 'hold', keys: ['ArrowDown', 'KeyS'] },
    ],
  },
  {
    id: 'pong',
    motion: 'track',
    label: 'Steer directly',
    emoji: '🎚️',
    scheme: 'Analog',
    hint: 'Steer to the gap — the whole range is in play.',
    tagline: 'One continuous reading maps straight to height. The middle of the range matters as much as the ends, so a dial, a slider, or a bend beats any button here.',
    targets: [
      {
        id: 'paddle',
        label: 'Height',
        emoji: '🎚️',
        description: 'Steer the craft from top to bottom across the input range.',
        ports: [{
          id: 'y',
          label: 'Height',
          type: 'level',
          defaultValue: 0.5,
          options: [
            { id: 'ease', lead: 'Follows the input', trail: '',
              choices: [['snap', 'instantly'], ['normal', 'closely'], ['smooth', 'loosely']],
              value: 'normal' },
            { id: 'flip', lead: 'The top of the range is', trail: '',
              choices: [['no', 'the top'], ['yes', 'the bottom']],
              value: 'no' },
          ],
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
export const SCHEMES = Object.freeze(CONTROL_SCHEMES.map((scheme) => Object.freeze({
  ...scheme,
  targets: [...scheme.targets, ...sharedTargets(scheme.motion)],
  controls: [...scheme.controls, ...SHARED_CONTROLS],
})));
