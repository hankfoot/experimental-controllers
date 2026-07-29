import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPicture, readDataUrl, toDataUrl, bucketFill, hexToRgba, rgbaToHex, isBlank, boundsOfPixels, CANVAS,
} from '../js/theme/raster.js';
import { SLOTS, SLOT_IDS, SPRITE_FILES, SOUND_FILES, sizeOf } from '../js/theme/defaults.js';
import { bytesToBase64, base64ToBytes } from '../js/theme/bytes.js';
import {
  createThemeStore, normalizeTheme, defaultTheme, fontStack, FONTS,
  readableInk, cardPalette,
} from '../js/theme/theme-store.js';
import { createAssetStore, normalizeAsset } from '../js/theme/assets.js';
import { bandOffset, spacedInstances } from '../js/theme/scene.js';
import { SOUND_EVENTS, asUpload, isUpload, uploadId } from '../js/theme/audio.js';
import { exportBundle, readBundle, BUNDLE_KIND } from '../js/theme/portable.js';
import { key } from '../js/storage-keys.js';
import { RULES } from '../js/games/sidescroller.js';
import { memoryStorage } from './helpers/memory-storage.js';

/** A tiny ImageData stand-in, since Node has no canvas. */
function pixels(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set(fill, i);
  }
  return { width, height, data };
}

const pixelAt = (image, x, y) => {
  const i = (y * image.width + x) * 4;
  return [...image.data.slice(i, i + 4)];
};

const setPixel = (image, x, y, rgba) => image.data.set(rgba, (y * image.width + x) * 4);

// --- Rasters -----------------------------------------------------------------

test('a data URL is recognised and split into the parts an asset keeps', () => {
  const url = toDataUrl('image/png', 'AAAB');
  assert.equal(isPicture(url), true);
  assert.deepEqual(readDataUrl(url), { mime: 'image/png', data: 'AAAB' });

  assert.equal(isPicture('not a picture'), false);
  assert.equal(isPicture(null), false);
  assert.equal(readDataUrl('data:image/png;base64'), null, 'no comma, no data');
});

test('colours convert both ways, and nonsense reads as black', () => {
  assert.deepEqual(hexToRgba('#ff8800'), [255, 136, 0, 255]);
  assert.equal(rgbaToHex([255, 136, 0, 255]), '#ff8800');
  assert.deepEqual(hexToRgba('rebeccapurple'), [0, 0, 0, 255]);
  // Round trips for every swatch-ish value, so the dropper cannot drift.
  for (const hex of ['#000000', '#ffffff', '#1b1c20', '#5eb0ff']) {
    assert.equal(rgbaToHex(hexToRgba(hex)), hex);
  }
});

test('an untouched canvas is blank, and one painted pixel is not', () => {
  const image = pixels(4, 4);
  assert.equal(isBlank(image), true);
  setPixel(image, 2, 2, [255, 0, 0, 255]);
  assert.equal(isBlank(image), false);
});

test('the bucket fills the region it started in and stops at a drawn edge', () => {
  const image = pixels(5, 3, [255, 255, 255, 255]);
  // A wall down the middle splits the canvas in two.
  for (let y = 0; y < 3; y += 1) setPixel(image, 2, y, [0, 0, 0, 255]);

  assert.equal(bucketFill(image, 0, 0, [255, 0, 0, 255]), true);
  assert.deepEqual(pixelAt(image, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(image, 1, 2), [255, 0, 0, 255], 'reaches the whole left side');
  assert.deepEqual(pixelAt(image, 2, 1), [0, 0, 0, 255], 'the wall is untouched');
  assert.deepEqual(pixelAt(image, 3, 0), [255, 255, 255, 255], 'the far side is untouched');
});

test('the bucket carries across the soft edge of a brush stroke', () => {
  // A stroke antialiases into its neighbours, so an exact-match fill would stop
  // one pixel short and leave a halo. The tolerance is what prevents that.
  const image = pixels(3, 1, [255, 255, 255, 255]);
  setPixel(image, 1, 0, [245, 245, 245, 255]);

  bucketFill(image, 0, 0, [0, 0, 255, 255], 32);
  assert.deepEqual(pixelAt(image, 1, 0), [0, 0, 255, 255], 'the near-white pixel went too');
});

test('the bucket paints the antialiased band rather than stopping at it', () => {
  // White region, then the two-pixel ramp a black stroke antialiases into, then
  // the stroke. Tolerance alone gets the first step; the second is too far from
  // white for any tolerance that doesn't also swallow the stroke, and leaving it
  // is what shows up as a pale halo round the fill.
  const image = pixels(5, 1, [255, 255, 255, 255]);
  setPixel(image, 2, 0, [170, 170, 170, 255]);
  setPixel(image, 3, 0, [0, 0, 0, 255]);
  setPixel(image, 4, 0, [0, 0, 0, 255]);

  bucketFill(image, 0, 0, [0, 0, 255, 255]);

  assert.deepEqual(pixelAt(image, 1, 0), [0, 0, 255, 255], 'the region is solid');
  const band = pixelAt(image, 2, 0);
  assert.ok(band[2] > 60 && band[2] < 255, `the band took some blue, not all: ${band}`);
  assert.ok(band[0] < 170, 'and lost some of its own white');
  // The wall of the stroke, and everything behind it, is where the flood ends —
  // a partly-filled pixel is painted but never spread from.
  assert.deepEqual(pixelAt(image, 3, 0), [0, 0, 0, 255], 'the stroke is untouched');
  assert.deepEqual(pixelAt(image, 4, 0), [0, 0, 0, 255], 'and so is what it hides');
});

test('a fill poured into empty space does not haze the canvas around it', () => {
  // Filling transparency: the ramp here is alpha, and a pixel that is mostly
  // clear should come back mostly filled rather than fully opaque.
  const image = pixels(4, 1);
  setPixel(image, 1, 0, [0, 0, 0, 90]);
  setPixel(image, 2, 0, [0, 0, 0, 255]);

  bucketFill(image, 0, 0, [255, 0, 0, 255]);

  assert.deepEqual(pixelAt(image, 0, 0), [255, 0, 0, 255], 'the clear pixel filled solid');
  const edge = pixelAt(image, 1, 0);
  assert.equal(edge[3], 255, 'the soft edge is opaque once paint is behind it');
  assert.ok(edge[0] > 100 && edge[0] < 255, `and reads as a blend: ${edge}`);
  assert.deepEqual(pixelAt(image, 2, 0), [0, 0, 0, 255], 'the solid pixel is a wall');
});

test('refilling a shape recolours its soft rim instead of ringing it', () => {
  // A shape drawn with a round brush fades out through a rim of its own colour
  // at falling alpha. Read as a colour difference that rim is "something else"
  // and gets left behind — the ring of the old colour around a fill that
  // stopped short. Read as coverage, it is plainly still the shape.
  const image = pixels(4, 1, [0, 0, 0, 0]);
  setPixel(image, 0, 0, [198, 47, 59, 255]);
  setPixel(image, 1, 0, [198, 47, 59, 255]);
  setPixel(image, 2, 0, [198, 47, 59, 90]);

  bucketFill(image, 0, 0, [31, 111, 235, 255]);

  assert.deepEqual(pixelAt(image, 1, 0), [31, 111, 235, 255], 'the body took the colour');
  assert.deepEqual(pixelAt(image, 2, 0), [31, 111, 235, 90],
    'and so did the rim, at the coverage it already had');
  // Filling must not harden the edge either: trading a halo for a staircase is
  // not a fix, and a jagged silhouette is the more obvious of the two.
  assert.equal(pixelAt(image, 2, 0)[3], 90, 'the silhouette is as soft as it was');
  assert.deepEqual(pixelAt(image, 3, 0), [0, 0, 0, 0], 'and nothing leaked past it');
});

test('a fill inside a dark shape does not escape across the empty canvas', () => {
  // Cleared pixels are (0, 0, 0, 0) — the same RGB a black shape has — so with
  // colour compared and alpha ignored, only the "nothing is not a faint
  // something" guard keeps a fill of anything dark inside its own shape.
  const image = pixels(3, 1, [0, 0, 0, 0]);
  setPixel(image, 0, 0, [0, 0, 0, 255]);
  setPixel(image, 1, 0, [0, 0, 0, 255]);

  bucketFill(image, 0, 0, [0, 200, 83, 255]);

  assert.deepEqual(pixelAt(image, 1, 0), [0, 200, 83, 255], 'the shape filled');
  assert.deepEqual(pixelAt(image, 2, 0), [0, 0, 0, 0], 'the empty canvas is untouched');
});

test('filling with the colour already there changes nothing', () => {
  const image = pixels(2, 2, [10, 20, 30, 255]);
  assert.equal(bucketFill(image, 0, 0, [10, 20, 30, 255]), false);
});

test('filling outside the canvas is refused rather than throwing', () => {
  const image = pixels(2, 2);
  assert.equal(bucketFill(image, 5, 5, [0, 0, 0, 255]), false);
  assert.equal(bucketFill(image, -1, 0, [0, 0, 0, 255]), false);
});

test('transparent regions fill as one, whatever their unused colour channels say', () => {
  const image = pixels(3, 1);
  // Two clear pixels whose RGB differs wildly are both still "nothing".
  setPixel(image, 1, 0, [255, 0, 0, 0]);
  bucketFill(image, 0, 0, [0, 128, 0, 255]);
  assert.deepEqual(pixelAt(image, 1, 0), [0, 128, 0, 255]);
  assert.deepEqual(pixelAt(image, 2, 0), [0, 128, 0, 255]);
});

test('a thumbnail crops to what was drawn, ignoring the empty margin', () => {
  const image = pixels(10, 10);
  setPixel(image, 3, 4, [255, 0, 0, 255]);
  setPixel(image, 6, 8, [0, 0, 255, 255]);

  // Inclusive of both extremes: a single painted pixel is a 1×1 crop, not 0×0.
  assert.deepEqual(boundsOfPixels(image), { x: 3, y: 4, width: 4, height: 5 });
});

test('one painted pixel crops to itself, and an empty canvas to nothing', () => {
  const one = pixels(4, 4);
  setPixel(one, 2, 1, [0, 0, 0, 255]);
  assert.deepEqual(boundsOfPixels(one), { x: 2, y: 1, width: 1, height: 1 });

  // Null rather than a zero-sized box, so the caller shows the whole canvas
  // instead of trying to draw a rectangle with no area in it.
  assert.equal(boundsOfPixels(pixels(4, 4)), null);
});

test('a drawing touching every edge crops to the whole canvas', () => {
  const full = pixels(3, 3, [10, 10, 10, 255]);
  assert.deepEqual(boundsOfPixels(full), { x: 0, y: 0, width: 3, height: 3 });
});

test('barely-there pixels still count, but fully clear ones never do', () => {
  const faint = pixels(5, 5);
  setPixel(faint, 4, 0, [0, 0, 0, 1]);
  assert.deepEqual(boundsOfPixels(faint), { x: 4, y: 0, width: 1, height: 1 });

  const ghost = pixels(5, 5);
  // Colour in a fully transparent pixel is not something drawn.
  setPixel(ghost, 2, 2, [255, 0, 0, 0]);
  assert.equal(boundsOfPixels(ghost), null);
});

// --- The defaults ------------------------------------------------------------

test('every slot is described, and the manifests name one entry per slot', () => {
  assert.equal(SLOTS.length, 8);
  for (const slot of SLOTS) {
    assert.ok(slot.label && slot.help && slot.emoji, `${slot.id} is described`);
    assert.ok(Object.hasOwn(SPRITE_FILES, slot.id), `${slot.id} has a manifest entry`);
  }
  // The sound manifest covers every event plus the music, so adding a default
  // later is filling in a blank rather than inventing a key.
  for (const [event] of SOUND_EVENTS) assert.ok(Object.hasOwn(SOUND_FILES, event), event);
  assert.ok(Object.hasOwn(SOUND_FILES, 'music'));
});

test('the working canvas is square and a sensible size', () => {
  assert.equal(CANVAS, 256);
});

// --- Base64 ------------------------------------------------------------------

test('bytes survive a base64 round trip at every length remainder', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255]) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 7) % 256);
    const back = base64ToBytes(bytesToBase64(bytes));
    assert.deepEqual([...back], [...bytes], `length ${length}`);
  }
});

test('base64 refuses input that is not base64', () => {
  assert.equal(base64ToBytes('not base64!'), null);
  assert.equal(base64ToBytes(42), null);
});

// --- The theme record --------------------------------------------------------

test('an absent or corrupt record reads as the default theme', () => {
  assert.deepEqual(normalizeTheme(null), defaultTheme());
  assert.deepEqual(normalizeTheme('nonsense'), defaultTheme());
  assert.deepEqual(normalizeTheme({ scene: 'no' }).scene, defaultTheme().scene);
});

test('unknown names fall back rather than reaching the renderer', () => {
  const theme = normalizeTheme({
    font: 'comic-sans',
    overlay: 'neon',
    sound: { score: 'airhorn', crash: 'asset:audio-2' },
    music: { track: 'jazz', volume: 40 },
  });

  assert.equal(theme.font, 'outfit');
  assert.equal(theme.overlay, defaultTheme().overlay);
  // Anything unreadable falls back to the sound the game came with, not to
  // silence: a record damaged in some way somebody cannot see should leave the
  // game working, and silence looks exactly like the feature being broken.
  assert.equal(theme.sound.score, 'default', 'a name that means nothing takes the built-in');
  assert.equal(theme.sound.crash, 'asset:audio-2', 'a recording is kept');
  assert.equal(theme.music.track, 'default');
  assert.equal(theme.music.volume, 1, 'volume clamps into range');

  // Silence is still reachable — it is a choice, and only that exact word.
  const quiet = normalizeTheme({ sound: { score: 'none' }, music: { track: 'none' } });
  assert.equal(quiet.sound.score, 'none');
  assert.equal(quiet.music.track, 'none');
});

test('a recording is kept as a reference and nothing else is', () => {
  const theme = normalizeTheme({ sound: { score: 'asset:audio-7' }, music: { track: 'asset:audio-9' } });
  assert.equal(theme.sound.score, 'asset:audio-7');
  assert.equal(theme.music.track, 'asset:audio-9');
});

test('a scene is a drawing per slot and keeps nothing else', () => {
  const scene = normalizeTheme({
    scene: {
      player: { sprite: 'sprite-1' },
      // Layout that used to live here is constant now, and the sky's colours
      // are gone entirely — it is a drawing like the rest. A record still
      // carrying either must not smuggle it back in.
      sky: { mode: 'solid', top: '#000000' },
      far: { sprite: 'sprite-2', height: 999, speed: 42 },
      ground: { sprite: null, style: 'none' },
    },
  }).scene;

  assert.deepEqual(Object.keys(scene).sort(), [...SLOT_IDS].sort());
  assert.deepEqual(scene.far, { sprite: 'sprite-2' }, 'only the drawing survives');
  assert.equal(scene.player.sprite, 'sprite-1');
  assert.equal(scene.ground.sprite, null);
  assert.equal(scene.sky, undefined, 'the sky is a slot now, not a setting');
});

// The sky is stretched across the whole field rather than repeated or drawn as
// an object, so a square frame would be squashed out of shape. Everything else
// stays square, and stays interchangeable with everything else square.
// Two slots are shaped by the job they do rather than by the editor's default:
// the sky is stretched across the whole field, and a pillar is stacked down a
// bar. Everything else is square and interchangeable with everything else square.
test('a slot is square unless its shape is doing work', () => {
  assert.equal(CANVAS, 256);
  const odd = ['backdrop', 'obstacle'];
  for (const id of SLOT_IDS) {
    if (odd.includes(id)) continue;
    assert.deepEqual(sizeOf(id), { width: CANVAS, height: CANVAS }, id);
  }

  const sky = sizeOf('backdrop');
  assert.equal(sky.width / sky.height, RULES.width / RULES.height, 'the field\'s shape');
  assert.ok(sky.width > CANVAS, 'and bigger, since it is stretched the furthest');

  const pillar = sizeOf('obstacle');
  assert.ok(pillar.height > pillar.width, 'a pillar segment is taller than it is wide');

  // A slot nobody has heard of is square, so a new one costs no thought.
  assert.deepEqual(sizeOf('nonexistent'), { width: CANVAS, height: CANVAS });
});

test('the store saves, reloads, and writes one field at a time', () => {
  const storage = memoryStorage();
  const store = createThemeStore({ storage });

  store.set('text.title', 'Go!');
  store.set('scene.player.sprite', 'sprite-9');
  assert.equal(store.get().text.title, 'Go!');
  assert.equal(store.get().scene.player.sprite, 'sprite-9');

  const reopened = createThemeStore({ storage });
  assert.equal(reopened.get().text.title, 'Go!');
  assert.equal(reopened.get().scene.player.sprite, 'sprite-9');
  assert.equal(reopened.get().text.over, defaultTheme().text.over, 'untouched fields keep defaults');
});

test('subscribers hear what changed, and blocked storage still works', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const store = createThemeStore({ storage: blocked });
  const heard = [];
  store.subscribe((_, reason) => heard.push(reason));

  store.set('font', 'mono');
  store.reset();

  assert.deepEqual(heard, ['font', 'replace']);
  assert.equal(store.get().font, 'outfit', 'reset really reset it');
});

test('a sound reference round-trips through its asset id', () => {
  assert.equal(asUpload('audio-3'), 'asset:audio-3');
  assert.equal(isUpload('asset:audio-3'), true);
  assert.equal(uploadId('asset:audio-3'), 'audio-3');
  assert.equal(isUpload('none'), false);
  assert.equal(uploadId('none'), null);
});

test('every font is a face of its own, and an unknown one falls back', () => {
  // Two ids resolving to the same stack would be two names for one choice, and
  // picking between them would change nothing on screen.
  const stacks = FONTS.map(([id]) => fontStack(id));
  assert.equal(new Set(stacks).size, FONTS.length, 'no two fonts share a stack');

  assert.match(fontStack('courier'), /monospace/);
  assert.match(fontStack('georgia'), /serif/);
  assert.equal(fontStack('nope'), fontStack('outfit'));
});

test('the card takes any colour, and the two old names still resolve', () => {
  assert.equal(normalizeTheme({ overlay: '#c62f3b' }).overlay, '#c62f3b');
  // The card used to be one of two words; a record saying either gets the
  // colour that word stood for rather than falling back to white.
  assert.equal(normalizeTheme({ overlay: 'light' }).overlay, '#ffffff');
  assert.equal(normalizeTheme({ overlay: 'dark' }).overlay, '#11151c');
  assert.equal(normalizeTheme({ overlay: 'chartreuse' }).overlay, defaultTheme().overlay);
});

test('the ink on a card is whichever of black or white can be read on it', () => {
  assert.equal(readableInk('#ffffff'), '#000000');
  assert.equal(readableInk('#f7e463'), '#000000', 'pale yellow takes dark ink');
  assert.equal(readableInk('#11151c'), '#ffffff');
  assert.equal(readableInk('#c62f3b'), '#ffffff', 'a deep red takes light ink');
  // A mid green sits either side of a badly chosen threshold; black wins here.
  assert.equal(readableInk('#2f8f3f'), '#000000');
  assert.equal(readableInk('not a colour'), '#000000');
});

test('a card palette reads against itself, whatever colour it is', () => {
  const contrast = (a, b) => {
    const lum = (hex) => {
      const [r, g, b2] = hex.match(/\w\w/g).map((pair) => {
        const value = parseInt(pair, 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // Every swatch somebody can pick, including the extremes.
  for (const hex of ['#ffffff', '#11151c', '#c62f3b', '#f7e463', '#2f8f3f', '#6b3fa0']) {
    const palette = cardPalette(hex);
    assert.ok(contrast(palette.title, hex) >= 4.5, `heading on ${hex}`);
    // The button is the ink filled in and the card's own colour written on it,
    // so it carries the same contrast the heading does, the other way round.
    assert.equal(palette.buttonInk, hex);
    assert.ok(contrast(palette.buttonFill, palette.buttonInk) >= 4.5, `button on ${hex}`);
  }
});

test('the card has the same three lines on both of its faces', () => {
  const { text } = defaultTheme();
  assert.deepEqual(
    Object.keys(text).sort(),
    ['body', 'button', 'over', 'overBody', 'overButton', 'title'],
  );
  // The score is drawn by the game, so it is not among the words you write.
  assert.equal(Object.values(text).some((line) => line.includes('{score}')), false);
});

test('words written for the older card are replaced, and its drawings kept', () => {
  const older = normalizeTheme({
    text: {
      title: 'Mine', body: 'Also mine', hint: 'a hint',
      over: 'Crashed', overBody: 'Score: {score} · go again',
    },
    scene: { player: { sprite: 'sprite-1' } },
    sound: { crash: 'asset:audio-2' },
  });

  // Those words described a hint line and a token, neither of which is drawn
  // any more, so they go — but nothing else does.
  assert.deepEqual(older.text, defaultTheme().text);
  assert.equal(older.scene.player.sprite, 'sprite-1');
  assert.equal(older.sound.crash, 'asset:audio-2');
});

test('a partial set of words keeps what it says and defaults the rest', () => {
  const { text } = normalizeTheme({ text: { title: 'Launch', button: 'Go' } });
  assert.equal(text.title, 'Launch');
  assert.equal(text.button, 'Go');
  assert.equal(text.over, defaultTheme().text.over);
});

// --- Scenes ------------------------------------------------------------------

test('a parallax band wraps instead of drifting off without bound', () => {
  assert.equal(bandOffset(0, 0.5, 240), 0);
  assert.equal(bandOffset(480, 0.5, 240), 0, 'a whole number of periods is back at the start');
  assert.equal(bandOffset(500, 0.5, 240), 10);
  // Even a very long round stays inside one period, which is what keeps the
  // scrolling smooth after several minutes rather than stepping.
  const late = bandOffset(9_999_999, 0.72, 190);
  assert.ok(late >= 0 && late < 190, `offset ${late} is inside the period`);
});

// The dotted far layer. What makes it look like scenery rather than a slideshow
// is that a given instance keeps its own size and lean for the whole time it is
// crossing, which comes down to it keeping its index.
test('a dotted band covers the field with no hole in it', () => {
  const period = 150;
  const span = 960;
  for (const distance of [0, 37, 480, 9_999_999]) {
    const xs = spacedInstances(distance, 0.28, period, span).map((one) => one.x);
    assert.ok(xs[0] <= 0, `${distance}: nothing starts past the left edge`);
    assert.ok(xs.at(-1) >= span, `${distance}: the row reaches past the right edge`);
    for (let i = 1; i < xs.length; i += 1) {
      assert.ok(Math.abs(xs[i] - xs[i - 1] - period) < 1e-9, `${distance}: evenly spaced`);
    }
  }
});

test('an instance keeps its identity for the whole time it is crossing', () => {
  const period = 150;
  const speed = 0.28;
  const at = (distance) =>
    new Map(spacedInstances(distance, speed, period, 960).map((one) => [one.index, one.x]));

  const first = at(1000);
  const later = at(1120);
  let shared = 0;
  for (const [index, x] of first) {
    if (!later.has(index)) continue;
    shared += 1;
    // Moved left by exactly the distance the world moved. Anything else is an
    // instance jumping, which is what reads as pop-in.
    assert.ok(Math.abs((x - later.get(index)) - 120 * speed) < 1e-9, `instance ${index} drifted`);
  }
  assert.ok(shared > 3, 'the two frames should have most of their instances in common');
});

// --- Assets ------------------------------------------------------------------

test('an asset is refused unless it is a coherent one', () => {
  assert.equal(normalizeAsset(null), null);
  assert.equal(normalizeAsset({ id: 'a', kind: 'image' }), null, 'a picture needs data');
  assert.equal(normalizeAsset({ id: 'a', kind: 'audio' }), null, 'a recording needs data');
  assert.equal(normalizeAsset({ id: '', kind: 'audio', data: 'AA' }), null, 'an asset needs an id');
  assert.equal(normalizeAsset({ id: 'a', kind: 'video', data: 'AA' }), null, 'unknown kind');

  const audio = normalizeAsset({ id: 'a', kind: 'audio', name: 'x', mime: 'audio/mp3', data: 'AA' });
  assert.equal(audio.data, 'AA');
  // A drawing and an uploaded picture are now the same kind of thing.
  assert.equal(normalizeAsset({ id: 'b', kind: 'image', data: 'AA' }).kind, 'image');
});

test('with no IndexedDB the store falls back to localStorage and still works', async () => {
  const storage = memoryStorage();
  const store = createAssetStore({ indexedDB: null, storage });
  assert.equal(await store.ready(), 'localstorage');

  const saved = await store.put({ id: 's1', kind: 'image', name: 'Player', mime: 'image/png', data: 'AAAB' });
  assert.equal(saved.id, 's1');

  const read = await store.get('s1');
  assert.equal(read.data, 'AAAB');
  assert.deepEqual((await store.list()).map((asset) => asset.id), ['s1']);

  await store.remove('s1');
  assert.equal(await store.get('s1'), null);
});

test('an upload too big for the fallback is refused rather than half-saved', async () => {
  const store = createAssetStore({ indexedDB: null, storage: memoryStorage() });
  const huge = { id: 'big', kind: 'audio', name: 'song', mime: 'audio/mpeg', data: 'A'.repeat(500_000) };
  assert.equal(await store.put(huge), null);
  assert.equal(await store.get('big'), null);
});

test('a database that never answers falls back rather than hanging forever', async () => {
  // An open request can queue behind a blocked delete and settle never. The
  // store has to give up on it, because everything downstream is awaiting this.
  const wedged = { open: () => ({ onsuccess: null, onerror: null, onblocked: null }) };
  const store = createAssetStore({ indexedDB: wedged, storage: memoryStorage(), openTimeoutMs: 20 });

  const backend = await store.ready();
  assert.equal(backend, 'localstorage');
  const saved = await store.put({ id: 'a', kind: 'audio', name: 'x', mime: 'audio/mpeg', data: 'AA' });
  assert.equal(saved.id, 'a');
});

test('with nowhere at all to put things, the store simply holds nothing', async () => {
  const store = createAssetStore({ indexedDB: null, storage: null });
  assert.equal(await store.ready(), 'none');
  assert.equal(await store.put({ id: 'a', kind: 'audio', data: 'AA' }), null);
  assert.deepEqual(await store.list(), []);
});

// --- Export and import -------------------------------------------------------

const fakeAssets = (records) => ({
  list: async () => records,
  get: async (id) => records.find((record) => record.id === id) ?? null,
});

test('an exported bundle carries the theme, its assets, and the course', async () => {
  const sprite = { id: 's1', kind: 'image', name: 'Player', mime: 'image/png', data: 'AAAB' };
  const spare = { id: 's2', kind: 'image', name: 'Unused', mime: 'image/png', data: 'AAAB' };

  const theme = normalizeTheme({ scene: { player: { sprite: 's1' } } });
  const bundle = await exportBundle({
    theme,
    assets: fakeAssets([sprite, spare]),
    game: { selected: 'flappy', options: { flappy: { 'world.pace': { speed: 'quick' } } } },
  });

  assert.equal(bundle.kind, BUNDLE_KIND);
  assert.deepEqual(bundle.assets.map((asset) => asset.id), ['s1'], 'only what the theme uses');
  assert.equal(bundle.game.options.flappy['world.pace'].speed, 'quick');
});

test('importing what was exported gives back the same theme', async () => {
  const theme = normalizeTheme({
    text: { title: 'Launch' },
    font: 'pixel',
  });
  const bundle = await exportBundle({
    theme,
    assets: fakeAssets([]),
    game: { selected: 'jetpack', options: { jetpack: { 'world.obstacles': { gap: 'tight' } } } },
  });

  const read = readBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(read.error, undefined);
  assert.deepEqual(read.theme, theme);
  assert.equal(read.game.options.jetpack['world.obstacles'].gap, 'tight');
});

test('an imported course reaches the engine, which is holding the old one', async () => {
  const { createWiringEngine } = await import('../js/wiring-engine.js');
  const { createSignalStore } = await import('../js/signal-store.js');
  const game = {
    id: 'flappy',
    targets: [],
    settings: [{
      id: 'world',
      ports: [{
        id: 'obstacles',
        options: [{ id: 'gap', choices: [['tight', 'tight'], ['normal', 'normal']], value: 'normal' }],
      }],
    }],
  };

  const published = [];
  const actions = {
    setValue() {}, fire() {}, setWiredPorts() {},
    setControlOptions: (node, port, options) => published.push([`${node}.${port}`, options]),
  };
  const storage = memoryStorage();
  const engine = createWiringEngine({ signalStore: createSignalStore(), actions, game, storage });
  assert.equal(engine.controlOptions('world', 'obstacles').gap, 'normal');

  // What importing does: rewrite the record from outside, then say so. The game
  // has not changed, so setGame would refuse — this is the path that must work.
  // Built from the same helper the code uses rather than typed out, so the test
  // cannot quietly stop testing anything the next time the namespace moves.
  storage.setItem(
    key('controls', 'v1'),
    JSON.stringify({ flappy: { 'world.obstacles': { gap: 'tight' } } }),
  );
  engine.setGame(game);
  assert.equal(engine.controlOptions('world', 'obstacles').gap, 'normal', 'setGame alone cannot');

  engine.reloadOptions();
  assert.equal(engine.controlOptions('world', 'obstacles').gap, 'tight');
  // And the running game is told, not just the screen that draws the dropdown.
  assert.deepEqual(published.at(-1), ['world.obstacles', { gap: 'tight' }]);
});

test('a file from somewhere else is refused with a reason', () => {
  assert.match(readBundle(null).error, /not a theme/);
  assert.match(readBundle({ kind: 'something-else' }).error, /not a theme for this game/);
  assert.match(readBundle({ kind: BUNDLE_KIND, version: 99 }).error, /different version/);
});

test('a reference to a drawing the file did not carry falls back to the built-in art', () => {
  const read = readBundle({
    kind: BUNDLE_KIND,
    version: 1,
    theme: {
      scene: { player: { sprite: 'missing' }, obstacle: { sprite: 'gone' } },
      sound: { crash: 'asset:nope' },
      music: { track: 'asset:nope' },
    },
    assets: [],
    game: {},
  });

  assert.equal(read.theme.scene.player.sprite, null);
  assert.equal(read.theme.scene.obstacle.sprite, null);
  assert.equal(read.theme.sound.crash, 'none');
  assert.equal(read.theme.music.track, 'none');
});

// A bundle is the whole of what somebody made, not just how it looks. It used
// to carry the drawings and the course but neither the inputs nor the wiring,
// so opening one gave you a game that looked exactly right and answered to
// nothing. This is the assertion that keeps all of it in the file.
test('a bundle carries the look, the sounds, the course, the wiring and the inputs', async () => {
  const theme = normalizeTheme({
    scene: { player: { sprite: 'sprite-1' }, backdrop: { sprite: 'sprite-2' } },
    sound: { crash: asUpload('audio-1') },
    music: { track: asUpload('audio-2'), volume: 0.85 },
    text: { title: 'Off we go' },
    font: 'comic',
    overlay: '#f4b400',
  });
  const assets = {
    list: async () => [
      { id: 'sprite-1', kind: 'image', name: 'craft', mime: 'image/png', data: 'AAAA' },
      { id: 'sprite-2', kind: 'image', name: 'sky', mime: 'image/png', data: 'BBBB' },
      { id: 'audio-1', kind: 'audio', name: 'thud', mime: 'audio/webm', data: 'CCCC' },
      { id: 'audio-2', kind: 'audio', name: 'tune', mime: 'audio/webm', data: 'DDDD' },
      // Something from last week that the theme no longer points at.
      { id: 'sprite-9', kind: 'image', name: 'old', mime: 'image/png', data: 'EEEE' },
    ],
  };
  const game = {
    selected: 'jetpack',
    options: { jetpack: { 'world.obstacles': { gap: 'tight' } } },
    wiring: { jetpack: [{ id: 'w1', source: 'btna', sourceKind: 'binary',
      target: { node: 'lift', port: 'thrust' }, transform: { type: 'hold', invert: false } }] },
    inputs: { selected: ['btna', 'pitch'], pinModes: { p0: 'switch' } },
  };

  const back = readBundle(JSON.parse(JSON.stringify(await exportBundle({ theme, assets, game }))));
  assert.equal(back.error, undefined);

  // Both kinds of asset travel, and only the ones actually used.
  assert.deepEqual(back.assets.map((a) => a.id).sort(),
    ['audio-1', 'audio-2', 'sprite-1', 'sprite-2']);

  assert.equal(back.theme.scene.player.sprite, 'sprite-1');
  assert.equal(back.theme.scene.backdrop.sprite, 'sprite-2');
  assert.equal(back.theme.sound.crash, asUpload('audio-1'));
  assert.equal(back.theme.music.track, asUpload('audio-2'));
  assert.equal(back.theme.music.volume, 0.85);
  assert.equal(back.theme.text.title, 'Off we go');
  assert.equal(back.theme.font, 'comic');

  assert.equal(back.game.selected, 'jetpack');
  assert.deepEqual(back.game.options, game.options, 'the course');
  assert.deepEqual(back.game.wiring, game.wiring, 'the wiring');
  assert.deepEqual(back.game.inputs.selected, ['btna', 'pitch'], 'the picked inputs');
  assert.deepEqual(back.game.inputs.pinModes, { p0: 'switch' }, 'and how each pin is read');
});
