export type SignalKind = 'event' | 'binary' | 'number';

export interface InputMessage {
  channel: string;
  value: number;
  raw?: string;
}

export interface ConnectionStatus {
  state: 'disconnected' | 'connecting' | 'connected';
  message?: string;
}

type Unsubscribe = () => void;

export class InputBus {
  private readonly inputListeners = new Set<(message: InputMessage) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  emitInput(message: InputMessage): void {
    this.inputListeners.forEach((listener) => listener(message));
  }

  onInput(listener: (message: InputMessage) => void): Unsubscribe {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }

  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
}

export const inputBus = new InputBus();
