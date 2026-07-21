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

    // Sky
    ctx.clearRect(0, 0, W, H);

    // Ground strip
    ctx.fillStyle = '#8bd07a';
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = '#79c268';
    ctx.fillRect(0, H - 22, W, 5);

    // Bird
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.strokeStyle = '#e0a800';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eye + beak
    ctx.fillStyle = '#1c1b29';
    ctx.beginPath();
    ctx.arc(bird.x + 5, bird.y - 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef8a17';
    ctx.beginPath();
    ctx.moveTo(bird.x + bird.r - 2, bird.y - 2);
    ctx.lineTo(bird.x + bird.r + 7, bird.y);
    ctx.lineTo(bird.x + bird.r - 2, bird.y + 3);
    ctx.closePath();
    ctx.fill();

    // Hint text
    ctx.fillStyle = 'rgba(28,27,41,.5)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('trigger → flap', W / 2, 26);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
