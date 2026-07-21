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
  shake:   { label: 'Shake',       emoji: '🫨', kind: 'event' },
};

/** Metadata for a channel name, with a generic fallback for unknown channels. */
export function channelInfo(name) {
  return CHANNELS[name] || { label: name, emoji: '📡' };
}
