// Where the things you make are kept. Drawn sprites are small enough to live
// anywhere, but an uploaded sound is not: localStorage holds about five
// megabytes for the whole origin, and wiring, jacks, ports, and control options
// are already spending from that budget. One uploaded track would evict them.
//
// So assets go in IndexedDB, which is the same kind of thing as localStorage —
// a client-side store built into the browser, no server and no dependency — and
// simply has room. The one place it isn't available is a page opened straight
// off the filesystem, where Chrome refuses to open a database at all; there we
// fall back to a key per asset in localStorage under a much tighter cap, so the
// feature gets smaller rather than disappearing.

import { NAMESPACE, key } from '../storage-keys.js';

const DB_NAME = NAMESPACE;
const DB_VERSION = 1;
const STORE = 'assets';
const FALLBACK_PREFIX = `${key('asset')}:`;

// Roughly how much one asset may occupy, as JSON. The fallback cap is small
// enough that filling it can't cost you your wiring; the database cap only
// exists so a mis-picked file fails with a message instead of a stall.
const LIMIT = { idb: 8_000_000, local: 400_000 };

// A drawing and an uploaded picture are the same thing now — both are a PNG on
// a canvas — so there are only two kinds here, and both are base64 in `data`.
const ASSET_KINDS = Object.freeze(['image', 'audio']);

let counter = 0;
export function newAssetId(kind) {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** A record is `{ id, kind, name, mime, data }`, `data` being base64 bytes. */
export function normalizeAsset(value) {
  if (!value || typeof value !== 'object') return null;
  const { id, kind, name } = value;
  if (typeof id !== 'string' || !id) return null;
  if (!ASSET_KINDS.includes(kind)) return null;
  if (typeof value.data !== 'string' || !value.data) return null;

  return {
    id,
    kind,
    name: typeof name === 'string' ? name.slice(0, 80) : 'Untitled',
    mime: typeof value.mime === 'string' ? value.mime : '',
    data: value.data,
  };
}

function tooBig(asset, limit) {
  return JSON.stringify(asset).length > limit;
}

export function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

// How long to wait for the database before giving up on it. An open request
// normally settles in a millisecond or two, but it can also queue behind a
// delete that is itself blocked and then never settle at all — and an unsettled
// promise here would hang every caller downstream, which for the import button
// means a screen reading "Reading…" until the page is reloaded. Falling back
// after a wait is worse than IndexedDB and far better than stopping.
const OPEN_TIMEOUT_MS = 3000;

function openDatabase(factory, timeoutMs) {
  return new Promise((resolve) => {
    let request = null;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const settle = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => settle(request.result);
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  });
}

// --- Bringing the previous name's drawings across -----------------------------
// A database cannot be renamed, so the new name opens empty and every drawing
// and recording looks like it has been thrown away. This copies them over once.

const OLD_DB_NAME = 'experimental-game-controllers';
const ASSETS_MIGRATED_KEY = key('migrated', 'assets');

/**
 * Opens a database only if it is already there.
 *
 * The trap this exists for: a version-less `open()` of a database that does not
 * exist *creates* it, at version 1, with no object stores. So `onupgradeneeded`
 * firing is the signal that there was nothing here — and the accident has to be
 * undone, or every future run finds an empty database and tries again.
 */
function openExisting(factory, timeoutMs, name) {
  return new Promise((resolve) => {
    let request = null;
    try {
      request = factory.open(name);
    } catch {
      resolve(null);
      return;
    }
    let missing = false;
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const settle = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    request.onupgradeneeded = () => { missing = true; };
    request.onsuccess = () => {
      const db = request.result;
      if (missing || !db.objectStoreNames.contains(STORE)) {
        db.close();
        try {
          factory.deleteDatabase(name);
        } catch {
          // Nothing to undo, or it is held open elsewhere. Either way the
          // marker below stops us coming back.
        }
        settle(null);
        return;
      }
      settle(db);
    };
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  });
}

function readAllFrom(db) {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function run(db, mode, work) {
  return new Promise((resolve) => {
    let transaction = null;
    try {
      transaction = db.transaction(STORE, mode);
    } catch {
      resolve(null);
      return;
    }
    const request = work(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

/**
 * Opens the store, choosing a backend once. Every method resolves rather than
 * rejecting: an asset that can't be read is an asset you haven't drawn yet, and
 * the rest of the app carries on around it.
 */
export function createAssetStore({
  indexedDB = globalThis.indexedDB,
  storage = browserStorage(),
  openTimeoutMs = OPEN_TIMEOUT_MS,
} = {}) {
  let db = null;
  let backend = 'none';
  let opening = null;

  /**
   * Copies the previous name's records in, once. Runs inside `open` so every
   * read naturally queues behind it — there is nowhere else it could go without
   * a second promise for callers to remember to wait on.
   *
   * The old database is deliberately *not* deleted afterwards. `deleteDatabase`
   * fires `blocked` and then sits pending forever while another tab holds the
   * database open, which is the exact hazard `OPEN_TIMEOUT_MS` was added for.
   * A few megabytes of orphan is the cheaper problem.
   */
  async function bringAcross() {
    if (!db || !storage) return;
    try {
      if (storage.getItem(ASSETS_MIGRATED_KEY)) return;
    } catch {
      return;
    }

    const old = await openExisting(indexedDB, openTimeoutMs, OLD_DB_NAME);
    if (old) {
      for (const record of await readAllFrom(old)) {
        const asset = normalizeAsset(record);
        // Never clobber: the same rule the localStorage migration follows, for
        // the same reason. Anything already here was written by this build.
        if (asset && !(await run(db, 'readonly', (store) => store.get(asset.id)))) {
          await run(db, 'readwrite', (store) => store.put(asset));
        }
      }
      old.close();
    }

    try {
      storage.setItem(ASSETS_MIGRATED_KEY, new Date().toISOString());
    } catch {
      // Unmarked, so it is attempted again next load — which copies nothing,
      // since every record is now already there.
    }
  }

  async function open() {
    if (opening) return opening;
    opening = (async () => {
      db = indexedDB ? await openDatabase(indexedDB, openTimeoutMs) : null;
      if (db) backend = 'indexeddb';
      else if (storage) backend = 'localstorage';
      else backend = 'none';
      await bringAcross();
      return backend;
    })();
    return opening;
  }

  const localKey = (id) => `${FALLBACK_PREFIX}${id}`;

  function localGet(id) {
    try {
      return normalizeAsset(JSON.parse(storage?.getItem(localKey(id)) ?? 'null'));
    } catch {
      return null;
    }
  }

  return {
    ready: open,
    backend: () => backend,
    limit: () => (backend === 'indexeddb' ? LIMIT.idb : LIMIT.local),

    async get(id) {
      if (typeof id !== 'string' || !id) return null;
      await open();
      if (backend === 'indexeddb') {
        return normalizeAsset(await run(db, 'readonly', (store) => store.get(id)));
      }
      if (backend === 'localstorage') return localGet(id);
      return null;
    },

    /** Saves an asset. Resolves to the stored record, or null if it was refused. */
    async put(value) {
      const asset = normalizeAsset(value);
      if (!asset) return null;
      await open();
      if (tooBig(asset, backend === 'indexeddb' ? LIMIT.idb : LIMIT.local)) return null;

      if (backend === 'indexeddb') {
        const key = await run(db, 'readwrite', (store) => store.put(asset));
        return key == null ? null : asset;
      }
      if (backend === 'localstorage') {
        try {
          storage.setItem(localKey(asset.id), JSON.stringify(asset));
          return asset;
        } catch {
          // Out of room, or blocked outright. Either way nothing was saved, and
          // the caller reports that rather than pretending the drawing is safe.
          return null;
        }
      }
      return null;
    },

    async remove(id) {
      await open();
      if (backend === 'indexeddb') await run(db, 'readwrite', (store) => store.delete(id));
      else if (backend === 'localstorage') {
        try {
          storage.removeItem(localKey(id));
        } catch {
          // Nothing to do; a record we can't remove is one we also can't read.
        }
      }
    },

    /** Every stored asset, used by export and to warm the renderer's images. */
    async list() {
      await open();
      if (backend === 'indexeddb') {
        const all = await run(db, 'readonly', (store) => store.getAll());
        return (Array.isArray(all) ? all : []).map(normalizeAsset).filter(Boolean);
      }
      if (backend === 'localstorage') {
        const found = [];
        try {
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key?.startsWith(FALLBACK_PREFIX)) continue;
            const asset = localGet(key.slice(FALLBACK_PREFIX.length));
            if (asset) found.push(asset);
          }
        } catch {
          return found;
        }
        return found;
      }
      return [];
    },
  };
}
