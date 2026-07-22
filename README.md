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
wire**. [`src/domain/channels.ts`](src/domain/channels.ts) only supplies labels and range hints for
known channels; custom channels are discovered automatically.

## Local preview

The app uses React, TypeScript, Mantine, and Vite. Serve it over HTTP instead of opening
`index.html` directly.

On NixOS (or any system with Nix and flakes enabled), enter the pinned development environment:

```
nix develop path:.
```

Install the pinned npm dependencies and start Vite:

```
npm ci
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173/`.

Run the unit tests, strict type checker, and production build with:

```
npm test
npm run typecheck
npm run build
```

## Wiring inputs to the game

The Game page contains a visual patch bay. Choose or drag a controller input onto a compatible
game port, then tune that connection's threshold, range, direction, or smoothing. Buttons and
gestures work naturally as triggers; live sensor readings can drive continuous controls such as
bird position, game speed, flap strength, and gravity. Wiring is stored locally in the browser and
survives a refresh.

On wide screens the wiring workbench and game stay side-by-side so changes can be tested
immediately. On phones and tablets the game moves above the editor. Click/tap wiring works at every
size, with drag-and-drop as a desktop shortcut.

## Code structure

- `src/domain/` contains the typed input bus, signal catalog, controller-code generator, and pure
  wiring runtime.
- `src/game/` contains the game simulation, canvas renderer, and small React adapter.
- `src/components/` and `src/pages/` contain the Mantine UI.
- `test/` covers wiring transforms, persistence fallbacks, signal-kind migration, and game rules.

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
