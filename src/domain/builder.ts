import type { ChannelDescriptor } from './signalStore';
import type { SignalKind } from './bus';

export interface InputVariant {
  label?: string;
  kind: SignalKind;
  channels: string[];
  loop?: string[];
  handlers?: string[];
  build: string;
}

export interface ControllerInput extends Omit<InputVariant, 'kind' | 'channels' | 'build'> {
  id: string;
  emoji: string;
  name: string;
  description: string;
  kind?: SignalKind;
  channels?: string[];
  build?: string;
  modes?: Record<string, InputVariant>;
}

export interface InputSection {
  id: string;
  title: string;
  description: string;
  inputs: ControllerInput[];
}

export interface BuilderState {
  selected: Set<string>;
  pinModes: Record<string, string>;
}

const SCAFFOLD = [
  'bluetooth.startUartService()',
  'let connected = false',
  'bluetooth.onBluetoothConnected(function () {',
  '    connected = true',
  '})',
  'bluetooth.onBluetoothDisconnected(function () {',
  '    connected = false',
  '})',
];

const binary = (channel: string, expression: string): string[] => [
  `if (${expression}) {`,
  `    bluetooth.uartWriteLine("${channel}:1")`,
  '} else {',
  `    bluetooth.uartWriteLine("${channel}:0")`,
  '}',
];

const numeric = (channel: string, expression: string): string[] => [
  `bluetooth.uartWriteLine("${channel}:" + ${expression})`,
];

function pinInput(pin: number): ControllerInput {
  const channel = `p${pin}`;
  return {
    id: channel,
    emoji: '🔌',
    name: `Pin ${pin}`,
    description: 'Alligator-clip an object to the large gold pin.',
    modes: {
      touch: {
        label: 'Touch pad',
        kind: 'binary',
        channels: [channel],
        loop: binary(channel, `input.pinIsPressed(TouchPin.P${pin})`),
        build: `Clip P${pin} to foil, fruit, or another conductive object. Hold GND and touch the object to send 1.`,
      },
      switch: {
        label: 'Switch',
        kind: 'binary',
        channels: [channel],
        loop: binary(channel, `pins.digitalReadPin(DigitalPin.P${pin}) == 1`),
        build: `Make a switch between 3V and P${pin}. When its two conductive pieces touch, it sends 1.`,
      },
    },
  };
}

function gesture(
  id: string,
  name: string,
  makeCodeName: string,
  emoji: string,
  description: string,
  build: string,
): ControllerInput {
  return {
    id,
    name,
    emoji,
    description,
    kind: 'event',
    channels: [id],
    handlers: [
      `input.onGesture(Gesture.${makeCodeName}, function () {`,
      '    if (connected) {',
      `        bluetooth.uartWriteLine("${id}:1")`,
      '    }',
      '})',
    ],
    build,
  };
}

export const INPUT_SECTIONS: InputSection[] = [
  {
    id: 'touch',
    title: 'Touch & press',
    description: 'Buttons and conductive switches send 1 while active and 0 when released.',
    inputs: [
      {
        id: 'btna', emoji: '🔘', name: 'Button A', description: 'The built-in A button.',
        kind: 'binary', channels: ['btna'], loop: binary('btna', 'input.buttonIsPressed(Button.A)'),
        build: 'Use the button directly, or add a lever that presses it.',
      },
      {
        id: 'btnb', emoji: '🔘', name: 'Button B', description: 'The built-in B button.',
        kind: 'binary', channels: ['btnb'], loop: binary('btnb', 'input.buttonIsPressed(Button.B)'),
        build: 'Use it as a second action or add a physical button-pushing mechanism.',
      },
      {
        id: 'logo', emoji: '⭐', name: 'Logo touch', description: 'The gold logo is a touch sensor.',
        kind: 'binary', channels: ['logo'], loop: binary('logo', 'input.logoIsPressed()'),
        build: 'Touch the logo directly or extend it with a thin strip of foil.',
      },
      pinInput(0), pinInput(1), pinInput(2),
    ],
  },
  {
    id: 'motion',
    title: 'Tilt & direction',
    description: 'Stream the angle or heading of the whole controller.',
    inputs: [
      {
        id: 'tilt', emoji: '📐', name: 'Tilt', description: 'Pitch and roll angles in degrees.',
        kind: 'number', channels: ['pitch', 'roll'],
        loop: [...numeric('pitch', 'input.rotation(Rotation.Pitch)'), ...numeric('roll', 'input.rotation(Rotation.Roll)')],
        build: 'Strap the micro:bit and battery to your object, then tilt the whole controller.',
      },
      {
        id: 'heading', emoji: '🧭', name: 'Compass', description: 'Heading from 0–360°.',
        kind: 'number', channels: ['heading'], loop: numeric('heading', 'input.compassHeading()'),
        build: 'Calibrate once, then spin your object like a dial.',
      },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures',
    description: 'One-off movements send only when they happen, keeping Bluetooth responsive.',
    inputs: [
      gesture('shake', 'Shake', 'Shake', '🫨', 'Fires once per shake.', 'Attach the board to anything shakeable.'),
      gesture('tiltleft', 'Tilt left', 'TiltLeft', '👈', 'Fires when tipped left.', 'Use a quick left flick as an action.'),
      gesture('tiltright', 'Tilt right', 'TiltRight', '👉', 'Fires when tipped right.', 'Use a quick right flick as an action.'),
      gesture('logoup', 'Logo up', 'LogoUp', '🙂', 'Upright with logo at the top.', 'Swing the controller upright.'),
      gesture('logodown', 'Logo down', 'LogoDown', '🙃', 'Upright but upside down.', 'Flip the controller upside down.'),
      gesture('faceup', 'Face up', 'ScreenUp', '🔆', 'Flat with LEDs toward the ceiling.', 'Place or turn the object face-up.'),
      gesture('facedown', 'Face down', 'ScreenDown', '🌙', 'Flat with LEDs toward the floor.', 'Turn the object face-down.'),
      gesture('freefall', 'Free fall', 'FreeFall', '🪂', 'Fires while dropping.', 'Toss it safely or drop it onto a cushion.'),
      gesture('g3', 'Small bump', 'ThreeG', '💥', 'A light 3g jolt.', 'Tap or gently knock the object.'),
      gesture('g6', 'Hard hit', 'SixG', '💥', 'A firm 6g jolt.', 'Use a deliberate hit as a power move.'),
      gesture('g8', 'Big slam', 'EightG', '💥', 'A large 8g impact.', 'Use only for a safely padded slam.'),
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    description: 'Turn light, warmth, or sound into a continuous control.',
    inputs: [
      {
        id: 'light', emoji: '💡', name: 'Light', description: 'Light level from 0–255.',
        kind: 'number', channels: ['light'], loop: numeric('light', 'input.lightLevel()'),
        build: 'Cover the LEDs with your hand or shine a flashlight on them.',
      },
      {
        id: 'temp', emoji: '🌡️', name: 'Temperature', description: 'Chip temperature in °C.',
        kind: 'number', channels: ['temp'], loop: numeric('temp', 'input.temperature()'),
        build: 'Warm the processor with your fingers for a slow-changing control.',
      },
      {
        id: 'mic', emoji: '🎤', name: 'Sound', description: 'Microphone level from 0–255.',
        kind: 'number', channels: ['mic'], loop: numeric('mic', 'input.soundLevel()'),
        build: 'Clap, sing, blow, or shout near the microphone.',
      },
    ],
  },
];

export const CONTROLLER_INPUTS = INPUT_SECTIONS.flatMap((section) => section.inputs);

export const DEFAULT_BUILDER_STATE: BuilderState = {
  selected: new Set(),
  pinModes: { p0: 'touch', p1: 'touch', p2: 'touch' },
};

export function inputVariant(input: ControllerInput, pinModes: Record<string, string>): InputVariant {
  if (input.modes) return input.modes[pinModes[input.id] ?? Object.keys(input.modes)[0]];
  return {
    kind: input.kind ?? 'binary',
    channels: input.channels ?? [],
    loop: input.loop,
    handlers: input.handlers,
    build: input.build ?? '',
  };
}

export function generateControllerCode(state: BuilderState): string {
  const handlers: string[] = [];
  const loop: string[] = [];
  CONTROLLER_INPUTS.forEach((input) => {
    if (!state.selected.has(input.id)) return;
    const variant = inputVariant(input, state.pinModes);
    if (variant.handlers) handlers.push(...variant.handlers);
    if (variant.loop) loop.push(...variant.loop);
  });
  return [
    ...SCAFFOLD,
    ...handlers,
    'basic.forever(function () {',
    '    if (connected) {',
    '        basic.showIcon(IconNames.Yes)',
    ...loop.map((line) => `        ${line}`),
    '    } else {',
    '        basic.showString(control.deviceName())',
    '    }',
    '    basic.pause(100)',
    '})',
  ].join('\n');
}

export function selectedChannels(state: BuilderState): ChannelDescriptor[] {
  return CONTROLLER_INPUTS.flatMap((input) => {
    if (!state.selected.has(input.id)) return [];
    const variant = inputVariant(input, state.pinModes);
    return variant.channels.map((channel) => ({ channel, kind: variant.kind }));
  });
}

export function streamingLineCount(state: BuilderState): number {
  return CONTROLLER_INPUTS.reduce((count, input) => {
    if (!state.selected.has(input.id)) return count;
    const variant = inputVariant(input, state.pinModes);
    return count + (variant.loop ? variant.channels.length : 0);
  }, 0);
}
