export interface GameActions {
  flap(options?: { magnitude?: number }): void;
  restartGame(): void;
  setGameSpeed(value: number): void;
  setGravity(value: number): void;
  setPosition(value: number): void;
  setPositionEnabled(enabled: boolean): void;
}
