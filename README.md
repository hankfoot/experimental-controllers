# Experimental Game Controllers

A companion website for the **Fidget Camp 2026** workshop on unconventional controllers.

Wire a real-world object to a **BBC micro:bit v2**, stream its sensors over **Web Bluetooth**,
and turn everyday objects into controllers for a browser game.

## How it works

1. On the **Controller** page, choose inputs and copy the generated MakeCode.
2. Flash that code to a micro:bit using the walkthrough on the **Setup** page.
3. Open the site in desktop or Android Chrome/Edge and click **Connect**.
4. Open the Live-input control to test each signal.
5. Wire signals to controls on the **Game** page and play.

## Input protocol

The micro:bit sends one raw sensor reading per UART line:

```text
<channel>:<number>
```

| Example | Meaning |
| --- | --- |
| `btna:1` / `btna:0` | A binary button, touch pad, or switch. |
| `light:187` | A continuous raw sensor reading. |
| `pitch:-42` | The board's pitch angle in degrees. |
| `shake:1` | A one-off event sent when the gesture occurs. |

The browser decides what each channel controls, so remapping never requires reflashing. Any
channel name is valid. [js/channels.js](js/channels.js) supplies friendly metadata for known
channels; custom channels are discovered automatically.

## Run locally

The site has no runtime dependencies and no build step. Serve it over HTTP so browser modules and
Web Bluetooth use the same paths as GitHub Pages:

```sh
npm run dev
```

Then open <http://localhost:8000>. The included server uses only Node's standard library.

Run the Node test suite with:

```sh
npm test
```

With Nix installed, `nix develop path:.` provides Node.

## GitHub Pages

Configure Pages to **Deploy from a branch**, using the `main` branch and `/(root)`. GitHub serves
`index.html`, `styles.css`, `js/`, and `assets/` directly; no workflow, generated bundle, or
deployment branch is needed.

## Wiring inputs to the game

The Game page contains a visual patch bay. Choose or drag an input onto a compatible game port,
then tune its threshold, range, direction, cooldown, or smoothing. Buttons and gestures work as
triggers; sensor readings can drive bird position, game speed, flap strength, and gravity. Wiring
is saved in browser storage and survives a refresh.

On wide screens the wiring workbench and game sit side-by-side so changes can be tested
immediately. When that pair cannot fit comfortably, the game stacks beneath the workbench.

## Code structure

- `index.html` contains the four accessible page panels and static workshop content.
- `styles.css` contains the complete responsive design.
- `js/builder.js` generates MakeCode and controller-building guidance.
- `js/signal-store.js` owns discovered, planned, and wired input state.
- `js/wiring-*.js` separate wiring configuration, runtime math, persistence, coordination, and UI.
- `js/game-engine.js` contains testable game rules; `js/game.js` connects them to the DOM/canvas.
- `js/bluetooth.js`, `js/bus.js`, and `js/visualizer.js` handle the input pipeline.
- `test/` covers wiring migration, persistence, protocol parsing, and game rules.

## Controller code builder

The Controller page generates complete MakeCode JavaScript from the selected inputs, including
per-input build tips. Inputs are grouped into touch/press, tilt/direction, gestures, and ambient
sensors. The generated loop polls every 100 ms; the page warns when too many continuously
streaming inputs may overwhelm the micro:bit's Bluetooth UART.
