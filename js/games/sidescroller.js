// The game. There is exactly one of them — a craft flying rightward past
// scrolling gates — and four control schemes that decide how you steer it. The
// picker changes nothing but the scheme: same world, same gates, same scoring,
// a different way of moving through it.
//
// A scheme owns a `motion`, which is the only thing the engine branches on:
//   impulse  every trigger kicks the craft upward, gravity does the rest
//   thrust   climb while the input is held, sink when it lets go
//   step     two triggers move the craft one step up or down
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
  maxFallSpeed: 430,
  stepCount: 3,
  stepBlend: 13,
  trackBlend: 18,
  manualSpeed: 0.95, // range units per second when using keys instead of a dial
  wakeDelta: 0.12, // how far a wired dial must move to start the round
});

// How close to the top and bottom a gap is allowed to sit.
const GATE_EDGE = RULES.gateGap / 2 + RULES.gateMargin;

export const stepY = (step) => (RULES.groundY / RULES.stepCount) * (step + 0.5);
export const trackY = (value) => lerp(
  RULES.playerRadius,
  RULES.groundY - RULES.playerRadius,
  value,
);

export class SidescrollerGame extends BaseGame {
  constructor(random, motion = 'impulse') {
    super(random);
    this.motion = motion;
    this.thrustLatch = false;
    this.manual = { up: false, down: false };
    this.reset();
  }

  newRound() {
    // Cleared so the next wired reading re-arms the "wiggle to start" gesture.
    this.wakeValue = null;
    const step = Math.floor(RULES.stepCount / 2);
    const y = { step: stepY(step), track: trackY(0.5) }[this.motion] ?? RULES.groundY * 0.45;
    return {
      player: { y, velocity: 0, step, value: 0.5, thrusting: false },
      gates: [],
      distanceUntilGate: RULES.firstGateDistance,
      distance: 0,
    };
  }

  // --- Input ----------------------------------------------------------------
  // Each scheme feeds exactly one of these four; from `update` onward the game
  // only reads the resulting player position.
  rise() {
    if (!this.engage()) return;
    this.state.player.velocity = -RULES.riseVelocity;
  }

  applyThrust(active) {
    const running = this.state.phase === 'playing';
    if (active && !this.thrustLatch) {
      // Rising edge only, so a wire parked at full throttle can't instantly
      // restart the round the moment you crash.
      this.thrustLatch = true;
      if (!running) this.engage();
    } else if (!active) {
      this.thrustLatch = false;
    }
    this.state.player.thrusting = active && this.state.phase === 'playing';
  }

  shift(delta) {
    const wasPlaying = this.state.phase === 'playing';
    this.engage();
    // A step that only woke the round up shouldn't also move the craft — the
    // player gets a clean look at the gates before committing.
    if (!wasPlaying) return;
    this.state.player.step = Math.max(
      0,
      Math.min(RULES.stepCount - 1, this.state.player.step + delta),
    );
    this.notify();
  }

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

  setValue(node, port, value) {
    if (this.motion === 'thrust' && node === 'lift' && port === 'thrust') {
      this.applyThrust(clamp01(value) > 0.5);
    }
    if (this.motion === 'track' && node === 'paddle' && port === 'y') this.track(value);
  }

  fire(node, port) {
    if (this.motion === 'impulse' && node === 'flap') this.rise();
    if (this.motion === 'step' && node === 'lane') this.shift(port === 'down' ? 1 : -1);
  }

  press(id) {
    if (this.motion === 'impulse') this.rise();
    else if (this.motion === 'step') this.shift(id === 'down' ? 1 : -1);
    else this.engage();
  }

  hold(id, down) {
    if (this.motion === 'thrust' && !this.isWired('lift', 'thrust')) {
      this.applyThrust(Boolean(down));
    }
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
    const { player } = this.state;
    const playing = this.state.phase === 'playing';

    if (this.motion === 'impulse' || this.motion === 'thrust') {
      if (!playing) return;
      const thrusting = this.motion === 'thrust' && player.thrusting;
      const accel = RULES.gravity - (thrusting ? RULES.thrustAccel : 0);
      player.velocity = Math.max(
        -RULES.maxFallSpeed,
        Math.min(RULES.maxFallSpeed, player.velocity + accel * frameTime),
      );
      player.y += player.velocity * frameTime;
      return;
    }

    if (this.motion === 'step') {
      if (!playing) return;
      const blend = 1 - Math.exp(-frameTime * RULES.stepBlend);
      player.y += (stepY(player.step) - player.y) * blend;
      return;
    }

    // A tracked height keeps following the input between rounds, so the craft
    // starts each round where the player is actually holding it.
    if (!this.isWired('paddle', 'y')) {
      const direction = (this.manual.down ? 1 : 0) - (this.manual.up ? 1 : 0);
      if (direction) {
        player.value = clamp01(player.value + direction * RULES.manualSpeed * frameTime);
      }
    }
    const blend = 1 - Math.exp(-frameTime * RULES.trackBlend);
    player.y += (trackY(player.value) - player.y) * blend;
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
      this.state.distanceUntilGate += RULES.gateSpacing;
    }
    this.state.gates = this.state.gates.filter((gate) => gate.x + RULES.gateWidth > -10);

    if (collided || this.outsideField()) this.end();
  }

  speed() {
    return Math.min(RULES.speedMax, RULES.speedStart + this.state.score * RULES.speedPerPoint);
  }

  // Only the schemes that can fly the craft off the field can crash into it — a
  // step or a tracked height is inside the field by construction.
  outsideField() {
    if (this.motion === 'step' || this.motion === 'track') return false;
    const { y } = this.state.player;
    return y - RULES.playerRadius <= 0 || y + RULES.playerRadius >= RULES.groundY;
  }

  spawnGate(x) {
    // A stepped craft can only ever be at a step height, so its gaps have to be
    // there too — anywhere else and the gap would be unreachable.
    const gapY = this.motion === 'step'
      ? stepY(Math.min(RULES.stepCount - 1, Math.floor(this.random() * RULES.stepCount)))
      : lerp(GATE_EDGE, RULES.groundY - GATE_EDGE, this.random());
    this.state.gates.push({ x, gapY, scored: false });
  }

  hitsGate(gate) {
    const overlapsX = RULES.playerX + RULES.playerRadius > gate.x
      && RULES.playerX - RULES.playerRadius < gate.x + RULES.gateWidth;
    if (!overlapsX) return false;
    // Compares against the drawn position, not the step being moved to, so a
    // craft caught mid-move is judged where the player can actually see it.
    const { y } = this.state.player;
    return y - RULES.playerRadius < gate.gapY - RULES.gateGap / 2
      || y + RULES.playerRadius > gate.gapY + RULES.gateGap / 2;
  }
}

export function createRenderer(ctx, helpers, scheme = {}) {
  const { width, height, groundY, playerX, playerRadius, gateWidth, gateGap } = RULES;
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

  // Only the stepped scheme gets guides — they mark heights the craft can
  // actually stop at, which is meaningless when the input is continuous.
  function drawSteps() {
    ctx.save();
    ctx.strokeStyle = 'rgba(27, 28, 32, .1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    for (let step = 0; step < RULES.stepCount; step += 1) {
      ctx.beginPath();
      ctx.moveTo(0, stepY(step));
      ctx.lineTo(width, stepY(step));
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintSlab(x, y, slabWidth, slabHeight, radius) {
    roundedRect(x, y, slabWidth, slabHeight, radius);
    ctx.fill();
    ctx.stroke();
  }

  function drawGate(gate) {
    const gapTop = gate.gapY - gateGap / 2;
    const gapBottom = gate.gapY + gateGap / 2;
    ctx.fillStyle = '#34b24a';
    ctx.strokeStyle = '#238b37';
    ctx.lineWidth = 3;

    paintSlab(gate.x, -8, gateWidth, gapTop + 8, 6);
    paintSlab(gate.x - 6, gapTop - 22, gateWidth + 12, 24, 5);
    paintSlab(gate.x, gapBottom, gateWidth, groundY - gapBottom + 8, 6);
    paintSlab(gate.x - 6, gapBottom - 2, gateWidth + 12, 24, 5);
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
    if (scheme.motion === 'step') drawSteps();
    state.gates.forEach(drawGate);
    drawGround(state.distance);
    drawPlayer(state.player, state.phase, now);
    drawOverlay(state, scheme.hint ?? 'Fly through the gaps.');
  };
}

// The four control schemes. `targets` are the ports the scheme exposes to the
// wiring board — the whole point of the picker — and `controls` are the manual
// keyboard and on-screen fallbacks for the same thing.
//
// The ids here (and the target/port ids inside them) are the names these
// schemes carried when each was its own game. They are the keys saved wiring is
// stored under, so they stay put; everything the player reads is the label.
export const SCHEMES = Object.freeze([
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
        ports: [{ id: 'trigger', label: 'Trigger', type: 'trigger' }],
      },
    ],
    controls: [{ id: 'flap', label: 'Rise', kind: 'press', keys: ['Space', 'ArrowUp'], primary: true }],
  },
  {
    id: 'helicopter',
    motion: 'thrust',
    label: 'Hold to climb',
    emoji: '✊',
    scheme: 'Held trigger',
    hint: 'Hold to climb, release to sink.',
    tagline: 'The same single input, except now it matters how long you hold it. Squeeze to climb, let go to sink, and ride the line between.',
    targets: [
      {
        id: 'lift',
        label: 'Lift',
        emoji: '✊',
        description: 'Climb while the input is held; sink the moment it lets go.',
        ports: [{ id: 'thrust', label: 'Thrust', type: 'value', defaultValue: 0 }],
      },
    ],
    controls: [{ id: 'lift', label: 'Lift', kind: 'hold', keys: ['Space', 'ArrowUp'], primary: true }],
  },
  {
    id: 'lanes',
    motion: 'step',
    label: 'Step up or down',
    emoji: '↕️',
    scheme: 'Two buttons',
    hint: 'Two buttons: step up, or step down.',
    tagline: 'Three fixed heights, two buttons. Each trigger moves the craft exactly one step, and every gap lines up with a step — so the game is picking the right one in time.',
    targets: [
      {
        id: 'lane',
        label: 'Step',
        emoji: '↕️',
        description: 'Each trigger moves the craft exactly one step.',
        ports: [
          { id: 'up', label: 'Step up', type: 'trigger' },
          { id: 'down', label: 'Step down', type: 'trigger' },
        ],
      },
    ],
    controls: [
      { id: 'up', label: 'Up', kind: 'press', keys: ['ArrowUp', 'KeyW'], primary: true },
      { id: 'down', label: 'Down', kind: 'press', keys: ['ArrowDown', 'KeyS'] },
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
        ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
      },
    ],
    controls: [
      { id: 'up', label: 'Up', kind: 'hold', keys: ['ArrowUp', 'KeyW'], primary: true },
      { id: 'down', label: 'Down', kind: 'hold', keys: ['ArrowDown', 'KeyS'] },
    ],
  },
]);
