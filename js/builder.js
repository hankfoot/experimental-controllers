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
        channels: [ch],
        loop: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip a wire from P${n} to anything conductive — foil, fruit, a spoon. ` +
          `The player holds a second clip from GND in their other hand; touching the object sends 1.`,
      },
      switch: {
        label: 'Switch',
        channels: [ch],
        loop: binary(ch, `pins.digitalReadPin(DigitalPin.P${n}) == 1`),
        build:
          `Make a switch: clip a wire from 3V to one piece of foil, and another from P${n} to a second piece. ` +
          `When the foils touch, the circuit closes and sends 1. Great for jaws, doors, stomp pads.`,
      },
      analog: {
        label: 'Analog sensor',
        channels: [ch],
        loop: number(ch, `pins.analogReadPin(AnalogPin.P${n})`),
        build:
          `Connect a variable resistor between 3V and P${n} (potentiometer: outer legs to 3V and GND, ` +
          `middle to P${n}). Sends 0–1023 as it changes.`,
      },
    },
  };
}

export const INPUTS = [
  {
    id: 'btna', emoji: '🔘', name: 'Button A',
    desc: 'The A button — pressed or not.',
    channels: ['btna'],
    loop: binary('btna', 'input.buttonIsPressed(Button.A)'),
    build: 'No wiring. To press it with an object, tape something onto the button or build a little lever that pushes it.',
  },
  {
    id: 'btnb', emoji: '🔘', name: 'Button B',
    desc: 'The B button — pressed or not.',
    channels: ['btnb'],
    loop: binary('btnb', 'input.buttonIsPressed(Button.B)'),
    build: 'No wiring. Same tricks as Button A — two buttons means two separate channels.',
  },
  {
    id: 'logo', emoji: '⭐', name: 'Logo touch',
    desc: 'The gold logo is a touch sensor.',
    channels: ['logo'],
    loop: binary('logo', 'input.logoIsPressed()'),
    build: 'No wiring. Touch the gold logo on the front — it even works through a thin strip of foil taped over it.',
  },
  {
    id: 'tilt', emoji: '📐', name: 'Tilt',
    desc: 'Pitch & roll angles from the accelerometer.',
    channels: ['pitch', 'roll'],
    loop: [
      ...number('pitch', 'input.rotation(Rotation.Pitch)'),
      ...number('roll', 'input.rotation(Rotation.Roll)'),
    ],
    build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tilt it. Pitch and roll arrive in degrees.',
  },
  {
    id: 'shake', emoji: '🫨', name: 'Shake',
    desc: 'Fires once each time the board is shaken.',
    channels: ['shake'],
    handlers: [
      'input.onGesture(Gesture.Shake, function () {',
      '    if (connected) {',
      '        bluetooth.uartWriteLine("shake:1")',
      '    }',
      '})',
    ],
    build: 'No wiring — attach the board to anything shakeable. A maraca, a stuffed animal, a pool noodle.',
  },
  {
    id: 'light', emoji: '💡', name: 'Light',
    desc: 'The LED grid doubles as a light sensor.',
    channels: ['light'],
    loop: number('light', 'input.lightLevel()'),
    build: 'No wiring. Cover and uncover the LED grid with your hand, or shine a flashlight on it. Sends 0–255.',
  },
  {
    id: 'temp', emoji: '🌡️', name: 'Temperature',
    desc: 'The chip’s temperature in °C.',
    channels: ['temp'],
    loop: number('temp', 'input.temperature()'),
    build: 'No wiring. Warm the processor with your thumbs — it responds slowly, which makes for hilarious controls.',
  },
  {
    id: 'mic', emoji: '🎤', name: 'Sound',
    desc: 'Microphone loudness.',
    channels: ['mic'],
    loop: number('mic', 'input.soundLevel()'),
    build: 'No wiring. Clap, yell, blow, sing — loudness arrives as 0–255. The mic is next to the touch logo.',
  },
  {
    id: 'heading', emoji: '🧭', name: 'Compass',
    desc: 'Which way the board is pointing, 0–360°.',
    channels: ['heading'],
    loop: number('heading', 'input.compassHeading()'),
    build: 'No wiring. The first run asks you to calibrate — tilt the board to fill the circle of dots. Then spin your object like a dial.',
  },
  pinInput(0),
  pinInput(1),
  pinInput(2),
];

// --- Code + steps generation ------------------------------------------------

/** Resolve an input to its active variant (pins depend on the chosen mode). */
function variantOf(input, pinModes) {
  return input.modes ? input.modes[pinModes[input.id]] : input;
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

export function initBuilder({ grid, codeEl, stepsEl }) {
  const selected = new Set();
  const pinModes = { p0: 'touch', p1: 'touch', p2: 'touch' };

  function renderGrid() {
    grid.innerHTML = '';
    for (const input of INPUTS) {
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
      grid.appendChild(tile);
    }
  }

  function renderOutput() {
    codeEl.textContent = generateCode(selected, pinModes);

    const notes = [];
    for (const input of INPUTS) {
      if (!selected.has(input.id)) continue;
      const v = variantOf(input, pinModes);
      const name = input.modes ? `${input.name} · ${v.label}` : input.name;
      notes.push(`<li><strong>${input.emoji} ${name}:</strong> ${v.build}</li>`);
    }

    stepsEl.innerHTML = selected.size === 0
      ? `<p class="build-empty">Check at least one input above — the code and build steps fill in here.</p>`
      : `
        <ul class="build-list">${notes.join('')}</ul>
        <ol class="build-final">
          <li>Copy the code above and paste it over <em>everything</em> in the JavaScript tab of
              your MakeCode project, then <strong>Download</strong> to flash (see Set&nbsp;up).</li>
          <li>Click <strong>Connect</strong> in the top bar, then open the <strong>Live</strong>
              panel and check every input responds before building around it.</li>
        </ol>
      `;
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
