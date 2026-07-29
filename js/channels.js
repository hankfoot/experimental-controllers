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
//          and the block you wire on Controls are the same input, so they say the
//          same sentence about it rather than two paraphrases you have to
//          reconcile. A reading with no natural unit says its own scale here,
//          since "255" means nothing by itself.
//   unit — what the numbers are in, written after any of them: the live value
//          and every threshold you set. Omitted when the reading is a bare
//          count with no unit to name.
//
// A third, `subject`, is only there when the name that heads the card would be
// wrong in the middle of a sentence. A card is titled after the thing you point
// at — "Light", "Sound", "Pin 0" — but a wire's sentence is about the quantity
// that thing reports, and "Follows the light from 0 to 255" reads as though a
// lamp were being followed. Where the two differ the sentence gets the
// measurement's own name ("the brightness", "the loudness"); where the label
// already is the quantity, as with Temperature or Pitch, there is nothing to
// say twice and the field is left off. Written as the whole noun phrase,
// article included, because a pin doesn't take one.

const CHANNELS = {
  btna:    { label: 'Button A',    emoji: '🔘', kind: 'binary',
             desc: 'The A button on the left of the LED display.' },
  btnb:    { label: 'Button B',    emoji: '🔘', kind: 'binary',
             desc: 'The B button on the right of the LED display.' },
  logo:    { label: 'Logo touch',  emoji: '⭐', kind: 'binary',
             desc: 'The gold logo at the top can sense your touch.' },
  p0:      { label: 'Pin 0',       emoji: '🔌', max: 1023, subject: 'pin 0',
             desc: 'Whatever you clip to the big gold P0 pin — foil, fruit, a spoon.' },
  p1:      { label: 'Pin 1',       emoji: '🔌', max: 1023, subject: 'pin 1',
             desc: 'Whatever you clip to the big gold P1 pin — foil, fruit, a spoon.' },
  p2:      { label: 'Pin 2',       emoji: '🔌', max: 1023, subject: 'pin 2',
             desc: 'Whatever you clip to the big gold P2 pin — foil, fruit, a spoon.' },
  light:   { label: 'Light',       emoji: '💡', kind: 'number', max: 255, subject: 'the brightness',
             desc: 'How bright it is at the LED grid: 0 is covered, 255 is a flashlight.' },
  temp:    { label: 'Temperature', emoji: '🌡️', kind: 'number', min: 0, max: 50, unit: '°C',
             desc: 'The chip’s own temperature. It moves slowly — room air is around 20 °C.' },
  mic:     { label: 'Sound',       emoji: '🎤', kind: 'number', max: 255, subject: 'the loudness',
             desc: 'How loud it is at the mic: 0 is a quiet room, 255 is a shout.' },
  pitch:   { label: 'Pitch',       emoji: '📐', kind: 'number', min: -90,  max: 90, unit: '°',
             desc: 'Tipped forward or back: 0° is flat, ±90° is straight up or down.' },
  roll:    { label: 'Roll',        emoji: '📐', kind: 'number', min: -180, max: 180, unit: '°',
             desc: 'Tipped left or right: 0° is level, ±90° is on its side.' },
  // A heading is a circle, so it gets its own kind rather than riding along as a
  // number. Everything a number offers is measured along a line: a level would
  // snap end to end as the board passed north, and a threshold would be crossed
  // by every spin past the 0°/360° seam. A bearing is asked about instead — is
  // it pointing this way — which is a question the seam can't break.
  heading: { label: 'Compass',     emoji: '🧭', kind: 'bearing', max: 360, unit: '°',
             desc: 'Which way the board points when it is held level.' },
  // One-off accelerometer gestures — each fires a single "1". `phrase` is how
  // the gesture reads mid-sentence on the wiring screen: "Each time <phrase>".
  shake:     { label: 'Shake',      emoji: '🫨', kind: 'event', phrase: 'the board is shaken',
               desc: 'Fires once per shake, however long you keep shaking.' },
  tiltleft:  { label: 'Tilt left',  emoji: '👈', kind: 'event', phrase: 'the board tips left',
               desc: 'Fires the moment it tips past about 45° to the left.' },
  tiltright: { label: 'Tilt right', emoji: '👉', kind: 'event', phrase: 'the board tips right',
               desc: 'Fires the moment it tips past about 45° to the right.' },
  logoup:    { label: 'Logo up',    emoji: '🙂', kind: 'event', phrase: 'the logo comes upright',
               desc: 'Standing upright, LED display facing you, logo edge at the top.' },
  logodown:  { label: 'Logo down',  emoji: '🙃', kind: 'event', phrase: 'the board turns upside down',
               desc: 'Still upright and facing you, but turned 180° — logo at the bottom.' },
  faceup:    { label: 'Face up',    emoji: '🔆', kind: 'event', phrase: 'the board is laid face up',
               desc: 'Lying flat, LED display pointing at the ceiling.' },
  facedown:  { label: 'Face down',  emoji: '🌙', kind: 'event', phrase: 'the board is laid face down',
               desc: 'Lying flat the other way, LED display pointing at the floor.' },
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
