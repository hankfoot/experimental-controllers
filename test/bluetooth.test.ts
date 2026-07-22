import { expect, it, vi } from 'vitest';
import { inputBus } from '../src/domain/bus';
import { parseProtocolLine } from '../src/services/bluetooth';

it('accepts complete finite protocol values and rejects malformed ones', () => {
  const listener = vi.fn();
  const unsubscribe = inputBus.onInput(listener);

  try {
    parseProtocolLine(' Light : 12.5 ');
    parseProtocolLine('light:1junk');
    parseProtocolLine('light:Infinity');
    parseProtocolLine('light:');
    parseProtocolLine(':1');
  } finally {
    unsubscribe();
  }

  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith({ channel: 'light', value: 12.5, raw: ' Light : 12.5 ' });
});
