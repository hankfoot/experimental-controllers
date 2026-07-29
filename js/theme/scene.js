// The background: a sky, two drawings scrolling past at different speeds, and
// a third scattered through the air. Which is to say, where each of your
// drawings goes and how fast — not what any of them look like, which is
// entirely a matter of what you painted.
//
// None of the numbers below are settings. They were, briefly, and it was too
// many knobs for what they bought: how tall a hillside stands and how fast it
// goes past are the sort of thing that has one right answer, and the drawing
// sitting on top of it is where the interesting differences live. So they are
// constants, tuned once, and the Design screen is shorter for it.
//
// The sky is not among them either: it is simply the drawing in the backdrop
// slot, stretched across the whole field, with `SKY` below showing through
// wherever that drawing is transparent or has not loaded yet.

/** Shown under the backdrop drawing, so a wiped sky is never the page. */
const SKY = '#eaf1ff';

/**
 * Where each layer sits. Tuned against a 960×600 field.
 *
 * The two bands do different jobs, which is why only one of them tiles. The far
 * one is the horizon: a continuous skyline repeated end to end, drawn large,
 * and it has to join up with itself. The near one is scenery — trees, rocks,
 * whatever somebody draws — dotted along with air between, because a row of
 * trees shoulder to shoulder reads as wallpaper rather than as trees.
 *
 * `gap` is the space from one prop to the next as a multiple of how wide one is
 * drawn; `vary`, `sway` and `sink` are how far each may differ from its
 * neighbours, so a row of the same drawing isn't visibly stamped. `overlap` is
 * how far a band is drawn past the horizon, so no seam of sky shows between the
 * bottom of the scenery and the top of the ground.
 */
const LAYOUT = Object.freeze({
  far: { height: 150, speed: 0.28, overlap: 10 },
  near: { height: 120, speed: 0.55, gap: 2.4, vary: 0.24, sway: 0.16, sink: 5, overlap: 8 },
  // How wide a drifting thing is drawn, how many there are, and how they move.
  decor: { width: 52, count: 7, drift: 0.16 },
});

/**
 * Where a repeating layer sits for a given distance. Wrapping here rather than
 * at the draw site keeps the offset from growing without bound across a long
 * round, which is what eventually makes a parallax band stutter.
 */
export function bandOffset(distance, speed, period) {
  const shift = (distance * speed) % period;
  return shift < 0 ? shift + period : shift;
}

// Particles need to sit somewhere, and somewhere needs to be the same place on
// every frame. A hash of the index gives each one a fixed spot without storing
// a list of them or letting Math.random scatter them anew sixty times a second.
function scatter(index, salt) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Where the instances of a dotted band are, for a given distance travelled.
 *
 * Each one carries the index it has in the world rather than the one it has in
 * this loop, and that is the whole point of the function. Instance `n` lives at
 * `n * period` in a world that has scrolled `travelled` — so writing
 * `travelled` as `passed` whole periods plus a remainder puts instance
 * `passed + i` at exactly `i * period - remainder`, and its identity and its
 * position come out of the same arithmetic. Jitter keyed off `i` instead is the
 * bug where a tree changes height as it crosses the screen.
 *
 * Only the remainder is ever added up, so nothing grows without bound over a
 * long round — the same reason `bandOffset` wraps where it does.
 */
export function spacedInstances(distance, speed, period, span) {
  const remainder = bandOffset(distance, speed, period);
  const passed = Math.floor((distance * speed) / period);
  const across = Math.ceil(span / period);
  const out = [];
  // One extra either side, so an instance is already in hand before its leading
  // edge reaches the field and is not dropped until its trailing edge is past.
  for (let i = -1; i <= across + 1; i += 1) out.push({ index: passed + i, x: i * period - remainder });
  return out;
}

export function createSceneRenderer(ctx, rules) {
  const { width, height, groundY } = rules;

  /** Repeats a drawing sideways across the whole width at a given height. */
  /**
   * A drawing repeated end to end, scrolled by `travelled` pixels.
   *
   * The wrap happens here, against the tile, and that placement is the whole
   * point. It used to happen at the call site against the *field* width, and
   * since a tile is very unlikely to divide the field evenly, the offset
   * jumping from `width % tileWidth` back to `0` shifted the entire row
   * sideways by the remainder every time it came round — the periodic hiccup in
   * a band that is otherwise perfectly smooth. Wrapped against the tile, the
   * seam lands exactly where the last one did.
   */
  function tileAcross(image, top, bandHeight, travelled) {
    const tileWidth = Math.max(1, image.width * (bandHeight / image.height));
    const shift = bandOffset(travelled, 1, tileWidth);
    // Each copy drawn a hair wider than its slot, so consecutive ones overlap
    // by a fraction of a pixel. Tiles are placed at fractional x — the scroll is
    // a float and the field is scaled by the display's pixel ratio — and a copy
    // whose right edge lands mid-pixel is antialiased against whatever is behind
    // it, which shows as a faint seam flickering along the band. Overlapping
    // costs a sliver of the next tile's leftmost column and removes the seam.
    const overdraw = tileWidth * 0.01;
    for (let x = -shift - tileWidth; x < width + tileWidth; x += tileWidth) {
      ctx.drawImage(image, x, top, tileWidth + overdraw, bandHeight);
    }
  }

  function drawBand(layer, image, distance) {
    if (!image) return;
    const bandHeight = layer.height + layer.overlap;
    tileAcross(image, groundY - layer.height, bandHeight, distance * layer.speed);
  }

  /**
   * The same drawing repeated with air between the copies. Each one stands on
   * the horizon and varies upward from it — anchoring the bottom is what keeps
   * a row of different-sized things reading as a row of things on the ground
   * rather than as a row of things floating at different heights.
   */
  function drawSpaced(layer, image, distance) {
    if (!image) return;
    const nominal = Math.max(1, image.width * (layer.height / image.height));
    // Measured off the nominal width rather than each instance's jittered one,
    // so the spacing is a constant for the whole round and the wrap stays exact.
    const period = nominal * layer.gap;

    for (const { index, x } of spacedInstances(distance, layer.speed, period, width)) {
      const scale = 1 + (scatter(index, 7) - 0.5) * 2 * layer.vary;
      const drawWidth = nominal * scale;
      const drawHeight = layer.height * scale;
      const nudge = (scatter(index, 8) - 0.5) * 2 * layer.sway * period;
      const base = groundY + layer.overlap + (scatter(index, 9) - 0.5) * 2 * layer.sink;
      ctx.drawImage(image, x + nudge, base - drawHeight, drawWidth, drawHeight);
    }
  }

  function drawDecor(image, distance, now) {
    if (!image) return;
    const { width: drawWidth, count, drift } = LAYOUT.decor;
    const seconds = now / 1000;
    const span = width + 120;

    for (let i = 0; i < count; i += 1) {
      const shift = distance * drift + seconds * 8 * drift;
      const x = ((scatter(i, 1) * span - shift) % span + span) % span - 60;
      const y = scatter(i, 2) * groundY;
      // Each one a little different in size, so a scattering of the same
      // drawing doesn't read as a stamped pattern. Sized to a target width
      // rather than by scaling the source, so how big it looks doesn't depend
      // on how large the picture behind it happens to be.
      const w = drawWidth * (0.6 + scatter(i, 4) * 0.7);
      ctx.drawImage(image, x, y, w, w * (image.height / image.width));
    }
  }

  return {
    /** Everything behind the gates: sky, both bands, and the drifting things. */
    drawBackdrop(scene, images, distance, now) {
      // A flat fill under everything, always, even though a drawing is about to
      // go straight over the top of it. That is the whole fallback: a backdrop
      // that hasn't finished decoding, or one whose record went missing from an
      // imported bundle, shows sky rather than nothing at all — and one
      // fillRect a frame is not worth being clever about.
      ctx.fillStyle = SKY;
      ctx.fillRect(0, 0, width, height);

      // Stretched to the field rather than cropped to fill it. Every other slot
      // is a shape whose proportions matter; this one is the field, and it is
      // drawn at the field's own 8:5 so there is nothing to squash.
      const sky = images.get(scene.backdrop.sprite, 'backdrop');
      if (sky) ctx.drawImage(sky, 0, 0, width, height);

      drawBand(LAYOUT.far, images.get(scene.far.sprite, 'far'), distance);
      // Drifting things sit between the two: in front of the far band, which is
      // the horizon, and behind the scenery, which is the near side of the
      // world. Drawn last they passed in front of the trees, and a cloud
      // crossing a trunk reads as being closer to you than the tree is.
      drawDecor(images.get(scene.decor.sprite, 'decor'), distance, now);
      drawSpaced(LAYOUT.near, images.get(scene.near.sprite, 'near'), distance);
    },

    drawGround(scene, images, distance) {
      const image = images.get(scene.ground.sprite, 'ground');
      if (!image) return;
      tileAcross(image, groundY, height - groundY, distance);
    },
  };
}
