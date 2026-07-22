// The controller code builder (Starters screen).
//
// Attendees check the inputs they want (and pick a mode for each pin), and this
// generates the complete MakeCode JavaScript to paste into the template project
// (see Set up), plus wiring / build ideas for each selection. The generated code
// speaks the wire protocol: one "<channel>:<number>" line per reading.
//
// Generated code is written block-style (if/else, no ternaries) so MakeCode can
// decompile it back to blocks for attendees who'd rather edit visually.

// --- Code fragments ---------------------------------------------------------

// Everything the Set up screen's baseline code does: UART service + a connected
// flag + name display. The builder's output is a strict superset of it.
const SCAFFOLD_TOP = [
  'bluetooth.startUartService()',
  'let connected = false',
  'bluetooth.onBluetoothConnected(function () {',
  '    connected = true',
  '})',
  'bluetooth.onBluetoothDisconnected(function () {',
  '    connected = false',
  '})',
];

/** Lines that report a true/false reading as "<channel>:1" / "<channel>:0". */
function binary(channel, expr) {
  return [
    `if (${expr}) {`,
    `    bluetooth.uartWriteLine("${channel}:1")`,
    `} else {`,
    `    bluetooth.uartWriteLine("${channel}:0")`,
    `}`,
  ];
}

/** Line that reports a numeric reading as "<channel>:<n>". */
function number(channel, expr) {
  return [`bluetooth.uartWriteLine("${channel}:" + ${expr})`];
}

// --- The inputs -------------------------------------------------------------

/**
 * Each input contributes:
 *   channels — wire channel names it emits (shown as chips on the tile)
 *   loop     — lines run every tick inside the forever loop (while connected)
 *   handlers — top-level event handlers (outside the loop)
 *   build    — one wiring / build-idea note for the "Build it" list
 * Pin inputs have `modes` instead, keyed by mode id.
 */
function pinInput(n) {
  const ch = `p${n}`;
  return {
    id: ch,
    emoji: '🔌',
    name: `Pin ${n}`,
    desc: 'Alligator-clip things to the big gold pin.',
    modes: {
      touch: {
        label: 'Touch pad',
        kind: 'binary',
        channels: [ch],
        loop: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip a wire from P${n} to anything conductive — foil, fruit, a spoon. ` +
          `The player holds a second clip from GND in their other hand; touching the object sends 1.`,
      },
      switch: {
        label: 'Switch',
        kind: 'binary',
        channels: [ch],
        loop: binary(ch, `pins.digitalReadPin(DigitalPin.P${n}) == 1`),
        build:
          `Make a switch: clip a wire from 3V to one piece of foil, and another from P${n} to a second piece. ` +
          `When the foils touch, the circuit closes and sends 1. Great for jaws, doors, stomp pads.`,
      },
    },
  };
}

/** A one-off accelerometer gesture: fires "<id>:1" via an onGesture handler. */
function gesture(id, name, gestureName, emoji, desc, build) {
  return {
    id, emoji, name, desc,
    kind: 'event',
    channels: [id],
    handlers: [
      `input.onGesture(Gesture.${gestureName}, function () {`,
      '    if (connected) {',
      `        bluetooth.uartWriteLine("${id}:1")`,
      '    }',
      '})',
    ],
    build,
  };
}

// Inputs are grouped into three sections shown as separate labelled grids.
export const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch & press',
    desc: 'Buttons and things you make conductive. Each sends 1 while active, 0 otherwise.',
    inputs: [
      {
        id: 'btna', emoji: '🔘', name: 'Button A',
        kind: 'binary',
        desc: 'The A button — pressed or not.',
        channels: ['btna'],
        loop: binary('btna', 'input.buttonIsPressed(Button.A)'),
        build: 'No wiring. To press it with an object, tape something onto the button or build a little lever that pushes it.',
      },
      {
        id: 'btnb', emoji: '🔘', name: 'Button B',
        kind: 'binary',
        desc: 'The B button — pressed or not.',
        channels: ['btnb'],
        loop: binary('btnb', 'input.buttonIsPressed(Button.B)'),
        build: 'No wiring. Same tricks as Button A — two buttons means two separate channels.',
      },
      {
        id: 'logo', emoji: '⭐', name: 'Logo touch',
        kind: 'binary',
        desc: 'The gold logo is a touch sensor.',
        channels: ['logo'],
        loop: binary('logo', 'input.logoIsPressed()'),
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
        id: 'tilt', emoji: '📐', name: 'Tilt',
        kind: 'number',
        desc: 'Pitch & roll angles, live in degrees.',
        channels: ['pitch', 'roll'],
        loop: [
          ...number('pitch', 'input.rotation(Rotation.Pitch)'),
          ...number('roll', 'input.rotation(Rotation.Roll)'),
        ],
        build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tilt it. Pitch and roll arrive in degrees. Great for steering.',
      },
      {
        id: 'heading', emoji: '🧭', name: 'Compass',
        kind: 'number',
        desc: 'Which way it points, 0–360°, live.',
        channels: ['heading'],
        loop: number('heading', 'input.compassHeading()'),
        build: 'No wiring. The first run asks you to calibrate — tilt the board to fill the circle of dots. Then spin your object like a dial.',
      },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures',
    desc: 'One-off moves — the board flags the instant each happens, so unlike the live inputs they add nothing to the Bluetooth load. Lean on these when you can.',
    inputs: [
      gesture('shake', 'Shake', 'Shake', '🫨',
        'Fires once each shake.',
        'No wiring — attach the board to anything shakeable. A maraca, a stuffed animal, a pool noodle.'),
      gesture('tiltleft', 'Tilt left', 'TiltLeft', '👈',
        'Fires when tipped left.',
        'No wiring. Fires the moment the board tips past ~45° to the left — a quick flick, not a hold.'),
      gesture('tiltright', 'Tilt right', 'TiltRight', '👉',
        'Fires when tipped right.',
        'No wiring. The mirror of tilt-left — pair the two to nudge something left/right.'),
      gesture('logoup', 'Logo up', 'LogoUp', '🙂',
        'Standing upright, logo at the top.',
        'No wiring. Board held UPRIGHT (screen facing you), gold-logo edge at the top — the normal way to read it. Fires when it swings into that position.'),
      gesture('logodown', 'Logo down', 'LogoDown', '🙃',
        'Standing upright but flipped, logo at the bottom.',
        'No wiring. Still UPRIGHT and facing you, but turned 180° so the logo edge is now at the bottom. Fires when your object is flipped upside down.'),
      gesture('faceup', 'Face up', 'ScreenUp', '🔆',
        'Lying flat, screen toward the ceiling.',
        'No wiring. Board laid FLAT like on a table, LED screen pointing up at the ceiling. Fires when it settles face-up.'),
      gesture('facedown', 'Face down', 'ScreenDown', '🌙',
        'Lying flat, screen toward the floor.',
        'No wiring. Board laid FLAT the other way, LED screen pointing down at the floor. Fires when it settles face-down.'),
      gesture('freefall', 'Free fall', 'FreeFall', '🪂',
        'Fires while dropping.',
        'No wiring. Fires the instant the board is in the air — toss it up (and catch it!) or drop it onto a cushion.'),
      gesture('g3', 'Small bump', 'ThreeG', '💥',
        'A light 3g jolt.',
        'No wiring. Fires on a light knock (3g) — a gentle tap or bump of your object.'),
      gesture('g6', 'Hard hit', 'SixG', '💥',
        'A hard 6g jolt.',
        'No wiring. Fires on a firm whack (6g) — a solid smack or a real shake.'),
      gesture('g8', 'Big slam', 'EightG', '💥',
        'A big 8g jolt.',
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
        desc: 'The LED grid doubles as a light sensor.',
        channels: ['light'],
        loop: number('light', 'input.lightLevel()'),
        build: 'No wiring. Cover and uncover the LED grid with your hand, or shine a flashlight on it. Sends 0–255.',
      },
      {
        id: 'temp', emoji: '🌡️', name: 'Temperature',
        kind: 'number',
        desc: 'The chip’s temperature in °C.',
        channels: ['temp'],
        loop: number('temp', 'input.temperature()'),
        build: 'No wiring. Warm the processor with your thumbs — it responds slowly, which makes for hilarious controls.',
      },
      {
        id: 'mic', emoji: '🎤', name: 'Sound',
        kind: 'number',
        desc: 'Microphone loudness.',
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
 * How many UART lines the forever loop writes per 100 ms tick — the real steady
 * Bluetooth load. Only loop inputs count; gestures fire on events, not every
 * tick. A loop input writes one line per channel each tick (so tilt = 2:
 * pitch + roll; a binary if/else still writes exactly one). The visualizer/game
 * feel laggy once the micro:bit's BLE UART can't keep up, so we warn past a cap.
 */
export function streamingLines(selected, pinModes) {
  let n = 0;
  for (const input of INPUTS) {
    if (!selected.has(input.id)) continue;
    const v = variantOf(input, pinModes);
    if (v.loop) n += v.channels.length;
  }
  return n;
}

export function generateCode(selected, pinModes) {
  const handlers = [];
  const loop = [];
  for (const input of INPUTS) {
    if (!selected.has(input.id)) continue;
    const v = variantOf(input, pinModes);
    if (v.handlers) handlers.push(...v.handlers);
    if (v.loop) loop.push(...v.loop);
  }

  return [
    ...SCAFFOLD_TOP,
    ...handlers,
    'basic.forever(function () {',
    '    if (connected) {',
    '        basic.showIcon(IconNames.Yes)',
    ...loop.map((l) => '        ' + l),
    '    } else {',
    '        basic.showString(control.deviceName())',
    '    }',
    '    basic.pause(100)',
    '})',
  ].join('\n');
}

// --- UI ---------------------------------------------------------------------

// Soft caps on streaming lines/tick before the BLE UART starts to lag. These are
// conservative estimates — validate against real hardware and tune. See CLAUDE.md.
const STREAM_BUSY = 5; // gentle heads-up
const STREAM_HEAVY = 8; // stronger warning

export function initBuilder({ grid, codeEl, stepsEl, warnEl, onChange = () => {} }) {
  const selected = new Set();
  const pinModes = { p0: 'touch', p1: 'touch', p2: 'touch' };

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

    tile.innerHTML = `
      <span class="tile-check" aria-hidden="true"></span>
      <span class="tile-emoji">${input.emoji}</span>
      <h3>${input.name}</h3>
      <p>${input.desc}</p>
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

  function renderWarning() {
    if (!warnEl) return;
    const n = streamingLines(selected, pinModes);
    if (n < STREAM_BUSY) {
      warnEl.hidden = true;
      return;
    }
    warnEl.hidden = false;
    warnEl.dataset.level = n >= STREAM_HEAVY ? 'heavy' : 'busy';
    warnEl.innerHTML = n >= STREAM_HEAVY
      ? `⚡ <strong>${n} readings are streaming</strong> ten times a second. That's a lot for the
         micro:bit's Bluetooth — expect the game to feel laggy or jerky. Uncheck any inputs you're
         not actually using. Tip: <strong>gestures are free</strong> (shake, tilt-left, free fall…
         only send when they happen), so lean on those instead of held buttons and live sensors
         where you can.`
      : `⚡ <strong>${n} readings are streaming</strong> ten times a second. Still fine, but
         stacking on many more may start to lag over Bluetooth. <strong>Gestures are free</strong>
         — they only send the moment they fire, so they never add to this.`;
  }

  function renderOutput() {
    codeEl.textContent = generateCode(selected, pinModes);
    renderWarning();

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
      variant.channels.forEach((channel) => channels.push({ channel, kind: variant.kind }));
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

  renderGrid();
  renderOutput();
}
