// Putting a popover under the thing that opened it.
//
// Extracted when a second caller wanted it. The awkward part is not the
// arithmetic, it is that the popover is measured against the *viewport* rather
// than against its opener's parent: a control inside a scrolling panel would
// otherwise have its popover clipped at the panel's edge, and a control near
// the bottom of the window would have half of it below the fold.
//
// Both callers therefore park the popover on `document.body` and position it
// `fixed`. What lives here is only where to put it.

/**
 * Centres `box` under `anchor`, flipping above when there is no room below and
 * sliding along the edge rather than off it. Writes `left`/`top` in pixels, so
 * the element must already be `position: fixed` and visible — a hidden element
 * has no size to centre on.
 */
export function placeUnder(anchor, box, { gap = 6, margin = 8 } = {}) {
  const from = anchor.getBoundingClientRect();
  const size = box.getBoundingClientRect();

  const left = Math.min(
    Math.max(margin, from.left + from.width / 2 - size.width / 2),
    Math.max(margin, window.innerWidth - size.width - margin),
  );
  const below = from.bottom + gap;
  const top = below + size.height + margin > window.innerHeight
    ? Math.max(margin, from.top - gap - size.height)
    : below;

  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}
