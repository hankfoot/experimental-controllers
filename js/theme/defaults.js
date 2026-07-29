// What the game looks and sounds like before anybody has changed anything.
//
// ─── ADDING YOUR OWN DEFAULT ASSETS ─────────────────────────────────────────
// Drop files into `assets/sprites/` and `assets/sounds/`, then name them in the
// two manifests below. Anything named here is fetched at startup; anything that
// is missing, or fails to load, quietly falls back — a sprite to the sketch
// drawn further down this file, a sound to silence. So a half-filled manifest
// is fine, and you can add them one at a time.
//
//   SPRITE_FILES.player = 'assets/sprites/player.png';
//   SOUND_FILES.crash   = 'assets/sounds/crash.mp3';
//
// Sprites are drawn onto a 256×256 square, so square art fits best; anything
// else is centre-cropped to fit. Sounds can be any format the browser plays.
// ─────────────────────────────────────────────────────────────────────────────

import { CANVAS } from './raster.js';

/** Slot id → file path, or null to use the built-in sketch. */
export const SPRITE_FILES = {
  player: null,
  obstacle: null,
  block: null,
  ground: null,
  backdrop: null,
  far: null,
  near: null,
  decor: null,
};

/**
 * Sound event → the file that ships with the game, or null for no built-in.
 *
 * These are what `'default'` resolves to (see js/theme/audio.js). They are
 * fetched on the first play and cached decoded, so an event nobody triggers
 * costs nothing. Regenerate them with `python3 scripts/make-sounds.py`.
 */
export const SOUND_FILES = {
  launch: 'assets/sounds/launch.mp3',
  score: 'assets/sounds/score.mp3',
  crash: 'assets/sounds/crash.mp3',
  thrust: 'assets/sounds/thrust.mp3',
  music: 'assets/sounds/music.mp3',
};

// --- The built-in sketches ---------------------------------------------------
// Deliberately rough: thick marker outlines and flat fills, drawn a little
// wobbly so they read as something somebody knocked together rather than as
// finished art. They are meant to look replaceable, because they are.

const INK = '#1b1c20';

/**
 * Nudges a point off its exact position by a fixed amount for its index, so a
 * shape drawn twice is drawn identically but neither time looks ruled.
 */
function wobble(index, amount = 3) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 2 * amount;
}

/** A closed shape through the given points, with a hand-drawn waver. */
function scrawl(ctx, points, { fill, stroke = INK, width = 7, close = true } = {}) {
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = x + wobble(i * 2);
    const py = y + wobble(i * 2 + 1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (close) ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

const SKETCHES = {
  // A little flier with a face on it. The point of drawing a creature rather
  // than a shape is that the first thing most people do here is give it a
  // different expression, and a wedge with no eyes doesn't invite that.
  player(ctx, s) {
    // A scarf trailing off the back, which is most of what sells the motion.
    scrawl(ctx, [
      [s * 0.3, s * 0.46], [s * 0.1, s * 0.4], [s * 0.02, s * 0.5],
      [s * 0.12, s * 0.52], [s * 0.28, s * 0.56],
    ], { fill: '#e5484d', width: 5 });
    // The body: a rounded wedge, nose to the right.
    scrawl(ctx, [
      [s * 0.24, s * 0.3], [s * 0.62, s * 0.32], [s * 0.9, s * 0.5],
      [s * 0.62, s * 0.68], [s * 0.24, s * 0.7], [s * 0.16, s * 0.5],
    ], { fill: '#5b8cff' });
    // A wing folded along the near side, a shade darker so it reads as behind.
    scrawl(ctx, [
      [s * 0.34, s * 0.52], [s * 0.6, s * 0.54], [s * 0.5, s * 0.72],
      [s * 0.34, s * 0.68],
    ], { fill: '#3b6bd8', width: 5 });

    const eye = (cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      // Pupils sit forward in the eye, so it is looking where it is going.
      ctx.arc(cx + r * 0.34, cy, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    };
    eye(s * 0.58, s * 0.44, s * 0.085);
    eye(s * 0.75, s * 0.47, s * 0.06);
  },

  // A section of pillar. Drawn tall rather than square because it is repeated
  // *down* a bar: a square drawing tiles into a stack of squares, which reads as
  // a wall of bricks, where one long segment reads as a pillar with joints.
  // Flat top and bottom so the stack has no seam.
  obstacle(ctx, w, h) {
    ctx.fillStyle = '#4ac06a';
    ctx.fillRect(0, 0, w, h);
    // A lit edge down one side and a shadow down the other: enough to make a
    // flat fill read as something solid rather than as a coloured rectangle.
    ctx.fillStyle = '#6fd98d';
    ctx.fillRect(w * 0.08, 0, w * 0.13, h);
    ctx.fillStyle = '#2f9350';
    ctx.fillRect(w * 0.79, 0, w * 0.13, h);

    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(4, h);
    ctx.moveTo(w - 4, 0);
    ctx.lineTo(w - 4, h);
    ctx.stroke();

    // Bands across it, so a long segment has some rhythm rather than being a
    // plain stripe. Inset from both ends so the joint between two copies is the
    // only line that meets the edge.
    ctx.lineWidth = 6;
    for (const y of [0.22, 0.5, 0.78]) {
      scrawl(ctx, [[w * 0.12, h * y], [w * 0.88, h * y]], { stroke: '#2f9350', close: false });
    }
  },

  // The floating obstacle, which is one object rather than a length of
  // something — so it is square, and it is its own drawing. Sharing one with the
  // pillars meant a shape that had to work both stacked and alone, and did
  // neither especially well.
  block(ctx, s) {
    scrawl(ctx, [
      [s * 0.12, s * 0.2], [s * 0.88, s * 0.14], [s * 0.9, s * 0.84], [s * 0.1, s * 0.88],
    ], { fill: '#f2622e', width: 8 });
    // A face, because it is the thing you spend the round dodging.
    ctx.fillStyle = INK;
    for (const x of [0.36, 0.64]) {
      ctx.beginPath();
      ctx.arc(s * x, s * 0.42, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
    scrawl(ctx, [[s * 0.34, s * 0.66], [s * 0.5, s * 0.58], [s * 0.66, s * 0.66]],
      { stroke: INK, width: 7, close: false });
  },

  // A strip of ground: earth with a band of grass on top, and a few tufts. Flat
  // left and right edges so it runs along the floor without a join showing.
  ground(ctx, s) {
    ctx.fillStyle = '#d9a066';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#c98d4e';
    ctx.fillRect(0, s * 0.4, s, s * 0.6);
    ctx.fillStyle = '#4ac06a';
    ctx.fillRect(0, 0, s, s * 0.22);
    ctx.fillStyle = '#2f9350';
    ctx.fillRect(0, s * 0.19, s, s * 0.05);

    ctx.lineWidth = 5;
    for (let i = 0; i < 4; i += 1) {
      const x = s * (0.14 + i * 0.24);
      scrawl(ctx, [[x, s * 0.2], [x + s * 0.03, s * 0.06]], { stroke: '#2f9350', close: false });
    }
    // Pebbles, so the earth below the grass isn't a flat slab.
    ctx.fillStyle = '#b98c33';
    for (const [x, y, r] of [[0.2, 0.6, 0.045], [0.55, 0.78, 0.035], [0.82, 0.55, 0.05]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * r, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // The whole sky, for when somebody would rather draw one than pick a colour.
  //
  // The only sketch that has to cover its frame edge to edge and opaquely:
  // every other slot is a shape with the page behind it, and this one *is* the
  // page. A transparent margin here shows as a band of browser chrome around
  // the game, which reads as a bug rather than as a drawing.
  backdrop(ctx, w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#8fc4ff');
    sky.addColorStop(0.65, '#d8ecff');
    sky.addColorStop(1, '#f4fbf5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sized off the short side, or it becomes a dinner plate on a wide sky.
    // Small and high in a corner: the menu card sits across the middle of the
    // field, and a sun behind lettering is worse than no sun.
    const sun = Math.min(w, h) * 0.085;
    ctx.beginPath();
    ctx.arc(w * 0.86, h * 0.16, sun, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd76b';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e0a93f';
    ctx.stroke();

    // A far-off ridge, well above where the real scenery sits, so the sky has
    // some depth to it rather than being a flat wash behind everything.
    ctx.globalAlpha = 0.35;
    scrawl(ctx, [
      [0, h], [0, h * 0.82], [w * 0.18, h * 0.7], [w * 0.34, h * 0.79],
      [w * 0.52, h * 0.66], [w * 0.72, h * 0.78], [w, h * 0.72], [w, h],
    ], { fill: '#9fb2cc', stroke: null });
    ctx.globalAlpha = 1;
  },

  // Rolling hills, repeated end to end across the back. Both side edges sit at
  // the same height so a row of them joins into one continuous skyline.
  //
  // Outlined in a washed-out blue rather than in ink. Everything else here is
  // drawn with the same near-black marker, but this band is the furthest thing
  // in the picture and a hard black edge on it pulls it forward — it ends up
  // reading as the scenery rather than as the distance behind the scenery.
  far(ctx, s) {
    const HAZE = '#7f93b0';
    scrawl(ctx, [
      [0, s], [0, s * 0.7], [s * 0.16, s * 0.5], [s * 0.32, s * 0.64],
      [s * 0.52, s * 0.38], [s * 0.72, s * 0.62], [s * 0.86, s * 0.52],
      [s, s * 0.7], [s, s],
    ], { fill: '#b3c2d8', stroke: HAZE, width: 4 });
    // A lighter face on one side of each peak, for a bit of relief.
    scrawl(ctx, [
      [s * 0.52, s * 0.38], [s * 0.72, s * 0.62], [s * 0.62, s * 0.66],
    ], { fill: '#c9d5e6', stroke: null });
  },

  // A tree, standing on its own. Unlike the band behind it this one is dotted
  // along with air either side, so it is drawn as one object rather than as a
  // strip that has to join up with itself.
  near(ctx, s) {
    scrawl(ctx, [
      [s * 0.46, s], [s * 0.46, s * 0.5], [s * 0.54, s * 0.5], [s * 0.54, s],
    ], { fill: '#7a4a26', width: 5 });
    // Three tiers, widest at the bottom.
    const tier = (y, half, drop) => scrawl(ctx, [
      [s * 0.5, y], [s * (0.5 + half), y + drop], [s * (0.5 - half), y + drop],
    ], { fill: '#3f8f4f', width: 6 });
    tier(s * 0.52, 0.3, s * 0.16);
    tier(s * 0.3, 0.26, s * 0.16);
    tier(s * 0.1, 0.2, s * 0.16);
  },

  // A cloud. Also has to pass for a bubble or a speck, being the only one.
  //
  // Filled twice rather than filled and stroked: three overlapping circles in
  // one path stroke as three rings, including the arcs buried inside the shape,
  // which reads as chainmail rather than as a cloud. A dark blob with a
  // slightly smaller white one on top leaves an outline around the silhouette
  // and nothing across the middle.
  decor(ctx, s) {
    const puffs = [[0.32, 0.58, 0.19], [0.5, 0.44, 0.24], [0.7, 0.56, 0.18]];
    const blob = (grow, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const [x, y, r] of puffs) ctx.arc(s * x, s * y, s * r + grow, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(4, INK);
    blob(-1, '#ffffff');
    // A soft underside, so it isn't a flat white cut-out.
    ctx.save();
    ctx.beginPath();
    for (const [x, y, r] of puffs) ctx.arc(s * x, s * y, s * r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#dfe8f5';
    ctx.fillRect(0, s * 0.6, s, s);
    ctx.restore();
  },
};

/** The shape of a drawing, unless a slot says otherwise. */
export const SLOT_SIZE = Object.freeze({ width: CANVAS, height: CANVAS });

// The sky is the one slot with a size of its own: it is stretched across the
// whole field rather than repeated or drawn as an object, so a square drawing
// would be squashed to nothing like the right proportions. 768×480 is exactly
// the field's 8:5 and exactly three times the working unit.
const WIDE = Object.freeze({ width: 768, height: 480 });

export const SLOTS = Object.freeze([
  { id: 'player', label: 'You', emoji: '🚀', help: 'The thing you steer.' },
  {
    id: 'obstacle',
    label: 'Pillars',
    emoji: '🧱',
    help: 'Repeated down each bar you fly past.',
    // Taller than it is wide, because it is stacked: one long segment reads as
    // a pillar where a square one reads as brickwork. Only half again as tall,
    // though — a bar is drawn at a fixed width, so the segment's own proportion
    // is exactly how tall each copy comes out, and 2:1 made pillars built from
    // two enormous slabs.
    size: Object.freeze({ width: 192, height: 288 }),
  },
  { id: 'block', label: 'Floating blocks', emoji: '🟧', help: 'The one that hangs in mid-air.' },
  { id: 'ground', label: 'The ground', emoji: '🟫', help: 'Repeated along the floor.' },
  {
    id: 'backdrop',
    label: 'The sky',
    emoji: '🌤️',
    help: 'Behind everything, stretched to fill the whole field.',
    size: WIDE,
    // Cropping to the ink is meaningless for a drawing defined to fill its
    // frame, and measuring it is a full pixel read on every brush stroke.
    crop: false,
  },
  { id: 'far', label: 'Far background', emoji: '⛰️', help: 'Repeated across the back, scrolling slowly.' },
  { id: 'near', label: 'Scenery', emoji: '🌴', help: 'Dotted in front of that — trees, rocks, whatever you like.' },
  { id: 'decor', label: 'Drifting things', emoji: '☁️', help: 'Scattered through the air.' },
]);

export const SLOT_IDS = Object.freeze(SLOTS.map((slot) => slot.id));

const BY_ID = new Map(SLOTS.map((slot) => [slot.id, slot]));

/**
 * How big a slot's drawing is. The only door to "the sky is the exception", so
 * that fact lives in exactly one place and everything downstream just asks.
 */
export function sizeOf(slotId) {
  return BY_ID.get(slotId)?.size ?? SLOT_SIZE;
}

/** Whether a slot's drawing should be cropped to its ink when shown small. */
export function cropsToInk(slotId) {
  return BY_ID.get(slotId)?.crop !== false;
}

/**
 * Paints a slot's built-in sketch onto a canvas context.
 *
 * Both dimensions are passed, but only the sky reads the second: for every
 * other slot they are equal, and rewriting six square sketches to mention a
 * height they cannot differ in would only invite the mistake of turning a
 * radius into one of the two axes.
 */
export function drawSketch(slot, ctx, size = SLOT_SIZE) {
  const sketch = SKETCHES[slot];
  if (!sketch) return false;
  ctx.save();
  sketch(ctx, size.width, size.height);
  ctx.restore();
  return true;
}
