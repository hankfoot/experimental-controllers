// What everything this site saves is filed under.
//
// One owner, because the alternative is what this replaced: eleven copies of
// the same string spread across js/ and js/theme/, two of which had already
// drifted into being typed out twice for the same record.
//
// IMPORTANT: nothing may ever be added to this file that imports anything.
// Having no imports is what lets js/theme/* reach up to a module in its parent
// directory without any possibility of a cycle — which is the only reason this
// can be one file rather than one per directory.
//
// The names below are what a *current* build reads and writes. Anything that
// has to name an older namespace — the migration, the bundle format — spells it
// out literally at the point of use, so a future rename cannot silently rewrite
// history it was supposed to leave alone.

export const NAMESPACE = 'game-controller-workshop';

/** `key('wiring', 'v3')` → `game-controller-workshop:wiring:v3`. */
export const key = (...parts) => [NAMESPACE, ...parts].join(':');
