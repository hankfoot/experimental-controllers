// What is missing between the controller somebody built and the game.
//
// Every screen before this one reports on its own half — Sensing lists the
// inputs you picked, Controls draws the wires you made — and each of them looks
// perfectly finished on its own while the pair of them adds up to a game that
// cannot be flown. So the check belongs here, at the point where you find out,
// and it names the one thing furthest from done rather than listing them all.
//
// It is never a blocker. The keys still work, and every message says so: a room
// halfway through building a controller should still be able to play.

const COUNTS = ['no', 'one', 'two', 'three', 'four'];
const count = (n) => COUNTS[n] ?? String(n);

/**
 * What is wrong with the wiring right now, or null when the controller can fly
 * the craft. Deliberately says nothing about how to word it: this is the half
 * worth testing, and it has no business knowing what a document is.
 *
 * `steering` is what the scheme says it needs — see the SCHEMES merge in
 * js/games/sidescroller.js.
 */
export function diagnose({ steering, connections, signals }) {
  const wired = new Map();
  for (const { source, target } of connections) {
    const key = `${target.node}.${target.port}`;
    if (!wired.has(key)) wired.set(key, new Set());
    wired.get(key).add(source);
  }

  const controls = steering.map((control) => ({
    label: control.label,
    total: control.keys.length,
    done: control.keys.filter((key) => wired.has(key)).length,
    sources: control.keys.flatMap((key) => [...(wired.get(key) ?? [])]),
  }));

  if (!signals.some((signal) => signal.planned || signal.live)) {
    return { reason: 'no-inputs', level: 'empty' };
  }

  if (controls.every((control) => control.done === 0)) {
    return { reason: 'nothing-wired', level: 'empty', controls };
  }

  // A half-wired control is worse than an unwired one and reads worse too — the
  // craft moves, just never back — so it is the one that gets named first.
  const partial = controls.find((control) => control.done > 0 && control.done < control.total);
  if (partial) return { reason: 'half-wired', level: 'partial', control: partial };

  const empty = controls.find((control) => control.done === 0);
  if (empty) return { reason: 'control-unwired', level: 'partial', control: empty };

  // Everything is wired, which is the point at which a wire to a reading the
  // board has never actually sent stops being invisible. The board is the only
  // thing that can tell us a channel exists, so silence here usually means the
  // reading was left out of the code that got flashed.
  const quiet = [...new Set(controls.flatMap((control) => control.sources))]
    .map((channel) => signals.find((signal) => signal.channel === channel))
    .filter((signal) => signal && !signal.live);
  if (quiet.length) return { reason: 'silent', level: 'partial', signals: quiet };

  return null;
}

/** A link into another screen, using the same delegated handler the pagers do. */
function tabLink(label, target) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link-btn';
  button.dataset.tabTarget = target;
  button.textContent = label;
  return button;
}

function strong(text) {
  const element = document.createElement('strong');
  element.textContent = text;
  return element;
}

const controlsLink = () => tabLink('Controls', 'controls');

/**
 * The finding, in words. Text and elements rather than a string of HTML, since
 * a channel's name comes from whatever somebody typed in MakeCode.
 */
function describe(found) {
  if (found.reason === 'no-inputs') {
    return [
      'You haven\'t picked any inputs yet, so there is nothing to wire. Check the ones your '
      + 'controller uses over on ',
      tabLink('Sensing', 'sensing'),
      '.',
    ];
  }
  if (found.reason === 'nothing-wired') {
    return [
      'Nothing on your controller steers the game yet. Wire an input to ',
      strong(found.controls.map((control) => control.label).join(' or ')),
      ' over on ',
      controlsLink(),
      '.',
    ];
  }
  if (found.reason === 'half-wired') {
    return [
      strong(found.control.label),
      ` takes ${count(found.control.total)} inputs and only ${count(found.control.done)} is wired,`
      + ' so the craft can only go one way. Add the other on ',
      controlsLink(),
      '.',
    ];
  }
  if (found.reason === 'control-unwired') {
    return [
      'Nothing is wired to ',
      strong(found.control.label),
      ' yet — wire an input to it on ',
      controlsLink(),
      '.',
    ];
  }
  const many = found.signals.length > 1;
  return [
    'Wired to ',
    strong(found.signals.map((signal) => signal.label).join(' and ')),
    `, but your board hasn't sent ${many ? 'those' : 'that'} yet. Check it is connected, and that `
    + `${many ? 'those readings are' : 'that reading is'} among the inputs you flashed.`,
  ];
}

export function initGameWarning({ element, signalStore, engine, host }) {
  if (!element || !signalStore || !engine || !host) return null;

  function render() {
    const game = host.activeGame();
    const found = game?.steering
      ? diagnose({
        steering: game.steering,
        connections: engine.listConnections(),
        signals: signalStore.all(),
      })
      : null;

    element.hidden = !found;
    if (!found) {
      // Emptied rather than just hidden: this is a live region, and leaving the
      // last complaint sitting in it means the next one that happens to match it
      // word for word is never announced.
      element.replaceChildren();
      return;
    }
    element.dataset.level = found.level;
    element.replaceChildren(
      ...describe(found),
      // Said every time rather than once, because it is the reassuring half and
      // whoever is reading this is looking at the alarming half.
      ' The keys under the game work either way.',
    );
  }

  engine.subscribe(render);
  signalStore.subscribe(render);
  host.onGameChange(render);
  render();
  return { render };
}
