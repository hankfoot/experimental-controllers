// Channel metadata for the wire protocol.
//
// The protocol is just "<channel>:<number>\n" — ANY channel name is valid on the
// wire. This registry only makes the known ones prettier (label, emoji, expected
// range for plotting). Unknown channels still render everywhere, with an
// auto-scaled plot, so attendees can invent their own channels in MakeCode.
//
// Two fields carry what a bare number can't say on its own:
//   desc — one line on what the reading actually is, shown under the name
//          wherever the channel appears: the tile you pick it with on Sensing
//          and the block you wire on Config are the same input, so they say the
//          same sentence about it rather than two paraphrases you have to
//          reconcile. A reading with no natural unit says its own scale here,
//          since "255" means nothing by itself.
//   unit — what the numbers are in, written after any of them: the live value
//          and every threshold you set. Omitted when the reading is a bare
//          count with no unit to name.

const CHANNELS = {
  btna:    { label: 'Button A',    emoji: '🔘', kind: 'binary',
             desc: 'The A button, on the left of the screen.' },
  btnb:    { label: 'Button B',    emoji: '🔘', kind: 'binary',
             desc: 'The B button, on the right of the screen.' },
  logo:    { label: 'Logo touch',  emoji: '⭐', kind: 'binary',
             desc: 'The gold logo at the top — it senses a finger.' },
  p0:      { label: 'Pin 0',       emoji: '🔌', max: 1023,
             desc: 'Whatever you clip to the big gold P0 pin — foil, fruit, a spoon.' },
  p1:      { label: 'Pin 1',       emoji: '🔌', max: 1023,
             desc: 'Whatever you clip to the big gold P1 pin — foil, fruit, a spoon.' },
  p2:      { label: 'Pin 2',       emoji: '🔌', max: 1023,
             desc: 'Whatever you clip to the big gold P2 pin — foil, fruit, a spoon.' },
  light:   { label: 'Light',       emoji: '💡', kind: 'number', max: 255,
             desc: 'How bright it is at the LED grid: 0 is covered, 255 is a flashlight.' },
  temp:    { label: 'Temperature', emoji: '🌡️', kind: 'number', min: 0, max: 50, unit: '°C',
             desc: 'The chip’s own temperature. It moves slowly — room air is around 20 °C.' },
  mic:     { label: 'Sound',       emoji: '🎤', kind: 'number', max: 255,
             desc: 'How loud it is at the mic: 0 is a quiet room, 255 is a shout.' },
  pitch:   { label: 'Pitch',       emoji: '📐', kind: 'number', min: -90,  max: 90, unit: '°',
             desc: 'Tipped forward or back: 0° is flat, ±90° is straight up or down.' },
  roll:    { label: 'Roll',        emoji: '📐', kind: 'number', min: -180, max: 180, unit: '°',
             desc: 'Tipped left or right: 0° is level, ±180° is fully rolled over.' },
  heading: { label: 'Compass',     emoji: '🧭', kind: 'number', max: 360, unit: '°',
             desc: 'Which way it points: 0° north, 90° east, 180° south, 270° west.' },
  // One-off accelerometer gestures — each fires a single "1". `phrase` is how
  // the gesture reads mid-sentence on the wiring screen: "Each time <phrase>".
  shake:     { label: 'Shake',      emoji: '🫨', kind: 'event', phrase: 'the board is shaken',
               desc: 'Fires once per shake, however long you keep shaking.' },
  tiltleft:  { label: 'Tilt left',  emoji: '👈', kind: 'event', phrase: 'the board tips left',
               desc: 'Fires the moment it tips past about 45° to the left.' },
  tiltright: { label: 'Tilt right', emoji: '👉', kind: 'event', phrase: 'the board tips right',
               desc: 'Fires the moment it tips past about 45° to the right.' },
  logoup:    { label: 'Logo up',    emoji: '🙂', kind: 'event', phrase: 'the logo comes upright',
               desc: 'Standing upright, screen facing you, logo edge at the top.' },
  logodown:  { label: 'Logo down',  emoji: '🙃', kind: 'event', phrase: 'the board turns upside down',
               desc: 'Still upright and facing you, but turned 180° — logo at the bottom.' },
  faceup:    { label: 'Face up',    emoji: '🔆', kind: 'event', phrase: 'the board is laid face up',
               desc: 'Lying flat, screen pointing at the ceiling.' },
  facedown:  { label: 'Face down',  emoji: '🌙', kind: 'event', phrase: 'the board is laid face down',
               desc: 'Lying flat the other way, screen pointing at the floor.' },
  freefall:  { label: 'Free fall',  emoji: '🪂', kind: 'event', phrase: 'the board is dropped',
               desc: 'Fires the instant the board is in the air.' },
  g3:        { label: 'Small bump', emoji: '💥', kind: 'event', phrase: 'the board takes a small bump',
               desc: 'A light 3g knock — a gentle tap or bump.' },
  g6:        { label: 'Hard hit',   emoji: '💥', kind: 'event', phrase: 'the board takes a hard hit',
               desc: 'A firm 6g whack — a solid smack or a real shake.' },
  g8:        { label: 'Big slam',   emoji: '💥', kind: 'event', phrase: 'the board takes a big slam',
               desc: 'A big 8g impact — a hard slam, nothing accidental.' },
};

/** Metadata for a channel name, with a generic fallback for unknown channels. */
export function channelInfo(name) {
  return CHANNELS[name] || { label: name, emoji: '📡' };
}

/** Whether a value can still represent a binary on/off channel. */
export function isBinaryValue(value) {
  return value === 0 || value === 1;
}

/** Infer how a channel should initially be interpreted from its first reading. */
export function channelKind(name, value) {
  const kind = channelInfo(name).kind;
  if (kind) return kind;
  return isBinaryValue(value) ? 'binary' : 'number';
}
