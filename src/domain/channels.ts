import type { SignalKind } from './bus';

export interface ChannelMetadata {
  label: string;
  emoji: string;
  kind?: SignalKind;
  min?: number;
  max?: number;
}

export const CHANNELS: Readonly<Record<string, ChannelMetadata>> = {
  btna: { label: 'Button A', emoji: '🔘', kind: 'binary' },
  btnb: { label: 'Button B', emoji: '🔘', kind: 'binary' },
  logo: { label: 'Logo touch', emoji: '⭐', kind: 'binary' },
  p0: { label: 'Pin 0', emoji: '🔌', max: 1023 },
  p1: { label: 'Pin 1', emoji: '🔌', max: 1023 },
  p2: { label: 'Pin 2', emoji: '🔌', max: 1023 },
  light: { label: 'Light', emoji: '💡', kind: 'number', max: 255 },
  temp: { label: 'Temperature', emoji: '🌡️', kind: 'number', min: 0, max: 50 },
  mic: { label: 'Sound', emoji: '🎤', kind: 'number', max: 255 },
  pitch: { label: 'Pitch', emoji: '📐', kind: 'number', min: -90, max: 90 },
  roll: { label: 'Roll', emoji: '📐', kind: 'number', min: -180, max: 180 },
  heading: { label: 'Compass', emoji: '🧭', kind: 'number', max: 360 },
  shake: { label: 'Shake', emoji: '🫨', kind: 'event' },
  tiltleft: { label: 'Tilt left', emoji: '👈', kind: 'event' },
  tiltright: { label: 'Tilt right', emoji: '👉', kind: 'event' },
  logoup: { label: 'Logo up', emoji: '🙂', kind: 'event' },
  logodown: { label: 'Logo down', emoji: '🙃', kind: 'event' },
  faceup: { label: 'Face up', emoji: '🔆', kind: 'event' },
  facedown: { label: 'Face down', emoji: '🌙', kind: 'event' },
  freefall: { label: 'Free fall', emoji: '🪂', kind: 'event' },
  g3: { label: 'Small bump', emoji: '💥', kind: 'event' },
  g6: { label: 'Hard hit', emoji: '💥', kind: 'event' },
  g8: { label: 'Big slam', emoji: '💥', kind: 'event' },
};

export function channelInfo(channel: string): ChannelMetadata {
  return CHANNELS[channel] ?? { label: channel, emoji: '📡' };
}

export function isBinaryValue(value: number): boolean {
  return value === 0 || value === 1;
}

export function inferChannelKind(channel: string, value: number): SignalKind {
  return channelInfo(channel).kind ?? (isBinaryValue(value) ? 'binary' : 'number');
}
