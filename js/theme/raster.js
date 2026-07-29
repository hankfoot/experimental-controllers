// A drawing, as a picture. Everything you make here — a brush stroke, a filled
// rectangle, a photo you dropped in — ends up as the same thing: a PNG on a
// square canvas. That is what lets an upload and a drawing be the same object,
// and what lets a stroke be a smooth line rather than a staircase.
//
// The cost of holding drawings this way is that they are opaque: nothing here
// can tell you which colours a picture uses, and a saved sprite is a base64
// blob rather than anything readable in a storage inspector. In exchange,
// drawing is just drawing, and there is no resolution to decide on first.

/**
 * The working size of a sprite. Large enough that a brush stroke reads as a
 * stroke; small enough that a set of them plus a few sounds sit comfortably in
 * storage.
 *
 * Nearly every slot is this, square, so the editor is the same editor almost
 * everywhere and a drawing can be moved between them. The sky is the exception
 * — it is stretched across the whole field rather than repeated or drawn as an
 * object, so it gets a bigger widescreen frame of its own. Which slots differ
 * is `sizeOf` in defaults.js; nothing here knows what a slot is.
 */
export const CANVAS = 256;

const PNG_PREFIX = 'data:image/';

/** Whether a stored value could be a picture we drew or were handed. */
export function isPicture(value) {
  return typeof value === 'string' && value.startsWith(PNG_PREFIX) && value.includes(';base64,');
}

/** Splits a data URL into the parts an asset record keeps separately. */
export function readDataUrl(url) {
  if (!isPicture(url)) return null;
  const [header, data] = url.split(',');
  if (!data) return null;
  return { mime: header.slice(5).split(';')[0], data };
}

export function toDataUrl(mime, data) {
  return `data:${mime || 'image/png'};base64,${data}`;
}

// --- Things that need a canvas ----------------------------------------------

/**
 * A blank working canvas, transparent. Takes an object rather than two numbers
 * so that `makeCanvas(768)` cannot quietly hand back a square — every caller
 * already holds a `{ width, height }` from `sizeOf`.
 */
export function makeCanvas({ width = CANVAS, height = CANVAS } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

/**
 * Draws a source image to cover the working canvas the way a CSS background
 * would — filled, centred, cropped — so a photo of any shape lands in the frame
 * without being squashed. Both axes are read: a wide frame given a square photo
 * has to crop the top and bottom, not the sides.
 */
export function drawCover(ctx, image, { width = CANVAS, height = CANVAS } = {}) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * Bucket fill, on pixels rather than on cells.
 *
 * Every edge in a drawing here is soft — the brush is round and anti-aliased,
 * and so is anything scaled in from a photo — so between "the region" and "the
 * stroke around it" there is a band of pixels that are part of both. A fill
 * that treats each pixel as in or out has to put that band on one side or the
 * other: keep it out and the fill stops short, leaving the pale halo that reads
 * as "it didn't fill all the way"; take it in and the fill eats the stroke's
 * soft edge and turns it into a jagged one.
 *
 * So a pixel isn't in or out, it has a strength. Dead-on matches are 1 and
 * fill solid; the further a pixel is from the colour under the pointer the less
 * of the new colour it takes, down to nothing at `soft`. The band gets painted
 * in proportion to how much of it belonged to the region, which is roughly the
 * proportion the anti-aliasing put there — and when the region is empty space,
 * exactly it, since there the pixel's alpha says so outright (see `blend`).
 *
 * The walk only *spreads* from full-strength pixels, though. Partial ones are
 * painted and become a wall — otherwise a fill would seep through the soft edge
 * of a stroke and flood the far side.
 */
export function bucketFill(imageData, startX, startY, rgba, tolerance = 32, soft = 128) {
  const { width, height, data } = imageData;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return false;

  const at = (x, y) => (y * width + x) * 4;
  const start = at(startX, startY);
  const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];

  // Colour only, never alpha. Alpha is not a shade of a colour, it is how much
  // of the pixel that colour covers — and a shape drawn with a round brush
  // fades out through a rim of its own colour at falling alpha. Counted as a
  // difference, that rim reads as "some other colour" and gets left behind,
  // which is the ring of the old colour you see around a fill that stopped
  // short. Counted as coverage, it is plainly still the region.
  const distance = (i) => Math.max(
    Math.abs(data[i] - target[0]),
    Math.abs(data[i + 1] - target[1]),
    Math.abs(data[i + 2] - target[2]),
  );

  /** How much of this pixel belongs to the region: 1 solid, 0 not at all. */
  const strengthAt = (i) => {
    // Filling empty space needs no guesswork: a pixel's alpha *is* how much of
    // it was covered, so the rest of it is the hole being filled. Two fully
    // clear pixels also differ wildly in their unused colour channels and are
    // still both "nothing", which is the other reason alpha is read alone here.
    if (target[3] === 0) return 1 - data[i + 3] / 255;
    // Going the other way, nothing at all is not a faint version of the region,
    // whatever colour the empty pixel is nominally carrying — and on a canvas
    // that is black, so without this a fill of anything dark would run straight
    // out of the shape and across the whole picture.
    if (data[i + 3] === 0) return 0;
    const d = distance(i);
    if (d <= tolerance) return 1;
    if (d >= soft) return 0;
    return (soft - d) / (soft - tolerance);
  };

  const alreadyFilled = target[3] === rgba[3]
    && target[0] === rgba[0] && target[1] === rgba[1] && target[2] === rgba[2];
  if (alreadyFilled) return false;

  const [fr, fg, fb, fa] = rgba;
  const fillAlpha = fa / 255;
  const intoEmptiness = target[3] === 0;

  function write(i, r, g, b, alpha) {
    data[i] = Math.round(r);
    data[i + 1] = Math.round(g);
    data[i + 2] = Math.round(b);
    data[i + 3] = Math.round(alpha * 255);
  }

  /**
   * Puts the fill against what is already at this pixel, at `coverage` strength.
   *
   * Which side of it depends on what is being filled. Pouring into empty space
   * is pouring *behind* the drawing: the soft edge of a stroke keeps its own
   * colour and gets paint backing it, which is what closes the join instead of
   * leaving it hazy — and there the pixel's own alpha is the coverage, exactly,
   * so nothing has to be guessed.
   *
   * Filling a coloured region is not a layer at all — it is a change of colour.
   * The pixels keep the alpha they had, which is what keeps the shape's edge as
   * soft as it was: painting the rim solid to "finish the job" would trade a
   * halo for a staircase, and a jagged silhouette is the more obvious of the
   * two once the sprite is a few hundred pixels wide on the canvas.
   */
  function blend(i, coverage) {
    const dst = data[i + 3] / 255;
    const [dr, dg, db] = [data[i], data[i + 1], data[i + 2]];

    if (intoEmptiness) {
      const under = fillAlpha * (1 - dst);
      const alpha = dst + under;
      if (alpha <= 0) return write(i, 0, 0, 0, 0);
      return write(i,
        (dr * dst + fr * under) / alpha,
        (dg * dst + fg * under) / alpha,
        (db * dst + fb * under) / alpha,
        alpha);
    }

    const share = fillAlpha * coverage;
    return write(i,
      dr + (fr - dr) * share,
      dg + (fg - dg) * share,
      db + (fb - db) * share,
      dst);
  }

  const seen = new Uint8Array(width * height);
  const stack = [[startX, startY]];
  let painted = false;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (seen[y * width + x]) continue;
    const i = at(x, y);
    const strength = strengthAt(i);
    if (strength <= 0) continue;

    seen[y * width + x] = 1;
    blend(i, strength);
    painted = true;
    if (strength === 1) stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return painted;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** '#rrggbb' to the four bytes bucketFill and getImageData deal in. */
export function hexToRgba(hex, alpha = 255) {
  const match = HEX.exec(hex);
  if (!match) return [0, 0, 0, alpha];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

export function rgbaToHex([r, g, b]) {
  const pair = (channel) => channel.toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/**
 * The smallest rectangle holding everything drawn, or null if nothing is. A
 * thumbnail is cropped to this so a small drawing on a big canvas fills its
 * tile rather than floating in a field of checkerboard — the canvas is a
 * generous 256 square precisely so nobody has to think about fitting it, which
 * leaves most drawings surrounded by a lot of nothing.
 */
export function boundsOfPixels(imageData) {
  const { width, height, data } = imageData;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** The same, measured off a canvas or a loaded image. */
export function contentBounds(source) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  return boundsOfPixels(ctx.getImageData(0, 0, width, height));
}

/** Whether a drawing has anything on it at all. */
export function isBlank(imageData) {
  const { data } = imageData;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}
