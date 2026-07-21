// PLACEHOLDER game. The collaborator will replace this with Flappy Bird.
//
// It's intentionally minimal — a bird that flaps up on each `trigger` and falls
// under gravity — so attendees get instant end-to-end confirmation that their
// controller works. It reads from the SAME bus the real game will use, so the
// input wiring is already done: subscribe to `trigger` and make the bird jump.

import { onInput } from './bus.js';

export function initGame() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const bird = { x: W * 0.32, y: H / 2, vy: 0, r: 13 };
  const GRAVITY = 0.45;
  const FLAP = -7.2;

  onInput((msg) => {
    if (msg.type === 'trigger') bird.vy = FLAP;
  });

  function loop() {
    bird.vy += GRAVITY;
    bird.y += bird.vy;

    // Bounce gently off the floor/ceiling so the placeholder never gets stuck.
    if (bird.y > H - bird.r) { bird.y = H - bird.r; bird.vy *= -0.35; }
    if (bird.y < bird.r) { bird.y = bird.r; bird.vy = 0; }

    // Night sky
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0a1526');
    sky.addColorStop(1, '#12233a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Static starfield (deterministic — no RNG in the draw loop)
    ctx.fillStyle = 'rgba(220,239,228,.5)';
    for (let i = 0; i < 26; i++) {
      const sx = (i * 97) % W;
      const sy = (i * 53) % (H - 60);
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    // Ground with a phosphor edge
    ctx.fillStyle = '#0c1310';
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = '#57ffa6';
    ctx.fillRect(0, H - 22, W, 2);

    // Bird — amber with a soft glow
    ctx.save();
    ctx.shadowColor = '#ffb43d';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcf5c';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#e0952a';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eye + beak
    ctx.fillStyle = '#0a0f0d';
    ctx.beginPath();
    ctx.arc(bird.x + 5, bird.y - 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7a2f';
    ctx.beginPath();
    ctx.moveTo(bird.x + bird.r - 2, bird.y - 2);
    ctx.lineTo(bird.x + bird.r + 7, bird.y);
    ctx.lineTo(bird.x + bird.r - 2, bird.y + 3);
    ctx.closePath();
    ctx.fill();

    // Hint text
    ctx.fillStyle = 'rgba(87,255,166,.7)';
    ctx.font = '12px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('trigger → flap', W / 2, 28);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
