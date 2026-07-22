import { describe, expect, it, vi } from 'vitest';
import { InputBus } from '../src/domain/bus';
import { SignalStore } from '../src/domain/signalStore';
import {
  type GameActions,
  type StorageLike,
  WiringEngine,
} from '../src/domain/wiring';

function setup(storage: StorageLike | null = null) {
  let now = 0;
  const bus = new InputBus();
  const signals = new SignalStore(bus, () => now);
  const actions: GameActions = {
    flap: vi.fn(),
    restartGame: vi.fn(),
    setGameSpeed: vi.fn(),
    setGravity: vi.fn(),
    setPosition: vi.fn(),
    setPositionEnabled: vi.fn(),
  };
  const wiring = new WiringEngine(signals, actions, { storage });
  wiring.start();
  return {
    actions,
    bus,
    signals,
    wiring,
    emit(channel: string, value: number, time = now + 200) {
      now = time;
      bus.emitInput({ channel, value });
    },
  };
}

describe('WiringEngine', () => {
  it('updates values before firing same-sample triggers regardless of wire order', () => {
    const context = setup();
    context.emit('light', 0);
    context.wiring.addConnection('light', { node: 'flap', port: 'trigger' });
    context.wiring.addConnection('light', { node: 'flap', port: 'magnitude' });

    context.emit('light', 0);
    context.emit('light', 255);

    expect(context.actions.flap).toHaveBeenCalledOnce();
    expect(context.actions.flap).toHaveBeenCalledWith({ magnitude: 1 });
  });

  it('migrates binary transforms and persisted source metadata when a custom signal becomes numeric', () => {
    const saved = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    };
    const context = setup(storage);
    context.emit('custom', 0);
    context.wiring.addConnection('custom', { node: 'flap', port: 'trigger' });
    context.wiring.addConnection('custom', { node: 'speed', port: 'value' });

    context.emit('custom', 200);
    const [trigger, value] = context.wiring.listConnections();

    expect(trigger.sourceKind).toBe('number');
    expect(trigger.transform).toMatchObject({ type: 'threshold', min: 0, max: 200 });
    expect(value.sourceKind).toBe('number');
    expect(value.transform).toMatchObject({ type: 'range', min: 0, max: 200 });
    expect(context.actions.setGameSpeed).toHaveBeenLastCalledWith(1);
    expect(saved.values().next().value).toContain('"sourceKind":"number"');
  });

  it('supports numeric threshold crossings with a per-wire cooldown', () => {
    const context = setup();
    context.emit('light', 0, 0);
    context.wiring.addConnection('light', { node: 'restart', port: 'trigger' });
    context.emit('light', 0, 100);
    context.emit('light', 255, 200);
    context.emit('light', 0, 250);
    context.emit('light', 255, 300);
    context.emit('light', 0, 500);
    context.emit('light', 255, 700);
    expect(context.actions.restartGame).toHaveBeenCalledTimes(2);
  });

  it('can trigger on every repeated binary event sample', () => {
    const context = setup();
    context.emit('custom', 1, 0);
    const connection = context.wiring.addConnection('custom', { node: 'flap', port: 'trigger' });
    expect(connection).not.toBeNull();
    context.wiring.updateConnection(connection!.id, { type: 'event', cooldownMs: 160 });

    context.emit('custom', 1, 200);
    context.emit('custom', 1, 400);

    expect(context.actions.flap).toHaveBeenCalledTimes(2);
  });

  it('rejects event signals for continuous value ports', () => {
    const context = setup();
    context.emit('shake', 1);
    expect(context.wiring.addConnection('shake', { node: 'speed', port: 'value' })).toBeNull();
  });

  it('does not reacquire position mode when unrelated wiring changes', () => {
    const context = setup();
    context.emit('btna', 0);
    context.wiring.addConnection('btna', { node: 'flap', port: 'trigger' });
    context.wiring.addConnection('btna', { node: 'restart', port: 'trigger' });
    expect(context.actions.setPositionEnabled).toHaveBeenCalledTimes(1);
    expect(context.actions.setPositionEnabled).toHaveBeenCalledWith(false);
  });

  it('rejects transforms that do not match the target port', () => {
    const context = setup();
    context.emit('btna', 0);
    const connection = context.wiring.addConnection('btna', { node: 'flap', port: 'trigger' });
    expect(connection).not.toBeNull();

    context.wiring.updateConnection(connection!.id, {
      type: 'range', min: 0, max: 1, invert: false, smoothing: 0,
    });

    expect(context.wiring.listConnections()[0].transform.type).toBe('edge');
  });

  it('restores valid saved wires and ignores malformed entries', () => {
    const stored = JSON.stringify({
      version: 1,
      connections: [
        {
          id: 'valid',
          source: 'btna',
          sourceKind: 'binary',
          target: { node: 'flap', port: 'trigger' },
          transform: { type: 'edge', edge: 'rising', cooldownMs: 160 },
        },
        {
          id: 'invalid',
          source: 'light',
          sourceKind: 'number',
          target: { node: 'speed', port: 'value' },
          transform: { type: 'range', min: 'oops', max: 255, invert: false, smoothing: 0 },
        },
      ],
    });
    const storage: StorageLike = { getItem: () => stored, setItem: vi.fn() };
    const context = setup(storage);
    expect(context.wiring.listConnections().map(({ id }) => id)).toEqual(['valid']);
  });

  it('migrates early v1 numeric triggers that omitted invert', () => {
    const stored = JSON.stringify({
      version: 1,
      connections: [
        {
          id: 'threshold',
          source: 'light',
          sourceKind: 'number',
          target: { node: 'flap', port: 'trigger' },
          transform: {
            type: 'threshold', min: 0, max: 255, direction: 'above', threshold: 0.5, cooldownMs: 160,
          },
        },
        {
          id: 'change',
          source: 'pitch',
          sourceKind: 'number',
          target: { node: 'restart', port: 'trigger' },
          transform: { type: 'change', min: 0, max: 360, amount: 0.2, cooldownMs: 160 },
        },
      ],
    });
    const context = setup({ getItem: () => stored, setItem: vi.fn() });

    expect(context.wiring.listConnections().map(({ transform }) => transform)).toMatchObject([
      { type: 'threshold', invert: false },
      { type: 'change', invert: false },
    ]);
  });

  it('reconciles saved source kinds with authoritative channel metadata', () => {
    const stored = JSON.stringify({
      version: 1,
      connections: [{
        id: 'shake-wire',
        source: 'shake',
        sourceKind: 'binary',
        target: { node: 'flap', port: 'trigger' },
        transform: { type: 'edge', edge: 'rising', cooldownMs: 160 },
      }],
    });
    const storage: StorageLike = { getItem: () => stored, setItem: vi.fn() };
    const context = setup(storage);

    expect(context.wiring.listConnections()[0]).toMatchObject({
      sourceKind: 'event',
      transform: { type: 'event', cooldownMs: 160 },
    });
    expect(storage.setItem).toHaveBeenCalled();
  });
});

it('falls back to memory when reading global localStorage throws', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new DOMException('blocked', 'SecurityError'); },
  });

  try {
    const bus = new InputBus();
    const signals = new SignalStore(bus, () => 0);
    const actions = {
      flap: vi.fn(), restartGame: vi.fn(), setGameSpeed: vi.fn(), setGravity: vi.fn(),
      setPosition: vi.fn(), setPositionEnabled: vi.fn(),
    };
    expect(() => new WiringEngine(signals, actions)).not.toThrow();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
