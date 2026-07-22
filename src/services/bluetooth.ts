import { inputBus } from '../domain/bus';

const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

let device: BluetoothDevice | null = null;
let buffer = '';
const decoder = new TextDecoder();

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

export async function connectBluetooth(): Promise<void> {
  if (!isBluetoothSupported()) {
    const message = 'Web Bluetooth is not supported in this browser.';
    inputBus.emitStatus({ state: 'disconnected', message });
    throw new Error(message);
  }

  inputBus.emitStatus({ state: 'connecting' });
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [UART_SERVICE],
    });
    device.addEventListener('gattserverdisconnected', handleDisconnect);
    const server = await device.gatt?.connect();
    if (!server) throw new Error('Could not connect to the micro:bit.');
    const service = await server.getPrimaryService(UART_SERVICE);
    const transmitCharacteristic = await service.getCharacteristic(UART_TX);
    await transmitCharacteristic.startNotifications();
    transmitCharacteristic.addEventListener('characteristicvaluechanged', handleNotification);
    buffer = '';
    inputBus.emitStatus({ state: 'connected', message: device.name ?? 'micro:bit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    inputBus.emitStatus({ state: 'disconnected', message });
    throw error;
  }
}

export function disconnectBluetooth(): void {
  if (device?.gatt?.connected) device.gatt.disconnect();
}

export function parseProtocolLine(raw: string): void {
  const separator = raw.indexOf(':');
  if (separator <= 0) return;
  const channel = raw.slice(0, separator).trim().toLowerCase();
  const encodedValue = raw.slice(separator + 1).trim();
  const value = Number(encodedValue);
  if (!channel || !encodedValue || !Number.isFinite(value)) return;
  inputBus.emitInput({ channel, value, raw });
}

function handleDisconnect(): void {
  inputBus.emitStatus({ state: 'disconnected', message: 'micro:bit disconnected' });
}

function handleNotification(event: Event): void {
  const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
  if (!characteristic.value) return;
  buffer += decoder.decode(characteristic.value);
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) parseProtocolLine(line);
    newline = buffer.indexOf('\n');
  }
}
