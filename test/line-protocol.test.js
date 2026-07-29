import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLine, createLineBuffer } from '../js/line-protocol.js';
import { onInput } from '../js/bus.js';

/** Collects everything that reaches the bus while `work` runs. */
function heard(work) {
  const messages = [];
  const unsubscribe = onInput((message) => messages.push(message));
  try {
    work();
  } finally {
    unsubscribe();
  }
  return messages;
}

const bytes = (text) => new TextEncoder().encode(text);

test('the protocol accepts complete finite values and rejects malformed ones', () => {
  const messages = heard(() => {
    parseLine(' Light : 12.5 ');
    parseLine('light:1junk');
    parseLine('light:Infinity');
    parseLine('light:');
    parseLine(':1');
  });

  assert.deepEqual(messages, [{ channel: 'light', value: 12.5, raw: ' Light : 12.5 ' }]);
});

test('a line split across two chunks is put back together', () => {
  const buffer = createLineBuffer();
  const messages = heard(() => {
    buffer.push(bytes('btna:'));
    buffer.push(bytes('1\nbtnb:0\n'));
  });

  assert.deepEqual(messages.map((m) => [m.channel, m.value]), [['btna', 1], ['btnb', 0]]);
});

// `serial.writeLine` on the micro:bit ends every line with \r\n. The split is on
// \n and the remainder is trimmed, so both endings work — but this is precisely
// the difference between wired working and wired reporting NaN forever, and it
// is one refactor away from breaking silently.
test('a line ending in CRLF parses the same as one ending in LF', () => {
  const buffer = createLineBuffer();
  const messages = heard(() => buffer.push(bytes('light:187\r\npitch:-42\n')));

  assert.deepEqual(messages.map((m) => [m.channel, m.value]), [['light', 187], ['pitch', -42]]);
});

test('a blank line is not a reading', () => {
  const buffer = createLineBuffer();
  const messages = heard(() => buffer.push(bytes('\n\nbtna:1\n\n')));
  assert.equal(messages.length, 1);
});

// A drop can cut a line in half. Left in the buffer, its front half would be
// glued to the first line of the next session and parse as something neither
// board sent.
test('resetting throws away a half-finished line', () => {
  const buffer = createLineBuffer();
  const messages = heard(() => {
    buffer.push(bytes('light:1'));
    buffer.reset();
    buffer.push(bytes('87\n'));
  });

  assert.deepEqual(messages, [], 'the spliced line must not reach the bus');
});

test('each buffer keeps its own half-line, so two transports cannot interleave', () => {
  const one = createLineBuffer();
  const two = createLineBuffer();
  const messages = heard(() => {
    one.push(bytes('pitch:'));
    two.push(bytes('roll:90\n'));
    one.push(bytes('45\n'));
  });

  assert.deepEqual(messages.map((m) => [m.channel, m.value]), [['roll', 90], ['pitch', 45]]);
});

// The bug this exists for: a serial port hands over whatever was already in the
// board's transmit buffer, which is almost always the tail of a line that
// started before anybody was reading. Spliced onto the next line, "pit" plus
// "pitch:112" becomes a channel called "pitpitch" — a stream that does not
// exist, sitting in the input list next to the real one.
test('a stream joined mid-line throws the fragment away instead of splicing it', () => {
  const buffer = createLineBuffer({ midStream: true });
  const messages = heard(() => buffer.push(bytes('pit\npitch:112\nroll:5\n')));

  assert.deepEqual(messages.map((m) => m.channel), ['pitch', 'roll']);
  assert.ok(!messages.some((m) => m.channel === 'pitpitch'), 'no spliced channel');
});

test('a mid-line fragment spanning several chunks is still dropped whole', () => {
  const buffer = createLineBuffer({ midStream: true });
  const messages = heard(() => {
    buffer.push(bytes('ch:1'));
    buffer.push(bytes('23'));
    buffer.push(bytes('\nlight:7\n'));
  });

  assert.deepEqual(messages.map((m) => [m.channel, m.value]), [['light', 7]]);
});

test('a reconnect resyncs again, since the board never stopped writing', () => {
  const buffer = createLineBuffer({ midStream: true });
  heard(() => buffer.push(bytes('junk\nbtna:1\n')));
  const messages = heard(() => {
    buffer.reset();
    buffer.push(bytes('tna:0\nbtnb:1\n'));
  });

  assert.deepEqual(messages.map((m) => m.channel), ['btnb']);
});

// Bluetooth notifications begin at a line boundary, so nothing is discarded.
test('a stream that starts clean keeps its first line', () => {
  const buffer = createLineBuffer();
  const messages = heard(() => buffer.push(bytes('btna:1\n')));
  assert.deepEqual(messages.map((m) => m.channel), ['btna']);
});
