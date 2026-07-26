// Accessible patch bay. Every input exposes its own outputs and every game
// control its ports; a connection is legal when the two ends are the same type,
// which is a rule you can see rather than one you discover by being refused.
// Click/tap an output then a port; pointer users can also drag. SVG cables are
// decorative — the mapping cards remain the source of truth and work on narrow
// screens without the diagram.

import {
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
  loadDrafts,
  loadPortPaces,
  normalizeTransform,
  saveDrafts,
  savePortPaces,
} from './wiring-storage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function initWiringUI({ signalStore, engine }) {
  const byId = (id) => document.getElementById(id);
  const ui = {
    board: byId('wiring-board'),
    sources: byId('wiring-sources'),
    targets: byId('wiring-targets'),
    cables: byId('wiring-cables'),
    status: byId('wiring-status'),
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
  // The same idea from the control's end: how fast it will let itself be driven,
  // readable and settable whether or not anything is wired into it yet.
  const paces = loadPortPaces(draftStorage);

  function rememberDraft(key, kind, transform) {
    drafts.set(key, { kind, transform });
    saveDrafts(draftStorage, drafts);
  }

  const paceKey = (node, port) => `${node}:${port}`;
  const paceOf = (node, port) => paces.get(paceKey(node, port)) ?? 160;

  function rememberPace(node, port, cooldownMs) {
    paces.set(paceKey(node, port), cooldownMs);
    savePortPaces(draftStorage, paces);
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

  // The same unit after any number you set, as its own word in the sentence —
  // the way "ms" already follows a pace. Nothing to add when the reading is a
  // bare count; those channels say their scale in the block's description.
  const unitWords = (signal) => (signal?.unit ? [signal.unit] : []);

  function setStatus(message) {
    ui.status.textContent = message;
  }

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

  function renderSources() {
    const signals = signalStore.all().sort((a, b) => {
      const aRank = a.planned ? 0 : a.wired ? 1 : 2;
      const bRank = b.planned ? 0 : b.wired ? 1 : 2;
      return aRank - bRank || a.label.localeCompare(b.label);
    });
    ui.sources.replaceChildren();
    ui.clear.disabled = engine.listConnections().length === 0;

    if (!signals.length) {
      const empty = document.createElement('p');
      empty.className = 'wiring-source-empty';
      empty.textContent = 'Choose inputs on the Sensing page, or connect a controller to discover them live.';
      ui.sources.appendChild(empty);
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
      // What the input actually reads, under its name — the same line the
      // Sensing page introduced it with, so a block you wired days ago still
      // says what its numbers mean without going back to look it up.
      if (signal.desc) {
        const desc = document.createElement('span');
        desc.className = 'wiring-source-desc';
        desc.textContent = signal.desc;
        lines.appendChild(desc);
      }

      const reading = document.createElement('span');
      reading.className = 'wiring-source-reading';
      reading.dataset.sourceValue = signal.channel;
      reading.textContent = formatValue(signal);
      identity.append(emoji, lines, reading);

      const outs = document.createElement('div');
      outs.className = 'wiring-outs';
      for (const output of sourceOutputs(signal)) {
        // A jack and whatever it currently drives travel together, so the
        // settings for a wire sit under the output that produced it rather
        // than in a separate list you have to match up by name. The row owns
        // the identity; the name, the settings and the jack all read it.
        const row = document.createElement('div');
        row.className = 'wiring-out-row';
        row.dataset.channel = signal.channel;
        row.dataset.output = output.id;
        row.dataset.type = output.type;
        // Everything is reachable until a cable is actually in the air.
        row.dataset.compatible = 'true';

        const head = document.createElement('div');
        head.className = 'wiring-out';
        head.textContent = output.label;

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
        row.append(head, maps);
        outs.appendChild(row);
      }

      card.append(identity, outs);
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

      for (const port of target.ports) {
        // One wire per port: a control is driven by one thing, so this is one
        // box that restyles when something lands on it.
        const wire = connections.find((connection) =>
          connection.target.node === target.id && connection.target.port === port.id) ?? null;

        // The port's name is its little title, exactly like an output's.
        const head = document.createElement('div');
        head.className = 'wiring-port';
        head.textContent = port.label;

        // Whatever lands on this port gets the same sentence it already showed
        // empty, read from the wire's far end.
        const maps = document.createElement('div');
        maps.className = 'wiring-port-maps';
        let box;
        if (wire) {
          box = connectionCard(wire, signalStore.get(wire.source), { reverse: true });
        } else {
          // Unwired, a trigger port still states how often it will let itself be
          // fired — the same sentence it will show once something is patched in,
          // so the box says the same thing before and after.
          box = document.createElement('div');
          box.className = 'wiring-map wiring-map-draft';
          const settings = document.createElement('div');
          settings.className = 'wiring-map-settings';
          controlOptions(settings, { ...port, node: target.id });
          if (port.type === 'trigger') {
            // Only a trigger has a pace to hold, so only a trigger's box is
            // somewhere an edit to one can be read back from.
            box.dataset.paceKey = paceKey(target.id, port.id);
            settings.appendChild(sentence(
              'At most every', numberInput(paceOf(target.id, port.id), 'cooldownMs'), 'ms',
            ));
          }
          if (settings.childElementCount) box.appendChild(settings);
        }

        // The jack lives inside the box, against its left wall — the mirror of
        // an output's, since this is the edge a cable arrives at rather than
        // leaves from. Last in the markup, because the box lays itself out
        // reversed, which puts it hard against that outer edge. A setting has
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
        row.append(head, maps);
        ports.appendChild(row);
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

  function numberInput(value, field) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(value);
    input.dataset.field = field;
    return input;
  }

  function percentInput(fraction, field) {
    const input = numberInput(Math.round(fraction * 100), `${field}Percent`);
    input.min = '0';
    input.max = '95';
    input.step = '5';
    return input;
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
  //   target — how the control responds to that: how often it will act on it.
  function renderTransformSettings(host, transform, signal, port, { side = 'source' } = {}) {
    if (side === 'target') {
      // What the control itself does with whatever reaches it, chosen from the
      // handful of answers the game says are sensible.
      controlOptions(host, port);
      // Only a trigger paces itself; a value port takes whatever it is handed,
      // continuously, so there is nothing more to set on the receiving end.
      if (port.type === 'trigger') {
        host.appendChild(sentence(
          'At most every', numberInput(transform.cooldownMs ?? 160, 'cooldownMs'), 'ms',
        ));
      }
      return;
    }

    if (isValuePort(port.type)) {
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
      // Reading the span backwards is what inverting means, so the sentence
      // says it outright instead of hiding it behind a checkbox.
      // Both ends the same is a range of nothing — reachable halfway through
      // swapping them round — so it says so rather than quietly going dead.
      // The unit lands after the second number only: "from -90 to 90°" is how
      // a span is written, and saying it at both ends reads as two facts.
      const span = sentence(
        `Follows ${subjectOf(signal)} from`, numberInput(transform.min, 'min'),
        'to', numberInput(transform.max, 'max'), ...unitWords(signal),
      );
      if (transform.min === transform.max) {
        span.dataset.warn = 'true';
        span.appendChild(note('needs two different ends'));
      }
      host.appendChild(span);
      host.appendChild(sentence(
        'Smoothed by', percentInput(transform.smoothing || 0, 'smoothing'), '%',
      ));
      return;
    }

    // Every condition opens the same way — "When …" — and states only the
    // moment it names; what that moment leads to is at the far end of the cable.
    if (signal?.kind === 'event') {
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
    if (portOf(connection.target)?.type === 'trigger' && connection.transform.cooldownMs != null) {
      rememberPace(connection.target.node, connection.target.port, connection.transform.cooldownMs);
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
    remove.setAttribute(
      'aria-label',
      `Unwire ${signal?.label || connection.source} · ${connectionOutput(connection).label}`
      + ` from ${target.label} · ${port.label}`,
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
    // whatever the port's sentence said is the pace it does it at.
    const draft = drafts.get(draftKey(channel, outputId));
    if (draft) engine.updateConnection(connection.id, { transform: draft.transform });
    if (target?.type === 'trigger') {
      engine.updateConnection(connection.id, { transform: { cooldownMs: paceOf(node, port) } });
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
    if (drag.moved) drawDragCable(event.clientX, event.clientY);
  });
  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
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
    if (low === high) {
      setStatus(`Move ${signal.label} through its full range, then calibrate again.`);
      return;
    }
    // Calibrating answers "what does this sensor actually read", not "which way
    // round should it drive the control" — so a span the person deliberately
    // reversed comes back reversed, fitted to the new numbers.
    const flipped = connection.transform.min > connection.transform.max;
    const [min, max] = flipped ? [high, low] : [low, high];
    engine.updateConnection(connection.id, { transform: { min, max } });
    setStatus(`Calibrated ${signal.label} to its observed ${low}–${high} range.`);
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
    // The sentence talks in percent; the transform stores a fraction.
    if (field === 'smoothingPercent') return { smoothing: Number(control.value) / 100 };
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

    const card = event.target.closest('[data-connection-id], [data-draft-key], [data-pace-key]');
    if (!card) return;

    // An unwired port has no connection either; the pace it is set to is what
    // the next wire landing here will run at.
    const { paceKey: pace } = card.dataset;
    if (pace) {
      const next = Number(event.target.value);
      if (Number.isFinite(next) && next >= 0) {
        paces.set(pace, next);
        savePortPaces(draftStorage, paces);
      }
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
