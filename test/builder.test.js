import assert from 'node:assert/strict';
import test from 'node:test';

import { INPUTS, generateCode, streamLoad } from '../js/builder.js';

const MODES = { p0: 'touch', p1: 'touch', p2: 'touch' };
const code = (ids, modes = MODES) => generateCode(new Set(ids), modes);
const count = (text, needle) => text.split(needle).length - 1;

// Everything below is about one property: the program that gets flashed has to
// work over the USB cable and over Bluetooth, without being reflashed to swap.

test('every reading is written through one send, and only send touches the radio', () => {
  const program = code(['btna', 'pitch', 'shake', 'p0']);

  assert.equal(count(program, 'function send'), 1, 'defined exactly once');
  // The one permitted mention is inside send's own body. Anywhere else is a
  // reading that a wired session would silently never receive.
  assert.equal(count(program, 'bluetooth.uartWriteLine('), 1);
  const inSend = program.slice(program.indexOf('function send'), program.indexOf('}\n', program.indexOf('function send')));
  assert.ok(inSend.includes('bluetooth.uartWriteLine(line)'));
  assert.ok(inSend.includes('serial.writeLine(line)'), 'and the cable is written unconditionally');
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

test('the cable is set up explicitly, so "no data over USB" is never a mystery', () => {
  const program = code(['btna']);
  assert.ok(program.includes('serial.redirectToUSB()'));
  assert.ok(program.includes('serial.setBaudRate(BaudRate.BaudRate115200)'));
});

// MakeCode can only show the program as blocks if it can decompile it, which is
// why the whole file avoids ternaries. `send` is the one function it defines.
test('the generated program stays block-shaped', () => {
  const program = code(INPUTS.map((input) => input.id));
  assert.ok(!program.includes('?'), 'no ternaries anywhere');
  assert.ok(!program.includes('=>'), 'and no arrow functions');
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
