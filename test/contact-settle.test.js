import assert from 'node:assert/strict';
import test from 'node:test';

import { createContactSettle, SETTLE_MS } from '../js/contact-settle.js';

// A fake clock, so these run instantly and so the release can be shown *not* to
// arrive until it is due. Timers are kept in the order they were made; nothing
// here ever has more than a couple pending.
function fakeClock() {
  let pending = [];
  let id = 0;
  return {
    schedule(fn, ms) {
      pending.push({ id: ++id, fn, ms });
      return id;
    },
    cancel(target) {
      pending = pending.filter((timer) => timer.id !== target);
    },
    get pendingCount() {
      return pending.length;
    },
    /** Run everything currently due. */
    flush() {
      const due = pending;
      pending = [];
      for (const timer of due) timer.fn();
    },
  };
}

function harness() {
  const clock = fakeClock();
  const seen = [];
  const accept = createContactSettle({
    emit: (message) => seen.push([message.channel, message.value]),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, seen, accept };
}

test('a press is reported the instant it arrives', () => {
  const { seen, accept } = harness();
  accept({ channel: 'p0', value: 1 });
  assert.deepEqual(seen, [['p0', 1]], 'no delay on taking hold');
});

// The whole point. A contact held against 3V is not one connection — it makes
// and breaks continuously — and every one of those edges reaches us.
test('a contact breaking and remaking reads as one unbroken press', () => {
  const { clock, seen, accept } = harness();

  for (const value of [1, 0, 1, 0, 1, 0, 1]) accept({ channel: 'p0', value });

  assert.deepEqual(seen, [['p0', 1]], 'one press, however much it chattered');
  // Still genuinely held: it ended on a 1, so there is nothing pending and
  // nothing to deliver. Letting go now is the only thing that releases it.
  assert.equal(clock.pendingCount, 0);
  clock.flush();
  assert.deepEqual(seen, [['p0', 1]], 'and no release is invented');

  accept({ channel: 'p0', value: 0 });
  clock.flush();
  assert.deepEqual(seen, [['p0', 1], ['p0', 0]], 'one press and one release, in the end');
});

// The property that matters most, and the one the deleted per-wire filter got
// wrong: the release rides on a clock, never on another reading arriving. The
// board sends a release once and then says nothing at all.
test('a release always lands, even though nothing else ever arrives', () => {
  const { clock, seen, accept } = harness();

  accept({ channel: 'p0', value: 1 });
  accept({ channel: 'p0', value: 0 });
  assert.deepEqual(seen, [['p0', 1]], 'not believed straight away');
  assert.equal(clock.pendingCount, 1, 'but it is scheduled');

  clock.flush();
  assert.deepEqual(seen, [['p0', 1], ['p0', 0]], 'and it lands with no further input');
});

test('a release already settling is not scheduled twice over', () => {
  const { clock, seen, accept } = harness();
  accept({ channel: 'p0', value: 1 });
  accept({ channel: 'p0', value: 0 });
  accept({ channel: 'p0', value: 0 });
  accept({ channel: 'p0', value: 0 });

  assert.equal(clock.pendingCount, 1);
  clock.flush();
  assert.deepEqual(seen, [['p0', 1], ['p0', 0]], 'one release, not three');
});

test('the settle is per channel, so one contact does not mask another', () => {
  const { clock, seen, accept } = harness();
  accept({ channel: 'p0', value: 1 });
  accept({ channel: 'p1', value: 1 });
  accept({ channel: 'p0', value: 0 });
  clock.flush();

  assert.deepEqual(seen, [['p0', 1], ['p1', 1], ['p0', 0]], 'p1 is still held');
});

// Numbers are readings, not contacts. Holding one back would invent a delay for
// something that never chattered, and would wreck a live sensor besides.
test('numeric channels pass straight through, every reading', () => {
  const { clock, seen, accept } = harness();
  for (const value of [10, 0, 255, 0]) accept({ channel: 'light', value });

  assert.deepEqual(seen, [['light', 10], ['light', 0], ['light', 255], ['light', 0]]);
  assert.equal(clock.pendingCount, 0, 'and nothing is ever deferred for them');
});

// A gesture only ever sends a 1, and sends it repeatedly on purpose.
test('gestures are not settled', () => {
  const { seen, accept } = harness();
  accept({ channel: 'shake', value: 1 });
  accept({ channel: 'shake', value: 1 });
  assert.deepEqual(seen, [['shake', 1], ['shake', 1]], 'every shake counts');
});

// A pin does not declare itself — it is whatever it was wired up as — so an
// analog pin reading must not be mistaken for a contact.
test('a pin sending real numbers is treated as a reading, not a contact', () => {
  const { seen, accept } = harness();
  accept({ channel: 'p0', value: 512 });
  accept({ channel: 'p0', value: 3 });
  assert.deepEqual(seen, [['p0', 512], ['p0', 3]]);
});

test('a board going away forgets what it was holding, silently', () => {
  const { clock, seen, accept } = harness();
  accept({ channel: 'p0', value: 1 });
  accept({ channel: 'p0', value: 0 });

  accept.reset();
  clock.flush();

  assert.deepEqual(seen, [['p0', 1]], 'no release invented for a board that is gone');
  // And the channel starts clean, rather than believing it is still held.
  accept({ channel: 'p0', value: 1 });
  assert.deepEqual(seen, [['p0', 1], ['p0', 1]]);
});

test('the settle window is the one the module documents', () => {
  const clock = fakeClock();
  const accept = createContactSettle({
    emit: () => {}, schedule: clock.schedule, cancel: clock.cancel,
  });
  accept({ channel: 'p0', value: 1 });
  accept({ channel: 'p0', value: 0 });
  assert.equal(SETTLE_MS, 80);
});
