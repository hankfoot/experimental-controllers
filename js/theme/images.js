// Turns drawings into things the canvas can draw. The render loop runs sixty
// times a second and can't wait on a database, so every picture the theme uses
// is decoded up front and the loop only ever does a synchronous lookup.
//
// Each lookup names the slot it is for, so a slot you have never drawn on hands
// back the default instead of nothing. There is always a picture, and the only
// question is whose: a file dropped into `assets/`, or the built-in sketch.

import { SLOT_IDS, SPRITE_FILES, SLOT_SIZE, drawSketch, sizeOf } from './defaults.js';
import { newAssetId } from './assets.js';
import {
  CANVAS, makeCanvas, loadImage, drawCover, toDataUrl, readDataUrl, contentBounds,
} from './raster.js';
import { bytesToBase64, base64ToBytes } from './bytes.js';

/** Every asset id a theme points at, so warming can load exactly those. */
export function referencedAssets(theme) {
  const { scene, sound, music } = theme;
  const ids = SLOT_IDS.map((slot) => scene[slot].sprite);
  for (const value of [...Object.values(sound), music.track]) {
    if (typeof value === 'string' && value.startsWith('asset:')) ids.push(value.slice(6));
  }
  return ids.filter(Boolean);
}

/**
 * The default picture for a slot: the file named in the manifest if there is
 * one and it loads, otherwise the sketch. Failing over rather than erroring is
 * what lets the manifest be filled in one entry at a time.
 */
async function defaultFor(slot) {
  const path = SPRITE_FILES[slot];
  const size = sizeOf(slot);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (path) {
    const image = await loadImage(path);
    if (image) {
      drawCover(ctx, image, size);
      return canvas;
    }
    console.warn(`Default sprite for "${slot}" could not be loaded from ${path}; using the built-in sketch.`);
  }
  drawSketch(slot, ctx, size);
  return canvas;
}

/**
 * Notes where the drawing actually is on its canvas, once, at load.
 *
 * The working canvas is a generous 256 square precisely so nobody has to think
 * about fitting a drawing into it — which leaves most drawings sitting in a
 * field of nothing. Drawn whole, that nothing is scaled up along with the
 * picture, so a small doodle arrives on the game canvas smaller still, and the
 * cropped thumbnail on the Design screen promises something bigger than the
 * game delivers. Whoever draws it can then size to the picture instead.
 *
 * Measured here rather than per frame: it reads every pixel of the image, which
 * is nothing once and far too much sixty times a second.
 */
function measured(image) {
  if (image) image.content = contentBounds(image);
  return image;
}

export function createImageCache({ assets }) {
  const cache = new Map();
  const builtIn = new Map();

  async function decode(id) {
    const asset = await assets.get(id);
    if (!asset?.data) return null;
    return measured(await loadImage(toDataUrl(asset.mime, asset.data)));
  }

  return {
    /**
     * Synchronous, for the render loop. `slot` is what to fall back to when the
     * theme names no drawing of yours — or names one that hasn't loaded yet.
     */
    get(id, slot) {
      return (id && cache.get(id)) || builtIn.get(slot) || null;
    },

    /** The default picture for a slot, ignoring whatever is set. */
    builtIn: (slot) => builtIn.get(slot) ?? null,

    /** Loads the defaults once. Everything waits on this before first paint. */
    async ready() {
      const loaded = await Promise.all(
        SLOT_IDS.map(async (slot) => [slot, measured(await defaultFor(slot))]));
      for (const [slot, canvas] of loaded) builtIn.set(slot, canvas);
    },

    /** Loads everything a theme references. Safe to call on every change. */
    async warm(theme) {
      const wanted = referencedAssets(theme);
      const loaded = await Promise.all(wanted.map(async (id) => [id, await decode(id)]));
      for (const [id, image] of loaded) {
        if (image) cache.set(id, image);
        else cache.delete(id);
      }
      // Anything the theme stopped pointing at is dropped, so swapping drawings
      // through a long session doesn't accumulate images nobody draws.
      for (const id of [...cache.keys()]) {
        if (!wanted.includes(id)) cache.delete(id);
      }
    },

    async refresh(id) {
      const image = await decode(id);
      if (image) cache.set(id, image);
      else cache.delete(id);
      return image;
    },
  };
}

// --- Getting a picture in ----------------------------------------------------

/**
 * An uploaded picture at its own size, decoded and ready to draw.
 *
 * Deliberately *not* cropped to a slot. Fitting it is the editor's job now, and
 * doing it here would throw away the pixels outside the crop before anybody had
 * a chance to say where the picture should sit — which was the old behaviour,
 * and the reason bringing in a photo felt like a coin toss.
 *
 * The object URL is released as soon as it has loaded: the pixels are decoded
 * by then, so the image stays drawable without holding the blob open.
 */
export async function imageFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A canvas, as the asset record that gets stored and exported. */
export function spriteAsset(canvas, { id, name }) {
  const parts = readDataUrl(canvas.toDataURL('image/png'));
  if (!parts) return null;
  return { id: id ?? newAssetId('sprite'), kind: 'image', name, mime: parts.mime, data: parts.data };
}

export async function audioAssetFromFile(file, name = file.name) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    id: newAssetId('audio'),
    kind: 'audio',
    name,
    mime: file.type || 'audio/mpeg',
    data: bytesToBase64(bytes),
  };
}

/** Bytes back out of a stored audio asset, for decodeAudioData. */
export function assetBytes(asset) {
  return asset?.data ? base64ToBytes(asset.data) : null;
}

export { CANVAS };
