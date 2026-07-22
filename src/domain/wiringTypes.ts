import type { SignalKind } from './bus';

export type PortType = 'trigger' | 'value';
export type GameTargetId = 'flap' | 'restart' | 'speed' | 'position' | 'gravity';

export interface TargetPort {
  id: string;
  label: string;
  type: PortType;
  defaultValue?: number;
}

export interface GameTarget {
  id: GameTargetId;
  label: string;
  emoji: string;
  description: string;
  ports: TargetPort[];
}

export interface WireTarget {
  node: GameTargetId;
  port: string;
}

export interface TransformRange {
  min: number;
  max: number;
  invert: boolean;
}

export interface RangeTransform extends TransformRange {
  type: 'range';
  smoothing: number;
}

export interface EventTransform {
  type: 'event';
  cooldownMs: number;
}

export interface EdgeTransform {
  type: 'edge';
  edge: 'rising' | 'falling';
  cooldownMs: number;
}

export interface ThresholdTransform extends TransformRange {
  type: 'threshold';
  direction: 'above' | 'below';
  threshold: number;
  cooldownMs: number;
}

export interface ChangeTransform extends TransformRange {
  type: 'change';
  amount: number;
  cooldownMs: number;
}

export type WireTransform =
  | RangeTransform
  | EventTransform
  | EdgeTransform
  | ThresholdTransform
  | ChangeTransform;

export type TriggerTransform = Exclude<WireTransform, RangeTransform>;

export interface WireConnection {
  id: string;
  source: string;
  sourceKind: SignalKind;
  target: WireTarget;
  transform: WireTransform;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
