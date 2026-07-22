import { ActionIcon, Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { GameEngine } from './gameEngine';
import { createGameRenderer } from './renderer';

interface GameCanvasProps {
  engine: GameEngine;
}

export function GameCanvas({ engine }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [summary, setSummary] = useState(() => ({
    phase: engine.state.phase,
    score: engine.state.score,
    best: engine.state.best,
  }));

  useEffect(() => engine.subscribe(() => setSummary({
    phase: engine.state.phase,
    score: engine.state.score,
    best: engine.state.best,
  })), [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createGameRenderer(canvas);
    if (!renderer) return;
    renderer.resize();

    let animationFrame = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      engine.update((now - previous) / 1000);
      previous = now;
      renderer.render(engine.state, now);
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    const resize = () => renderer.resize();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
    };
  }, [engine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest('button, a, input, select, textarea, [contenteditable="true"]');
      if ((event.code !== 'Space' && event.code !== 'ArrowUp') || event.repeat || interactive) return;
      event.preventDefault();
      engine.flap();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  const status = summary.phase === 'playing'
    ? 'Playing — keep the bird in the air.'
    : summary.phase === 'over'
      ? `Game over — score ${summary.score}. Flap to retry.`
      : 'Press Space, tap the game, or trigger your controller.';

  return (
    <Paper className="game-card" radius="lg" shadow="sm" withBorder>
      <Group justify="space-between" p="sm" wrap="nowrap">
        <Group gap="xs">
          <Badge size="lg" variant="light" color="blue">Score {summary.score}</Badge>
          <Badge size="lg" variant="light" color="yellow">Best {summary.best}</Badge>
        </Group>
        <ActionIcon
          aria-label="Reset game"
          title="Reset game"
          variant="subtle"
          color="gray"
          onClick={() => engine.reset()}
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        width="480"
        height="600"
        tabIndex={0}
        aria-label="Flappy Bird game. Press Space or tap to flap."
        onPointerDown={() => engine.flap()}
      />
      <Stack gap={6} p="sm">
        <Button size="md" fullWidth onClick={() => engine.flap()}>Flap</Button>
        <Text c="dimmed" size="sm" ta="center" aria-live="polite">{status}</Text>
      </Stack>
    </Paper>
  );
}
