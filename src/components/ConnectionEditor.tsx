import {
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { IconWand } from '@tabler/icons-react';
import type { Signal } from '../domain/signalStore';
import type {
  EdgeTransform,
  EventTransform,
  RangeTransform,
  ThresholdTransform,
  WireConnection,
  WireTransform,
} from '../domain/wiring';
import type { WiringEngine } from '../domain/wiring';

interface ConnectionEditorProps {
  connection: WireConnection;
  signal: Signal | null;
  engine: WiringEngine;
}

export function ConnectionEditor({ connection, signal, engine }: ConnectionEditorProps) {
  const update = (transform: WireTransform) => engine.updateConnection(connection.id, transform);
  const transform = connection.transform;

  if (transform.type === 'range') {
    const set = (patch: Partial<RangeTransform>) => update({ ...transform, ...patch });
    const hasLiveRange = signal?.observedMin != null
      && signal.observedMax != null
      && signal.observedMin !== signal.observedMax;
    return (
      <Stack gap="sm">
        <RangeInputs transform={transform} onChange={set} />
        <Button
          size="xs"
          variant="light"
          leftSection={<IconWand size={15} />}
          disabled={!hasLiveRange}
          onClick={() => {
            if (signal?.observedMin == null || signal.observedMax == null) return;
            set({ min: signal.observedMin, max: signal.observedMax });
          }}
        >
          Use observed range
        </Button>
        <Switch label="Reverse direction" checked={transform.invert} onChange={(event) => set({ invert: event.currentTarget.checked })} />
        <div>
          <Group justify="space-between">
            <Text size="sm">Smoothing</Text>
            <Text size="sm" c="dimmed">{Math.round(transform.smoothing * 100)}%</Text>
          </Group>
          <Slider min={0} max={0.9} step={0.05} value={transform.smoothing} onChange={(smoothing) => set({ smoothing })} />
        </div>
      </Stack>
    );
  }

  if (transform.type === 'event') {
    const set = (patch: Partial<EventTransform>) => update({ ...transform, ...patch });
    return <Cooldown value={transform.cooldownMs} onChange={(cooldownMs) => set({ cooldownMs })} />;
  }

  if (transform.type === 'edge') {
    const set = (patch: Partial<EdgeTransform>) => update({ ...transform, ...patch });
    return (
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={transform.edge}
          data={[{ value: 'rising', label: 'On press' }, { value: 'falling', label: 'On release' }]}
          onChange={(edge) => set({ edge: edge as EdgeTransform['edge'] })}
        />
        <Cooldown value={transform.cooldownMs} onChange={(cooldownMs) => set({ cooldownMs })} />
      </Stack>
    );
  }

  const setRange = (patch: { min?: number; max?: number }) => update({ ...transform, ...patch });
  const changeMode = (next: string | null) => {
    const range = { min: transform.min, max: transform.max, invert: transform.invert };
    if (next === 'change') {
      update({ type: 'change', ...range, amount: 0.2, cooldownMs: transform.cooldownMs });
    } else if (next === 'threshold') {
      update({ type: 'threshold', ...range, direction: 'above', threshold: 0.5, cooldownMs: transform.cooldownMs });
    }
  };

  return (
    <Stack gap="sm">
      <Select
        label="Trigger when"
        value={transform.type}
        data={[{ value: 'threshold', label: 'Crosses a level' }, { value: 'change', label: 'Changes suddenly' }]}
        onChange={changeMode}
      />
      <RangeInputs transform={transform} onChange={setRange} />
      <Switch
        label="Reverse direction"
        checked={transform.invert}
        onChange={(event) => update({ ...transform, invert: event.currentTarget.checked })}
      />
      {transform.type === 'threshold' ? (
        <>
          <SegmentedControl
            fullWidth
            value={transform.direction}
            data={[{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]}
            onChange={(direction) => update({ ...transform, direction: direction as ThresholdTransform['direction'] })}
          />
          <div>
            <Text size="sm" mb={4}>Level: {Math.round(transform.threshold * 100)}%</Text>
            <Slider min={0.05} max={0.95} step={0.05} value={transform.threshold} onChange={(threshold) => update({ ...transform, threshold })} />
          </div>
        </>
      ) : (
        <div>
          <Text size="sm" mb={4}>Minimum change: {Math.round(transform.amount * 100)}%</Text>
          <Slider min={0.05} max={1} step={0.05} value={transform.amount} onChange={(amount) => update({ ...transform, amount })} />
        </div>
      )}
      <Cooldown value={transform.cooldownMs} onChange={(cooldownMs) => update({ ...transform, cooldownMs })} />
    </Stack>
  );
}

function RangeInputs({ transform, onChange }: {
  transform: { min: number; max: number };
  onChange(patch: { min?: number; max?: number }): void;
}) {
  return (
    <SimpleGrid cols={2}>
      <NumberInput label="Raw minimum" value={transform.min} onChange={(value) => onChange({ min: Number(value) })} />
      <NumberInput label="Raw maximum" value={transform.max} onChange={(value) => onChange({ max: Number(value) })} />
    </SimpleGrid>
  );
}

function Cooldown({ value, onChange }: { value: number; onChange(value: number): void }) {
  return (
    <NumberInput
      label="Cooldown (milliseconds)"
      description="Ignores repeat triggers briefly"
      min={0}
      max={5000}
      step={50}
      value={value}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

export function connectionSummary(transform: WireTransform): string {
  if (transform.type === 'range') return 'continuous value';
  if (transform.type === 'event') return 'every event';
  if (transform.type === 'edge') return transform.edge === 'rising' ? 'on press' : 'on release';
  if (transform.type === 'change') return `changes ${Math.round(transform.amount * 100)}%`;
  return `${transform.direction} ${Math.round(transform.threshold * 100)}%`;
}
