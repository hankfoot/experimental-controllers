// Accessible patch-bay UI. Click/tap a source then a destination; pointer users
// can also drag. SVG cables are decorative—the mapping cards remain the source
// of truth and work on narrow screens without the diagram.

import { canConnect } from './wiring-engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function initWiringUI({ signalStore, engine }) {
  const byId = (id) => document.getElementById(id);
  const ui = {
    board: byId('wiring-board'),
    sources: byId('wiring-sources'),
    targets: byId('wiring-targets'),
    cables: byId('wiring-cables'),
    connections: byId('wiring-connections'),
    empty: byId('wiring-empty'),
    status: byId('wiring-status'),
    clear: byId('wiring-clear'),
  };
  if (Object.values(ui).some((element) => !element)) return;

  let selectedSource = null;
  let drag = null;
  let suppressClick = false;
  const activityTimers = new Map();

  const targetOf = (nodeId) => engine.targets.find(({ id }) => id === nodeId);
  const portOf = (target) => targetOf(target.node)?.ports.find(({ id }) => id === target.port);
  const formatValue = (signal) => signal.value == null
    ? 'waiting'
    : Number.isInteger(signal.value) ? String(signal.value) : signal.value.toFixed(1);

  function setStatus(message) {
    ui.status.textContent = message;
  }

  function renderSources() {
    const signals = signalStore.all().sort((a, b) => {
      const aRank = a.planned ? 0 : a.wired ? 1 : 2;
      const bRank = b.planned ? 0 : b.wired ? 1 : 2;
      return aRank - bRank || a.label.localeCompare(b.label);
    });
    ui.sources.replaceChildren();

    if (!signals.length) {
      const empty = document.createElement('p');
      empty.className = 'wiring-source-empty';
      empty.textContent = 'Choose inputs on the Controller page, or connect a controller to discover them live.';
      ui.sources.appendChild(empty);
      return;
    }

    for (const signal of signals) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wiring-source';
      button.dataset.channel = signal.channel;
      button.dataset.kind = signal.kind || 'unknown';
      button.dataset.live = String(signal.live);
      button.setAttribute('aria-pressed', String(selectedSource === signal.channel));

      const identity = document.createElement('span');
      identity.className = 'wiring-source-id';
      const emoji = document.createElement('span');
      emoji.className = 'wiring-source-emoji';
      emoji.textContent = signal.emoji;
      const text = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = signal.label;
      const channel = document.createElement('code');
      channel.textContent = signal.channel;
      text.append(label, channel);
      identity.append(emoji, text);

      const reading = document.createElement('span');
      reading.className = 'wiring-source-reading';
      reading.dataset.sourceValue = signal.channel;
      reading.textContent = formatValue(signal);
      const jack = document.createElement('span');
      jack.className = 'wiring-jack wiring-jack-source';
      jack.setAttribute('aria-hidden', 'true');
      button.append(identity, reading, jack);
      ui.sources.appendChild(button);
    }
  }

  function renderTargets() {
    ui.targets.replaceChildren();
    const source = selectedSource && signalStore.get(selectedSource);
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
        const compatible = !source || canConnect(source, port);
        button.dataset.compatible = String(compatible);
        const count = connections.filter((connection) =>
          connection.target.node === target.id && connection.target.port === port.id).length;
        button.innerHTML = `
          <span class="wiring-jack wiring-jack-target" aria-hidden="true"></span>
          <span>${port.label}</span>
          <small>${port.type}${port.defaultValue != null ? ` · default ${Math.round(port.defaultValue * 100)}%` : ''}</small>
          ${count ? `<b>${count}</b>` : ''}
        `;
        card.appendChild(button);
      }
      ui.targets.appendChild(card);
    }
  }

  function transformMode(connection, signal) {
    const { transform } = connection;
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

  function labelledControl(label, control, className = '') {
    const wrapper = document.createElement('label');
    wrapper.className = `wiring-setting ${className}`.trim();
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(text, control);
    return wrapper;
  }

  function numberInput(value, field) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(value);
    input.dataset.field = field;
    return input;
  }

  function rangeInput(value, field, max = 1, step = 0.01) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.field = field;
    return input;
  }

  function renderTransformSettings(host, connection, signal, port) {
    const { transform } = connection;
    if (port.type === 'value') {
      host.append(
        labelledControl('Raw minimum', numberInput(transform.min, 'min')),
        labelledControl('Raw maximum', numberInput(transform.max, 'max')),
      );
      const invert = document.createElement('input');
      invert.type = 'checkbox';
      invert.checked = Boolean(transform.invert);
      invert.dataset.field = 'invert';
      host.append(labelledControl('Invert', invert, 'wiring-setting-check'));
      host.append(labelledControl(
        `Smoothing · ${Math.round((transform.smoothing || 0) * 100)}%`,
        rangeInput(transform.smoothing || 0, 'smoothing', 0.95, 0.05),
      ));
      return;
    }

    let options;
    if (signal?.kind === 'event') {
      options = [['event', 'Whenever it happens']];
    } else if (signal?.kind === 'binary') {
      options = [
        ['edge-rising', 'When pressed / turned on'],
        ['edge-falling', 'When released / turned off'],
        ['event', 'Every 1 received'],
      ];
    } else {
      options = [
        ['threshold-above', 'When it rises above'],
        ['threshold-below', 'When it falls below'],
        ['change', 'When it changes quickly'],
      ];
    }
    host.append(labelledControl('Trigger', addSelect(options, transformMode(connection, signal), 'mode')));

    if (transform.type === 'threshold') {
      host.append(labelledControl(
        `Threshold · ${Math.round((transform.threshold ?? 0.5) * 100)}%`,
        rangeInput(transform.threshold ?? 0.5, 'threshold'),
      ));
    }
    if (transform.type === 'change') {
      host.append(labelledControl(
        `Change · ${Math.round((transform.amount ?? 0.18) * 100)}%`,
        rangeInput(transform.amount ?? 0.18, 'amount'),
      ));
    }
    if (transform.type === 'threshold' || transform.type === 'change') {
      host.append(
        labelledControl('Raw minimum', numberInput(transform.min, 'min')),
        labelledControl('Raw maximum', numberInput(transform.max, 'max')),
      );
    }
    host.append(labelledControl(
      `Cooldown · ${transform.cooldownMs ?? 160} ms`,
      rangeInput(transform.cooldownMs ?? 160, 'cooldownMs', 1000, 20),
    ));
  }

  function renderConnections() {
    const connections = engine.listConnections();
    ui.connections.replaceChildren();
    ui.empty.hidden = connections.length > 0;
    ui.clear.disabled = connections.length === 0;

    for (const connection of connections) {
      const signal = signalStore.get(connection.source);
      const target = targetOf(connection.target.node);
      const port = portOf(connection.target);
      if (!target || !port) continue;

      const card = document.createElement('article');
      card.className = 'wiring-map';
      card.dataset.connectionId = connection.id;
      const header = document.createElement('div');
      header.className = 'wiring-map-header';
      const title = document.createElement('strong');
      title.textContent = `${signal?.label || connection.source} → ${target.label} · ${port.label}`;
      const liveValue = document.createElement('output');
      liveValue.className = 'wiring-map-value';
      liveValue.textContent = '—';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn wiring-remove';
      remove.dataset.removeConnection = connection.id;
      remove.setAttribute('aria-label', `Remove ${title.textContent} connection`);
      remove.textContent = '✕';
      header.append(title, liveValue, remove);

      const settings = document.createElement('div');
      settings.className = 'wiring-map-settings';
      renderTransformSettings(settings, connection, signal, port);
      if (signal?.kind === 'number') {
        const calibrate = document.createElement('button');
        calibrate.type = 'button';
        calibrate.className = 'btn btn-soft wiring-calibrate';
        calibrate.dataset.calibrateConnection = connection.id;
        calibrate.textContent = 'Use live range';
        settings.appendChild(calibrate);
      }
      card.append(header, settings);
      ui.connections.appendChild(card);
    }
    requestAnimationFrame(drawCables);
  }

  function setSelectedSource(channel) {
    selectedSource = selectedSource === channel ? null : channel;
    renderSources();
    renderTargets();
    setStatus(selectedSource
      ? `Now choose a game port for ${signalStore.get(selectedSource)?.label || selectedSource}.`
      : 'Choose an input, then choose a compatible game port.');
  }

  function connect(source, node, port) {
    const connection = engine.addConnection(source, { node, port });
    if (!connection) {
      setStatus('That input type cannot connect to this port.');
      return;
    }
    const signal = signalStore.get(source);
    const target = targetOf(node);
    setStatus(`Wired ${signal?.label || source} to ${target?.label || node}.`);
    selectedSource = null;
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
      const source = ui.sources.querySelector(`[data-channel="${CSS.escape(connection.source)}"] .wiring-jack-source`);
      const target = ui.targets.querySelector(
        `[data-node="${CSS.escape(connection.target.node)}"][data-port="${CSS.escape(connection.target.port)}"] .wiring-jack-target`,
      );
      if (!source || !target) continue;
      const from = pointInBoard(source, 'right');
      const to = pointInBoard(target, 'left');
      const path = document.createElementNS(SVG_NS, 'path');
      path.dataset.connectionId = connection.id;
      path.setAttribute('d', cablePath(from.x, from.y, to.x, to.y));
      ui.cables.appendChild(path);
    }
  }

  function drawDragCable(clientX, clientY) {
    drawCables();
    const source = ui.sources.querySelector(`[data-channel="${CSS.escape(drag.source)}"] .wiring-jack-source`);
    if (!source) return;
    const boardRect = ui.board.getBoundingClientRect();
    const from = pointInBoard(source, 'right');
    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('wiring-cable-drag');
    path.setAttribute('d', cablePath(from.x, from.y, clientX - boardRect.left, clientY - boardRect.top));
    ui.cables.appendChild(path);
  }

  function pulseConnection(id, fired, value) {
    const card = ui.connections.querySelector(`[data-connection-id="${CSS.escape(id)}"]`);
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
    const source = event.target.closest('.wiring-source');
    if (source) setSelectedSource(source.dataset.channel);
  });

  ui.targets.addEventListener('click', (event) => {
    const port = event.target.closest('.wiring-port');
    if (!port) return;
    if (!selectedSource) {
      setStatus('Choose an input on the left first.');
      return;
    }
    connect(selectedSource, port.dataset.node, port.dataset.port);
  });

  ui.sources.addEventListener('pointerdown', (event) => {
    const source = event.target.closest('.wiring-source');
    if (!source || event.button !== 0) return;
    if (event.pointerType === 'touch' && !event.target.closest('.wiring-jack-source')) return;
    drag = { source: source.dataset.channel, x: event.clientX, y: event.clientY, moved: false };
    source.setPointerCapture(event.pointerId);
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
      if (port) connect(drag.source, port.dataset.node, port.dataset.port);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
    drawCables();
  });

  ui.connections.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-connection]');
    if (remove) {
      engine.removeConnection(remove.dataset.removeConnection);
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
  ui.connections.addEventListener('change', (event) => {
    const card = event.target.closest('[data-connection-id]');
    const field = event.target.dataset.field;
    if (!card || !field) return;
    const connection = engine.listConnections().find(({ id }) => id === card.dataset.connectionId);
    if (!connection) return;
    let patch;
    if (field === 'mode') {
      const [type, qualifier] = event.target.value.split('-');
      patch = { type };
      if (type === 'edge') patch.edge = qualifier;
      if (type === 'threshold') patch.direction = qualifier;
      if (type === 'change') patch.amount = connection.transform.amount ?? 0.18;
    } else if (field === 'invert') {
      patch = { invert: event.target.checked };
    } else {
      patch = { [field]: Number(event.target.value) };
    }
    engine.updateConnection(connection.id, { transform: patch });
  });

  ui.clear.addEventListener('click', () => {
    if (!engine.listConnections().length) return;
    if (window.confirm('Remove every controller-to-game connection?')) engine.reset();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selectedSource) return;
    selectedSource = null;
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
    if (!output) {
      renderSources();
      requestAnimationFrame(drawCables);
      return;
    }
    output.textContent = formatValue(signal);
    const source = output.closest('.wiring-source');
    const kindChanged = source.dataset.kind !== signal.kind;
    source.dataset.live = 'true';
    source.dataset.kind = signal.kind;
    if (kindChanged) renderConnections();
  }, { emitCurrent: true });

  engine.subscribe((event) => {
    if (event.type === 'connections') {
      renderTargets();
      renderConnections();
    } else if (event.type === 'activity') {
      pulseConnection(event.connectionId, event.fired, event.value);
    }
  }, { emitCurrent: true });

  new ResizeObserver(() => drawCables()).observe(ui.board);
}
