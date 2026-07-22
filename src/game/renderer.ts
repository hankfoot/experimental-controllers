import { GAME_RULES, type GameState, type Pipe } from './gameEngine';

export interface GameRenderer {
  render(game: GameState, now: number): void;
  resize(): void;
}

export function createGameRenderer(canvas: HTMLCanvasElement): GameRenderer | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const ctx = context;
  const { width, height, groundY, birdX, birdRadius, pipeWidth, pipeGap } = GAME_RULES;

  function resize(): void {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function roundedRect(x: number, y: number, w: number, h: number, radius: number): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
  }

  function drawCloud(x: number, y: number, scale: number): void {
    ctx.fillStyle = 'rgba(255, 255, 255, .8)';
    ctx.beginPath();
    ctx.arc(x, y, 22 * scale, 0, Math.PI * 2);
    ctx.arc(x + 24 * scale, y - 8 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.arc(x + 53 * scale, y, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(): void {
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#eaf1ff');
    sky.addColorStop(1, '#f4fbf5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);
    drawCloud(40, 105, 0.8);
    drawCloud(330, 175, 0.65);
    ctx.fillStyle = '#dff1d7';
    ctx.beginPath();
    ctx.moveTo(0, 475);
    ctx.quadraticCurveTo(90, 410, 180, 475);
    ctx.quadraticCurveTo(300, 395, 480, 475);
    ctx.lineTo(width, groundY);
    ctx.lineTo(0, groundY);
    ctx.fill();
  }

  function paintPipe(x: number, y: number, w: number, h: number, radius: number): void {
    roundedRect(x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();
  }

  function drawPipe(pipe: Pipe): void {
    const gapTop = pipe.gapY - pipeGap / 2;
    const gapBottom = pipe.gapY + pipeGap / 2;
    ctx.fillStyle = '#34b24a';
    ctx.strokeStyle = '#238b37';
    ctx.lineWidth = 3;
    paintPipe(pipe.x, -8, pipeWidth, gapTop + 8, 6);
    paintPipe(pipe.x - 6, gapTop - 22, pipeWidth + 12, 24, 5);
    paintPipe(pipe.x, gapBottom, pipeWidth, groundY - gapBottom + 8, 6);
    paintPipe(pipe.x - 6, gapBottom - 2, pipeWidth + 12, 24, 5);
  }

  function drawGround(): void {
    ctx.fillStyle = '#f4d35e';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#d8b53d';
    ctx.fillRect(0, groundY, width, 9);
    ctx.strokeStyle = 'rgba(165, 118, 15, .28)';
    ctx.lineWidth = 2;
    for (let x = -30; x < width + 30; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 10);
      ctx.lineTo(x + 28, groundY + 38);
      ctx.stroke();
    }
  }

  function drawBird(game: GameState, now: number): void {
    const { bird, phase } = game;
    const y = phase === 'ready' ? bird.y + Math.sin(now / 260) * 6 : bird.y;
    const angle = phase === 'ready' ? -0.08 : Math.max(-0.45, Math.min(1.15, bird.velocity / 650));
    ctx.save();
    ctx.translate(birdX, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#f4b400';
    ctx.strokeStyle = '#a5760f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, birdRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff6df';
    ctx.beginPath();
    ctx.ellipse(-9, 5, 10, 7, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(7, -6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1c20';
    ctx.beginPath();
    ctx.arc(9, -6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(28, 5);
    ctx.lineTo(13, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawOverlay(game: GameState): void {
    if (game.phase === 'playing') return;
    ctx.fillStyle = 'rgba(255, 255, 255, .93)';
    roundedRect(74, 190, 332, 130, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(27, 28, 32, .09)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1b1c20';
    ctx.font = '700 25px Outfit, sans-serif';
    ctx.fillText(game.phase === 'over' ? 'Game over' : 'Ready?', width / 2, 234);
    ctx.fillStyle = '#666b74';
    ctx.font = '500 16px Outfit, sans-serif';
    ctx.fillText(
      game.phase === 'over' ? `Score: ${game.score} · Flap to retry` : 'Space, tap, or use your controller',
      width / 2,
      272,
    );
    if (game.phase === 'ready') ctx.fillText('Fly through the gaps.', width / 2, 298);
  }

  return {
    resize,
    render(game, now) {
      ctx.clearRect(0, 0, width, height);
      drawBackground();
      game.pipes.forEach(drawPipe);
      drawGround();
      drawBird(game, now);
      drawOverlay(game);
    },
  };
}
