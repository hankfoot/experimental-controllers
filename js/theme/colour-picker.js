// A colour, behind a chip that shows the one you are holding. Sixteen swatches
// laid out flat is two rows of chrome for something you change every minute or
// so; behind a chip they cost one click and no permanent space.
//
// Shared by the paint editor and the menu card, which is why it lives here
// rather than inside either of them: they want the same swatches, the same
// custom-colour rainbow, and the same behaviour when you press Escape.

import { placeUnder } from '../anchor.js';

const SWATCHES = [
  '#1b1c20', '#6b7280', '#c9ced8', '#ffffff',
  '#c62f3b', '#f2622e', '#f4b400', '#f7e463',
  '#2f8f3f', '#67c96a', '#1f6feb', '#5eb0ff',
  '#6b3fa0', '#c76bd6', '#7a4a26', '#d9a066',
];

const button = (className) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  return element;
};

/**
 * `onPick(colour, { settled })` fires as the colour changes. `settled` is false
 * while the system picker is still being dragged about, so a caller that wants
 * to save can wait for the one that isn't.
 */
export function createColourPicker({ value, onPick, label = 'Colour', layer = null }) {
  let colour = value;
  let open = false;

  const root = document.createElement('div');
  root.className = 'swatch-picker';

  const chip = button('swatch-chip');
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');
  const dot = document.createElement('span');
  dot.className = 'swatch-chip-dot';
  const caret = document.createElement('span');
  caret.className = 'swatch-chip-caret';
  caret.textContent = '▾';
  caret.setAttribute('aria-hidden', 'true');
  chip.append(dot, caret);

  const palette = document.createElement('div');
  palette.className = 'swatch-palette';
  palette.hidden = true;

  // A colour input draws its own little well — a swatch inset in a white
  // border — which beside sixteen flat ones reads as a seventeenth preset that
  // happens to be blue. So the input itself is made invisible and laid over a
  // rainbow chip, which is what "any other colour" looks like everywhere else.
  const customWrap = document.createElement('label');
  customWrap.className = 'swatch-custom';
  customWrap.title = 'Any other colour';
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'swatch-custom-input';
  custom.setAttribute('aria-label', 'Any other colour');
  custom.value = '#1b1c20';
  customWrap.appendChild(custom);

  /**
   * Puts the swatches under the chip when they cannot simply hang off it.
   *
   * Inside the paint window the picker sits in a panel that scrolls, and a
   * scrolling box clips whatever leaves it — which cut the swatches off mid-row
   * against the edge of the window. Hanging them off the dialog instead, out of
   * the scroller and measured against the viewport, is what lets a popover be
   * bigger than the thing that opened it.
   */
  function place() {
    if (!layer) return;
    placeUnder(chip, palette);
  }

  function setOpen(next) {
    open = next;
    palette.hidden = !next;
    chip.setAttribute('aria-expanded', String(next));
    // Measured while it is showing: a hidden element has no size to centre on.
    if (next) place();
  }

  function sync() {
    dot.style.background = colour;
    chip.title = `${label} — ${colour}`;
    chip.setAttribute('aria-label', `${label}, currently ${colour}`);
    [...palette.querySelectorAll('.swatch')].forEach((swatch) =>
      swatch.setAttribute('aria-pressed', String(swatch.dataset.colour === colour)));
    // Marked when the colour in hand came from the picker rather than the row,
    // so the selection is shown somewhere whichever way it was chosen.
    customWrap.dataset.active = String(!SWATCHES.includes(colour));
  }

  function pick(next, { settled = true } = {}) {
    colour = next;
    sync();
    if (settled) setOpen(false);
    onPick?.(next, { settled });
  }

  for (const swatch of SWATCHES) {
    const chipButton = button('swatch');
    chipButton.dataset.colour = swatch;
    chipButton.style.background = swatch;
    chipButton.title = swatch;
    chipButton.setAttribute('aria-label', `Colour ${swatch}`);
    chipButton.addEventListener('click', () => pick(swatch));
    palette.appendChild(chipButton);
  }
  palette.appendChild(customWrap);

  custom.addEventListener('input', () => pick(custom.value, { settled: false }));
  // The picker is done being dragged about, so this is the colour that sticks.
  custom.addEventListener('change', () => pick(custom.value));

  chip.addEventListener('click', () => setOpen(!open));

  // Anywhere else on the page means "not that one after all".
  // Both boxes, because the swatches may have been hung somewhere else in the
  // document — a click on one of them is still a click on this picker.
  const onDocumentClick = (event) => {
    if (!open) return;
    if (root.contains(event.target) || palette.contains(event.target)) return;
    setOpen(false);
  };
  document.addEventListener('click', onDocumentClick);

  root.appendChild(chip);
  if (layer) {
    palette.classList.add('swatch-palette-floating');
    layer.appendChild(palette);
  } else {
    root.appendChild(palette);
  }
  sync();

  const replace = () => { if (open) place(); };
  window.addEventListener('resize', replace);

  return {
    element: root,
    isOpen: () => open,
    close: () => setOpen(false),
    focus: () => chip.focus(),
    destroy() {
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('resize', replace);
      palette.remove();
    },
  };
}
