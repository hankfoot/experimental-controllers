import type { Signal } from './signalStore';
import type {
  GameTarget,
  TargetPort,
  WireTarget,
} from './wiringTypes';

export const GAME_TARGETS: GameTarget[] = [
  {
    id: 'flap', label: 'Flap', emoji: '🐤', description: 'Push the bird upward.',
    ports: [
      { id: 'trigger', label: 'When to flap', type: 'trigger' },
      { id: 'magnitude', label: 'Flap strength', type: 'value', defaultValue: 0.57 },
    ],
  },
  {
    id: 'restart', label: 'Restart', emoji: '↻', description: 'Start a fresh round.',
    ports: [{ id: 'trigger', label: 'When to restart', type: 'trigger' }],
  },
  {
    id: 'speed', label: 'Game speed', emoji: '💨', description: 'Set how quickly pipes move.',
    ports: [{ id: 'value', label: 'Speed', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'position', label: 'Bird position', emoji: '↕️', description: 'Steer height directly instead of flapping.',
    ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'gravity', label: 'Gravity', emoji: '🪨', description: 'Make the bird floaty or heavy.',
    ports: [{ id: 'value', label: 'Weight', type: 'value', defaultValue: 0.5 }],
  },
];

export function targetPort(target: WireTarget): TargetPort | null {
  return GAME_TARGETS.find((node) => node.id === target.node)?.ports.find(
    (port) => port.id === target.port,
  ) ?? null;
}

export function canConnect(signal: Signal | null, port: TargetPort | null): boolean {
  return Boolean(signal && port && (port.type === 'trigger' || signal.kind !== 'event'));
}
