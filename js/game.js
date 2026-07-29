// Host for the game. Owns the canvas, the frame loop, the score UI, and the
// manual keyboard/button fallbacks, and swaps the active control scheme
// underneath all of it. Controller interpretation stays in the wiring engine;
// the physics and drawing stay in js/games/.
//
// The scheme picker lives on the Controls tab and the canvas on the Game tab, so
// this module reaches across both — which is also why the round restarts
// whenever the game panel comes back into view.

import { GAMES, DEFAULT_GAME_ID, findGame } from './games/index.js';
import { defaultTheme, fontStack, cardPalette, CARD } from './theme/theme-store.js';
import { key } from './storage-keys.js';

const STORAGE_KEY = key('game');

// The score while a round is running is drawn over the game world rather than
// on the card, so it keeps its own colours: white with a dark halo reads over
// whatever anybody has painted behind it.
const SCORE_INK = { fill: '#ffffff', shadow: 'rgba(27, 28, 32, .45)' };

const KEY_LABELS = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', KeyW: 'W', KeyS: 'S' };
const keyLabel = (code) => KEY_LABELS[code] ?? code;

// What the overlay says when nobody has customized it.
const blankTheme = defaultTheme();

/**
 * `look` is the theme: `{ theme(), images }`, the same pair the renderer reads.
 * `audio` is optional — the whole host works without it, and does when the
 * browser has no AudioContext to give.
 */
export function initGame({ look = null, audio = null, musicWhen = null } = {}) {
  const byId = (id) => document.getElementById(id);
  const ui = {
    canvas: byId('game-canvas'),
    panel: byId('panel-game'),
    picker: byId('game-picker'),
    tagline: byId('game-tagline'),
    buttons: byId('game-buttons'),
    reset: byId('game-reset'),
    scheme: byId('game-scheme'),
    score: byId('game-score'),
    best: byId('game-best'),
    status: byId('game-status'),
  };
  if (Object.values(ui).some((element) => !element)) return null;

  const ctx = ui.canvas.getContext('2d');
  if (!ctx) return null;

  const gameChangeListeners = new Set();
  let current = null; // { game, engine, render }
  let lastFrame = performance.now();
  let unsubscribe = null;

  // --- Drawing helpers shared by every game ---------------------------------
  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  const themeNow = () => look?.theme?.() ?? blankTheme;

  function makeHelpers(rules) {
    const { width, height } = rules;

    function drawScore(score, font) {
      ctx.font = `700 38px ${font}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = SCORE_INK.shadow;
      ctx.strokeText(String(score), width / 2, 58);
      ctx.fillStyle = SCORE_INK.fill;
      ctx.fillText(String(score), width / 2, 58);
    }

    /**
     * Breaks a line into as many as it takes to fit. Canvas has no wrapping of
     * its own, so without this everything anybody typed was drawn as one line
     * and simply ran out of both sides of the card.
     *
     * Assumes `ctx.font` is already the font it will be drawn in — measuring
     * against a different one is how a card ends up sized for text it isn't
     * showing. A single word wider than the card is left alone rather than
     * broken mid-letter; the theme caps a line at 60 characters, so the worst
     * case is one long word slightly over the edge instead of a hyphen storm.
     */
    function wrap(text, maxWidth) {
      const words = String(text ?? '').split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines = [];
      let line = words[0];
      for (const word of words.slice(1)) {
        const candidate = `${line} ${word}`;
        if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
      return lines;
    }

    const fontFor = (style, font) => `${style.weight} ${style.size}px ${font}`;

    /**
     * The card's contents, measured but not yet drawn.
     *
     * Laying it out before drawing is what lets the card be the size of what is
     * in it. It used to be a fixed 166 or 208 tall whatever the words were, so
     * a short line left a pool of empty card under it and a long one wrote
     * straight through the bottom edge.
     */
    function layout(words, state, font) {
      const inner = CARD.width - CARD.padX * 2;
      const blocks = [];
      const add = (style, lines) => {
        if (lines.length) blocks.push({ style, lines, height: lines.length * style.size * CARD.leading });
      };

      ctx.font = fontFor(CARD.title, font);
      add(CARD.title, wrap(words.title, inner));

      if (state.phase === 'over') {
        // Drawn by the game rather than typed into the words, so it is always
        // the number you actually got — and the record beside it, since the
        // one thing anybody wants to know at that moment is whether they beat it.
        add(CARD.score, [String(state.score)]);
        add(CARD.best, [state.score >= state.best && state.score > 0
          ? 'NEW BEST'
          : `BEST ${state.best}`]);
      }

      ctx.font = fontFor(CARD.body, font);
      add(CARD.body, wrap(words.body, inner));

      let cardHeight = CARD.padTop + CARD.padBottom
        + blocks.reduce((sum, block) => sum + block.height, 0)
        + Math.max(0, blocks.length - 1) * CARD.gap;
      if (words.button) cardHeight += CARD.gap + CARD.button.height;

      return { blocks, cardHeight, inner };
    }

    /** A pill with words on it, centred on the card. */
    function drawButton(label, palette, font, centreY) {
      ctx.font = fontFor(CARD.button, font);
      const buttonWidth = Math.min(
        CARD.width - CARD.padX * 2,
        ctx.measureText(label).width + CARD.button.padX * 2,
      );
      const { height: buttonHeight } = CARD.button;

      ctx.fillStyle = palette.buttonFill;
      roundedRect(
        (width - buttonWidth) / 2, centreY - buttonHeight / 2,
        buttonWidth, buttonHeight, buttonHeight / 2,
      );
      ctx.fill();
      ctx.fillStyle = palette.buttonInk;
      ctx.textAlign = 'center';
      // Nudged off the exact centre because a text baseline sits below it.
      ctx.fillText(label, width / 2, centreY + CARD.button.size * 0.35);
    }

    function drawOverlay(state) {
      const theme = themeNow();
      const palette = cardPalette(theme.overlay);
      const font = fontStack(theme.font);
      if (state.phase === 'playing') {
        drawScore(state.score, font);
        return;
      }

      const over = state.phase === 'over';
      const words = over
        ? { title: theme.text.over, body: theme.text.overBody, button: theme.text.overButton }
        : { title: theme.text.title, body: theme.text.body, button: theme.text.button };

      const { blocks, cardHeight } = layout(words, state, font);
      const cardWidth = Math.min(CARD.width, width - 80);
      const x = (width - cardWidth) / 2;
      // Centred. It used to sit high, to stay clear of a craft parked around
      // the middle of the field — but the craft moves and the card does not,
      // so all that bought was a card that looked misplaced the rest of the time.
      const y = (height - cardHeight) / 2;

      ctx.fillStyle = palette.panel;
      roundedRect(x, y, cardWidth, cardHeight, CARD.radius);
      ctx.fill();
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      let cursor = y + CARD.padTop;
      for (const block of blocks) {
        ctx.font = fontFor(block.style, font);
        ctx.fillStyle = block.style === CARD.body ? palette.body : palette.title;
        for (const line of block.lines) {
          // The baseline sits below the top of the line box by about the cap
          // height, which is near enough to the font size for lettering this size.
          cursor += block.style.size * CARD.leading;
          ctx.fillText(line, width / 2, cursor - block.style.size * 0.22);
        }
        cursor += CARD.gap;
      }

      // The whole canvas starts a round, so this labels what a tap does rather
      // than being the only thing that does it.
      if (words.button) drawButton(words.button, palette, font, cursor + CARD.button.height / 2);
    }

    return { roundedRect, drawScore, drawOverlay };
  }

  function resize() {
    if (!current) return;
    const { width, height } = current.game.rules;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    ui.canvas.width = width * scale;
    ui.canvas.height = height * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // --- UI sync --------------------------------------------------------------
  function primaryControl() {
    return current.game.controls.find((control) => control.primary) ?? current.game.controls[0];
  }

  /**
   * Every control and every key that works it, as one line of prose.
   *
   * This replaced a row of on-screen buttons. Those were a second way to play
   * that nobody used — the keys and the controller you built are the two that
   * matter — and having them meant the keys were never written down anywhere
   * except a hint naming the first key of one control.
   */
  function controlText() {
    const parts = current.game.controls.map((control) => {
      const keys = (control.keys ?? []).map(keyLabel).join(' / ');
      return keys ? `${control.label}: ${keys}` : control.label;
    });
    const mouse = current.game.motion === 'track' ? ['or just move the mouse over the game'] : [];
    return [...parts, ...mouse].join('  ·  ');
  }

  function readyHint() {
    const control = primaryControl();
    const key = keyLabel(control.keys?.[0] ?? '');
    const verb = control.kind === 'hold' ? 'Hold' : 'Press';
    return `${verb} ${key} or wire up your controller.`;
  }

  // The numbers above the canvas used to be set in the app's mono face while the
  // score drawn *on* the canvas used the theme's — two readings of the same
  // number, inches apart, in different type. Pushed as a custom property rather
  // than set on each element, so one write covers the row.
  let shownFont = null;
  function syncFont() {
    const face = fontStack(themeNow().font);
    if (face === shownFont) return;
    shownFont = face;
    ui.panel.style.setProperty('--game-font', face);
  }

  function syncUi() {
    syncFont();
    const { state } = current.engine;
    ui.score.textContent = String(state.score);
    ui.best.textContent = String(state.best);
    if (state.phase === 'ready') {
      ui.status.textContent = `Ready — ${readyHint()}`;
    } else if (state.phase === 'playing') {
      ui.status.textContent = `Playing — score ${state.score}.`;
    } else {
      ui.status.textContent = `Game over — score ${state.score}. Go again to retry.`;
    }
  }

  // One choice out of four, and picking it rewrites the controls listed under
  // it — so it reads as the heading of that list rather than a gallery of cards
  // competing with the board for attention.
  function renderPicker() {
    ui.picker.replaceChildren();
    for (const game of GAMES) {
      const option = document.createElement('option');
      option.value = game.id;
      option.textContent = `${game.emoji}  ${game.label} · ${game.scheme}`;
      option.selected = game.id === current?.game.id;
      ui.picker.appendChild(option);
    }
  }

  function renderControls() {
    ui.buttons.textContent = controlText();
  }

  // --- Input ----------------------------------------------------------------
  const held = new Set();

  /**
   * Lets a held control go, wherever the page happens to be.
   *
   * Deliberately not routed through `activate`, which ignores everything while
   * the game panel is hidden. That guard is right for a press and wrong for a
   * release: hold a key, switch tab before letting go, and the release was
   * dropped — so the id stayed in `held` and the craft went on thrusting until
   * something else happened to clear it.
   */
  function release(control) {
    if (!held.delete(control.id)) return;
    current?.engine.hold(control.id, false);
  }

  function releaseAll() {
    for (const id of held) current?.engine.hold(id, false);
    held.clear();
  }

  function activate(control, phase) {
    if (!current || ui.panel.hidden) return;
    // Every path into here is a keypress, a tap, or a click — which is exactly
    // what a browser wants to see before it will let a page make a sound.
    audio?.resume();
    if (control.kind === 'hold') {
      if (phase === 'down' && !held.has(control.id)) {
        held.add(control.id);
        current.engine.hold(control.id, true);
      } else if (phase === 'up' && held.delete(control.id)) {
        current.engine.hold(control.id, false);
      }
      return;
    }
    if (phase === 'down') current.engine.press(control.id);
  }

  function controlForKey(code) {
    return current?.game.controls.find((control) => control.keys?.includes(code)) ?? null;
  }

  function controlById(id) {
    return current?.game.controls.find((control) => control.id === id) ?? null;
  }

  // The keys the page must not act on while the game is up, whether or not the
  // active scheme happens to bind them. Binding alone was not enough: Flappy
  // uses Space and ↑, so pressing ↓ fell through to the browser and scrolled
  // the game off the screen mid-round — and which arrow does that changes with
  // the scheme, which is worse than it always doing it.
  const STEERING_KEYS = new Set([
    'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD',
  ]);

  document.addEventListener('keydown', (event) => {
    if (ui.panel.hidden || event.repeat) return;
    // Somewhere a key already means something — a button, a text field — is
    // somewhere the game has no business taking it.
    const typing = event.target.closest?.(
      'button, a, input, select, textarea, [contenteditable="true"]',
    );
    if (typing) return;
    if (STEERING_KEYS.has(event.code)) event.preventDefault();
    const control = controlForKey(event.code);
    if (control) activate(control, 'down');
  });
  document.addEventListener('keyup', (event) => {
    const control = controlForKey(event.code);
    if (control) release(control);
  });
  window.addEventListener('blur', releaseAll);

  ui.canvas.addEventListener('pointerdown', (event) => {
    ui.canvas.focus();
    event.preventDefault();
    activate(primaryControl(), 'down');
  });
  ui.canvas.addEventListener('pointerup', () => activate(primaryControl(), 'up'));
  ui.canvas.addEventListener('pointerleave', releaseAll);

  // The mouse, for the one scheme that steers to a position rather than by
  // pushing. A dial is what that scheme is really for, but before anybody has
  // wired one there is nothing to demonstrate it with — arrow keys nudging a
  // value is exactly the feel it is not supposed to have. Whatever spoke last
  // wins, here as everywhere, so a wired reading takes over on its next sample.
  ui.canvas.addEventListener('pointermove', (event) => {
    if (!current || ui.panel.hidden || current.game.motion !== 'track') return;
    const box = ui.canvas.getBoundingClientRect();
    if (!box.height) return;
    const { groundY, playerRadius } = current.game.rules;
    // Read against the band the craft can actually occupy, so the top of the
    // window puts it at the top of its travel rather than somewhere short of it.
    const top = (playerRadius / current.game.rules.height) * box.height;
    const bottom = (groundY - playerRadius) / current.game.rules.height * box.height;
    const at = (event.clientY - box.top - top) / Math.max(1, bottom - top);
    current.engine.steer(Math.max(0, Math.min(1, at)));
  });

  ui.reset.addEventListener('click', () => {
    releaseAll();
    current.engine.reset();
  });

  ui.picker.addEventListener('change', (event) => selectGame(event.target.value));

  window.addEventListener('resize', resize);

  // --- Game switching -------------------------------------------------------
  function selectGame(id, { persist = true } = {}) {
    const game = findGame(id);
    if (!game || game.id === current?.game.id) return;

    releaseAll();
    unsubscribe?.();

    const engine = game.createEngine();
    current = { game, engine, render: game.createRenderer(ctx, makeHelpers(game.rules), look) };
    unsubscribe = engine.subscribe(syncUi);
    heard = null;

    ui.canvas.setAttribute('aria-label', `Sidescroller. ${game.scheme} controls — ${game.label}.`);
    ui.tagline.textContent = game.tagline;
    ui.scheme.textContent = game.scheme;
    renderPicker();
    renderControls();
    resize();
    syncUi();

    if (persist) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, game.id);
      } catch {
        // Persistence may be blocked; the picker still works for this session.
      }
    }
    gameChangeListeners.forEach((listener) => listener(game));
  }

  let wasVisible = false;

  // --- Sound ----------------------------------------------------------------
  // Which moments deserve a noise is a question about the game's story, not
  // about its physics, so it is answered here by watching the state the engine
  // publishes rather than by the engine announcing anything. js/games/ stays
  // pure arithmetic, and its tests stay free of a sound card.
  let heard = null;

  function playSounds(state) {
    if (!audio) return;
    const { sound } = themeNow();
    const steering = Boolean(state.player.thrusting || state.player.sinking);

    if (heard) {
      if (state.phase === 'playing' && heard.phase !== 'playing') audio.play(sound.launch, 'launch');
      if (state.phase === 'over' && heard.phase !== 'over') audio.play(sound.crash, 'crash');
      if (state.score > heard.score) audio.play(sound.score, 'score');
      // Only the moment steering starts, or a held control would retrigger the
      // same sound on every one of the sixty frames it is down for.
      if (steering && !heard.steering) audio.play(sound.thrust, 'thrust');
    }
    heard = { phase: state.phase, score: state.score, steering };
  }

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.035);
    lastFrame = now;
    const visible = Boolean(current) && !ui.panel.hidden;
    if (visible) {
      // Wiring on the Controls tab drives this same engine, so testing a wire can
      // wake a round up with nobody watching. Arriving at the game hands the
      // player a fresh one rather than whatever was left mid-air.
      if (!wasVisible) {
        releaseAll();
        current.engine.reset();
        heard = null;
        syncMusic();
      }
      syncFont();
      current.engine.update(dt);
      playSounds(current.engine.state);
      ctx.clearRect(0, 0, current.game.rules.width, current.game.rules.height);
      current.render(current.engine.state, now);
    }
    wasVisible = visible;
    requestAnimationFrame(frame);
  }

  /**
   * Whether the music should be running at all.
   *
   * Not the same question as "is the game on screen". You pick the music on the
   * Design screen, so it has to play there too — and it must stop when the whole
   * browser tab goes away, which panel visibility says nothing about. The host
   * is told the rule rather than working it out, since which panels count is a
   * fact about the app's layout and not about the game.
   */
  const musicWanted = musicWhen ?? (() => !ui.panel.hidden);

  function syncMusic() {
    if (!audio) return;
    if (!musicWanted()) {
      audio.stopMusic();
      return;
    }
    const { music } = themeNow();
    audio.setVolume(music.volume);
    audio.setMuted(music.muted);
    audio.setMusic(music.track);
  }

  // Checked on a timer because two of the three things that change the answer —
  // switching browser tabs, and switching page panels — fire no event this
  // module listens to. A second's lag on stopping a track nobody is looking at
  // is not worth wiring three listeners for.
  let musicOn = false;
  setInterval(() => {
    const wanted = Boolean(musicWanted());
    if (wanted === musicOn) return;
    musicOn = wanted;
    syncMusic();
  }, 500);

  let saved = null;
  try {
    saved = globalThis.localStorage?.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  selectGame(findGame(saved) ? saved : DEFAULT_GAME_ID, { persist: false });
  requestAnimationFrame(frame);

  return {
    // The control surface the wiring engine drives — deliberately generic, so
    // whichever game is loaded receives the same three calls.
    actions: {
      setValue: (node, port, value) => current?.engine.setValue(node, port, value),
      fire: (node, port) => current?.engine.fire(node, port),
      setWiredPorts: (ports) => current?.engine.setWiredPorts(ports),
      setControlOptions: (node, port, options) =>
        current?.engine.setControlOptions?.(node, port, options),
    },
    activeGame: () => current?.game ?? null,
    selectGame,
    // The theme is read fresh every frame, so a visual change needs no call at
    // all; this is only for the parts that aren't drawn — volume, mute, and
    // which track should be playing.
    syncMusic,
    onGameChange(listener) {
      gameChangeListeners.add(listener);
      return () => gameChangeListeners.delete(listener);
    },
  };
}
