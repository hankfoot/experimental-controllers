export const GAME_TARGETS = [
  {
    id: 'flap', label: 'Flap', emoji: '🐤', description: 'Give the bird an upward push.',
    ports: [
      { id: 'trigger', label: 'Trigger', type: 'trigger' },
      { id: 'magnitude', label: 'Strength', type: 'value', defaultValue: 0.57 },
    ],
  },
  {
    id: 'restart', label: 'Restart game', emoji: '↻', description: 'Start immediately from the beginning.',
    ports: [{ id: 'trigger', label: 'Trigger', type: 'trigger' }],
  },
  {
    id: 'speed', label: 'Game speed', emoji: '💨', description: 'Control how quickly the pipes move.',
    ports: [{ id: 'value', label: 'Speed', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'position', label: 'Bird position', emoji: '↕️', description: 'Direct steering from top to bottom; replaces flap physics.',
    ports: [{ id: 'y', label: 'Height', type: 'value', defaultValue: 0.5 }],
  },
  {
    id: 'gravity', label: 'Gravity', emoji: '🪨', description: 'Make flap controls floaty or heavy.',
    ports: [{ id: 'value', label: 'Weight', type: 'value', defaultValue: 0.5 }],
  },
];

export function targetPort(target) {
  return GAME_TARGETS.find((node) => node.id === target?.node)
    ?.ports.find((port) => port.id === target?.port) ?? null;
}

export function canConnect(signal, port) {
  return Boolean(signal && port && (port.type === 'trigger' || signal.kind !== 'event'));
}
