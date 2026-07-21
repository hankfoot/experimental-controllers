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

    // Soft daytime sky
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#e8f6ff');
    sky.addColorStop(1, '#cfe9fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // A couple of soft static clouds (deterministic — no RNG in the draw loop)
    const cloud = (cx, cy, s) => {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      [[0, 0, 1], [18, 4, .8], [-18, 4, .8], [8, -6, .7]].forEach(([dx, dy, r]) => {
        ctx.beginPath();
        ctx.arc(cx + dx * s, cy + dy * s, 14 * s * r, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    cloud(90, 70, 1);
    cloud(360, 50, .8);

    // Grassy ground
    ctx.fillStyle = '#bfe39a';
    ctx.fillRect(0, H - 24, W, 24);
    ctx.fillStyle = '#a9d67f';
    ctx.fillRect(0, H - 24, W, 4);

    // Bird — cheerful round yellow
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24c';
    ctx.fill();
    ctx.strokeStyle = '#f0b429';
    ctx.lineWidth = 2;
    ctx.stroke();
    // rosy cheek
    ctx.fillStyle = 'rgba(242,121,90,.5)';
    ctx.beginPath();
    ctx.arc(bird.x - 3, bird.y + 3, 3.2, 0, Math.PI * 2);
    ctx.fill();
    // eye + beak
    ctx.fillStyle = '#3a352d';
    ctx.beginPath();
    ctx.arc(bird.x + 5, bird.y - 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2795a';
    ctx.beginPath();
    ctx.moveTo(bird.x + bird.r - 2, bird.y - 2);
    ctx.lineTo(bird.x + bird.r + 7, bird.y);
    ctx.lineTo(bird.x + bird.r - 2, bird.y + 3);
    ctx.closePath();
    ctx.fill();

    // Hint text
    ctx.fillStyle = 'rgba(58,53,45,.4)';
    ctx.font = '600 13px "Nunito", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('trigger → flap', W / 2, 28);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
