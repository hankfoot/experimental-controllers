# Experimental Game Controllers

A companion website for the **Fidget Camp 2026** workshop on unconventional controllers.

Wire a real-world object to a **BBC micro:bit (v2)**, and its sensors stream your interactions
over **Web Bluetooth** to this website — turning everyday fidget objects into a game controller
for a browser game of Flappy Bird.

## How it works

1. On the **Controller** page, check the inputs you want; the site generates the MakeCode for you.
2. Paste that code into the ready-made MakeCode project (see the **Setup** page) and flash it to your micro:bit.
3. Open this site in **Chrome or Edge** (Web Bluetooth isn't supported in Safari/Firefox).
4. Click **Connect** and pair your micro:bit.
5. Watch your inputs in the visualizer.
6. Wire those inputs to game controls on the **Game** page — then play.

## Input protocol

The micro:bit streams **raw sensor channels** over its UART service — one reading per line, as
plain text:

```
<channel>:<number>
```

| Example line | Meaning |
| --- | --- |
| `btna:1` / `btna:0` | A binary input (button, touch pin, switch) — `1` while active, `0` otherwise. |
| `light:187` | A continuous reading sent as its **raw value** (light/sound `0`–`255`, pins `0`–`1023`, tilt in degrees, heading `0`–`360`). |
| `pitch:-42` | The board's live pitch angle in degrees. |
| `shake:1` | A one-off gesture — sends a single `1` the instant it fires. |

All meaning lives **in the browser**, not the micro:bit: what a channel triggers or steers is
decided browser-side, so remapping never means reflashing. **Any channel name is valid on the
wire** — the visualizer renders unknown channels with an auto-scaled plot, so you can invent your
own in MakeCode. `js/channels.js` is just a prettiness registry (label, emoji, range hint) for the
known ones.

## Local preview

This site uses ES modules (`<script type="module">`), which browsers refuse to load over the
`file://` protocol — double-clicking `index.html` will load the page but silently break every
button, tab, and popover (no console error, they just do nothing). Serve it over HTTP instead:

On NixOS (or any system with Nix and flakes enabled), enter the pinned development environment:

```
nix develop path:.
```

Then start the local server:

```
python -m http.server 8000
```

then open `http://localhost:8000/`.

Run the dependency-free JavaScript tests with:

```
npm test
```

## Wiring inputs to the game

The Game page contains a visual patch bay. Choose or drag a controller input onto a compatible
game port, then tune that connection's threshold, range, direction, or smoothing. Buttons and
gestures work naturally as triggers; live sensor readings can drive continuous controls such as
bird position, game speed, flap strength, and gravity. Wiring is stored locally in the browser and
survives a refresh.

## Controller code builder

There are no separate per-sensor starter projects. Instead the **Controller** page is a code
builder: check the inputs you want and it live-generates the complete MakeCode JavaScript to paste
into the ready-made project (see the **Setup** page), plus per-input wiring and build tips.

Inputs are grouped into sections you can mix and match:

- **Touch & press** — buttons, the gold logo, and pins P0–P2 (each pin picks *touch pad* or
  *switch* mode).
- **Tilt & direction** — live tilt (pitch/roll) and compass heading.
- **Gestures** — one-off moves (shake, tilt-left/right, face-up/down, free fall, bump/hit/slam).
  These fire only when they happen, so they add nothing to the Bluetooth load.
- **Ambient sensing** — light, temperature, and microphone loudness.

The generated code polls every 100 ms and writes each reading with `bluetooth.uartWriteLine`,
guarded by a `connected` flag. It's written block-style (if/else, no ternaries) so MakeCode can
decompile it back to Blocks view. Because the live inputs stream continuously, the builder shows a
warning when too many are checked at once — lean on the free gestures where you can.
