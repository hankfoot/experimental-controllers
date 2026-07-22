import { Center, Container, Loader, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { WiringWorkbench } from '../components/WiringWorkbench';
import type { SignalStore } from '../domain/signalStore';
import { WiringEngine } from '../domain/wiring';
import { GameCanvas } from '../game/GameCanvas';
import { GameEngine } from '../game/gameEngine';

interface GamePageProps {
  signalStore: SignalStore;
}

export function GamePage({ signalStore }: GamePageProps) {
  const [game] = useState(() => new GameEngine());
  const [wiring, setWiring] = useState<WiringEngine | null>(null);

  useEffect(() => {
    const engine = new WiringEngine(signalStore, game);
    setWiring(engine);
    return () => engine.destroy();
  }, [game, signalStore]);

  return (
    <Container size="xl" py="xl">
      <Stack gap={4} mb="lg">
        <Title order={1}>Wire it. Play it.</Title>
        <Text c="dimmed" size="lg">
          Pick an input, choose what it controls, and test it immediately in the game.
        </Text>
      </Stack>
      {wiring ? (
        <div className="game-layout">
          <div className="wiring-pane">
            <WiringWorkbench signalStore={signalStore} engine={wiring} />
          </div>
          <aside className="game-pane" aria-label="Game preview">
            <GameCanvas engine={game} />
          </aside>
        </div>
      ) : (
        <Center mih={420}><Loader /></Center>
      )}
    </Container>
  );
}
