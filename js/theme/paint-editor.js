// Drawing, in a window of its own. Three tools, three brush sizes, and a row of
// colours — which is the whole of it, because this is for knocking out a tomato
// with a face on it, not for finished art. Lines, boxes, ellipses and a colour
// dropper were all here once and all went: seven tools is a thing to read
// before you can start, and a fat brush draws a box well enough.
//
// It opens as a modal `<dialog>` rather than unfolding inside the page. The
// browser then handles the backdrop, Escape, holding focus inside it, and
// making the rest of the page inert — all of which a hand-rolled panel has to
// get right by hand, and usually doesn't.
//
// It always opens on a picture: yours, or the default. There is never a blank
// canvas and never a question about which of the two is in use, because
// painting over what is already there is the only way in.
//
// The editor never touches storage itself. It reports a finished canvas upward
// and lets whoever opened it decide what that means, which is what lets the same
// window edit a craft, an obstacle, a hillside, and a cloud.

import {
  CANVAS, makeCanvas, bucketFill, hexToRgba, isBlank,
} from './raster.js';
import { SLOT_SIZE } from './defaults.js';
import { imageFromFile } from './images.js';
import { createColourPicker } from './colour-picker.js';

const TOOLS = [
  ['brush', '🖌️', 'Brush'],
  ['eraser', '🧽', 'Eraser'],
  ['fill', '🪣', 'Fill an area'],
];

const WIDTHS = [['4', 'thin'], ['12', 'medium'], ['28', 'thick']];

const button = (className, label, title) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  if (title) element.title = title;
  return element;
};

/**
 * Opens a drawing window on `source` (a canvas).
 *
 * `onCommit(canvas)` fires when a stroke finishes rather than on every move, so
 * a drag is one save and one undo step rather than forty of each.
 */
export function createPaintEditor({
  source, title, onCommit, onClose, onReset, size = SLOT_SIZE,
}) {
  const wide = size.width !== size.height;
  // Brush widths are in canvas pixels, so on a bigger frame the same number is
  // a finer pen. Scaled once here instead, so "thick" stays the same fraction
  // of the picture whatever the picture is.
  const brush = (value) => Math.round(Number(value) * (size.width / CANVAS));

  let tool = 'brush';
  let colour = '#1b1c20';
  let width = brush(12);
  let drawing = false;
  let from = null;
  const undo = [];

  const dialog = document.createElement('dialog');
  dialog.className = 'paint-dialog';
  dialog.setAttribute('aria-label', `Draw ${title ?? 'a sprite'}`);

  const shell = document.createElement('div');
  shell.className = 'paint-shell';
  // A whole sky in a 408px box is not editable. Marked rather than measured so
  // the stylesheet keeps the widths.
  if (wide) shell.dataset.wide = 'true';

  // --- The canvas -----------------------------------------------------------
  const canvas = makeCanvas(size);
  canvas.className = 'paint-canvas';
  // Set here rather than in the stylesheet, because it is per-instance now. A
  // stale square would letterbox the canvas inside its box — and `pointFrom`
  // below assumes the element's shape matches the bitmap's, so a letterboxed
  // canvas would put every stroke somewhere other than under the cursor.
  canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Drawing canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Stretched to the frame, which is also what the game does with a backdrop —
  // so a drawing made before this slot grew reopens looking as it plays, and is
  // saved at the new size the first time anybody touches it.
  if (ctx && source) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const whole = () => ctx.getImageData(0, 0, canvas.width, canvas.height);

  // How much undo history to keep, in bytes rather than in steps. A snapshot is
  // four bytes a pixel: a quarter-megabyte on a 256 square, but a megabyte and a
  // half on the sky. Fifteen of those would be twenty-odd megabytes of retained
  // ImageData for one editing session, which is enough to make a modest laptop
  // struggle — so the deep history stays where it is cheap.
  const UNDO_BUDGET = 4_000_000;

  function snapshot() {
    undo.push(whole());
    let held = undo.reduce((sum, frame) => sum + frame.data.length, 0);
    while (undo.length > 1 && held > UNDO_BUDGET) {
      held -= undo.shift().data.length;
    }
  }

  const commit = () => onCommit?.(canvas, { blank: isBlank(whole()) });

  // --- Placing a picture ------------------------------------------------------
  // A picture brought in used to be cropped to fill the frame and stamped down,
  // which meant the only say you had over what survived was which photo you
  // picked. Now it arrives floating: sized to fit, draggable, and scalable, and
  // nothing is written to the drawing until you say so.
  //
  // `under` is the drawing as it stood before the picture arrived. Every frame
  // of the placement puts that back and redraws the picture over it, so moving
  // the picture around never eats what is underneath — and cancelling is just
  // putting it back one last time.
  let placing = null;

  /** Sized to sit entirely inside the frame, centred: the default placement. */
  function fitted(image, cover = false) {
    const pick = cover ? Math.max : Math.min;
    const scale = pick(canvas.width / image.width, canvas.height / image.height);
    return {
      scale,
      x: (canvas.width - image.width * scale) / 2,
      y: (canvas.height - image.height * scale) / 2,
    };
  }

  function paintPlacement() {
    if (!placing) return;
    ctx.putImageData(placing.under, 0, 0);
    const { image, x, y, scale } = placing;
    ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
  }

  function beginPlacing(image) {
    // Whatever was already being placed is abandoned rather than stacked: two
    // floating pictures would need two sets of handles and one of them would
    // always be the one you did not mean.
    const under = placing ? placing.under : whole();
    placing = { image, under, ...fitted(image) };
    paintPlacement();
    syncPlacing();
  }

  function endPlacing(keep) {
    if (!placing) return;
    if (keep) {
      // The snapshot is taken here rather than when the picture arrived, so undo
      // steps back to the drawing as it was before any of this — one step for
      // the whole placement, not one per nudge.
      undo.push(placing.under);
      placing = null;
      commit();
    } else {
      ctx.putImageData(placing.under, 0, 0);
      placing = null;
    }
    syncPlacing();
  }

  /** Scales about a point, so the picture grows toward wherever you are. */
  function zoomAt(point, factor) {
    if (!placing) return;
    const next = Math.max(0.02, Math.min(20, placing.scale * factor));
    // Keep whatever is under the pointer under the pointer.
    placing.x = point.x - (point.x - placing.x) * (next / placing.scale);
    placing.y = point.y - (point.y - placing.y) * (next / placing.scale);
    placing.scale = next;
    paintPlacement();
  }

  function pointFrom(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function dab(start, end) {
    // The eraser is the same brush punching a hole instead of laying paint,
    // which is what keeps a rubbed-out edge as soft as a drawn one.
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!ctx) return;
    event.preventDefault();
    const point = pointFrom(event);

    // While a picture is floating, the canvas moves it rather than painting on
    // it. Painting over something you have not placed yet would be drawing on a
    // preview, and the strokes would vanish the moment you nudged it.
    if (placing) {
      placing.grab = { x: point.x - placing.x, y: point.y - placing.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    snapshot();

    if (tool === 'fill') {
      const image = whole();
      if (bucketFill(image, Math.floor(point.x), Math.floor(point.y), hexToRgba(colour))) {
        ctx.putImageData(image, 0, 0);
        commit();
      } else {
        undo.pop();
      }
      return;
    }

    drawing = true;
    from = point;
    canvas.setPointerCapture(event.pointerId);
    dab(point, point);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (placing?.grab) {
      const point = pointFrom(event);
      placing.x = point.x - placing.grab.x;
      placing.y = point.y - placing.grab.y;
      paintPlacement();
      return;
    }
    if (!drawing) return;
    const point = pointFrom(event);
    dab(from, point);
    from = point;
  });

  canvas.addEventListener('pointerup', () => {
    if (placing) placing.grab = null;
  });

  canvas.addEventListener('wheel', (event) => {
    if (!placing) return;
    event.preventDefault();
    // Trackpads report in pixels and mice in lines or pages; normalising to a
    // small fixed step keeps a pinch and a wheel click feeling like each other.
    zoomAt(pointFrom(event), event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  // --- The cursor -----------------------------------------------------------
  // Three named sizes tell you there are three, not how big any of them is on
  // the picture in front of you — and the same 28px brush is a broad sweep on a
  // small preview and a fine line on a large one. So the pointer wears the
  // brush: a ring the exact width of the stroke it is about to lay down.
  const stage = document.createElement('div');
  stage.className = 'paint-stage';
  const cursor = document.createElement('div');
  cursor.className = 'paint-cursor';
  cursor.hidden = true;
  stage.append(canvas, cursor);

  // Where the pointer last was, so picking a fatter brush resizes the ring
  // under a hand that hasn't moved.
  let hover = null;

  function paintCursor() {
    if (!hover) {
      cursor.hidden = true;
      return;
    }
    const box = canvas.getBoundingClientRect();
    cursor.hidden = false;
    cursor.style.left = `${hover.x - box.left}px`;
    cursor.style.top = `${hover.y - box.top}px`;
    cursor.dataset.tool = tool;

    // The fill tool floods a region rather than drawing a line, so it has no
    // width for a ring to stand for. It wears its bucket instead, hung off the
    // stylesheet, with a dot marking the pixel the flood starts from.
    if (tool === 'fill') {
      cursor.style.width = '0px';
      cursor.style.height = '0px';
      // The dot is the colour about to be poured.
      cursor.style.color = colour;
      return;
    }

    // The canvas is drawn at whatever size the dialog gives it, so a stroke of
    // `width` canvas pixels is this many pixels on screen. One scale factor
    // serves both axes only because the element keeps the bitmap's shape.
    const ring = width * (box.width / canvas.width);
    cursor.style.width = `${ring}px`;
    cursor.style.height = `${ring}px`;
    // The ring carries the colour it will paint with, which answers "what am I
    // holding" without a trip back up to the swatches.
    cursor.style.borderColor = tool === 'eraser' ? '' : colour;
  }

  const trackCursor = (event) => {
    hover = { x: event.clientX, y: event.clientY };
    paintCursor();
  };
  const dropCursor = () => {
    hover = null;
    paintCursor();
  };

  canvas.addEventListener('pointermove', trackCursor);
  canvas.addEventListener('pointerdown', trackCursor);
  canvas.addEventListener('pointerenter', trackCursor);
  canvas.addEventListener('pointerleave', dropCursor);
  // A finger leaves no pointer behind when it lifts, so neither should the ring.
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') dropCursor();
  });

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    commit();
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // --- Header ---------------------------------------------------------------
  const header = document.createElement('div');
  header.className = 'paint-head';
  const heading = document.createElement('strong');
  // The slot's own name, not "Draw <name>": you arrived by clicking a pencil
  // and there is a canvas in front of you, so the verb is not news — and one
  // sentence cannot be phrased to fit "You", "Obstacles" and "The ground" at
  // once without reading badly for at least one of them.
  heading.textContent = title ?? 'Drawing';
  // What you are actually drawing on. Worth stating because it is no longer one
  // number for everything — the sky is wide, a pillar is tall — and because it
  // is the thing you need to know before bringing a picture in.
  const resolution = document.createElement('span');
  resolution.className = 'paint-size';
  resolution.textContent = `${size.width} × ${size.height}`;

  const close = button('icon-btn', '✕', 'Close');
  close.addEventListener('click', () => finish());
  header.append(heading, resolution, close);

  // --- The toolbar ----------------------------------------------------------
  // One row: what the pointer does, how wide, what colour, and the two things
  // you do to the whole drawing. It was three stacked rows, which put more
  // chrome above the canvas than there was canvas.
  const bar = document.createElement('div');
  bar.className = 'paint-bar';

  const toolGroup = document.createElement('div');
  toolGroup.className = 'paint-group';
  const toolButtons = TOOLS.map(([id, glyph, label]) => {
    const element = button('paint-tool', glyph, label);
    element.dataset.tool = id;
    element.setAttribute('aria-label', label);
    element.addEventListener('click', () => {
      tool = id;
      syncTools();
    });
    toolGroup.appendChild(element);
    return element;
  });

  function syncTools() {
    toolButtons.forEach((element) =>
      element.setAttribute('aria-pressed', String(element.dataset.tool === tool)));
    paintCursor();
  }

  // --- Brush width ----------------------------------------------------------
  const sizeGroup = document.createElement('div');
  sizeGroup.className = 'paint-group';
  const sizeButtons = WIDTHS.map(([value, label]) => {
    const element = button('paint-size', '', `${label} brush`);
    element.setAttribute('aria-label', `${label} brush`);
    const dot = document.createElement('span');
    // The button shows the width it sets, at the size it sets, capped so the
    // thickest one still fits in a button.
    dot.style.width = `${Math.min(Number(value), 16)}px`;
    dot.style.height = `${Math.min(Number(value), 16)}px`;
    element.appendChild(dot);
    element.setAttribute('aria-pressed', String(brush(value) === width));
    element.addEventListener('click', () => {
      width = brush(value);
      sizeButtons.forEach((other) =>
        other.setAttribute('aria-pressed', String(other === element)));
      paintCursor();
    });
    sizeGroup.appendChild(element);
    return element;
  });

  // --- Colour ---------------------------------------------------------------
  const picker = createColourPicker({
    value: colour,
    label: 'Brush colour',
    // Hung off the dialog rather than the toolbar: the toolbar is inside the
    // panel that scrolls, and a scrolling panel cuts off anything that leaves
    // it. The dialog is also the top layer, so the swatches stay above the
    // backdrop and above the page.
    layer: dialog,
    onPick: (next) => {
      colour = next;
      // Reaching for a colour means you want to paint with it, so the eraser
      // steps aside rather than silently ignoring the choice.
      if (tool === 'eraser') tool = 'brush';
      syncTools();
    },
  });

  // --- Undo and clear -------------------------------------------------------
  const actionGroup = document.createElement('div');
  actionGroup.className = 'paint-group paint-group-end';

  const undoButton = button('paint-tool', '↶', 'Undo');
  undoButton.setAttribute('aria-label', 'Undo');
  undoButton.addEventListener('click', () => {
    const previous = undo.pop();
    if (!previous) return;
    ctx.putImageData(previous, 0, 0);
    commit();
  });

  const clearButton = button('paint-tool', '🗑', 'Wipe the whole canvas');
  clearButton.setAttribute('aria-label', 'Wipe the whole canvas');
  clearButton.addEventListener('click', () => {
    snapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    commit();
  });

  // Wiping and resetting are different things, and only one of them was here.
  // Wiping leaves you with an empty canvas, which is a picture — an invisible
  // obstacle is a fair thing to want. Resetting puts the drawing the game came
  // with back, which is the one you want when an experiment went badly and you
  // would rather start from something than from nothing.
  const resetButton = button('paint-tool', '↺', 'Put the default drawing back');
  resetButton.setAttribute('aria-label', 'Put the default drawing back');
  resetButton.addEventListener('click', async () => {
    const fresh = await onReset?.();
    if (!fresh) return;
    snapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fresh, 0, 0, canvas.width, canvas.height);
    commit();
  });
  actionGroup.append(undoButton, resetButton, clearButton);

  bar.append(toolGroup, sizeGroup, picker.element, actionGroup);
  syncTools();

  // --- Bringing a picture in ------------------------------------------------
  const footer = document.createElement('div');
  footer.className = 'paint-footer';

  const note = document.createElement('span');
  note.className = 'theme-note';

  const upload = document.createElement('label');
  upload.className = 'btn btn-soft paint-upload';
  upload.textContent = 'Use a picture';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.className = 'visually-hidden-file';
  file.addEventListener('change', async () => {
    const [chosen] = file.files ?? [];
    if (!chosen) return;
    await bringIn(chosen);
    file.value = '';
  });
  upload.appendChild(file);

  /**
   * Floats a picture over the drawing, ready to be placed.
   *
   * One path for the file picker and the clipboard, because they differ only in
   * where the `File` came from.
   */
  async function bringIn(chosen) {
    note.textContent = 'Reading…';
    const brought = await imageFromFile(chosen);
    if (!brought) {
      note.textContent = "That picture couldn't be read.";
      return;
    }
    beginPlacing(brought);
    note.textContent = '';
  }

  // Pasting. Bound to the dialog rather than to the document so it only applies
  // while the editor is the thing you are looking at, and so a paste into a text
  // field somewhere else on the page is never intercepted.
  dialog.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items ?? [])]
      .find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    const picture = item.getAsFile();
    if (!picture) return;
    event.preventDefault();
    bringIn(picture);
  });

  // --- The placement bar ------------------------------------------------------
  // Only up while a picture is floating. It replaces the footer's usual row so
  // there is one obvious thing to do next, rather than a Done button that would
  // quietly discard the thing you are in the middle of positioning.
  const placeBar = document.createElement('div');
  placeBar.className = 'paint-place';
  placeBar.hidden = true;

  const placeHint = document.createElement('span');
  placeHint.className = 'theme-note';
  placeHint.textContent = 'Drag to move, scroll to resize.';

  const fitButton = button('btn btn-soft', 'Fit', 'Sit the whole picture inside the frame');
  fitButton.addEventListener('click', () => {
    if (!placing) return;
    Object.assign(placing, fitted(placing.image));
    paintPlacement();
  });

  const fillButton = button('btn btn-soft', 'Fill', 'Cover the frame, cropping the overflow');
  fillButton.addEventListener('click', () => {
    if (!placing) return;
    Object.assign(placing, fitted(placing.image, true));
    paintPlacement();
  });

  const cancelPlace = button('btn btn-soft', 'Cancel', 'Leave the drawing as it was');
  cancelPlace.addEventListener('click', () => endPlacing(false));

  const placeButton = button('btn paint-done', 'Place', 'Draw it in where it is');
  placeButton.addEventListener('click', () => endPlacing(true));

  placeBar.append(placeHint, fitButton, fillButton, cancelPlace, placeButton);

  /** Swaps the footer between its usual row and the placement one. */
  function syncPlacing() {
    const busy = Boolean(placing);
    canvas.toggleAttribute('data-placing', busy);
    if (busy) cursor.hidden = true;
    placeBar.hidden = !busy;
    upload.hidden = busy;
    done.hidden = busy;
    // The tools would paint onto a preview, so they step aside rather than
    // being left live and misleading.
    bar.hidden = busy;
  }

  const done = button('btn paint-done', 'Done');
  done.addEventListener('click', () => finish());
  footer.append(upload, note, done, placeBar);

  shell.append(header, bar, stage, footer);
  dialog.appendChild(shell);
  document.body.appendChild(dialog);

  // One way out, however it was reached, and safe to reach twice.
  //
  // Not hung off the `close` event alone: `close()` is specified to fire one,
  // but not every engine does — the browser these pages are developed against
  // sets `open` to false and fires nothing, which left the dialog sitting in
  // the document and a second one stacking on top of it the next time somebody
  // pressed the pencil. So each exit calls this directly, and the events are
  // kept as well for the paths the browser starts by itself.
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    picker.destroy();
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose?.();
  }

  dialog.addEventListener('close', finish);
  // Escape dismisses the innermost thing that is open, so with the swatches
  // showing it puts those away and leaves the drawing where it is. Anything
  // else would lose work to a keystroke people press to mean "not that".
  dialog.addEventListener('cancel', (event) => {
    if (!picker.isOpen()) return;
    event.preventDefault();
    picker.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (picker.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      picker.close();
      picker.focus();
      return;
    }
    finish();
  });
  // A click landing on the dialog itself rather than on the panel inside it is
  // a click on the backdrop. The picker closes itself on any click outside it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish();
  });

  dialog.showModal();

  return { element: dialog, destroy: finish };
}
