import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateStorage, MIGRATED_KEY } from '../js/storage-migrate.js';
import { key } from '../js/storage-keys.js';
import { memoryStorage } from './helpers/memory-storage.js';

const OLD = 'experimental-game-controllers';

/** A store holding what a visit before the rename would have left behind. */
function previousVisit(extra = {}) {
  const storage = memoryStorage(extra);
  storage.setItem(`${OLD}:builder`, '{"selected":["btna"]}');
  storage.setItem(`${OLD}:wiring:v3`, '{"version":3,"games":{}}');
  storage.setItem(`${OLD}:theme:v1`, '{"version":1}');
  storage.setItem(`${OLD}:game`, 'jetpack');
  storage.setItem(`${OLD}:asset:image-1`, '{"id":"image-1"}');
  storage.setItem(`${OLD}:asset:audio-9`, '{"id":"audio-9"}');
  return storage;
}

test('everything saved under the old name is readable under the new one', () => {
  const storage = previousVisit();
  migrateStorage(storage);

  assert.equal(storage.getItem(key('builder')), '{"selected":["btna"]}');
  assert.equal(storage.getItem(key('wiring', 'v3')), '{"version":3,"games":{}}');
  assert.equal(storage.getItem(key('theme', 'v1')), '{"version":1}');
  assert.equal(storage.getItem(key('game')), 'jetpack');
  assert.equal(storage.getItem(`${key('asset')}:image-1`), '{"id":"image-1"}');
  assert.equal(storage.getItem(`${key('asset')}:audio-9`), '{"id":"audio-9"}');
});

// Copy, not move. A tab still running the old code writes the old keys back,
// and deleting them would only make that resurrected record look like a fresh
// install to a later run.
test('the old records are left where they are', () => {
  const storage = previousVisit();
  migrateStorage(storage);
  assert.equal(storage.getItem(`${OLD}:builder`), '{"selected":["btna"]}');
  assert.equal(storage.getItem(`${OLD}:asset:image-1`), '{"id":"image-1"}');
});

test('running it again does nothing at all', () => {
  const storage = previousVisit();
  migrateStorage(storage);
  storage.setItem(key('game'), 'flappy'); // a round played since

  migrateStorage(storage);
  assert.equal(storage.getItem(key('game')), 'flappy', 'the newer choice survives');
});

test('a record already under the new name is never overwritten by an old one', () => {
  const storage = previousVisit();
  storage.setItem(key('theme', 'v1'), '{"version":1,"font":"comic"}');

  migrateStorage(storage);
  assert.equal(storage.getItem(key('theme', 'v1')), '{"version":1,"font":"comic"}');
});

// The half-run case, which is the whole reason each copy is guarded on "is the
// destination empty" rather than on the marker alone.
test('a write that fails leaves the rest copied and comes back for it', () => {
  let refuse = true;
  const storage = previousVisit({ failOn: (name) => refuse && name === key('theme', 'v1') });

  migrateStorage(storage);
  assert.equal(storage.getItem(key('builder')), '{"selected":["btna"]}', 'the rest landed');
  assert.equal(storage.getItem(key('theme', 'v1')), null, 'the refused one did not');
  assert.equal(storage.getItem(MIGRATED_KEY), null, 'and it is not marked done');

  refuse = false;
  migrateStorage(storage);
  assert.equal(storage.getItem(key('theme', 'v1')), '{"version":1}', 'a later run finishes it');
  assert.ok(storage.getItem(MIGRATED_KEY), 'and marks it done');
});

test('the asset sweep moves assets and nothing else', () => {
  const storage = previousVisit();
  storage.setItem(`${OLD}:not-an-asset`, 'leave me');
  migrateStorage(storage);

  assert.equal(storage.getItem(`${key('asset')}:not-an-asset`), null);
  assert.equal(storage.getItem(key('not-an-asset')), null);
});

test('a first-ever visit is marked done without inventing anything', () => {
  const storage = memoryStorage();
  migrateStorage(storage);

  assert.ok(storage.getItem(MIGRATED_KEY));
  assert.equal(storage.getItem(key('theme', 'v1')), null);
});

test('no storage at all is not an error', () => {
  assert.doesNotThrow(() => migrateStorage(null));
});
