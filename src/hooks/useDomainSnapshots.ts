import { useCallback, useSyncExternalStore } from 'react';
import type { Signal, SignalStore } from '../domain/signalStore';
import type { WireConnection } from '../domain/wiring';
import type { WiringEngine } from '../domain/wiring';

export function useSignals(store: SignalStore, enabled = true): Signal[] {
  useRevision(store, enabled);
  return store.all();
}

export function useConnections(engine: WiringEngine): WireConnection[] {
  useRevision(engine, true);
  return engine.listConnections();
}

function useRevision(source: {
  subscribe(listener: () => void): () => void;
  getRevision(): number;
}, enabled: boolean): void {
  const subscribe = useCallback(
    (listener: () => void) => enabled ? source.subscribe(listener) : () => {},
    [enabled, source],
  );
  const getSnapshot = useCallback(() => source.getRevision(), [source]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
