import assert from 'node:assert/strict';
import test from 'node:test';

import { INPUTS, generateCode, streamLoad } from '../js/builder.js';

const MODES = { p0: 'touch', p1: 'touch', p2: 'touch' };
const code = (ids, modes = MODES) => generateCode(new Set(ids), modes);
const count = (text, needle) => text.split(needle).length - 1;

// Everything below is about one property: the flashed program reports over the
// radio, and touches nothing else.

test('every reading is written through one send, and only send touches the radio', () => {
  const program = code(['btna', 'pitch', 'shake', 'p0']);

  assert.equal(count(program, 'function send'), 1, 'defined exactly once');
  assert.equal(count(program, 'bluetooth.uartWriteLine('), 1);
  const inSend = program.slice(program.indexOf('function send'), program.indexOf('\n}\n', program.indexOf('function send')));
  assert.ok(/if \(connected\) \{\s*\n\s*bluetooth\.uartWriteLine\(line\)/.test(inSend),
    'and only once a browser has attached');
});

// The board wrote to USB serial as well as the radio, and every part of that was
// trouble. Writing blocks once the transmit buffer fills with nothing draining
// it — the ordinary state of a board on a battery — so the board hung on the
// first reading it sent. Guarding the write on a greeting from the browser meant
// a serial receive handler, and then the board rebooted in a loop instead.
//
// Nothing in the generated program may touch serial again without that history
// being reckoned with, so this is pinned rather than left to be re-added by
// someone who wants the cable back.
test('the flashed program does not touch serial at all', () => {
  const program = code(INPUTS.map((input) => input.id));

  assert.ok(!program.includes('serial.'), 'no serial calls');
  assert.ok(!program.includes('wired'), 'and no leftover handshake for one');
});

// The guard used to wrap every handler body and the loop. `connected` only ever
// becomes true when a Bluetooth browser attaches, so leaving it in place meant a
// session over the cable fired every handler and sent nothing at all.
test('nothing outside send is gated on a Bluetooth browser being attached', () => {
  const program = code(['btna', 'shake', 'pitch', 'light']);
  const lines = program.split('\n');

  const sendBody = lines.indexOf('    if (connected) {');
  assert.ok(sendBody > 0, "send's own guard is there");
  assert.equal(count(program, 'if (connected)'), 1, 'and it is the only one');
});

// `showString` blocks for the length of its scroll — about two seconds — so from
// inside the forever loop it would drop a wired session to one reading every two
// seconds, which is precisely "wired feels broken".
test('the board name is scrolled once at startup, never inside the loop', () => {
  const program = code(['pitch']);
  assert.equal(count(program, 'control.deviceName()'), 1);

  const loopAt = program.indexOf('basic.forever');
  assert.ok(loopAt > 0);
  assert.ok(
    program.indexOf('control.deviceName()') < loopAt,
    'it has to happen before the loop starts, not in it',
  );
});


// MakeCode can only show the program as blocks if it can decompile it, which is
// why the whole file avoids ternaries. `send` is the one function it defines.
test('the generated program stays block-shaped', () => {
  const program = code(INPUTS.map((input) => input.id));
  assert.ok(!program.includes('?'), 'no ternaries anywhere');
  assert.ok(!program.includes('=>'), 'and no arrow functions');

  // A reporter alone on a line compiles fine but is not a shape MakeCode can
  // turn back into blocks, so the whole program silently drops to JavaScript.
  // Two priming reads were written that way. They return a value, so they have
  // to be assigned to something; the calls returning nothing are the safe ones.
  const reporters = /^\s*(input\.(pinIsPressed|compassHeading|lightLevel|rotation|acceleration)|pins\.(digitalReadPin|analogReadPin))\(/;
  for (const line of program.split('\n')) {
    if (reporters.test(line)) {
      assert.fail(`reporter standing alone as a statement, which will not decompile: ${line.trim()}`);
    }
  }
});

// An open switch leaves the pin attached to nothing, and a floating input picks
// up room hum as a stream of edges — the switch reporting frantically before
// anyone has touched it. The pull-down is the whole fix, and it has to be in
// place before edge watching starts or the pin's own settling reads as an edge.
test('a switch pin is pulled down, before its edges are watched', () => {
  const program = code(['p0'], { p0: 'switch' });

  const pull = program.indexOf('pins.setPull(DigitalPin.P0, PinPullMode.PullDown)');
  const events = program.indexOf('pins.setEvents(DigitalPin.P0, PinEventType.Edge)');
  assert.ok(pull > 0, 'the pin is tied to 0 while the circuit is open');
  assert.ok(events > 0);
  assert.ok(pull < events, 'and it is settled before anything watches for edges');
});

// Touch does its own sensing and is actively broken by a pull — it is the one
// pin mode that must be left alone.
test('a touch pin is not pulled', () => {
  const program = code(['p0'], { p0: 'touch' });
  assert.ok(!program.includes('setPull'));
});

// Resistive touch — the default — only reads when the player completes a circuit
// to GND, so it needs a second clip held in the other hand and does nothing at
// all without one. That was "touch doesn't work". Capacitive needs one wire.
test('a touch pin senses capacitively, so no GND wire is needed', () => {
  const program = code(['p0'], { p0: 'touch' });
  assert.ok(program.includes('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)'));
  assert.ok(!program.includes('TouchTargetMode.Resistive'));
});

test('a build of nothing but gestures still reports them', () => {
  const program = code(['shake', 'g8']);
  assert.ok(program.includes('send("shake:1")'));
  assert.ok(program.includes('send("g8:1")'));
});

// --- What the load warning is grading ---------------------------------------

test('load counts polled readings apart from contacts, and gestures not at all', () => {
  const quiet = streamLoad(new Set(['shake', 'g8', 'freefall']), MODES);
  assert.deepEqual({ streamed: quiet.streamed, pressed: quiet.pressed }, { streamed: 0, pressed: 0 },
    'gestures are free — they only send when they happen');

  const busy = streamLoad(new Set(['pitch', 'roll', 'light', 'btna', 'btnb']), MODES);
  assert.equal(busy.streamed, 3, 'three live readings');
  assert.equal(busy.pressed, 2, 'two contacts reporting edges');
  assert.ok(busy.weight > busy.streamed, 'and contacts do count for something');
  assert.ok(busy.weight < busy.streamed + busy.pressed, 'but for less than a live reading');
});
