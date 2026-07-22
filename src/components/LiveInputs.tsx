import {
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Progress,
  Slider,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import type { InputBus } from '../domain/bus';
import type { SignalStore } from '../domain/signalStore';
import { useSignals } from '../hooks/useDomainSnapshots';

interface LiveInputsProps {
  opened: boolean;
  onClose(): void;
  signalStore: SignalStore;
  inputBus: InputBus;
}

export function LiveInputs({ opened, onClose, signalStore, inputBus }: LiveInputsProps) {
  const signals = useSignals(signalStore, opened).filter((signal) => signal.live);

  return (
    <Drawer opened={opened} onClose={onClose} title="Live controller input" position="right" size="md">
      <Stack>
        {signals.length === 0 && (
          <Text c="dimmed" size="sm">
            No readings yet. Connect a micro:bit or use the test controls below.
          </Text>
        )}
        {signals.map((signal) => {
          const normalized = signal.value == null
            ? 0
            : Math.max(0, Math.min(100, ((signal.value - signal.min) / (signal.max - signal.min || 1)) * 100));
          return (
            <Group key={signal.channel} wrap="nowrap" align="center">
              <ThemeIcon variant="light" color="gray" size="lg">{signal.emoji}</ThemeIcon>
              <div style={{ flex: 1 }}>
                <Group justify="space-between" gap="xs">
                  <Text fw={600} size="sm">{signal.label}</Text>
                  <Badge variant="light" color={signal.kind === 'event' ? 'grape' : signal.kind === 'binary' ? 'teal' : 'blue'}>
                    {signal.value ?? '—'}
                  </Badge>
                </Group>
                {signal.kind === 'number' && <Progress value={normalized} mt={6} size="sm" />}
                <Text c="dimmed" size="xs"><code>{signal.channel}</code> · {signal.kind}</Text>
              </div>
            </Group>
          );
        })}
        <Divider label="Test without a micro:bit" labelPosition="center" />
        <Group grow>
          <Button
            variant="light"
            onPointerDown={() => inputBus.emitInput({ channel: 'btna', value: 1 })}
            onPointerUp={() => inputBus.emitInput({ channel: 'btna', value: 0 })}
            onPointerLeave={(event) => {
              if (event.buttons) inputBus.emitInput({ channel: 'btna', value: 0 });
            }}
          >
            Hold Button A
          </Button>
          <Button variant="light" onClick={() => inputBus.emitInput({ channel: 'shake', value: 1 })}>
            Send shake
          </Button>
        </Group>
        <div>
          <Text size="sm" fw={600} mb={6}>Light level</Text>
          <Slider
            min={0}
            max={255}
            label={(value) => value}
            onChange={(value) => inputBus.emitInput({ channel: 'light', value })}
          />
        </div>
      </Stack>
    </Drawer>
  );
}
