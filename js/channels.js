// Channel metadata for the wire protocol.
//
// The protocol is just "<channel>:<number>\n" — ANY channel name is valid on the
// wire. This registry only makes the known ones prettier (label, emoji, expected
// range for plotting). Unknown channels still render everywhere, with an
// auto-scaled plot, so attendees can invent their own channels in MakeCode.

export const CHANNELS = {
  btna:    { label: 'Button A',    emoji: '🔘' },
  btnb:    { label: 'Button B',    emoji: '🔘' },
  logo:    { label: 'Logo touch',  emoji: '⭐' },
  p0:      { label: 'Pin 0',       emoji: '🔌', max: 1023 },
  p1:      { label: 'Pin 1',       emoji: '🔌', max: 1023 },
  p2:      { label: 'Pin 2',       emoji: '🔌', max: 1023 },
  light:   { label: 'Light',       emoji: '💡', max: 255 },
  temp:    { label: 'Temperature', emoji: '🌡️', min: 0, max: 50 },
  mic:     { label: 'Sound',       emoji: '🎤', max: 255 },
  pitch:   { label: 'Pitch',       emoji: '📐', min: -90,  max: 90 },
  roll:    { label: 'Roll',        emoji: '📐', min: -180, max: 180 },
  heading: { label: 'Compass',     emoji: '🧭', max: 360 },
  // One-off accelerometer gestures — each fires a single "1".
  shake:     { label: 'Shake',      emoji: '🫨', kind: 'event' },
  tiltleft:  { label: 'Tilt left',  emoji: '👈', kind: 'event' },
  tiltright: { label: 'Tilt right', emoji: '👉', kind: 'event' },
  logoup:    { label: 'Logo up',    emoji: '🙂', kind: 'event' },
  logodown:  { label: 'Logo down',  emoji: '🙃', kind: 'event' },
  faceup:    { label: 'Face up',    emoji: '🔆', kind: 'event' },
  facedown:  { label: 'Face down',  emoji: '🌙', kind: 'event' },
  freefall:  { label: 'Free fall',  emoji: '🪂', kind: 'event' },
  g3:        { label: 'Small bump', emoji: '💥', kind: 'event' },
  g6:        { label: 'Hard hit',   emoji: '💥', kind: 'event' },
  g8:        { label: 'Big slam',   emoji: '💥', kind: 'event' },
};

/** Metadata for a channel name, with a generic fallback for unknown channels. */
export function channelInfo(name) {
  return CHANNELS[name] || { label: name, emoji: '📡' };
}
