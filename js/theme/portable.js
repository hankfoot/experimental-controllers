// A whole game, in one file. What you get out is everything that makes your copy
// yours: the drawings and the sounds, the words on the cards, the course you set
// up, the inputs you picked on Sensing, and the wiring you made on Controls.
//
// It used to be only the look and the course, which made a bundle a strange
// half-gift — the game arrived looking exactly right and answering to nothing,
// because the controller had been left behind.
//
// Assets travel inline as base64. It makes for a fat file and a single one,
// which is the right trade for something people mail to each other.

import { normalizeAsset } from './assets.js';
import { normalizeTheme } from './theme-store.js';
import { referencedAssets } from './images.js';
import { SLOT_IDS } from './defaults.js';
import { key } from '../storage-keys.js';

export const BUNDLE_KIND = key('theme');
const BUNDLE_VERSION = 1;

// What a file is allowed to call itself. The second entry is the name this
// project went by before it was renamed, and it is written out literally rather
// than built from anything: bundles carrying it are sitting in people's
// downloads folders, and a file that stops opening is a file somebody lost.
// Nothing is ever exported under it again — this list only grows, and only at
// the reading end.
const ACCEPTED_KINDS = Object.freeze([BUNDLE_KIND, 'experimental-game-controllers:theme']);

/**
 * Reads out everything, ready to be written to a file.
 *
 * `game` is the whole of what somebody made that isn't the theme:
 *   selected  — the control scheme they picked
 *   options   — the per-game course settings, from wiring-storage
 *   wiring    — every game's connections, from wiring-storage
 *   inputs    — the sensors they checked on the Sensing page
 *
 * The last two used to be left out, which made a bundle a strange half-gift: it
 * carried the drawings and the course but not the controller, so opening one
 * gave you a game that looked exactly right and answered to nothing.
 */
const asRecord = (value) => (value && typeof value === 'object' ? value : {});

export async function exportBundle({ theme, assets, game }) {
  const wanted = referencedAssets(theme);
  const stored = await assets.list();
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exported: new Date().toISOString(),
    theme,
    // Only what this theme actually uses. A drawing you replaced last week is
    // still in your own store, but it isn't part of what you're handing over.
    assets: stored.filter((asset) => wanted.includes(asset.id)),
    game: {
      selected: typeof game?.selected === 'string' ? game.selected : null,
      options: asRecord(game?.options),
      wiring: asRecord(game?.wiring),
      inputs: asRecord(game?.inputs),
    },
  };
}

/**
 * Checks a parsed file over before anything is written. Returns
 * `{ theme, assets, game }` or `{ error }` — never a half-applied import, since
 * the failure mode worth avoiding is a stranger's file leaving you with their
 * sprites and your colors.
 */
export function readBundle(value) {
  if (!value || typeof value !== 'object') return { error: 'That file is not a theme.' };
  if (!ACCEPTED_KINDS.includes(value.kind)) {
    return { error: 'That file is not a theme for this game.' };
  }
  if (value.version !== BUNDLE_VERSION) {
    return { error: `That theme was made by a different version (${value.version}).` };
  }

  const assets = (Array.isArray(value.assets) ? value.assets : [])
    .map(normalizeAsset)
    .filter(Boolean);
  const theme = normalizeTheme(value.theme);

  // A reference to an asset the file didn't carry would draw as nothing at all,
  // which looks like a bug rather than like a missing sprite. Dropping the
  // reference falls back to the built-in art instead.
  const have = new Set(assets.map((asset) => asset.id));
  const { scene } = theme;
  for (const slot of SLOT_IDS) {
    if (scene[slot].sprite && !have.has(scene[slot].sprite)) scene[slot].sprite = null;
  }
  const kept = (id) => (id.startsWith('asset:') && !have.has(id.slice(6)) ? 'none' : id);
  for (const [event, id] of Object.entries(theme.sound)) theme.sound[event] = kept(id);
  theme.music.track = kept(theme.music.track);

  const game = asRecord(value.game);
  return {
    theme,
    assets,
    game: {
      selected: typeof game.selected === 'string' ? game.selected : null,
      options: asRecord(game.options),
      wiring: asRecord(game.wiring),
      // Loosely checked on purpose: the builder validates every id against what
      // this build actually offers when it stores them, so a file naming an
      // input that no longer exists loses that input rather than the import.
      inputs: {
        selected: Array.isArray(game.inputs?.selected) ? game.inputs.selected : [],
        pinModes: asRecord(game.inputs?.pinModes),
      },
    },
  };
}

/** Writes the bundle out as a download. */
export function downloadBundle(bundle, name = 'game-theme.json') {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
