// What the game looks and sounds like, and what it says. Held apart from the
// wiring engine on purpose: the engine's settings are enumerated choices with a
// sentence around them, which is exactly right for "a tight gap / a fair gap"
// and exactly wrong for a drawing, a recording, or a line of your own copy.
//
// The record itself is small — names, colors, and a few numbers — so it lives
// in localStorage under the same conventions as everything else in
// wiring-storage.js: one versioned key, every field checked on the way in, and
// a write that fails silently rather than taking the session down. The heavy
// parts are asset ids pointing into the store in assets.js.

import { SLOT_IDS } from './defaults.js';
import { SOUND_EVENTS, BUILT_IN, isUpload } from './audio.js';
import { key } from '../storage-keys.js';

const STORAGE_KEY = key('theme', 'v1');
const VERSION = 1;

// Named for the face you get rather than for a mood, and shown in that face
// wherever they are listed — "blocky" and "typewriter" were two labels over one
// monospace stack, so choosing between them changed nothing you could see.
//
// Only the app's own face is a downloaded font; the rest are stacks the browser
// already has, so a theme never depends on the network to look the way you left
// it.
export const FONTS = Object.freeze([
  ['outfit', 'Outfit', '"Outfit", ui-sans-serif, system-ui, sans-serif'],
  ['arial', 'Arial', 'Arial, Helvetica, sans-serif'],
  ['verdana', 'Verdana', 'Verdana, Geneva, sans-serif'],
  ['trebuchet', 'Trebuchet', '"Trebuchet MS", "Segoe UI", sans-serif'],
  ['georgia', 'Georgia', 'Georgia, "Iowan Old Style", serif'],
  ['times', 'Times', '"Times New Roman", Times, serif'],
  ['courier', 'Courier', '"Courier New", Courier, monospace'],
  ['comic', 'Comic Sans', '"Comic Sans MS", "Chalkboard SE", cursive'],
  ['impact', 'Impact', 'Impact, Haettenschweiler, "Arial Black", sans-serif'],
]);

export const fontStack = (id) =>
  (FONTS.find((font) => font[0] === id) ?? FONTS[0])[2];

// Three lines a side, and the same three either side: a heading, a line under
// it, and the words on the button. The score is not among them — the game draws
// the number it actually is, rather than asking you to leave a slot for it.
const DEFAULT_TEXT = Object.freeze({
  title: 'Ready?',
  body: 'Use your controller or the keys',
  button: 'Tap to start',
  over: 'Game over',
  overBody: 'Nice flying',
  overButton: 'Go again',
});

export function defaultTheme() {
  return {
    version: VERSION,
    text: { ...DEFAULT_TEXT },
    font: 'outfit',
    overlay: '#ffffff',
    scene: normalizeScene(null),
    sound: Object.fromEntries(SOUND_EVENTS.map(([event]) => [event, BUILT_IN])),
    music: { track: BUILT_IN, volume: 0.5, muted: false },
  };
}

// --- Reading a saved record back ---------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const isRecord = (value) => Boolean(value) && typeof value === 'object';
const names = (pairs) => pairs.map(([id]) => id);

function color(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

function clamp(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function text(value, fallback, limit = 60) {
  return typeof value === 'string' ? value.slice(0, limit) : fallback;
}

function assetRef(value) {
  return typeof value === 'string' && value ? value : null;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Whether these words were written for the card as it used to be — when it had
 * a hint line, no button, and a {score} token you left a space for. Such a
 * record keeps its drawings and its sounds and takes fresh words, since the old
 * ones describe lines that are no longer drawn.
 */
function writtenBefore(value) {
  if (!isRecord(value)) return false;
  // Both are positive marks of the old shape. A merely missing `button` is not
  // one — a partial record should take that field's default, not lose the rest.
  return Object.hasOwn(value, 'hint')
    || String(value.overBody ?? '').includes('{score}');
}

// One of your recordings, the one the game came with, or silence. The same
// three states a drawing slot has, and for the same reason: "what it started
// as" and "nothing at all" are different answers, and a game that opens silent
// makes the sound controls look broken.
function sound(value) {
  if (isUpload(value)) return value;
  return value === 'none' ? 'none' : BUILT_IN;
}

/**
 * The scene is a slot per drawing, each of them a sprite id and nothing else.
 * Where each one goes and how fast it scrolls are constants in scene.js rather
 * than settings — and the sky, which briefly had a card of its own here for
 * picking colours, is now simply the drawing in the backdrop slot. One concept
 * fewer, and the way you change it is the way you change everything else.
 */
function normalizeScene(value) {
  const scene = {};
  for (const slot of SLOT_IDS) scene[slot] = { sprite: assetRef(value?.[slot]?.sprite) };
  return scene;
}

/** Reads any value at all and returns a theme that is safe to draw with. */
export function normalizeTheme(value) {
  const base = defaultTheme();
  if (!isRecord(value)) return base;

  return {
    version: VERSION,
    text: writtenBefore(value.text)
      ? { ...base.text }
      : {
        title: text(value.text?.title, base.text.title),
        body: text(value.text?.body, base.text.body),
        button: text(value.text?.button, base.text.button, 24),
        over: text(value.text?.over, base.text.over),
        overBody: text(value.text?.overBody, base.text.overBody),
        overButton: text(value.text?.overButton, base.text.overButton, 24),
      },
    font: pick(value.font, names(FONTS), base.font),
    overlay: color(cardColour(value.overlay), base.overlay),
    scene: normalizeScene(value.scene),
    sound: Object.fromEntries(SOUND_EVENTS.map(([event]) => [event, sound(value.sound?.[event])])),
    music: {
      track: sound(value.music?.track),
      volume: clamp(value.music?.volume, 0, 1, base.music.volume),
      muted: typeof value.music?.muted === 'boolean' ? value.music.muted : base.music.muted,
    },
  };
}

/**
 * How the menu card is laid out.
 *
 * Read by two things that draw the same card in different media: the game, on
 * canvas, and the Design screen, in DOM. Those were two independent sets of
 * hardcoded numbers sharing only a palette, so the sheet you typed your words
 * into was never quite the card you got — different padding, different rhythm,
 * and no warning when a line that fitted in one would overflow the other.
 *
 * Sizes are canvas pixels at the field's own scale. The DOM side divides by 16
 * to get rem, which is why they are round numbers.
 */
export const CARD = Object.freeze({
  width: 340,
  radius: 18,
  padX: 26,
  padTop: 30,
  padBottom: 24,
  // Between one block and the next. The lines *within* a wrapped block are set
  // by its own leading, below.
  gap: 14,
  leading: 1.24,
  title: { size: 25, weight: 700 },
  score: { size: 34, weight: 700 },
  best: { size: 14, weight: 600 },
  body: { size: 16, weight: 500 },
  button: { size: 15, weight: 600, height: 34, padX: 18 },
});

// The card used to be light or dark and is now any colour, so the two words it
// used to answer to are read as the colours they stood for.
const NAMED_CARDS = { light: '#ffffff', dark: '#11151c' };
const cardColour = (value) => NAMED_CARDS[value] ?? value;

/** Whether black or white is the readable ink on a given background. */
export function readableInk(hex) {
  const channel = (pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return '#000000';
  const luminance = 0.2126 * channel(match[1])
    + 0.7152 * channel(match[2])
    + 0.0722 * channel(match[3]);
  // Where white and black read equally well, which is not the middle of the
  // range: contrast is 1.05/(L+0.05) against white and (L+0.05)/0.05 against
  // black, and those meet at L = sqrt(1.05 * 0.05) - 0.05. A half-way 0.45 put
  // white on the mid greens at 4.1:1 when black would have given 5.1:1.
  //
  // Black here is black rather than the app's near-black ink. With only two
  // inks to choose from, the worst any colour can do is the contrast at this
  // crossover — 4.58:1 with pure black, and only 4.14:1 with #1b1c20, which
  // would leave the mid tones under the 4.5:1 the rest of the app holds to.
  return luminance > 0.1791 ? '#000000' : '#ffffff';
}

/**
 * Everything the menu card is drawn with, worked out from the one colour you
 * picked for it. Choosing a background and then being asked for a text colour
 * that reads against it would be two questions where there is only one.
 */
export function cardPalette(hex) {
  const ink = readableInk(hex);
  const dark = ink === '#ffffff';
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const channels = rgb ? [rgb[1], rgb[2], rgb[3]].map((pair) => parseInt(pair, 16)) : [255, 255, 255];
  return {
    // Slightly see-through, so the card sits over the game rather than on it.
    panel: `rgba(${channels.join(', ')}, .94)`,
    border: dark ? 'rgba(255, 255, 255, .16)' : 'rgba(27, 28, 32, .1)',
    title: ink,
    // The same ink as the heading, not a faded one: the heading's contrast is
    // only just clear of the floor on a mid-tone card, and fading a second line
    // out of that would put it under. Size and weight carry the hierarchy.
    body: ink,
    buttonFill: ink,
    buttonInk: hex,
  };
}

export function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Holds the one live theme. Everything that draws or plays reads it through
 * `get()`, and everything that edits it goes through `set()` — which normalizes,
 * saves, and tells the listeners, in that order, so nothing downstream ever
 * sees a value the renderer would choke on.
 */
export function createThemeStore({ storage = browserStorage() } = {}) {
  let theme = load();
  const listeners = new Set();

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (!isRecord(saved) || saved.version !== VERSION) return defaultTheme();
      return normalizeTheme(saved);
    } catch {
      return defaultTheme();
    }
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(theme));
    } catch {
      // Persistence may be blocked; the theme still applies for this session.
    }
  }

  function notify(reason) {
    listeners.forEach((listener) => listener(theme, reason));
  }

  return {
    get: () => theme,

    /** Writes one field, addressed like `scene.far.speed`. */
    set(path, value) {
      const keys = path.split('.');
      const next = structuredClone(theme);
      let cursor = next;
      for (const key of keys.slice(0, -1)) {
        if (!isRecord(cursor[key])) cursor[key] = {};
        cursor = cursor[key];
      }
      cursor[keys.at(-1)] = value;
      theme = normalizeTheme(next);
      save();
      notify(path);
    },

    /** Replaces everything, for an imported bundle. */
    replace(value) {
      theme = normalizeTheme(value);
      save();
      notify('replace');
    },

    reset() {
      theme = defaultTheme();
      save();
      notify('replace');
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
