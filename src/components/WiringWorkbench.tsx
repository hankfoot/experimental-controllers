import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowRight, IconPlugConnected, IconTrash } from '@tabler/icons-react';
import { useEffect, useReducer, useState } from 'react';
import { inputBus } from '../domain/bus';
import type { Signal, SignalStore } from '../domain/signalStore';
import {
  canConnect,
  type GameTarget,
  type WireConnection,
  type WireTarget,
  WiringEngine,
} from '../domain/wiring';
import { ConnectionEditor, connectionSummary } from './ConnectionEditor';

interface WiringWorkbenchProps {
  signalStore: SignalStore;
  engine: WiringEngine;
}

function formatValue(value: number | null): string {
  if (value == null) return 'waiting';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sourceStatus(signal: Signal): string {
  if (signal.live) return 'live';
  if (signal.planned) return 'from builder';
  return 'saved';
}

export function WiringWorkbench({ signalStore, engine }: WiringWorkbenchProps) {
  const [, rerender] = useReducer((value) => value + 1, 0);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [message, setMessage] = useState('Choose an input, then choose what it should control.');
  const [clearOpened, setClearOpened] = useState(false);

  useEffect(() => signalStore.subscribe(() => rerender()), [signalStore]);
  useEffect(() => engine.subscribe(() => rerender()), [engine]);

  const signals = signalStore.all().sort((left, right) => {
    const rank = (signal: Signal) => Number(signal.live) * 2 + Number(signal.planned);
    return rank(right) - rank(left) || left.label.localeCompare(right.label);
  });
  const connections = engine.listConnections();
  const selected = selectedSource ? signalStore.get(selectedSource) : null;

  const connect = (source: string, target: WireTarget) => {
    const connection = engine.addConnection(source, target);
    if (!connection) {
      setMessage('That input cannot feed this value control. Try a button-like action instead.');
      return;
    }
    const node = engine.targets.find((item) => item.id === target.node);
    const port = node?.ports.find((item) => item.id === target.port);
    setMessage(`${signalStore.get(source)?.label ?? source} is now wired to ${node?.label} · ${port?.label}.`);
    setSelectedSource(null);
  };

  return (
    <Paper radius="lg" p={{ base: 'md', sm: 'lg' }} withBorder>
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2} size="h3">Wire your controller</Title>
          <Text c="dimmed" size="sm">Tap an input and a game control. You can also drag on desktop.</Text>
        </div>
        {connections.length > 0 && (
          <Button color="red" variant="subtle" size="xs" onClick={() => setClearOpened(true)}>Clear all</Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Stack gap="xs">
          <Group gap="xs"><Badge circle>1</Badge><Text fw={700}>Choose an input</Text></Group>
          {signals.length === 0 ? (
            <Alert color="blue" title="No inputs yet">
              Choose inputs on the Controller page, connect a micro:bit, or{' '}
              <Button
                variant="transparent"
                size="compact-sm"
                px={3}
                onClick={() => {
                  inputBus.emitInput({ channel: 'btna', value: 0 });
                  inputBus.emitInput({ channel: 'light', value: 0 });
                }}
              >
                add test inputs
              </Button>.
            </Alert>
          ) : signals.map((signal) => (
            <UnstyledButton
              key={signal.channel}
              className="signal-source"
              data-selected={selectedSource === signal.channel}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', signal.channel)}
              onClick={() => {
                setSelectedSource(selectedSource === signal.channel ? null : signal.channel);
                setMessage(`Now choose what ${signal.label} should control.`);
              }}
            >
              <Group wrap="nowrap">
                <ThemeIcon variant="light" color="gray" size="lg">{signal.emoji}</ThemeIcon>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={650} size="sm" truncate>{signal.label}</Text>
                  <Text c="dimmed" size="xs"><code>{signal.channel}</code> · {sourceStatus(signal)}</Text>
                </Box>
                <Badge color={signal.live ? 'teal' : 'gray'} variant="light">{formatValue(signal.value)}</Badge>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>

        <Stack gap="xs">
          <Group gap="xs"><Badge circle>2</Badge><Text fw={700}>Choose a game control</Text></Group>
          {engine.targets.map((target) => (
            <TargetCard
              key={target.id}
              target={target}
              selected={selected}
              connectionCounts={connections}
              onConnect={(wireTarget, draggedSource) => connect(draggedSource ?? selectedSource ?? '', wireTarget)}
            />
          ))}
        </Stack>
      </SimpleGrid>

      <Alert mt="lg" color={message.startsWith('That') ? 'orange' : 'blue'} icon={<IconPlugConnected size={18} />}>
        {message}
      </Alert>

      <Divider my="lg" label={`Connections · ${connections.length}`} labelPosition="left" />
      {connections.length === 0 ? (
        <Text c="dimmed" size="sm">Nothing wired yet. The keyboard, game tap, and Flap button still work.</Text>
      ) : (
        <Accordion variant="separated" radius="md">
          {connections.map((connection) => {
            const target = engine.targets.find((item) => item.id === connection.target.node);
            const port = target?.ports.find((item) => item.id === connection.target.port);
            const signal = signalStore.get(connection.source);
            return (
              <Accordion.Item key={connection.id} value={connection.id}>
                <Accordion.Control>
                  <Group gap="xs" wrap="nowrap">
                    <Text>{signal?.emoji ?? '📡'}</Text>
                    <Text size="sm" fw={650}>{signal?.label ?? connection.source}</Text>
                    <IconArrowRight size={14} />
                    <Text size="sm">{target?.emoji} {target?.label}</Text>
                    <Badge variant="light" color="gray" visibleFrom="xs">{connectionSummary(connection.transform)}</Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Group justify="space-between" mb="sm">
                    <Text size="xs" c="dimmed">{port?.label} · settings apply immediately</Text>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Remove connection"
                      onClick={() => engine.removeConnection(connection.id)}
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                  <ConnectionEditor connection={connection} signal={signal} engine={engine} />
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <Modal opened={clearOpened} onClose={() => setClearOpened(false)} title="Clear all wiring?" centered>
        <Text size="sm">This removes every connection. Your controller inputs remain available.</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setClearOpened(false)}>Cancel</Button>
          <Button color="red" onClick={() => { engine.reset(); setClearOpened(false); }}>Clear wiring</Button>
        </Group>
      </Modal>
    </Paper>
  );
}

function TargetCard({ target, selected, connectionCounts, onConnect }: {
  target: GameTarget;
  selected: Signal | null;
  connectionCounts: WireConnection[];
  onConnect(target: WireTarget, source?: string): void;
}) {
  return (
    <Card radius="md" padding="sm" withBorder>
      <Group gap="xs" mb={4} wrap="nowrap">
        <Text fz="lg">{target.emoji}</Text>
        <div>
          <Text fw={650} size="sm">{target.label}</Text>
          <Text c="dimmed" size="xs">{target.description}</Text>
        </div>
      </Group>
      <Group gap="xs" mt="sm">
        {target.ports.map((port) => {
          const compatible = selected ? canConnect(selected, port) : true;
          const count = connectionCounts.filter(
            (connection) => connection.target.node === target.id && connection.target.port === port.id,
          ).length;
          return (
            <Button
              key={port.id}
              className="target-port"
              size="compact-sm"
              variant={count > 0 ? 'light' : 'default'}
              color={compatible ? 'blue' : 'gray'}
              disabled={Boolean(selected) && !compatible}
              onClick={() => selected && onConnect({ node: target.id, port: port.id })}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData('text/plain');
                if (source) onConnect({ node: target.id, port: port.id }, source);
              }}
            >
              {port.label}{count > 0 ? ` · ${count}` : ''}
            </Button>
          );
        })}
      </Group>
    </Card>
  );
}
