# Experimental Controllers

A companion website for the **Fidget Camp 2026** workshop on unconventional controllers.

Wire a real-world object to a **BBC micro:bit (v2)**, and its sensors stream your interactions
over **Web Bluetooth** to this website — turning everyday fidget objects into a game controller
for a browser game of Flappy Bird.

## How it works

1. Flash one of the sensor starter projects to your micro:bit (MakeCode).
2. Open this site in **Chrome or Edge** (Web Bluetooth isn't supported in Safari/Firefox).
3. Click **Connect** and pair your micro:bit.
4. Watch your inputs in the visualizer — then play.

## Input protocol

Every sensor speaks the same simple text protocol over the micro:bit UART service. One message
per line:

| Message | Meaning |
| --- | --- |
| `trigger` | A momentary event fired once (shake, clap, click). Drives the flap/jump. |
| `state:true` / `state:false` | A held on/off state (button down, object touched). |
| `value:0.42` | A continuous reading normalized to `0.0`–`1.0` (tilt, light, loudness). |

Because the browser only knows these three abstract types, the same visualizer and game work with
*any* sensor you build.

## Local preview

This site uses ES modules (`<script type="module">`), which browsers refuse to load over the
`file://` protocol — double-clicking `index.html` will load the page but silently break every
button, tab, and popover (no console error, they just do nothing). Serve it over HTTP instead:

```
python -m http.server 8000
```

then open `http://localhost:8000/`.

## Sensor starter code

<!-- MakeCode project links added as each starter is built -->

- Accelerometer / gestures — _coming soon_
- Buttons + touch pins — _coming soon_
- Light + temperature — _coming soon_
- Sound / microphone — _coming soon_
