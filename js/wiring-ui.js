// Accessible patch bay. Every input exposes its own outputs and every game
// control its ports; a connection is legal when the two ends are the same type,
// which is a rule you can see rather than one you discover by being refused.
// Click/tap an output then a port; pointer users can also drag. SVG cables are
// decorative — the mapping cards remain the source of truth and work on narrow
// screens without the diagram.

import {
  BEARINGS,
  findOutput,
  isValuePort,
  outputIdOf,
  phrasingOf,
  sourceOutputs,
  subjectOf,
} from './wiring-config.js';
import { createDefaultTransform } from './wiring-runtime.js';
import {
  browserStorage,
  isPortSetting,
  loadDrafts,
  loadPortDefaults,
  normalizeTransform,
  saveDrafts,
  savePortDefaults,
} from './wiring-storage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// What a group of jacks is called, which is the connector type itself — the same
// word the matching port says on the other side of the board. A setting is the
// one entry that names no connector, because it has none: what the group holds
// is choices about the control, so that is what it says.
const TYPE_LABELS = Object.freeze({
  trigger: 'Trigger',
  hold: 'Hold',
  level: 'Level',
  setting: 'Settings',
});

// How often a trigger will let itself fire. The runtime counts in milliseconds,
// so that is what gets stored — but a millisecond is a unit you have to already
// know, and the choice being made is only ever between three speeds. Nobody
// building a controller out of foil needs the difference between 160 ms and
// 200 ms; they need to know whether a shake fires once or twenty times.
//
// Read as a ceiling — "Limit trigger to a few times a second" — because that is
// what it is. A rate stated flat sounds like a promise the wire will fire that
// often, when all it does is refuse to fire faster.
//
// Each choice carries its own "to", so the one that sets no ceiling at all can
// say so plainly instead of being bent into a rate it isn't. "No limit" is a
// different shape of answer from "a few times a second", and the sentence is
// only right if the choices are allowed to be different shapes.
const PACES = Object.freeze([
  [0, 'not at all'],
  [160, 'to a few times a second'],
  [1000, 'to about once a second'],
]);

// How closely a level follows the reading driving it — the level's answer to
// the same question a trigger's pace answers, which is why it sits on the same
// end of the wire. Stored as the fraction of the old value each tick keeps, and
// said as what the control visibly does with it: a mic reading twitches, and the
// choice is whether the craft twitches with it.
//
// Each reads as the tail of its port's own sentence, so they are participles
// rather than adverbs: "Set the vertical position while smoothing out the
// jitter."
const SMOOTHINGS = Object.freeze([
  [0, 'following every wobble'],
  [0.6, 'smoothing out the jitter'],
  [0.9, 'ignoring all but the big moves'],
]);

// Saved wiring can carry any number — pace used to be typed into a box, and
// smoothing into a percent one — so a stored value lands on whichever choice it
// sits closest to. Showing the nearest is honest about what the wire does;
// showing nothing selected would not be.
function nearestChoice(choices, value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return choices.reduce(
    (best, [option]) => (Math.abs(option - number) < Math.abs(best - number) ? option : best),
    choices[0][0],
  );
}

const nearestPace = (ms) => nearestChoice(PACES, ms, PACES[1][0]);
const nearestSmoothing = (fraction) => nearestChoice(SMOOTHINGS, fraction, SMOOTHINGS[0][0]);

export function initWiringUI({ signalStore, engine }) {
  const byId = (id) => document.getElementById(id);
  const ui = {
    board: byId('wiring-board'),
    nothing: byId('wiring-nothing'),
    sources: byId('wiring-sources'),
    targets: byId('wiring-targets'),
    cables: byId('wiring-cables'),
    clear: byId('wiring-clear'),
    // Owned by the game module — the board only ever re-homes it, never builds
    // or clears it, so switching schemes can't tear out the control that
    // switches schemes.
    scheme: byId('game-picker-block'),
  };
  if (Object.values(ui).some((element) => !element)) return;

  let drag = null;
  let suppressClick = false;
  const activityTimers = new Map();
  // What a jack is set to before anything is patched into it, so its sentence
  // can be read (and adjusted) up front. A new wire starts from this, and
  // unwiring hands the settings back, so nothing you typed is thrown away.
  const draftStorage = browserStorage();
  const drafts = loadDrafts(draftStorage);
  // The same idea from the control's end: how it will let itself be driven —
  // pacing for a trigger, smoothing for a level — readable and settable whether
  // or not anything is wired into it yet.
  const portDefaults = loadPortDefaults(draftStorage);

  function rememberDraft(key, kind, transform) {
    drafts.set(key, { kind, transform });
    saveDrafts(draftStorage, drafts);
  }

  const portKey = (node, port) => `${node}:${port}`;
  const portSettings = (node, port) => portDefaults.get(portKey(node, port)) ?? {};
  const paceOf = (node, port) => portSettings(node, port).cooldownMs ?? 160;
  const smoothingOf = (node, port) => portSettings(node, port).smoothing ?? SMOOTHINGS[0][0];

  function rememberPortSetting(node, port, patch) {
    setPortSetting(portKey(node, port), patch);
  }

  function setPortSetting(key, patch) {
    portDefaults.set(key, { ...(portDefaults.get(key) ?? {}), ...patch });
    savePortDefaults(draftStorage, portDefaults);
  }

  const targetOf = (nodeId) => engine.targets.find(({ id }) => id === nodeId);
  const portOf = (target) => targetOf(target.node)?.ports.find(({ id }) => id === target.port);
  // A live reading carries its unit, so the number beside the name means
  // something without having to be looked up.
  const formatValue = (signal) => {
    if (signal.value == null) return '';
    const number = Number.isInteger(signal.value) ? String(signal.value) : signal.value.toFixed(1);
    return signal.unit ? `${number}${signal.unit}` : number;
  };

  // The sensor's own unit after any number you set, as its own word in the
  // sentence. Nothing to add when the reading is a bare count; those channels
  // say their scale in the block's description.
  const unitWords = (signal) => (signal?.unit ? [signal.unit] : []);

  function outputJack(channel, outputId) {
    return ui.sources.querySelector(
      `.wiring-out-row[data-channel="${CSS.escape(channel)}"][data-output="${outputId}"] .wiring-jack`,
    );
  }

  const draftKey = (channel, outputId) => `${channel}:${outputId}`;

  function draftTransform(signal, output) {
    const key = draftKey(signal.channel, output.id);
    const held = drafts.get(key);
    // A signal that turns out to be analog invalidates a draft built when it
    // still looked like a button, so the kind is remembered alongside it.
    if (held?.kind === signal.kind) return held.transform;
    const transform = createDefaultTransform(signal, { type: output.type }, output.id);
    rememberDraft(key, signal.kind, transform);
    return transform;
  }

  // Which jack a saved connection is hanging off, for cables and card labels.
  function connectionOutput(connection) {
    const signal = signalStore.get(connection.source);
    const output = outputIdOf(signal, portOf(connection.target), connection.transform);
    return findOutput(signal, output) ?? { id: output, type: 'trigger', label: output };
  }

  /** What the Controls screen says when there is nothing yet to control with. */
  function emptyBoard() {
    const title = document.createElement('p');
    title.className = 'placeholder-title';
    title.textContent = 'Nothing to wire up yet';

    const body = document.createElement('p');
    body.append(
      document.createTextNode('Pick the inputs your controller uses over on '),
    );
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn';
    link.dataset.tabTarget = 'sensing';
    link.textContent = 'Sensing';
    body.append(link, document.createTextNode(
      ', and they will appear here to wire to the game. Connecting a board that '
      + 'is already sending will also fill this in.',
    ));

    return [title, body];
  }

  function renderSources() {
    const signals = signalStore.all().sort((a, b) => {
      const aRank = a.planned ? 0 : a.wired ? 1 : 2;
      const bRank = b.planned ? 0 : b.wired ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      // The inputs you picked keep the order the Sensing page lists them in, so
      // the two pages read as the same list rather than two shuffles of it.
      // Anything else — a live channel nobody planned — has no such order to
      // borrow and falls back to its name.
      if (a.order != null && b.order != null) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
    ui.sources.replaceChildren();
    ui.clear.disabled = engine.listConnections().length === 0;

    // With nothing to wire *from*, the whole board goes away rather than just
    // its left-hand column. It used to show a line of apology beside a full set
    // of jacks, which invited people to drag between two things when only one
    // of them existed — and left this screen claiming to offer something the
    // Sensing screen had not yet made possible. The two pages agree now.
    const bare = !signals.length;
    ui.board.hidden = bare;
    ui.nothing.hidden = !bare;
    ui.clear.hidden = bare;
    if (bare) {
      ui.nothing.replaceChildren(...emptyBoard());
      return;
    }

    for (const signal of signals) {
      const card = document.createElement('article');
      card.className = 'wiring-source';
      card.dataset.channel = signal.channel;
      card.dataset.kind = signal.kind || 'unknown';
      card.dataset.live = String(signal.live);

      const identity = document.createElement('div');
      identity.className = 'wiring-source-id';
      const emoji = document.createElement('span');
      emoji.className = 'wiring-source-emoji';
      emoji.setAttribute('aria-hidden', 'true');
      emoji.textContent = signal.emoji;

      const lines = document.createElement('span');
      lines.className = 'wiring-source-lines';
      const label = document.createElement('strong');
      label.textContent = signal.label;
      const channel = document.createElement('code');
      channel.textContent = signal.channel;
      lines.append(label);
      // A pin can be read as a touch pad or as a switch, and which one it is was
      // decided back on the Sensing page — so it says so here rather than
      // leaving you to remember. Same "as" the picker there is labelled with,
      // and it reads as part of the name, before the bare channel.
      if (signal.mode) {
        const mode = document.createElement('span');
        mode.className = 'wiring-source-mode';
        mode.textContent = `as ${signal.mode}`;
        lines.appendChild(mode);
      }
      lines.appendChild(channel);

      const reading = document.createElement('span');
      reading.className = 'wiring-source-reading';
      reading.dataset.sourceValue = signal.channel;
      reading.textContent = formatValue(signal);
      identity.append(emoji, lines, reading);

      // What the input actually reads, under its name — the same line the
      // Sensing page introduced it with, so a block you wired days ago still
      // says what its numbers mean without going back to look it up. A full
      // card-width line rather than nested in the identity row, so it starts
      // flush with the emoji instead of indented under the title.
      let desc = null;
      if (signal.desc) {
        desc = document.createElement('p');
        desc.className = 'wiring-source-desc';
        desc.textContent = signal.desc;
      }

      const outs = document.createElement('div');
      outs.className = 'wiring-outs';
      // The headings name connector types, not jacks, so all the jacks of one
      // type sit under one of them: an analog reading offers HOLD once, with
      // its high end and its low end beneath. Which end each is belongs in the
      // sentence, where "above" and "below" are already the words — repeating
      // it as two headings made the type look like two different things.
      let group = null;
      let groupType = null;
      for (const output of sourceOutputs(signal)) {
        if (output.type !== groupType) {
          groupType = output.type;
          group = document.createElement('div');
          group.className = 'wiring-out-group';
          const head = document.createElement('div');
          head.className = 'wiring-out';
          head.textContent = TYPE_LABELS[output.type] ?? output.label;
          group.appendChild(head);
          outs.appendChild(group);
        }

        // A jack and whatever it currently drives travel together, so the
        // settings for a wire sit under the output that produced it rather
        // than in a separate list you have to match up by name. The row owns
        // the identity; the settings and the jack both read it.
        const row = document.createElement('div');
        row.className = 'wiring-out-row';
        row.dataset.channel = signal.channel;
        row.dataset.output = output.id;
        row.dataset.type = output.type;
        // Everything is reachable until a cable is actually in the air.
        row.dataset.compatible = 'true';

        // One wire per jack, so this is one box that changes appearance when
        // something is patched in — never a second box appearing beneath.
        const maps = document.createElement('div');
        maps.className = 'wiring-out-maps';
        const wire = wireFrom(signal, output.id);
        const box = wire ? connectionCard(wire, signal) : draftCard(signal, output);
        row.dataset.wired = String(Boolean(wire));

        // The jack lives inside the box it belongs to, against the wall its
        // cable runs to. First in the markup, because the box lays itself out
        // reversed, which puts it hard against the outer edge.
        const jack = document.createElement('span');
        jack.className = 'wiring-jack';
        jack.setAttribute('aria-hidden', 'true');
        box.prepend(jack);

        maps.appendChild(box);
        row.appendChild(maps);
        group.appendChild(row);
      }

      card.append(identity);
      if (desc) card.appendChild(desc);
      card.appendChild(outs);
      ui.sources.appendChild(card);
    }
  }

  function renderTargets() {
    ui.targets.replaceChildren();
    const connections = engine.listConnections();

    for (const [index, target] of engine.targets.entries()) {
      const card = document.createElement('article');
      card.className = 'wiring-target';
      card.dataset.node = target.id;
      // The picker already names this control and says what it does, so the card
      // doesn't say it a second time: choosing the movement IS the card's
      // identity line, the way an input's name is on the other side. A second
      // control, if a scheme ever had one, still introduces itself.
      if (index === 0) {
        card.appendChild(ui.scheme);
      } else {
        const heading = document.createElement('div');
        heading.className = 'wiring-target-heading';
        heading.innerHTML = `<span aria-hidden="true">${target.emoji}</span><div></div>`;
        const headingText = heading.querySelector('div');
        const title = document.createElement('h4');
        title.textContent = target.label;
        const description = document.createElement('p');
        description.textContent = target.description;
        headingText.append(title, description);
        card.appendChild(heading);
      }

      // The ports sit under a rule, the way an input's outputs do.
      const ports = document.createElement('div');
      ports.className = 'wiring-ports';

      // Grouped by connector type, exactly as an input's jacks are: the slide
      // scheme accepts two holds, and heading each of them HOLD made the pair
      // look like two different kinds of thing rather than the two ends of one
      // control. Which of them you are looking at is the sentence in the box —
      // one climbs, one drops — so the heading is free to name the type once.
      //
      // A setting has no connector, so it groups under SETTINGS instead — one
      // heading over every choice this control offers, the way a type is one
      // heading over every jack that carries it.
      let group = null;
      let groupType = null;
      for (const port of target.ports) {
        // One wire per port: a control is driven by one thing, so this is one
        // box that restyles when something lands on it.
        const wire = connections.find((connection) =>
          connection.target.node === target.id && connection.target.port === port.id) ?? null;

        if (port.type !== groupType) {
          groupType = port.type;
          group = document.createElement('div');
          group.className = 'wiring-port-group';
          const head = document.createElement('div');
          head.className = 'wiring-port';
          head.textContent = TYPE_LABELS[port.type] ?? port.label;
          group.appendChild(head);
          ports.appendChild(group);
        }

        // Whatever lands on this port gets the same sentence it already showed
        // empty, read from the wire's far end.
        const maps = document.createElement('div');
        maps.className = 'wiring-port-maps';
        let box;
        if (wire) {
          box = connectionCard(wire, signalStore.get(wire.source), { reverse: true });
        } else {
          // Unwired, a port still states how it will take whatever lands on it —
          // the same sentence it will show once something is patched in, so the
          // box says the same thing before and after. A level's half-sentence
          // reads as an unfinished one, which is exactly what it is.
          box = document.createElement('div');
          box.className = 'wiring-map wiring-map-draft';
          const settings = document.createElement('div');
          settings.className = 'wiring-map-settings';
          controlOptions(settings, { ...port, node: target.id });
          // Only a pace you are actually offered and a level's smoothing are
          // settings of the port's own, so only their boxes are somewhere an
          // edit to one can be read back from.
          const paced = port.type === 'trigger' && port.pace == null;
          if (paced || port.type === 'level') {
            box.dataset.portKey = portKey(target.id, port.id);
            settings.appendChild(paced
              ? sentence('Limit trigger', paceSelect(paceOf(target.id, port.id)))
              : landingSentence(port, smoothingOf(target.id, port.id)));
          }
          if (settings.childElementCount) box.appendChild(settings);
        }

        // The jack lives inside the box, against its left wall — the mirror of
        // an output's, since this is the edge a cable arrives at rather than
        // leaves from. Last in the markup, because the box lays itself out
        // reversed, which puts it hard against that outer edge. A setting gets
        // none: nothing can be patched into it, so a socket would be a promise
        // the board can't keep.
        if (port.type !== 'setting') {
          const jack = document.createElement('span');
          jack.className = 'wiring-jack';
          jack.setAttribute('aria-hidden', 'true');
          box.appendChild(jack);
        }
        maps.appendChild(box);

        const row = document.createElement('div');
        row.className = 'wiring-port-row';
        row.dataset.node = target.id;
        row.dataset.port = port.id;
        row.dataset.type = port.type;
        row.dataset.wired = String(Boolean(wire));
        // Everything is reachable until a cable is actually in the air.
        row.dataset.compatible = 'true';
        row.appendChild(maps);
        group.appendChild(row);
      }
      card.appendChild(ports);
      ui.targets.appendChild(card);
    }
  }

  function transformMode(transform, signal) {
    if (transform.type === 'edge') return `edge-${transform.edge}`;
    if (transform.type === 'threshold') return `threshold-${transform.direction}`;
    return transform.type || (signal?.kind === 'event' ? 'event' : 'change');
  }

  /** How often a trigger may fire, as a speed rather than a duration. */
  function paceSelect(cooldownMs) {
    return addSelect(
      PACES.map(([ms, label]) => [String(ms), label]),
      String(nearestPace(cooldownMs)),
      'cooldownMs',
    );
  }

  function addSelect(options, value, field) {
    const select = document.createElement('select');
    select.dataset.field = field;
    for (const [optionValue, label] of options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      option.selected = optionValue === value;
      select.appendChild(option);
    }
    return select;
  }

  /** The direction a bearing is being asked about, on either of its jacks. */
  function bearingSelect(value) {
    return addSelect(
      BEARINGS.map(([degrees, name]) => [String(degrees), name]),
      String(value ?? 0),
      'bearing',
    );
  }

  function numberInput(value, field) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(value);
    input.dataset.field = field;
    return input;
  }

  /** How closely a level follows what drives it, as what that looks like. */
  function smoothingSelect(fraction) {
    return addSelect(
      SMOOTHINGS.map(([value, label]) => [String(value), label]),
      String(nearestSmoothing(fraction)),
      'smoothing',
    );
  }

  /**
   * What a level port does with whatever reaches it: the thing it sets, and how
   * closely it follows the reading there. `phrase` names that thing in the words
   * the game would use for it; a port that never named one falls back to its own
   * label, so the sentence is always a whole one.
   */
  function landingSentence(port, smoothing) {
    return sentence(
      `Set ${port.phrase ?? `the ${port.label.toLowerCase()}`} while`,
      smoothingSelect(smoothing),
    );
  }

  // Lays out controls inline as running prose. Strings become plain words, so
  // the setting reads as a statement of what the wire does rather than a form
  // you have to assemble the meaning of yourself.
  function sentence(...parts) {
    const line = document.createElement('p');
    line.className = 'wiring-sentence';
    for (const part of parts) {
      if (typeof part !== 'string') {
        line.appendChild(part);
        continue;
      }
      const word = document.createElement('span');
      word.textContent = part;
      line.appendChild(word);
    }
    return line;
  }

  /**
   * The choices a control offers about its own behaviour, as sentences. These
   * belong to the port rather than to any wire, so they read the same whether
   * something is patched in or not.
   */
  function controlOptions(host, port) {
    const definition = targetOf(port.node)?.ports.find(({ id }) => id === port.id);
    if (!definition?.options?.length) return;
    const picked = engine.controlOptions(port.node, port.id);
    for (const option of definition.options) {
      const select = addSelect(option.choices, picked[option.id], `option:${option.id}`);
      select.dataset.node = port.node;
      select.dataset.port = port.id;
      host.appendChild(sentence(...[option.lead, select, option.trail].filter(Boolean)));
    }
  }

  /** A short aside inside a sentence, for when a setting can't do its job. */
  function note(text) {
    const aside = document.createElement('em');
    aside.className = 'wiring-note';
    aside.textContent = text;
    return aside;
  }

  /** A number bounded by the signal's own span, for a raw-units slot. */
  function spanInput(transform, field) {
    const input = numberInput(transform[field], field);
    input.min = String(Math.min(transform.min, transform.max));
    input.max = String(Math.max(transform.min, transform.max));
    return input;
  }

  // A wire's settings split by which end they belong to, and each end shows
  // only its own half — so the sentence beside an input never changes when a
  // wire is made or broken, and the control's side never restates what the
  // input is already saying.
  //   source — what the input turns its reading into: an instant, a range, a
  //            held on/off. True of the input whether or not it is wired.
  //   target — how the control responds to that: how often it will act on it,
  //            or how closely it tracks it.
  function renderTransformSettings(host, transform, signal, port, { side = 'source' } = {}) {
    if (side === 'target') {
      // What the control itself does with whatever reaches it, chosen from the
      // handful of answers the game says are sensible.
      controlOptions(host, port);
      // A trigger paces itself and a level decides how closely it follows; a
      // hold is simply on or off, so it has nothing to set on this end. A port
      // that fixed its own pace has nothing to say here either — the choice
      // isn't the wire's to make, so the wire doesn't claim it.
      if (port.type === 'trigger') {
        if (port.pace == null) {
          host.appendChild(sentence(
            'Limit trigger', paceSelect(transform.cooldownMs ?? 160),
          ));
        }
      } else if (port.type === 'level') {
        host.appendChild(landingSentence(port, transform.smoothing));
      }
      return;
    }

    if (isValuePort(port.type)) {
      // A bearing names a direction rather than a number, so the whole setting
      // is which one — there is no threshold to type, on either jack.
      if (transform.type === 'facing') {
        host.appendChild(sentence(
          `While ${subjectOf(signal)} is facing`,
          bearingSelect(transform.bearing),
        ));
        return;
      }
      if (transform.type === 'gate') {
        // Which side of the line this holds on is the jack it hangs from, so it
        // reads as a plain word — offering it as a choice here would mean
        // editing it moved the wire to the other jack.
        host.appendChild(sentence(
          `While ${subjectOf(signal)} is ${transform.direction}`,
          spanInput(transform, 'threshold'),
          ...unitWords(signal),
        ));
        return;
      }
      if (transform.type === 'hold') {
        const said = phrasingOf(signal);
        host.appendChild(sentence(
          `While ${said.subject} is`,
          addSelect([['false', said.while], ['true', said.until]], String(Boolean(transform.invert)), 'invert'),
        ));
        return;
      }
      // "Track … between … and …" — a whole statement about the input, the way
      // every other jack's sentence is. The port at the far end says what it
      // does with that in its own sentence rather than finishing this one:
      // splitting a single clause across the cable read worse than two
      // sentences that each stand up alone.
      //
      // Reading the span backwards is what inverting means, so the sentence
      // says it outright instead of hiding it behind a checkbox.
      // Both ends the same is a range of nothing — reachable halfway through
      // swapping them round — so it says so rather than quietly going dead.
      // The unit lands after the second number only: "from -90 to 90°" is how
      // a span is written, and saying it at both ends reads as two facts.
      const span = sentence(
        `Track ${subjectOf(signal)} between`, numberInput(transform.min, 'min'),
        'and', numberInput(transform.max, 'max'), ...unitWords(signal),
      );
      if (transform.min === transform.max) {
        span.dataset.warn = 'true';
        span.appendChild(note('needs two different ends'));
      }
      host.appendChild(span);
      return;
    }

    // Every condition opens the same way — "When …" — and states only the
    // moment it names; what that moment leads to is at the far end of the cable.
    if (signal?.kind === 'bearing') {
      // "Turns to face" rather than "is facing": this is the moment it arrives,
      // and the hold jack next to it is the one that means the whole time after.
      host.appendChild(sentence(
        `When ${subjectOf(signal)} turns to face`,
        bearingSelect(transform.bearing),
      ));
    } else if (signal?.kind === 'event') {
      // A gesture has nothing to choose: it either happened or it didn't. The
      // sentence just says which gesture, since the card's name is the only
      // other place that appears.
      host.appendChild(sentence(`Each time ${signal.phrase ?? 'it happens'}`));
    } else if (signal?.kind === 'binary') {
      const said = phrasingOf(signal);
      host.appendChild(sentence(
        `When ${said.subject} is`,
        addSelect([
          ['edge-rising', said.on],
          ['edge-falling', said.off],
        ], transformMode(transform, signal), 'mode'),
      ));
    } else {
      const mode = transformMode(transform, signal);
      host.appendChild(sentence(
        `When ${subjectOf(signal)}`,
        addSelect([
          ['threshold-above', 'rises above'],
          ['threshold-below', 'falls below'],
          ['change', 'changes by'],
        ], mode, 'mode'),
        transform.type === 'change'
          ? spanInput(transform, 'amount')
          : spanInput(transform, 'threshold'),
        ...unitWords(signal),
      ));
    }
  }

  /** The live wire leaving one particular jack of one particular input, if any. */
  function wireFrom(signal, outputId) {
    return engine.listConnections().find((connection) =>
      connection.source === signal.channel
      && portOf(connection.target)
      && connectionOutput(connection).id === outputId) ?? null;
  }

  /** Hands a wire's settings back to both of its ends, then cuts it. */
  function releaseConnection(connection) {
    const signal = signalStore.get(connection.source);
    rememberDraft(
      draftKey(connection.source, connectionOutput(connection).id),
      signal?.kind,
      connection.transform,
    );
    // Whatever the port's own end of the sentence said goes back to the port,
    // so cutting a wire leaves the empty box reading the way it did wired. A
    // port that fixes its own pace never offered one, so there is nothing of
    // the wire's to keep.
    const { node, port } = connection.target;
    const definition = portOf(connection.target);
    const setting = definition?.type === 'trigger' ? 'cooldownMs' : 'smoothing';
    if (definition?.pace == null && isPortSetting(setting, connection.transform[setting])) {
      rememberPortSetting(node, port, { [setting]: connection.transform[setting] });
    }
    engine.removeConnection(connection.id);
  }

  // Wiring is one-to-one: a jack drives one control and a control is driven by
  // one jack. Anything left over from a looser layout is trimmed so that what's
  // drawn is what's actually running.
  function pruneExtraWires() {
    const takenPorts = new Set();
    const takenJacks = new Set();
    for (const connection of engine.listConnections()) {
      const port = `${connection.target.node}:${connection.target.port}`;
      const jack = draftKey(connection.source, connectionOutput(connection).id);
      if (takenPorts.has(port) || takenJacks.has(jack)) {
        engine.removeConnection(connection.id);
        return true;
      }
      takenPorts.add(port);
      takenJacks.add(jack);
    }
    return false;
  }

  /** An unwired jack's settings — the sentence with nothing patched into it. */
  function draftCard(signal, output) {
    const card = document.createElement('div');
    card.className = 'wiring-map wiring-map-draft';
    card.dataset.draftKey = draftKey(signal.channel, output.id);
    const settings = document.createElement('div');
    settings.className = 'wiring-map-settings';
    renderTransformSettings(settings, draftTransform(signal, output), signal, { type: output.type });
    card.appendChild(settings);
    return card;
  }

  function connectionCard(connection, signal, { reverse = false } = {}) {
    const target = targetOf(connection.target.node);
    const port = portOf(connection.target);

    const card = document.createElement('article');
    card.className = 'wiring-map';
    card.dataset.connectionId = connection.id;
    card.dataset.type = port.type;

    // The cable itself says where the wire goes, so the card doesn't name the
    // far end — it just carries what the wire is doing and the way to cut it.
    // The full journey stays in the remove button's label for anyone who
    // isn't reading the diagram.
    const header = document.createElement('div');
    header.className = 'wiring-map-header';
    const liveValue = document.createElement('output');
    liveValue.className = 'wiring-map-value';
    liveValue.textContent = '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn wiring-remove';
    remove.dataset.removeConnection = connection.id;
    // The two ends by name, and no more: the connector each hangs off used to be
    // named here too, back when a port was called what it did. Now that a port
    // is called what it is, that half read as "Sound · Level from Move · Hold" —
    // four names for two things. The button only has to be told apart from the
    // other ✕ on the board, and the input and the control do that.
    remove.setAttribute(
      'aria-label',
      `Unwire ${signal?.label || connection.source} from ${target.label}`,
    );
    remove.textContent = '✕';
    header.append(liveValue, remove);

    const settings = document.createElement('div');
    settings.className = 'wiring-map-settings';
    renderTransformSettings(
      settings,
      connection.transform,
      signal,
      // The control's own options hang off the port it is, so the settings need
      // to know which port that is and not just what type it is.
      { ...port, node: connection.target.node, id: connection.target.port },
      { side: reverse ? 'target' : 'source' },
    );
    // Only a mapped range has a span worth fitting to what the sensor does, and
    // the span it fits is on the input's side of the wire.
    if (!reverse && signal?.kind === 'number' && connection.transform.type === 'range') {
      const calibrate = document.createElement('button');
      calibrate.type = 'button';
      calibrate.className = 'btn btn-soft wiring-calibrate';
      calibrate.dataset.calibrateConnection = connection.id;
      calibrate.textContent = 'Use live range';
      settings.appendChild(calibrate);
    }
    card.append(header);
    // A value port has nothing to set on the receiving end, so its card is the
    // header alone rather than a header with an empty gap under it.
    if (settings.childElementCount) card.appendChild(settings);
    return card;
  }

  /**
   * Dims whichever end a cable in the air cannot legally land on. A drag from
   * an input judges the controls; a drag from a control judges the inputs.
   */
  function showReachable(type) {
    const rows = [
      ...ui.sources.querySelectorAll('.wiring-out-row'),
      ...ui.targets.querySelectorAll('.wiring-port-row'),
    ];
    for (const row of rows) row.dataset.compatible = String(!type || row.dataset.type === type);
  }

  function connect(channel, outputId, node, port) {
    const output = findOutput(signalStore.get(channel), outputId);
    const target = targetOf(node)?.ports.find(({ id }) => id === port);
    // The dimming already said this wouldn't fit, so a refused drop just ends.
    if (output && target && target.type !== output.type) return;
    // Landing on a taken port, or dragging from a jack that already drives
    // something, replaces what was there rather than piling up beside it. Each
    // released wire hands its settings back, so the swap keeps them.
    for (const existing of engine.listConnections()) {
      const samePort = existing.target.node === node && existing.target.port === port;
      const sameJack = existing.source === channel && connectionOutput(existing).id === outputId;
      if (samePort || sameJack) releaseConnection(existing);
    }
    const connection = engine.addConnection(channel, { node, port }, outputId);
    if (!connection) return;
    // Whatever the jack's sentence already said is what the new wire does, and
    // whatever the port's sentence said is how it takes it. The port's half goes
    // on second because that half is the port's to own: the jack's draft may
    // carry a smoothing from wherever it was last patched, and the port it lands
    // on is what the sentence there actually read.
    const draft = drafts.get(draftKey(channel, outputId));
    if (draft) engine.updateConnection(connection.id, { transform: draft.transform });
    if (target?.type === 'trigger') {
      engine.updateConnection(connection.id, {
        transform: { cooldownMs: target.pace ?? paceOf(node, port) },
      });
    } else if (target?.type === 'level') {
      engine.updateConnection(connection.id, { transform: { smoothing: smoothingOf(node, port) } });
    }
    renderSources();
    renderTargets();
  }

  function cablePath(x1, y1, x2, y2) {
    const bend = Math.max(42, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  function pointInBoard(element, side) {
    const boardRect = ui.board.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: (side === 'right' ? rect.right : rect.left) - boardRect.left,
      y: rect.top + rect.height / 2 - boardRect.top,
    };
  }

  function drawCables() {
    const boardRect = ui.board.getBoundingClientRect();
    ui.cables.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    ui.cables.replaceChildren();
    for (const connection of engine.listConnections()) {
      const type = portOf(connection.target)?.type;
      // A cable leaves the exact jack it was patched from, so two value outputs
      // on one input stay visually distinct.
      const source = outputJack(connection.source, connectionOutput(connection).id);
      const target = ui.targets.querySelector(
        `[data-node="${CSS.escape(connection.target.node)}"][data-port="${CSS.escape(connection.target.port)}"] .wiring-jack`,
      );
      if (!source || !target) continue;
      const from = pointInBoard(source, 'right');
      const to = pointInBoard(target, 'left');
      const path = document.createElementNS(SVG_NS, 'path');
      path.dataset.connectionId = connection.id;
      path.dataset.type = type;
      path.setAttribute('d', cablePath(from.x, from.y, to.x, to.y));
      ui.cables.appendChild(path);
    }
  }

  function drawDragCable(clientX, clientY) {
    drawCables();
    const fromSource = drag.end === 'source';
    const jack = fromSource
      ? outputJack(drag.channel, drag.output)
      : ui.targets.querySelector(
        `[data-node="${CSS.escape(drag.node)}"][data-port="${CSS.escape(drag.port)}"] .wiring-jack`,
      );
    if (!jack) return;
    const boardRect = ui.board.getBoundingClientRect();
    const anchor = pointInBoard(jack, fromSource ? 'right' : 'left');
    const pointer = { x: clientX - boardRect.left, y: clientY - boardRect.top };
    // Cables always run left to right, so a cable pulled from a control has the
    // pointer as its left end and the jack it came from as its right.
    const [a, b] = fromSource ? [anchor, pointer] : [pointer, anchor];
    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('wiring-cable-drag');
    path.dataset.type = drag.type;
    path.setAttribute('d', cablePath(a.x, a.y, b.x, b.y));
    ui.cables.appendChild(path);
  }

  function pulseConnection(id, fired, value) {
    // The same wire now has a card on each end, so both light up together.
    const cards = [ui.sources, ui.targets]
      .map((container) => container.querySelector(`[data-connection-id="${CSS.escape(id)}"]`))
      .filter(Boolean);
    const path = ui.cables.querySelector(`[data-connection-id="${CSS.escape(id)}"]`);
    for (const card of cards) {
      const output = card.querySelector('.wiring-map-value');
      if (output) output.textContent = Number.isFinite(value) ? `${Math.round(value * 100)}%` : String(value);
      card.classList.toggle('active', fired);
    }
    path?.classList.toggle('active', fired);
    clearTimeout(activityTimers.get(id));
    activityTimers.set(id, setTimeout(() => {
      for (const card of cards) card.classList.remove('active');
      path?.classList.remove('active');
    }, fired ? 180 : 80));
  }

  // A jack that sits off the bottom of the screen shouldn't mean letting go of
  // the cable and starting again: while a cable is in the air, holding the
  // pointer near an edge scrolls that way, faster the closer to the edge it is.
  const EDGE_BAND = 72;
  const EDGE_SPEED = 20;
  let edgeFrame = null;

  function scrollParent(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const scrolls = /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX);
      if (scrolls && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
        return node;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function edgeDelta(position, near, far) {
    if (position < near + EDGE_BAND) return -EDGE_SPEED * Math.min(1, (near + EDGE_BAND - position) / EDGE_BAND);
    if (position > far - EDGE_BAND) return EDGE_SPEED * Math.min(1, (position - (far - EDGE_BAND)) / EDGE_BAND);
    return 0;
  }

  function stopEdgeScroll() {
    if (edgeFrame !== null) cancelAnimationFrame(edgeFrame);
    edgeFrame = null;
  }

  function runEdgeScroll() {
    edgeFrame = null;
    if (!drag?.moved) return;
    const container = scrollParent(ui.board);
    const page = container === document.scrollingElement || container === document.documentElement;
    const box = page
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : container.getBoundingClientRect();
    const dx = edgeDelta(drag.pointerX, box.left, box.right);
    const dy = edgeDelta(drag.pointerY, box.top, box.bottom);
    if (!dx && !dy) return;
    container.scrollBy(dx, dy);
    // The pointer hasn't moved, but the jacks under it have, so the cable is
    // redrawn from the same screen point against the board's new position.
    drawDragCable(drag.pointerX, drag.pointerY);
    edgeFrame = requestAnimationFrame(runEdgeScroll);
  }

  function nudgeEdgeScroll() {
    if (edgeFrame === null) edgeFrame = requestAnimationFrame(runEdgeScroll);
  }

  // Wiring is a drag between two jacks, and nothing else: the cable you are
  // holding is the instruction, so there is no pending selection to explain and
  // no running commentary to read. A cable can be pulled from either end — you
  // may be thinking "this button does that" or "this control needs something",
  // and both should work.
  function beginDrag(event, rowSelector) {
    // Dragging starts at the jack itself, which keeps the settings beside it
    // free to be dragged across and selected like ordinary form controls.
    const jack = event.target.closest('.wiring-jack');
    if (!jack || event.button !== 0) return;
    const row = jack.closest(rowSelector);
    if (!row) return;
    drag = {
      ...row.dataset,
      end: rowSelector === '.wiring-out-row' ? 'source' : 'target',
      x: event.clientX,
      y: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      moved: false,
    };
    jack.setPointerCapture(event.pointerId);
  }
  ui.sources.addEventListener('pointerdown', (event) => beginDrag(event, '.wiring-out-row'));
  ui.targets.addEventListener('pointerdown', (event) => beginDrag(event, '.wiring-port-row'));

  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) {
      drag.moved = true;
      // Once the cable is actually in the air, whatever it cannot reach fades
      // out — the rule shows itself rather than waiting to refuse the drop.
      showReachable(drag.type);
    }
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (drag.moved) {
      drawDragCable(event.clientX, event.clientY);
      nudgeEdgeScroll();
    }
  });
  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
    stopEdgeScroll();
    if (drag.moved) {
      // Whichever end the cable was pulled from, the other end is what it is
      // looking to land on.
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const landing = under?.closest(drag.end === 'source' ? '.wiring-port-row' : '.wiring-out-row');
      if (landing && drag.end === 'source') {
        connect(drag.channel, drag.output, landing.dataset.node, landing.dataset.port);
      } else if (landing) {
        connect(landing.dataset.channel, landing.dataset.output, drag.node, drag.port);
      }
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
    showReachable(null);
    drawCables();
  });

  // A wire's card now appears on both ends — beside the output that drives it
  // and beside the port it lands on — so removing or calibrating it has to work
  // from whichever side the click came from.
  function handleMapClick(event) {
    // A drag that happens to end over a card's controls is still a drag.
    if (suppressClick) return;
    const remove = event.target.closest('[data-remove-connection]');
    if (remove) {
      const id = remove.dataset.removeConnection;
      const going = engine.listConnections().find((connection) => connection.id === id);
      // Hand the settings back to both ends so unwiring never loses them.
      if (going) releaseConnection(going);
      else engine.removeConnection(id);
      return;
    }
    const calibrate = event.target.closest('[data-calibrate-connection]');
    if (!calibrate) return;
    const connection = engine.listConnections().find(({ id }) => id === calibrate.dataset.calibrateConnection);
    const signal = connection && signalStore.get(connection.source);
    if (!connection || !signal) return;
    const low = signal.observedMin ?? signal.min;
    const high = signal.observedMax ?? signal.max;
    // Nothing to fit until the sensor has actually moved.
    if (low === high) return;
    // Calibrating answers "what does this sensor actually read", not "which way
    // round should it drive the control" — so a span the person deliberately
    // reversed comes back reversed, fitted to the new numbers.
    const flipped = connection.transform.min > connection.transform.max;
    const [min, max] = flipped ? [high, low] : [low, high];
    engine.updateConnection(connection.id, { transform: { min, max } });
  }
  ui.sources.addEventListener('click', handleMapClick);
  ui.targets.addEventListener('click', handleMapClick);
  /** Turns one edited control into a transform patch, given what it edits now. */
  function fieldPatch(control, field, transform) {
    if (field === 'mode') {
      // Switching type carries over whatever the new shape needs, since a
      // transform missing a required field is rejected outright.
      const [type, qualifier] = control.value.split('-');
      const patch = { type };
      if (type === 'edge') patch.edge = qualifier;
      if (type === 'threshold') {
        patch.direction = qualifier;
        patch.threshold = transform.threshold ?? (transform.min + transform.max) / 2;
      }
      if (type === 'change') {
        patch.amount = transform.amount ?? Math.abs(transform.max - transform.min) / 5;
      }
      return patch;
    }
    if (field === 'invert') return { invert: control.value === 'true' };
    if (field === 'direction') return { direction: control.value };
    return { [field]: Number(control.value) };
  }

  function handleFieldChange(event) {
    const field = event.target.dataset.field;
    if (!field) return;

    // A control's own option belongs to its port, not to any wire through it,
    // so it is set straight on the engine and never touches a transform.
    if (field.startsWith('option:')) {
      const { node, port } = event.target.dataset;
      engine.setControlOption(node, port, field.slice('option:'.length), event.target.value);
      return;
    }

    const card = event.target.closest('[data-connection-id], [data-draft-key], [data-port-key]');
    if (!card) return;

    // An unwired port has no connection either; what it is set to is what the
    // next wire landing here will run at.
    const { portKey: emptyPort } = card.dataset;
    if (emptyPort) {
      const patch = fieldPatch(event.target, field, {});
      if (isPortSetting(field, patch[field])) setPortSetting(emptyPort, patch);
      renderTargets();
      return;
    }

    const { draftKey: key } = card.dataset;
    if (key) {
      // An unwired jack has no connection to update, so the draft absorbs the
      // edit and the next wire from this jack starts there.
      const held = drafts.get(key);
      const next = normalizeTransform({ ...held.transform, ...fieldPatch(event.target, field, held.transform) });
      if (next) rememberDraft(key, held.kind, next);
      renderSources();
      return;
    }

    const connection = engine.listConnections().find(({ id }) => id === card.dataset.connectionId);
    if (!connection) return;
    engine.updateConnection(connection.id, {
      transform: fieldPatch(event.target, field, connection.transform),
    });
  }
  ui.sources.addEventListener('change', handleFieldChange);
  ui.targets.addEventListener('change', handleFieldChange);

  ui.clear.addEventListener('click', () => {
    if (!engine.listConnections().length) return;
    if (window.confirm('Remove every controller-to-game connection?')) engine.reset();
  });

  signalStore.subscribe(({ type, signal }) => {
    if (type === 'catalog') {
      renderSources();
      renderTargets();
      requestAnimationFrame(drawCables);
      return;
    }
    const output = ui.sources.querySelector(`[data-source-value="${CSS.escape(signal.channel)}"]`);
    const card = output?.closest('.wiring-source');
    if (!card) {
      renderSources();
      requestAnimationFrame(drawCables);
      return;
    }
    output.textContent = formatValue(signal);
    card.dataset.live = 'true';
    // A kind change rewrites the caption and can add or remove an output, so
    // the card has to be rebuilt rather than patched.
    if (card.dataset.kind !== signal.kind) {
      renderSources();
      requestAnimationFrame(drawCables);
    }
  }, { emitCurrent: true });

  engine.subscribe((event) => {
    if (event.type === 'connections') {
      // Each removal re-fires this, so it settles after the last extra is gone.
      if (pruneExtraWires()) return;
      // Settings live inside the source cards now, so a wiring change has to
      // rebuild both columns.
      renderSources();
      renderTargets();
      requestAnimationFrame(drawCables);
    } else if (event.type === 'activity') {
      pulseConnection(event.connectionId, event.fired, event.value);
    }
  }, { emitCurrent: true });

  new ResizeObserver(() => drawCables()).observe(ui.board);
}
