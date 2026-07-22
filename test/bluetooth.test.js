import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLine } from '../js/bluetooth.js';
import { onInput } from '../js/bus.js';

test('the protocol accepts complete finite values and rejects malformed ones', () => {
  const messages = [];
  const unsubscribe = onInput((message) => messages.push(message));

  try {
    parseLine(' Light : 12.5 ');
    parseLine('light:1junk');
    parseLine('light:Infinity');
    parseLine('light:');
    parseLine(':1');
  } finally {
    unsubscribe();
  }

  assert.deepEqual(messages, [{ channel: 'light', value: 12.5, raw: ' Light : 12.5 ' }]);
});
