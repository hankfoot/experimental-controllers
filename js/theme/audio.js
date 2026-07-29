// Sound. Every effect and the music are recordings — the ones that ship with
// the game, one you made with the microphone right here, or a file you dropped
// in. Nothing is synthesised at play time: a sound is a file, always, which is
// what lets the three come from the same place and be swapped for each other.
//
// Three states, exactly mirroring how a drawing works. A slot has a built-in
// picture and `sprite: null` means "use it"; a sound event has a built-in
// recording and `'default'` means the same. `'none'` is the deliberate silence
// that neither of those is.
//
// Two halves that don't know about each other: playing sounds, and capturing
// them. Both degrade to doing nothing rather than throwing, since a browser
// with no AudioContext, or a laptop whose owner said no to the microphone, is a
// browser the rest of the app still has to work in.

const UPLOAD = 'asset:';
export const isUpload = (id) => typeof id === 'string' && id.startsWith(UPLOAD);
export const uploadId = (id) => (isUpload(id) ? id.slice(UPLOAD.length) : null);
export const asUpload = (assetId) => `${UPLOAD}${assetId}`;

/** The one that means "whatever this game came with". */
export const BUILT_IN = 'default';

/** The moments a sound can be attached to. */
export const SOUND_EVENTS = Object.freeze([
  ['launch', 'When a round starts, play'],
  ['score', 'When you clear an obstacle, play'],
  ['crash', 'When you crash, play'],
  ['thrust', 'While you are steering, play'],
]);

/**
 * `resolveUpload(assetId)` hands back the raw bytes of a stored sound, or null.
 * Injected rather than imported so this module never learns where assets are
 * kept — and so a test can hand it nothing at all.
 *
 * `builtIn` maps an event (and 'music') to the file that ships with the game.
 * Injected for the same reason: which files exist is the manifest's business,
 * over in defaults.js.
 */
export function createAudio({
  context: provided,
  resolveUpload = async () => null,
  builtIn = {},
} = {}) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let ctx = provided ?? null;
  let master = null;
  let musicGain = null;
  let volume = 0.6;
  let muted = false;
  let music = { track: 'none', source: null };

  const buffers = new Map(); // assetId -> AudioBuffer, or null once known bad
  const pending = new Map();

  function start() {
    if (!ctx) {
      if (!Context) return null;
      try {
        ctx = new Context();
      } catch {
        return null;
      }
    }
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.connect(master);
    }
    master.gain.value = muted ? 0 : volume;
    // Browsers hand back a suspended context until a gesture has happened, and
    // every entry point here is downstream of a click or a keypress.
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return ctx;
  }

  /**
   * What a sound id means, for a given moment: where to fetch the bytes, and a
   * key to file the decoded result under. `event` only matters for the built-in
   * case, which is the one that doesn't carry its own address.
   */
  function sourceFor(id, event) {
    if (isUpload(id)) {
      return {
        key: id,
        async bytes() {
          const raw = await resolveUpload(uploadId(id));
          return raw ? raw.slice(0).buffer : null;
        },
      };
    }
    const path = id === BUILT_IN ? builtIn[event] : null;
    if (!path) return null;
    return {
      key: `file:${path}`,
      async bytes() {
        try {
          const response = await fetch(path);
          return response.ok ? await response.arrayBuffer() : null;
        } catch {
          // Offline, or the file was never added to the manifest's folder.
          return null;
        }
      },
    };
  }

  async function bufferFor(source) {
    const { key } = source;
    if (buffers.has(key)) return buffers.get(key);
    if (pending.has(key)) return pending.get(key);

    const work = (async () => {
      // decodeAudioData wants a buffer it can detach, and a sound may be played
      // more than once, so `bytes()` always hands over a copy of its own.
      const raw = await source.bytes();
      if (!raw || !start()) return null;
      try {
        const decoded = await ctx.decodeAudioData(raw);
        buffers.set(key, decoded);
        return decoded;
      } catch {
        buffers.set(key, null);
        return null;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, work);
    return work;
  }

  function playBuffer(buffer, destination, loop = false) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(destination);
    source.start();
    return source;
  }

  function stopMusic() {
    try {
      music.source?.stop();
    } catch {
      // Already stopped, which is the state we were after anyway.
    }
    music = { track: 'none', source: null };
  }

  return {
    /** Whether anything can make a sound at all. */
    available: () => Boolean(Context || provided),

    /**
     * Called from anything that counts as a gesture. A context built before the
     * page had one starts out suspended, and a sound played against a stopped
     * clock is never heard.
     */
    resume() {
      start();
    },

    setVolume(next) {
      volume = Math.max(0, Math.min(1, Number(next) || 0));
      if (master) master.gain.value = muted ? 0 : volume;
    },
    setMuted(next) {
      muted = Boolean(next);
      if (master) master.gain.value = muted ? 0 : volume;
    },
    muted: () => muted,

    /**
     * Fires one sound. `id` is `'default'`, `'none'`, or `asset:<id>`; `event`
     * says which moment this is, which is what a `'default'` resolves through.
     *
     * Returns a handle: `{ stop() }` while it is playing, and `onEnded` fires
     * when it finishes on its own. The game ignores both — a crash noise is
     * fire-and-forget — but the Design screen's preview button needs to know,
     * because a button that says ▶ while a sound is already playing offers to
     * do the thing it is doing.
     */
    play(id, event, { onEnded } = {}) {
      if (muted || !start()) return null;
      const source = sourceFor(id, event);
      if (!source) return null;

      let node = null;
      let cancelled = false;
      bufferFor(source).then((buffer) => {
        if (!buffer || muted || cancelled) {
          onEnded?.();
          return;
        }
        node = playBuffer(buffer, master);
        node.onended = () => onEnded?.();
      });

      return {
        stop() {
          cancelled = true;
          try {
            node?.stop();
          } catch {
            // Already finished, which is the state we were asking for.
          }
          node = null;
        },
      };
    },

    /** Starts or swaps the looping background track. */
    setMusic(id) {
      if (id === music.track) return;
      stopMusic();
      if (!start()) return;
      const source = sourceFor(id, 'music');
      if (!source) return;
      music.track = id;
      bufferFor(source).then((buffer) => {
        if (buffer && music.track === id) music.source = playBuffer(buffer, musicGain, true);
      });
    },

    stopMusic,

    /** Drops a decoded sound so a re-recorded one isn't played from cache. */
    forget(assetId) {
      const id = asUpload(assetId);
      buffers.delete(id);
      pending.delete(id);
    },
  };
}

// --- Making the noise yourself ----------------------------------------------

/** Formats worth asking for, best first. Browsers differ on what they'll give. */
const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function recordingSupported() {
  return Boolean(globalThis.MediaRecorder && navigator.mediaDevices?.getUserMedia);
}

function pickType() {
  if (!globalThis.MediaRecorder?.isTypeSupported) return '';
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * One recording, from asking for the microphone to handing back a Blob.
 *
 * The stream's tracks are stopped on the way out whatever happened, because a
 * live microphone leaves a recording indicator lit on the machine and people
 * quite reasonably mind about that.
 */
/**
 * Opens the microphone and records until stopped.
 *
 * `beforeStart` runs after the microphone is open and the recorder is built but
 * before either of them is doing anything — which is where a countdown belongs.
 * Splitting it there is the point: asking for permission is the slow,
 * unpredictable part, so it happens first, and the count then measures the one
 * thing it can honestly promise. It also means the cap below starts when
 * recording does rather than when the counting does. Returning false from it
 * closes the microphone and records nothing.
 */
export async function startRecording({ maxMs = 10_000, beforeStart = null } = {}) {
  if (!recordingSupported()) return { error: 'This browser cannot record audio.' };

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    return {
      error: denied
        ? 'The microphone was blocked. Allow it for this page and try again.'
        : 'No microphone was available.',
    };
  }

  const mimeType = pickType();
  let recorder = null;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return { error: 'This browser cannot record audio.' };
  }

  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data);
  });

  const finished = new Promise((resolve) => {
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    });
  });

  if (beforeStart) {
    let go = false;
    try {
      go = await beforeStart();
    } catch {
      go = false;
    }
    if (go === false) {
      stream.getTracks().forEach((track) => track.stop());
      return { cancelled: true };
    }
  }

  recorder.start();
  // A hard stop, so a forgotten recording can't run until the tab is closed and
  // fill storage with a ten-minute file of somebody's afternoon.
  const timer = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
  }, maxMs);

  return {
    stop() {
      clearTimeout(timer);
      if (recorder.state === 'recording') recorder.stop();
      return finished;
    },
    cancel() {
      clearTimeout(timer);
      if (recorder.state === 'recording') recorder.stop();
      finished.then(() => {});
      return null;
    },
  };
}
