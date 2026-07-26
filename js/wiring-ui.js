// Accessible patch bay. Every input exposes its own outputs and every game
// control its ports; a connection is legal when the two ends are the same type,
// which is a rule you can see rather than one you discover by being refused.
// Click/tap an output then a port; pointer users can also drag. SVG cables are
// decorative — the mapping cards remain the source of truth and work on narrow
// screens without the diagram.

import {
  connectorLabel,
  findOutput,
  outputIdOf,
  sourceOutputs,
} from './wiring-config.js';
import { createDefaultTransform } from './wiring-runtime.js';
import { browserStorage, loadDrafts, normalizeTransform, saveDrafts } from './wiring-storage.js';

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
  };
  if (Object.values(ui).some((element) => !element)) return;

  // The selected end of a pending connection: { channel, output, type } or null.
  let selected = null;
  let drag = null;
  let suppressClick = false;
  const activityTimers = new Map();
  // What a jack is set to before anything is patched into it, so its sentence
  // can be read (and adjusted) up front. A new wire starts from this, and
  // unwiring hands the settings back, so nothing you typed is thrown away.
  const draftStorage = browserStorage();
  const drafts = loadDrafts(draftStorage);

  function rememberDraft(key, kind, transform) {
    drafts.set(key, { kind, transform });
    saveDrafts(draftStorage, drafts);
  }

  const targetOf = (nodeId) => engine.targets.find(({ id }) => id === nodeId);
  const portOf = (target) => targetOf(target.node)?.ports.find(({ id }) => id === target.port);
  const formatValue = (signal) => signal.value == null
    ? ''
    : Number.isInteger(signal.value) ? String(signal.value) : signal.value.toFixed(1);

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
      lines.append(label, channel);

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
        row.dataset.selected = String(
          selected?.channel === signal.channel && selected?.output === output.id,
        );

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wiring-out';
        button.setAttribute('aria-pressed', row.dataset.selected);
        // Every card repeats the same output names, so the jack has to carry
        // its input's name to be tellable apart out of visual context.
        button.setAttribute('aria-label', `${signal.label} · ${output.label} — ${output.hint}`);
        button.textContent = output.label;

        const maps = document.createElement('div');
        maps.className = 'wiring-out-maps';
        const wires = wiresFrom(signal, output.id);
        if (wires.length) {
          for (const connection of wires) maps.appendChild(connectionCard(connection, signal));
        } else {
          maps.appendChild(draftCard(signal, output));
        }

        // The jack rides on the right edge of what it drives, level with its
        // middle — that is where a cable leaves, so that is where you grab it.
        const jack = document.createElement('span');
        jack.className = 'wiring-jack';
        jack.setAttribute('aria-hidden', 'true');

        const body = document.createElement('div');
        body.className = 'wiring-out-body';
        body.append(maps, jack);

        row.append(button, body);
        outs.appendChild(row);
      }

      card.append(identity, outs);
      ui.sources.appendChild(card);
    }
  }

  function renderTargets() {
    ui.targets.replaceChildren();
    const connections = engine.listConnections();

    for (const target of engine.targets) {
      const card = document.createElement('article');
      card.className = 'wiring-target';
      card.dataset.node = target.id;
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

      for (const port of target.ports) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wiring-port';
        button.dataset.node = target.id;
        button.dataset.port = port.id;
        button.dataset.type = port.type;
        // With a pending output chosen, only the same connector type can accept it.
        button.dataset.compatible = String(!selected || selected.type === port.type);
        const count = connections.filter((connection) =>
          connection.target.node === target.id && connection.target.port === port.id).length;
        button.innerHTML = `
          <span class="wiring-jack" aria-hidden="true"></span>
          <span class="wiring-port-name">${port.label}</span>
          <span class="wiring-port-type">${connectorLabel(port.type)}</span>
          ${count ? `<b>${count}</b>` : ''}
        `;
        card.appendChild(button);
      }
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

  /** A number bounded by the signal's own span, for a raw-units slot. */
  function spanInput(transform, field) {
    const input = numberInput(transform[field], field);
    input.min = String(Math.min(transform.min, transform.max));
    input.max = String(Math.max(transform.min, transform.max));
    return input;
  }

  // Every output states what it does as one sentence, whether or not it is
  // wired yet — that plain-English line is how you tell the options apart.
  function renderTransformSettings(host, transform, signal, port) {
    if (port.type === 'value') {
      if (transform.type === 'gate') {
        host.appendChild(sentence(
          'Active when',
          addSelect([['above', 'above'], ['below', 'below']], transform.direction, 'direction'),
          spanInput(transform, 'threshold'),
        ));
        return;
      }
      if (signal?.kind === 'binary') {
        host.appendChild(sentence(
          'Active when',
          addSelect([['false', 'pressed'], ['true', 'released']], String(Boolean(transform.invert)), 'invert'),
        ));
        return;
      }
      // Reading the span backwards is what inverting means, so the sentence
      // says it outright instead of hiding it behind a checkbox.
      host.appendChild(sentence(
        'Maps', numberInput(transform.min, 'min'),
        'to', numberInput(transform.max, 'max'),
      ));
      host.appendChild(sentence(
        'Smoothed', percentInput(transform.smoothing || 0, 'smoothing'), '%',
      ));
      return;
    }

    if (signal?.kind === 'event') {
      host.appendChild(sentence('Fires each time it happens'));
    } else if (signal?.kind === 'binary') {
      host.appendChild(sentence('Fires on', addSelect([
        ['edge-rising', 'press'],
        ['edge-falling', 'release'],
      ], transformMode(transform, signal), 'mode')));
    } else {
      const mode = transformMode(transform, signal);
      host.appendChild(sentence(
        'Fires when it',
        addSelect([
          ['threshold-above', 'rises above'],
          ['threshold-below', 'falls below'],
          ['change', 'changes by'],
        ], mode, 'mode'),
        transform.type === 'change'
          ? spanInput(transform, 'amount')
          : spanInput(transform, 'threshold'),
      ));
    }
    host.appendChild(sentence(
      'At most every', numberInput(transform.cooldownMs ?? 160, 'cooldownMs'), 'ms',
    ));
  }

  /** Live wires leaving one particular jack of one particular input. */
  function wiresFrom(signal, outputId) {
    return engine.listConnections().filter((connection) =>
      connection.source === signal.channel
      && portOf(connection.target)
      && connectionOutput(connection).id === outputId);
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

  function connectionCard(connection, signal) {
    const target = targetOf(connection.target.node);
    const port = portOf(connection.target);

    const card = document.createElement('article');
    card.className = 'wiring-map';
    card.dataset.connectionId = connection.id;
    card.dataset.type = port.type;

    const header = document.createElement('div');
    header.className = 'wiring-map-header';
    const title = document.createElement('strong');
    // The input and jack are already named directly above, so the card only
    // has to say where this wire lands.
    title.textContent = `→ ${target.label} · ${port.label}`;
    const liveValue = document.createElement('output');
    liveValue.className = 'wiring-map-value';
    liveValue.textContent = '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn wiring-remove';
    remove.dataset.removeConnection = connection.id;
    remove.setAttribute(
      'aria-label',
      `Unwire ${signal?.label || connection.source} from ${target.label} · ${port.label}`,
    );
    remove.textContent = '✕';
    header.append(title, liveValue, remove);

    const settings = document.createElement('div');
    settings.className = 'wiring-map-settings';
    renderTransformSettings(settings, connection.transform, signal, port);
    // Only a mapped range has a span worth fitting to what the sensor does.
    if (signal?.kind === 'number' && connection.transform.type === 'range') {
      const calibrate = document.createElement('button');
      calibrate.type = 'button';
      calibrate.className = 'btn btn-soft wiring-calibrate';
      calibrate.dataset.calibrateConnection = connection.id;
      calibrate.textContent = 'Use live range';
      settings.appendChild(calibrate);
    }
    card.append(header, settings);
    return card;
  }

  function setSelected(channel, outputId) {
    const same = selected?.channel === channel && selected?.output === outputId;
    const output = findOutput(signalStore.get(channel), outputId);
    selected = same || !output ? null : { channel, output: outputId, type: output.type };
    renderSources();
    renderTargets();
    if (!selected) {
      setStatus('Choose an output, then a game port of the same type.');
      return;
    }
    const label = signalStore.get(channel)?.label || channel;
    setStatus(`Now choose a ${connectorLabel(output.type).toLowerCase()} port for ${label} · ${output.label}.`);
  }

  function connect(channel, outputId, node, port) {
    const output = findOutput(signalStore.get(channel), outputId);
    const target = targetOf(node)?.ports.find(({ id }) => id === port);
    if (output && target && target.type !== output.type) {
      const kind = connectorLabel(output.type).toLowerCase();
      setStatus(`${output.label} is a ${kind} output, so it only fits a ${kind} port.`);
      return;
    }
    const connection = engine.addConnection(channel, { node, port }, outputId);
    if (!connection) {
      setStatus('That input cannot drive this port.');
      return;
    }
    // Whatever the jack's sentence already said is what the new wire does.
    const draft = drafts.get(draftKey(channel, outputId));
    if (draft) engine.updateConnection(connection.id, { transform: draft.transform });
    const signal = signalStore.get(channel);
    setStatus(`Wired ${signal?.label || channel} · ${output?.label ?? outputId} to ${targetOf(node)?.label || node}.`);
    selected = null;
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
    const source = outputJack(drag.channel, drag.output);
    if (!source) return;
    const boardRect = ui.board.getBoundingClientRect();
    const from = pointInBoard(source, 'right');
    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('wiring-cable-drag');
    path.dataset.type = drag.type;
    path.setAttribute('d', cablePath(from.x, from.y, clientX - boardRect.left, clientY - boardRect.top));
    ui.cables.appendChild(path);
  }

  function pulseConnection(id, fired, value) {
    const card = ui.sources.querySelector(`[data-connection-id="${CSS.escape(id)}"]`);
    const path = ui.cables.querySelector(`[data-connection-id="${CSS.escape(id)}"]`);
    const output = card?.querySelector('.wiring-map-value');
    if (output) output.textContent = Number.isFinite(value) ? `${Math.round(value * 100)}%` : String(value);
    card?.classList.toggle('active', fired);
    path?.classList.toggle('active', fired);
    clearTimeout(activityTimers.get(id));
    activityTimers.set(id, setTimeout(() => {
      card?.classList.remove('active');
      path?.classList.remove('active');
    }, fired ? 180 : 80));
  }

  ui.sources.addEventListener('click', (event) => {
    if (suppressClick) return;
    // The name and the jack are two halves of the same control.
    if (!event.target.closest('.wiring-out, .wiring-jack')) return;
    const row = event.target.closest('.wiring-out-row');
    if (row) setSelected(row.dataset.channel, row.dataset.output);
  });

  ui.targets.addEventListener('click', (event) => {
    const port = event.target.closest('.wiring-port');
    if (!port) return;
    if (!selected) {
      setStatus('Choose an output on the left first.');
      return;
    }
    connect(selected.channel, selected.output, port.dataset.node, port.dataset.port);
  });

  ui.sources.addEventListener('pointerdown', (event) => {
    // Dragging starts at the jack itself, which keeps the settings beside it
    // free to be dragged across and selected like ordinary form controls.
    const jack = event.target.closest('.wiring-jack');
    if (!jack || event.button !== 0) return;
    const row = jack.closest('.wiring-out-row');
    if (!row) return;
    drag = {
      channel: row.dataset.channel,
      output: row.dataset.output,
      type: row.dataset.type,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    jack.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) drawDragCable(event.clientX, event.clientY);
  });
  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
    if (drag.moved) {
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest('.wiring-port');
      if (port) connect(drag.channel, drag.output, port.dataset.node, port.dataset.port);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
    drawCables();
  });

  ui.sources.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-connection]');
    if (remove) {
      const id = remove.dataset.removeConnection;
      const going = engine.listConnections().find((connection) => connection.id === id);
      // Hand the settings back to the jack so unwiring never loses them.
      if (going) {
        const signal = signalStore.get(going.source);
        rememberDraft(draftKey(going.source, connectionOutput(going).id), signal?.kind, going.transform);
      }
      engine.removeConnection(id);
      return;
    }
    const calibrate = event.target.closest('[data-calibrate-connection]');
    if (!calibrate) return;
    const connection = engine.listConnections().find(({ id }) => id === calibrate.dataset.calibrateConnection);
    const signal = connection && signalStore.get(connection.source);
    if (!connection || !signal) return;
    const min = signal.observedMin ?? signal.min;
    const max = signal.observedMax ?? signal.max;
    if (min === max) {
      setStatus(`Move ${signal.label} through its full range, then calibrate again.`);
      return;
    }
    engine.updateConnection(connection.id, { transform: { min, max } });
    setStatus(`Calibrated ${signal.label} to its observed ${min}–${max} range.`);
  });
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

  ui.sources.addEventListener('change', (event) => {
    const card = event.target.closest('[data-connection-id], [data-draft-key]');
    const field = event.target.dataset.field;
    if (!card || !field) return;

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
  });

  ui.clear.addEventListener('click', () => {
    if (!engine.listConnections().length) return;
    if (window.confirm('Remove every controller-to-game connection?')) engine.reset();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selected) return;
    selected = null;
    renderSources();
    renderTargets();
    setStatus('Connection cancelled.');
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
