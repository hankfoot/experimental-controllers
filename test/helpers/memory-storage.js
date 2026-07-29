// A localStorage stand-in, since Node has none.
//
// Hoisted out of the test files that had a copy each the moment a third one
// wanted it. It carries `length` and `key(index)` as well as the three obvious
// methods, because the storage migration walks the store by index and a
// stand-in without those would let that walk pass untested.

export function memoryStorage({ failOn = null } = {}) {
  const saved = new Map();
  const store = {
    saved,
    getItem: (name) => (saved.has(name) ? saved.get(name) : null),
    setItem: (name, value) => {
      // For testing a write that fails part-way through — a full quota, or a
      // browser that revokes storage mid-session.
      if (failOn && failOn(name)) throw new Error(`refused ${name}`);
      saved.set(name, String(value));
    },
    removeItem: (name) => saved.delete(name),
    key: (index) => [...saved.keys()][index] ?? null,
  };
  Object.defineProperty(store, 'length', { get: () => saved.size });
  return store;
}
