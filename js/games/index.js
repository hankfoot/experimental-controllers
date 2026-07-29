// The registry. There is one game — the sidescroller — and one entry here per
// control scheme, in the order the picker shows them. An entry's `targets` are
// the only ports it exposes to the wiring board, so the board never offers a
// control the current scheme doesn't actually use.
//
// Every entry provides:
//   id, label, emoji, scheme, tagline   presentation
//   rules                               at minimum { width, height }
//   targets                             wiring ports, fixed per control scheme
//   controls                            manual keyboard/button fallbacks
//   createEngine(random)                a BaseGame subclass instance
//   createRenderer(ctx, helpers, look)  returns render(state, now)

import { RULES, SCHEMES, SidescrollerGame, createRenderer } from './sidescroller.js';

export const GAMES = Object.freeze(SCHEMES.map((scheme) => Object.freeze({
  ...scheme,
  rules: RULES,
  createEngine: (random) => new SidescrollerGame(random, scheme.motion),
  createRenderer: (ctx, helpers, look) => createRenderer(ctx, helpers, scheme, look),
})));

export const DEFAULT_GAME_ID = GAMES[0].id;

export function findGame(id) {
  return GAMES.find((game) => game.id === id) ?? null;
}
