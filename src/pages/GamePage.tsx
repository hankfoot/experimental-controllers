import { Container, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { WiringWorkbench } from '../components/WiringWorkbench';
import type { InputBus } from '../domain/bus';
import type { SignalStore } from '../domain/signalStore';
import { WiringEngine } from '../domain/wiring';
import { GameCanvas } from '../game/GameCanvas';
import { GameEngine } from '../game/gameEngine';

interface GamePageProps {
  signalStore: SignalStore;
  inputBus: InputBus;
}

export function GamePage({ signalStore, inputBus }: GamePageProps) {
  const [{ game, wiring }] = useState(() => {
    const gameEngine = new GameEngine();
    return { game: gameEngine, wiring: new WiringEngine(signalStore, gameEngine) };
  });

  useEffect(() => wiring.start(), [wiring]);

  return (
    <Container size="xl" py="xl">
      <Stack gap={4} mb="lg">
        <Title order={1}>Wire it. Play it.</Title>
        <Text c="dimmed" size="lg">
          Pick an input, choose what it controls, and test it immediately in the game.
        </Text>
      </Stack>
      <div className="game-layout">
        <div className="wiring-pane">
          <WiringWorkbench signalStore={signalStore} engine={wiring} inputBus={inputBus} />
        </div>
        <aside className="game-pane" aria-label="Game preview">
          <GameCanvas engine={game} />
        </aside>
      </div>
    </Container>
  );
}
