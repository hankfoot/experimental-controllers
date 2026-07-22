export const GAME_RULES = Object.freeze({
  width: 480,
  height: 600,
  groundY: 530,
  birdX: 130,
  birdRadius: 16,
  pipeWidth: 66,
  pipeGap: 168,
  pipeSpacing: 240,
  firstPipeDistance: 180,
  pipeMargin: 70,
  gravityMin: 500,
  gravityMax: 2000,
  flapMin: 220,
  flapMax: 520,
  pipeSpeedMin: 70,
  pipeSpeedMax: 220,
});

const DEFAULT_CONTROLS = Object.freeze({
  magnitude: 0.57,
  gravity: 0.5,
  speed: 0.5,
  position: 0.5,
  positionEnabled: false,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const lerp = (min, max, value) => min + (max - min) * clamp01(value);

function newRound(best = 0) {
  return {
    phase: 'ready',
    bird: { y: GAME_RULES.height * 0.43, velocity: 0 },
    pipes: [],
    distanceUntilPipe: GAME_RULES.firstPipeDistance,
    score: 0,
    best,
  };
}

export class GameEngine {
  constructor(random = Math.random) {
    this.random = random;
    this.controls = { ...DEFAULT_CONTROLS };
    this.state = newRound();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flap({ magnitude = this.controls.magnitude } = {}) {
    if (this.state.phase === 'over') this.reset();
    if (this.state.phase === 'ready') this.start();
    if (!this.controls.positionEnabled) {
      this.state.bird.velocity = -lerp(GAME_RULES.flapMin, GAME_RULES.flapMax, magnitude);
    }
  }

  restartGame() {
    this.reset();
    this.start();
  }

  reset() {
    this.state = newRound(this.state.best);
    if (this.controls.positionEnabled) this.state.bird.y = this.positionY(this.controls.position);
    this.notify();
  }

  setGameSpeed(value) {
    this.controls.speed = clamp01(value);
  }

  setGravity(value) {
    this.controls.gravity = clamp01(value);
  }

  setPosition(value) {
    this.controls.position = clamp01(value);
  }

  setPositionEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.controls.positionEnabled) return;
    this.controls.positionEnabled = next;
    this.state.bird.velocity = 0;
    if (next) this.state.bird.y = this.positionY(this.controls.position);
  }

  update(dt) {
    if (this.state.phase !== 'playing') return;
    const frameTime = Math.max(0, Math.min(dt, 0.035));

    if (this.controls.positionEnabled) {
      const blend = 1 - Math.exp(-frameTime * 14);
      this.state.bird.y += (this.positionY(this.controls.position) - this.state.bird.y) * blend;
      this.state.bird.velocity = 0;
    } else {
      this.state.bird.velocity += lerp(
        GAME_RULES.gravityMin,
        GAME_RULES.gravityMax,
        this.controls.gravity,
      ) * frameTime;
      this.state.bird.y += this.state.bird.velocity * frameTime;
    }

    const travel = lerp(
      GAME_RULES.pipeSpeedMin,
      GAME_RULES.pipeSpeedMax,
      this.controls.speed,
    ) * frameTime;
    let collided = false;
    for (const pipe of this.state.pipes) {
      pipe.x -= travel;
      if (!pipe.scored && pipe.x + GAME_RULES.pipeWidth < GAME_RULES.birdX) {
        pipe.scored = true;
        this.state.score += 1;
        this.state.best = Math.max(this.state.best, this.state.score);
        this.notify();
      }
      collided ||= this.hitsPipe(pipe);
    }

    this.state.distanceUntilPipe -= travel;
    while (this.state.distanceUntilPipe <= 0) {
      // Account for the fraction of this frame after the spacing threshold.
      this.spawnPipe(GAME_RULES.width + 20 + this.state.distanceUntilPipe);
      this.state.distanceUntilPipe += GAME_RULES.pipeSpacing;
    }
    this.state.pipes = this.state.pipes.filter(
      (pipe) => pipe.x + GAME_RULES.pipeWidth > -10,
    );

    const outsidePlayfield = this.state.bird.y - GAME_RULES.birdRadius <= 0
      || this.state.bird.y + GAME_RULES.birdRadius >= GAME_RULES.groundY;
    if (collided || outsidePlayfield) this.end();
  }

  start() {
    this.state.phase = 'playing';
    this.notify();
  }

  end() {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'over';
    this.notify();
  }

  spawnPipe(x) {
    const margin = GAME_RULES.pipeGap / 2 + GAME_RULES.pipeMargin;
    this.state.pipes.push({
      x,
      gapY: margin + this.random() * (GAME_RULES.groundY - margin * 2),
      scored: false,
    });
  }

  hitsPipe(pipe) {
    const overlapsX = GAME_RULES.birdX + GAME_RULES.birdRadius > pipe.x
      && GAME_RULES.birdX - GAME_RULES.birdRadius < pipe.x + GAME_RULES.pipeWidth;
    if (!overlapsX) return false;
    const gapTop = pipe.gapY - GAME_RULES.pipeGap / 2;
    const gapBottom = pipe.gapY + GAME_RULES.pipeGap / 2;
    return this.state.bird.y - GAME_RULES.birdRadius < gapTop
      || this.state.bird.y + GAME_RULES.birdRadius > gapBottom;
  }

  positionY(value) {
    const margin = GAME_RULES.birdRadius + 2;
    return margin + clamp01(value) * (GAME_RULES.groundY - margin * 2);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }
}
