// The controller code builder (Starters screen).
//
// Attendees check the inputs they want (and pick a mode for each pin), and this
// generates the complete MakeCode JavaScript to paste into the template project
// (see Set up), plus wiring / build ideas for each selection. The generated code
// speaks the wire protocol: one "<channel>:<number>" line per reading.
//
// Generated code is written block-style (if/else, no ternaries) so MakeCode can
// decompile it back to blocks for attendees who'd rather edit visually.

import { channelInfo } from './channels.js';
import { key } from './storage-keys.js';

// --- Code fragments ---------------------------------------------------------

// Everything the Set up screen's baseline code does, plus the one function every
// reading goes through. `connect` holds the lines that report each held input's
// current state the moment a browser attaches over Bluetooth — see `edges` for
// why the state has to be sent there rather than every tick.
//
// `send` is the whole reason one flashed program works over either connection:
// the USB cable is always written to, and the radio as well once a browser has
// paired with it. Nothing else in this file writes a line, which is what keeps
// the two from drifting apart.
//
// A named function with a typed parameter still decompiles to blocks, so the
// promise at the top of this file survives — that is the only reason `send` can
// exist rather than every call site carrying both writes.
function scaffoldTop(connect) {
  return [
    // Both of these are MakeCode's defaults. They are written out because "no
    // data over the cable" is otherwise an unexplainable mystery in a workshop,
    // and two lines is a cheap thing to be able to point at.
    'serial.redirectToUSB()',
    'serial.setBaudRate(BaudRate.BaudRate115200)',
    'bluetooth.startUartService()',
    'let connected = false',
    'function send (line: string) {',
    '    serial.writeLine(line)',
    '    if (connected) {',
    '        bluetooth.uartWriteLine(line)',
    '    }',
    '}',
    'bluetooth.onBluetoothConnected(function () {',
    '    connected = true',
    // Drawn here, on the edge, rather than every time round the loop. Redrawing
    // all 25 LEDs ten times a second for a picture that never changes is real
    // work on the same processor that has to keep the Bluetooth radio fed, and
    // starving the radio is what a mystery disconnection usually turns out to be.
    '    basic.showIcon(IconNames.Yes)',
    ...connect.map((line) => '    ' + line),
    '})',
    'bluetooth.onBluetoothDisconnected(function () {',
    '    connected = false',
    '})',
  ];
}

/** Lines that report a true/false reading as "<channel>:1" / "<channel>:0". */
function binary(channel, expr) {
  return [
    `if (${expr}) {`,
    `    send("${channel}:1")`,
    `} else {`,
    `    send("${channel}:0")`,
    `}`,
  ];
}

/**
 * A top-level event handler.
 *
 * This used to wrap every body in `if (connected)`. It had to stop: `connected`
 * only ever becomes true when a *Bluetooth* browser attaches, so with the guard
 * still here a session over the USB cable would fire every handler and send
 * absolutely nothing. Whether the radio is listening is now `send`'s business,
 * and it is asked once rather than at every call site.
 */
function handler(open, body) {
  return [open, ...body.map((l) => '    ' + l), '})'];
}

/**
 * A held input reported the instant it changes, rather than read once a tick.
 *
 * Two things were wrong with polling it in the forever loop. The loop pauses
 * 100 ms, so a press was up to a tenth of a second late and a quick tap between
 * two ticks was never seen at all — which is what "the button feels laggy" is.
 * And the obvious fix, MakeCode's own `on button pressed`, is worse: that block
 * is wired to the DAL's CLICK event, which by definition fires on *release*, so
 * a hold registers as nothing until you let go. Same for `on pin pressed`, and
 * for `TouchButtonEvent.Pressed` on the logo — all three are clicks.
 *
 * So these go straight to the DOWN and UP events underneath, which fire on the
 * edge itself. The cost is that nothing is sent while the input sits still, so
 * a browser that connects mid-hold would hear silence; `connect` covers that by
 * reading the level once as the connection opens.
 */
function edges(channel, { down, up }) {
  const report = (value) => [`send("${channel}:${value}")`];
  return [...handler(down, report(1)), ...handler(up, report(0))];
}

/** DOWN/UP off the event bus, for anything the DAL treats as a button. */
function buttonEdges(channel, source) {
  const on = (event) =>
    `control.onEvent(EventBusSource.${source}, EventBusValue.MICROBIT_BUTTON_EVT_${event}, function () {`;
  return edges(channel, { down: on('DOWN'), up: on('UP') });
}

/** Line that reports a numeric reading as "<channel>:<n>". */
function number(channel, expr) {
  return [`send("${channel}:" + ${expr})`];
}

// --- The inputs -------------------------------------------------------------

/**
 * Each input contributes:
 *   channels — wire channel names it emits (shown as chips on the tile)
 *   loop     — lines run every tick inside the forever loop (while connected)
 *   handlers — top-level event handlers (outside the loop)
 *   setup    — lines run once at startup, after the handlers are registered
 *   build    — one wiring / build-idea note for the "Build it" list
 * Pin inputs have `modes` instead, keyed by mode id.
 *
 * What a tile says the input reads isn't written here: it comes from the
 * channels themselves (see js/channels.js), so the tile you pick an input with
 * and the block you later wire describe it in exactly the same words. `build`
 * stays local, because it's about the thing you make, not the reading.
 */
function describe(channels) {
  return channels.map((channel) => channelInfo(channel).desc).filter(Boolean);
}

function pinInput(n) {
  const ch = `p${n}`;
  return {
    id: ch,
    emoji: '🔌',
    name: `Pin ${n}`,
    modes: {
      touch: {
        label: 'Touch Pad',
        kind: 'binary', form: 'pad',
        channels: [ch],
        // Setting the mode is also what switches the pin into touch sensing, so
        // this doubles as the priming the pin needs — otherwise it sits in
        // digital mode and the touch events never arrive.
        //
        // Capacitive rather than the default resistive, which is the difference
        // between one wire and two. Resistive touch only reads when the player
        // completes a circuit to GND, so it needs a second clip held in the
        // other hand the whole time — fiddly, easy to let slip, and it fails
        // silently when it does. Capacitive senses the body's charge through
        // the one wire. V2 only, which the workshop's boards are.
        setup: [`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Capacitive)`],
        handlers: buttonEdges(ch, `MICROBIT_ID_IO_P${n}`),
        connect: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip one wire from P${n} to anything conductive — foil, fruit, a spoon. ` +
          `Touching the object sends 1. No second wire to hold: the pin senses your body through the one clip.`,
      },
      switch: {
        label: 'Switch',
        kind: 'binary', form: 'switch',
        channels: [ch],
        // An open switch leaves the pin connected to nothing at all, and a
        // floating input doesn't read 0 — it drifts on whatever hum is in the
        // room and reports a stream of rises and falls before anyone has
        // touched the thing. The pull-down ties it to 0 while the circuit is
        // open, so the only rise is the foils actually meeting. It goes before
        // setEvents so the pin is already resting at 0 when edge watching
        // starts, rather than firing an edge from its own settling.
        setup: [
          `pins.setPull(DigitalPin.P${n}, PinPullMode.PullDown)`,
          `pins.setEvents(DigitalPin.P${n}, PinEventType.Edge)`,
        ],
        handlers: edges(ch, {
          down: `control.onEvent(EventBusSource.MICROBIT_ID_IO_P${n}, EventBusValue.MICROBIT_PIN_EVT_RISE, function () {`,
          up: `control.onEvent(EventBusSource.MICROBIT_ID_IO_P${n}, EventBusValue.MICROBIT_PIN_EVT_FALL, function () {`,
        }),
        connect: binary(ch, `pins.digitalReadPin(DigitalPin.P${n}) == 1`),
        build:
          `Make a switch: clip a wire from 3V to one piece of foil, and another from P${n} to a second piece. ` +
          `When the foils touch, the circuit closes and sends 1. Great for jaws, doors, stomp pads.`,
      },
    },
  };
}

/** A one-off accelerometer gesture: fires "<id>:1" via an onGesture handler. */
function gesture(id, name, gestureName, emoji, build) {
  return {
    id, emoji, name,
    kind: 'event',
    channels: [id],
    handlers: handler(`input.onGesture(Gesture.${gestureName}, function () {`,
      [`send("${id}:1")`]),
    build,
  };
}

// Inputs are grouped into three sections shown as separate labelled grids.
const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch & press',
    desc: 'Buttons and things you make conductive. Each sends 1 while active, 0 otherwise.',
    inputs: [
      {
        id: 'btna', emoji: '🔘', name: 'Button A',
        kind: 'binary', form: 'button',
        channels: ['btna'],
        handlers: buttonEdges('btna', 'MICROBIT_ID_BUTTON_A'),
        connect: binary('btna', 'input.buttonIsPressed(Button.A)'),
        build: 'No wiring. To press it with an object, tape something onto the button or build a little lever that pushes it.',
      },
      {
        id: 'btnb', emoji: '🔘', name: 'Button B',
        kind: 'binary', form: 'button',
        channels: ['btnb'],
        handlers: buttonEdges('btnb', 'MICROBIT_ID_BUTTON_B'),
        connect: binary('btnb', 'input.buttonIsPressed(Button.B)'),
        build: 'No wiring. Same tricks as Button A — two buttons means two separate channels.',
      },
      {
        id: 'logo', emoji: '⭐', name: 'Logo touch',
        kind: 'binary', form: 'logo',
        channels: ['logo'],
        // `Touched` is the down event; the one named `Pressed` is the click,
        // and so lands on release. The names are the wrong way round from what
        // you would guess, which is exactly why this is worth spelling out.
        handlers: edges('logo', {
          down: 'input.onLogoEvent(TouchButtonEvent.Touched, function () {',
          up: 'input.onLogoEvent(TouchButtonEvent.Released, function () {',
        }),
        connect: binary('logo', 'input.logoIsPressed()'),
        build: 'No wiring. Touch the gold logo on the front — it even works through a thin strip of foil taped over it.',
      },
      pinInput(0),
      pinInput(1),
      pinInput(2),
    ],
  },
  {
    id: 'motion',
    title: 'Tilt & direction',
    desc: 'How the board is angled or pointed, streamed as a live number every tick.',
    inputs: [
      {
        id: 'pitch', emoji: '📐', name: 'Pitch',
        kind: 'number',
        channels: ['pitch'],
        loop: number('pitch', 'input.rotation(Rotation.Pitch)'),
        build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tip it forward or back. Arrives in degrees. Great for steering.',
      },
      {
        id: 'roll', emoji: '📐', name: 'Roll',
        kind: 'number',
        channels: ['roll'],
        loop: number('roll', 'input.rotation(Rotation.Roll)'),
        build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tip it left or right. Arrives in degrees. Great for steering.',
      },
      {
        id: 'heading', emoji: '🧭', name: 'Compass',
        kind: 'bearing',
        channels: ['heading'],
        // Reading the compass is what triggers calibration, and calibration
        // blocks until it's done. Left to the loop, that lands the moment you
        // connect — the app says connected and the board sits in the tilt game
        // instead of streaming, which reads as a broken connection. One throwaway
        // read up here spends it at power-on instead, while the board is still in
        // your hand. Once calibrated it returns instantly and shows nothing.
        //
        // Assigned rather than left as a bare call, because a reporter standing
        // alone as a statement is not a shape MakeCode can turn back into
        // blocks — it compiles, but it drops the whole program to JavaScript.
        setup: ['let calibrated = input.compassHeading()'],
        loop: number('heading', 'input.compassHeading()'),
        build: 'No wiring — spin your object like a dial. On power-up it asks you to calibrate: tilt the board to fill the LED grid. Calibrate with the finished object assembled, battery and all — the reading is thrown off by whatever is attached, so a bare board calibrated on the bench will be wrong once it is inside your build. Expect to redo it after each download, and test in the room you will play in: laptops, speaker magnets and steel tables all pull it about. On the Controls page you pick which direction to watch for, and whether it fires on arrival or holds while pointing that way.',
      },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures',
    desc: 'One-off moves — the board flags the instant each happens, so unlike the live inputs they add nothing to the Bluetooth load. Lean on these when you can.',
    inputs: [
      gesture('shake', 'Shake', 'Shake', '🫨',
        'No wiring — attach the board to anything shakeable. A maraca, a stuffed animal, a pool noodle.'),
      gesture('tiltleft', 'Tilt left', 'TiltLeft', '👈',
        'No wiring. Fires the moment the board tips past ~45° to the left — a quick flick, not a hold.'),
      gesture('tiltright', 'Tilt right', 'TiltRight', '👉',
        'No wiring. The mirror of tilt-left — pair the two to nudge something left/right.'),
      gesture('logoup', 'Logo up', 'LogoUp', '🙂',
        'No wiring. Board held UPRIGHT (LED display facing you), gold-logo edge at the top — the normal way to read it. Fires when it swings into that position.'),
      gesture('logodown', 'Logo down', 'LogoDown', '🙃',
        'No wiring. Still UPRIGHT and facing you, but turned 180° so the logo edge is now at the bottom. Fires when your object is flipped upside down.'),
      gesture('faceup', 'Face up', 'ScreenUp', '🔆',
        'No wiring. Board laid FLAT like on a table, LED display pointing up at the ceiling. Fires when it settles face-up.'),
      gesture('facedown', 'Face down', 'ScreenDown', '🌙',
        'No wiring. Board laid FLAT the other way, LED display pointing down at the floor. Fires when it settles face-down.'),
      gesture('freefall', 'Free fall', 'FreeFall', '🪂',
        'No wiring. Fires the instant the board is in the air — toss it up (and catch it!) or drop it onto a cushion.'),
      gesture('g3', 'Small bump', 'ThreeG', '💥',
        'No wiring. Fires on a light knock (3g) — a gentle tap or bump of your object.'),
      gesture('g6', 'Hard hit', 'SixG', '💥',
        'No wiring. Fires on a firm whack (6g) — a solid smack or a real shake.'),
      gesture('g8', 'Big slam', 'EightG', '💥',
        'No wiring. Fires only on a big impact (8g) — a hard slam. Use for a “power move”.'),
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    desc: 'What the board senses about its surroundings, each a live number.',
    inputs: [
      {
        id: 'light', emoji: '💡', name: 'Light',
        kind: 'number',
        channels: ['light'],
        loop: number('light', 'input.lightLevel()'),
        build: 'No wiring. Cover and uncover the LED grid with your hand, or shine a flashlight on it. Sends 0–255.',
      },
      {
        id: 'temp', emoji: '🌡️', name: 'Temperature',
        kind: 'number',
        channels: ['temp'],
        loop: number('temp', 'input.temperature()'),
        build: 'No wiring. Warm the processor with your thumbs — it responds slowly, which makes for hilarious controls.',
      },
      {
        id: 'mic', emoji: '🎤', name: 'Sound',
        kind: 'number',
        channels: ['mic'],
        loop: number('mic', 'input.soundLevel()'),
        build: 'No wiring. Clap, yell, blow, sing — loudness arrives as 0–255. The mic is next to the touch logo.',
      },
    ],
  },
];

// Flat list of every input, for code/steps generation (order = section order).
export const INPUTS = SECTIONS.flatMap((s) => s.inputs);

// --- Code + steps generation ------------------------------------------------

/** Resolve an input to its active variant (pins depend on the chosen mode). */
function variantOf(input, pinModes) {
  return input.modes ? input.modes[pinModes[input.id]] : input;
}

/**
 * What a build asks of the micro:bit's radio, split by the shape of it.
 *
 * Only the radio: the USB cable has no comparable ceiling, which is exactly why
 * the wired option exists. The same program is emitted either way, so this
 * cannot be hidden when somebody is plugged in — the builder has no idea which
 * cable they will use, and the warning is advice about a choice rather than a
 * limit being hit.
 *
 * `streamed` is a line per channel per 100 ms tick, for as long as the board is
 * on: the steady load, and what the caps below are really about. `pressed` is a
 * line per edge — a button sends one going down and one coming up, and nothing
 * at all while it sits still — so a couple of them cost nothing next to a live
 * reading, and a wall of them all being mashed at once is another matter. A
 * gesture is in neither: it fires the once, when it happens.
 *
 * `weight` is the two put on one scale, which is what the warning is graded on.
 */
export function streamLoad(selected, pinModes) {
  let streamed = 0;
  let pressed = 0;
  for (const input of INPUTS) {
    if (!selected.has(input.id)) continue;
    const v = variantOf(input, pinModes);
    if (v.kind === 'event') continue;
    if (v.loop) streamed += v.channels.length;
    else if (v.handlers) pressed += v.channels.length;
  }
  // A contact worked as hard as a person can work one is worth roughly a third
  // of a reading polled ten times a second. Rounded up, so a controller made
  // entirely of buttons still eventually earns the warning.
  return { streamed, pressed, weight: streamed + Math.ceil(pressed / 3) };
}

export function generateCode(selected, pinModes) {
  const handlers = [];
  const setup = [];
  const loop = [];
  const connect = [];
  for (const input of INPUTS) {
    if (!selected.has(input.id)) continue;
    const v = variantOf(input, pinModes);
    if (v.handlers) handlers.push(...v.handlers);
    if (v.setup) setup.push(...v.setup);
    if (v.loop) loop.push(...v.loop);
    if (v.connect) connect.push(...v.connect);
  }

  return [
    ...scaffoldTop(connect),
    ...handlers,
    // Last before the loop: a setup line may block for as long as it takes
    // someone to finish calibrating, so everything that has to be listening by
    // then is already registered above.
    ...setup,
    // Shown once, at startup, rather than from inside the loop. `showString`
    // *blocks* for the length of the scroll — about two seconds for a five
    // letter name — so a wired session, where `connected` is never true, would
    // have dropped to one reading every two seconds. The name is only wanted
    // while you are looking at the Bluetooth chooser anyway.
    'basic.showString(control.deviceName())',
    'basic.forever(function () {',
    // No `if (connected)` here either, for the same reason it left the handlers:
    // over the cable it is never true, and `send` already knows what to do.
    ...loop.map((l) => '    ' + l),
    '    basic.pause(100)',
    '})',
  ].join('\n');
}

// --- UI ---------------------------------------------------------------------

// Soft caps on `bluetoothLoad().weight` before the BLE UART starts to lag.
// Conservative estimates rather than measurements: what a board can actually
// keep up with depends on the room, the batteries and how far away the laptop
// is, so these are set low enough to warn before anybody notices rather than
// after. Tune them down if a build inside the caps still feels late.
const STREAM_BUSY = 5; // gentle heads-up
const STREAM_HEAVY = 8; // stronger warning

// How many live readings make the cable worth mentioning. Lower than the caps
// above on purpose: those say "this is too much for the radio", and by then the
// useful advice has already been missed. This one says "there is an easier way
// to run what you have picked" while there is still time to take it.
const WIRED_WORTH_IT = 3;

// Which inputs you picked is the shape of the physical thing you built, so it
// has to outlast a refresh — the wiring on the Game screen is keyed to these
// channels and looks gutted without them.
const STORAGE_KEY = key('builder');

const DEFAULT_PIN_MODES = { p0: 'touch', p1: 'touch', p2: 'touch' };

function loadSelection() {
  let saved = null;
  try {
    saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  const ids = new Set(INPUTS.map((input) => input.id));
  const selected = new Set(
    (Array.isArray(saved?.selected) ? saved.selected : []).filter((id) => ids.has(id)),
  );
  const pinModes = { ...DEFAULT_PIN_MODES };
  for (const [pin, mode] of Object.entries(saved?.pinModes ?? {})) {
    // A mode only survives if this build still offers it.
    if (INPUTS.find((input) => input.id === pin)?.modes?.[mode]) pinModes[pin] = mode;
  }
  return { selected, pinModes };
}

/**
 * The inputs somebody picked, for an exported bundle to carry. Read straight off
 * storage rather than through a running builder, so exporting does not depend on
 * which screen is open.
 */
export function loadBuilderSelection() {
  const { selected, pinModes } = loadSelection();
  return { selected: [...selected], pinModes };
}

export function saveBuilderSelection(value) {
  try {
    const ids = new Set(INPUTS.map((input) => input.id));
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      selected: (Array.isArray(value?.selected) ? value.selected : []).filter((id) => ids.has(id)),
      pinModes: { ...DEFAULT_PIN_MODES, ...(value?.pinModes ?? {}) },
    }));
  } catch {
    // Persistence may be blocked; the import still applies for this session.
  }
}

export function initBuilder({
  grid, codeEl, stepsEl, warnEl, wiredEl, clearBtn, onChange = () => {},
}) {
  const { selected, pinModes } = loadSelection();

  function persist() {
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: [...selected], pinModes }),
      );
    } catch {
      // Persistence may be blocked; the picker still works for this session.
    }
  }

  function makeTile(input) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile tile-pick';
    tile.setAttribute('aria-pressed', String(selected.has(input.id)));
    tile.dataset.id = input.id;

    const v = variantOf(input, pinModes);
    const tags = v.channels.map((c) => `<span class="tag">${c}</span>`).join('');
    const modePicker = input.modes
      ? `<label class="tile-mode">as
           <select data-pin="${input.id}">
             ${Object.entries(input.modes)
               .map(([id, m]) =>
                 `<option value="${id}"${id === pinModes[input.id] ? ' selected' : ''}>${m.label}</option>`)
               .join('')}
           </select>
         </label>`
      : '';
    // A tile combining several channels (Tilt: pitch + roll) gets one line per
    // channel rather than the two sentences run together — each already reads
    // fine alone, but back to back they blur into a single hard paragraph.
    const descLines = describe(v.channels).map((d) => `<p>${d}</p>`).join('');

    tile.innerHTML = `
      <span class="tile-check" aria-hidden="true"></span>
      <span class="tile-emoji">${input.emoji}</span>
      <h3>${input.name}</h3>
      ${descLines}
      ${modePicker}
      <div class="tags">${tags}</div>
    `;
    return tile;
  }

  function renderGrid() {
    grid.innerHTML = '';
    for (const section of SECTIONS) {
      const sec = document.createElement('div');
      sec.className = 'pick-section';
      sec.innerHTML = `<div class="pick-head"><h3>${section.title}</h3><p>${section.desc}</p></div>`;
      const tiles = document.createElement('div');
      tiles.className = 'tiles';
      for (const input of section.inputs) tiles.appendChild(makeTile(input));
      sec.appendChild(tiles);
      grid.appendChild(sec);
    }
  }

  /**
   * Suggests the cable, down beside the button that offers it.
   *
   * Only when there are live readings in the build: those are the ones that
   * stream ten times a second and are what actually saturates the radio. A
   * controller made of buttons and gestures is fine wirelessly however many of
   * them there are, and telling somebody to plug in for that is advice that
   * costs them the thing the workshop is about.
   */
  function renderWiredAdvice() {
    if (!wiredEl) return;
    const { streamed, weight } = streamLoad(selected, pinModes);
    if (streamed < WIRED_WORTH_IT) {
      wiredEl.hidden = true;
      return;
    }
    wiredEl.hidden = false;
    // Deliberately quieter than the load warning at its own threshold: this is a
    // suggestion about which cable to use, not a report that something is wrong.
    wiredEl.dataset.level = weight >= STREAM_HEAVY ? 'heavy' : 'busy';
    const readings = `${streamed} live reading${streamed > 1 ? 's' : ''}`;
    wiredEl.innerHTML = `🔌 You picked ${readings}, which stream constantly. <strong>Connect over the
      USB cable</strong> if you can — the cable carries them comfortably, where Bluetooth may not.`;
  }

  function renderWarning() {
    if (!warnEl) return;
    const { streamed, pressed, weight } = streamLoad(selected, pinModes);
    if (weight < STREAM_BUSY) {
      warnEl.hidden = true;
      return;
    }

    // What is actually loading the radio, so the advice lands on the right
    // inputs: unchecking a button is no help when it is five live readings.
    const parts = [];
    if (streamed) {
      parts.push(`<strong>${streamed} live reading${streamed > 1 ? 's' : ''}</strong>`
        + ' streaming ten times a second');
    }
    if (pressed) {
      parts.push(`<strong>${pressed} on/off input${pressed > 1 ? 's' : ''}</strong>`
        + ' reporting every press and release');
    }
    const load = parts.join(' and ');

    warnEl.hidden = false;
    warnEl.dataset.level = weight >= STREAM_HEAVY ? 'heavy' : 'busy';
    warnEl.innerHTML = weight >= STREAM_HEAVY
      ? `⚡ You have ${load}. That's a lot for the micro:bit's <strong>Bluetooth</strong> — wirelessly,
         expect the game to feel laggy or jerky. <strong>Over the USB cable this is fine</strong>, so
         if you can stay plugged in you can ignore this. Otherwise uncheck what you aren't using;
         <strong>gestures are free</strong> (shake, tilt-left, free fall… they only send when they
         happen).`
      : `⚡ You have ${load}. Fine over the USB cable, and still fine over Bluetooth — but stacking
         on many more may start to lag wirelessly. <strong>Gestures are free</strong> — they only
         send the moment they fire, so they never add to this.`;
  }

  function renderOutput() {
    persist();
    if (clearBtn) clearBtn.disabled = selected.size === 0;
    codeEl.textContent = generateCode(selected, pinModes);
    renderWarning();
    renderWiredAdvice();

    const notes = [];
    for (const input of INPUTS) {
      if (!selected.has(input.id)) continue;
      const v = variantOf(input, pinModes);
      const name = input.modes ? `${input.name} · ${v.label}` : input.name;
      notes.push(`<li><strong>${input.emoji} ${name}:</strong> ${v.build}</li>`);
    }

    stepsEl.innerHTML = selected.size === 0
      ? `<p class="build-empty">Check some inputs in step 1 and each one's build tips will appear here.</p>`
      : `<ul class="build-list">${notes.join('')}</ul>`;

    const channels = [];
    for (const input of INPUTS) {
      if (!selected.has(input.id)) continue;
      const variant = variantOf(input, pinModes);
      // A pin is wired up differently depending on the mode it was set to here,
      // so the mode travels with the channel — the wiring screen can then say
      // which one this pin is, rather than leaving you to remember.
      const mode = input.modes ? variant.label : null;
      // What the thing physically is, so the wiring screen can say "the pad is
      // touched" or "the switch is connected" rather than one wording for all.
      const { form } = variant;
      variant.channels.forEach((channel) => channels.push({ channel, kind: variant.kind, mode, form }));
    }
    onChange({ channels });
  }

  grid.addEventListener('click', (e) => {
    if (e.target.closest('select, .tile-mode')) return; // mode picker, not a toggle
    const tile = e.target.closest('.tile-pick');
    if (!tile) return;
    const id = tile.dataset.id;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    tile.setAttribute('aria-pressed', String(selected.has(id)));
    renderOutput();
  });

  grid.addEventListener('change', (e) => {
    const pin = e.target.dataset?.pin;
    if (!pin) return;
    pinModes[pin] = e.target.value;
    selected.add(pin); // choosing a mode implies you want the pin
    renderGrid();
    renderOutput();
  });

  if (clearBtn) {
    clearBtn.disabled = selected.size === 0;
    clearBtn.addEventListener('click', () => {
      if (!selected.size) return;
      if (!window.confirm('Uncheck every enabled input?')) return;
      selected.clear();
      Object.assign(pinModes, DEFAULT_PIN_MODES);
      renderGrid();
      renderOutput();
    });
  }

  renderGrid();
  renderOutput();

  return {
    /** Re-reads the record, for when an imported bundle has rewritten it. */
    reload() {
      const fresh = loadSelection();
      selected.clear();
      for (const id of fresh.selected) selected.add(id);
      Object.assign(pinModes, fresh.pinModes);
      renderGrid();
      renderOutput();
    },
  };
}
