#!/usr/bin/env python3
"""Writes the game's built-in sounds into assets/sounds/.

The app plays recordings, not synthesis — every sound it knows about is a file,
whether you recorded it into the microphone on the Design screen or it shipped
with the game. So the built-in set has to be authored somewhere, and it is
authored here rather than committed as opaque binaries nobody can adjust: the
waveform maths below is short, and "make the coin blip a tone higher" should be
a one-character change rather than a trip to an audio editor.

Deliberately crude. Square and triangle waves with hard envelopes, in a pentatonic
scale so nothing can clash, at a low bitrate — a chiptune, near enough, and a
sound that is obviously placeholder is a sound people feel free to replace.

    python3 scripts/make-sounds.py

Needs ffmpeg with libmp3lame on PATH. Regenerating is safe and idempotent; the
.mp3 files it writes are committed so the site has no build step.
"""

import math
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

RATE = 44_100
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "sounds"

# A minor pentatonic, which is the cheap way to make sure no two notes played
# near each other sound like a mistake.
A3 = 220.0
SCALE = [A3 * 2 ** (s / 12) for s in (0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24)]


def square(phase):
    return 1.0 if phase % 1.0 < 0.5 else -1.0


def triangle(phase):
    x = phase % 1.0
    return 4 * abs(x - 0.5) - 1


def noise(_phase, state=[0x1234]):
    # A 15-bit LFSR, the same trick the sound chips this is imitating used. Much
    # grittier than random(), and identical every run so the file never churns.
    state[0] = ((state[0] >> 1) | (((state[0] ^ (state[0] >> 1)) & 1) << 14)) & 0x7FFF
    return (state[0] & 1) * 2 - 1


WAVES = {"square": square, "triangle": triangle, "noise": noise}


def tone(samples, start, length, freq, gain=0.5, wave_name="square", bend=1.0, attack=0.004):
    """Adds one note, ramped in and out so it cannot click."""
    shape = WAVES[wave_name]
    first = int(start * RATE)
    count = int(length * RATE)
    phase = 0.0
    for i in range(count):
        if first + i >= len(samples):
            break
        t = i / count
        # Linear decay, which is blunter than an exponential and reads as more
        # of a blip — which is the point.
        envelope = min(1.0, i / max(1, int(attack * RATE))) * (1.0 - t)
        phase += (freq * bend ** t) / RATE
        samples[first + i] += shape(phase) * gain * envelope


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    # Left with headroom rather than pushed to full scale: these play over the
    # music and over whatever the room is doing.
    scale = 0.72 / peak if peak > 0.72 else 1.0

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        path = pathlib.Path(handle.name)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * scale * 32767))))
            for s in samples
        ))

    target = OUT / f"{name}.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path),
         "-codec:a", "libmp3lame", "-b:a", "64k", "-ar", str(RATE), "-ac", "1",
         str(target)],
        check=True,
    )
    path.unlink()
    print(f"{target.relative_to(OUT.parent.parent)}  {target.stat().st_size:,} bytes")


def blank(seconds):
    return [0.0] * int(seconds * RATE)


def launch():
    """A round starting: four notes up."""
    s = blank(0.42)
    for i, step in enumerate((0, 2, 4, 6)):
        tone(s, i * 0.06, 0.12, SCALE[step], gain=0.42)
    return s


def score():
    """Clearing an obstacle: two quick notes, the second higher."""
    s = blank(0.18)
    tone(s, 0.0, 0.06, SCALE[5], gain=0.4)
    tone(s, 0.05, 0.11, SCALE[7], gain=0.4)
    return s


def crash():
    """Hitting something: a noise burst with a tone falling out from under it."""
    s = blank(0.52)
    tone(s, 0.0, 0.26, 1.0, gain=0.5, wave_name="noise", attack=0.001)
    tone(s, 0.0, 0.46, SCALE[3], gain=0.45, wave_name="triangle", bend=0.35)
    return s


def thrust():
    """Steering. Fires on the rising edge of a hold, so it has to be brief and
    quiet enough to hear a hundred times without becoming irritating."""
    s = blank(0.13)
    tone(s, 0.0, 0.12, SCALE[2], gain=0.2, wave_name="triangle", bend=1.7)
    return s


def music():
    """A bed to loop under everything, in the same scale so nothing clashes.

    Written to a whole number of bars at a whole number of seconds, so the loop
    point lands exactly on the beat — `source.loop = true` splices the end to the
    start with no crossfade, and a bar that doesn't divide evenly is audible as
    a hitch every time round.
    """
    beat = 0.25
    bars, per_bar = 4, 8
    s = blank(beat * bars * per_bar)

    bass_line = (0, 0, 3, 3, 1, 1, 2, 2)
    melody = (5, 7, 6, 7, 8, 7, 6, 5, 5, 4, 6, 7, 8, 9, 7, 6,
              5, 7, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 5, 6, 7)

    for i in range(bars * per_bar):
        at = i * beat
        tone(s, at, beat * 1.6, SCALE[bass_line[i % per_bar]] / 2,
             gain=0.3, wave_name="triangle")
        tone(s, at, beat * 0.85, SCALE[melody[i % len(melody)]], gain=0.16)
        # An off-beat tick, so it has a pulse rather than just chords.
        if i % 2 == 1:
            tone(s, at + beat * 0.5, 0.05, 1.0, gain=0.08, wave_name="noise", attack=0.001)
    return s


TRACKS = {
    "launch": launch,
    "score": score,
    "crash": crash,
    "thrust": thrust,
    "music": music,
}

if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is not on PATH — needed to encode the mp3s.")
    for name, make in TRACKS.items():
        write(name, make())
