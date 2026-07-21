// The sensor starters shown in the "Flash a sensor starter" grid.
//
// When a MakeCode project is ready, fill in its `url` (share link from
// makecode.microbit.org). Until then, leave url null and the card renders as a
// "coming soon" placeholder. `types` lists which protocol messages it emits.

export const SENSORS = [
  {
    emoji: '📐',
    name: 'Tilt & motion',
    desc: 'Accelerometer — tilt an object to steer, or shake it.',
    types: ['value', 'trigger'],
    tone: 'blue',
    url: null,
  },
  {
    emoji: '🔘',
    name: 'Buttons & touch',
    desc: 'A/B buttons and capacitive touch on pins 0/1/2.',
    types: ['trigger', 'state'],
    tone: 'red',
    url: null,
  },
  {
    emoji: '💡',
    name: 'Light',
    desc: 'Onboard light sensor — cover it, shine on it.',
    types: ['value'],
    tone: 'yellow',
    url: null,
  },
  {
    emoji: '🌡️',
    name: 'Temperature',
    desc: 'Warm the board with your hands.',
    types: ['value'],
    tone: 'green',
    url: null,
  },
  {
    emoji: '🔊',
    name: 'Sound (v2)',
    desc: 'Microphone loudness and clap detection.',
    types: ['value', 'trigger'],
    tone: 'blue',
    url: null,
  },
  {
    emoji: '🧲',
    name: 'Compass (v2)',
    desc: 'Magnetometer heading — spin an object to control.',
    types: ['value'],
    tone: 'red',
    url: null,
  },
];

export function renderSensors(container) {
  container.innerHTML = '';
  for (const s of SENSORS) {
    const ready = !!s.url;
    const el = document.createElement(ready ? 'a' : 'div');
    el.className = `tile tile--${s.tone}`;
    el.dataset.ready = String(ready);
    if (ready) {
      el.href = s.url;
      el.target = '_blank';
      el.rel = 'noopener';
    }

    const tags = s.types.map((t) => `<span class="tag">${t}</span>`).join('');

    el.innerHTML = `
      <span class="tile-emoji">${s.emoji}</span>
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
      ${ready
        ? `<div class="tags">${tags}</div>`
        : `<span class="soon">Starter coming soon</span>`}
    `;
    container.appendChild(el);
  }
}
