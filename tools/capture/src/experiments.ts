/** The controlled experiment plan (docs/reverse-engineering/capture-methodology.md). One change each. */
export const EXPERIMENTS = [
  [
    '01-device-info',
    'Connect; let the official tool read whatever it reads at start-up; change nothing',
  ],
  ['02-rgb-off-on', 'Lighting effect: off, then static'],
  ['03-rgb-red-blue', 'Static effect: colour red, then blue'],
  ['04-rgb-brightness', 'Static red: brightness 0 → max one step at a time'],
  ['05-rgb-speed', 'Breath: speed 0 → max one step at a time'],
  ['06-key-a-b', 'Base layer: remap A → B'],
  ['07-key-a-c', 'Base layer: remap A → C'],
  ['08-fn-layer', 'Fn layer: remap Fn+F1 → Mute'],
  ['09-macro-create', 'Create macro 1 = A down, 20 ms, A up; assign to F12'],
  ['10-macro-delete', 'Delete macro 1'],
  ['11-tft-red-image', 'Upload a solid red 128×128 image'],
  ['12-tft-blue-image', 'Upload a solid blue 128×128 image'],
  ['13-tft-checkerboard', 'Upload an 8-pixel black/white checkerboard'],
  ['14-tft-two-frame-gif', 'Upload a 2-frame red/blue GIF, 500 ms per frame'],
  ['15-tft-clock', 'Time sync'],
  ['16-tft-battery', 'Switch the screen to battery view (if the tool offers it)'],
  ['17-tft-brightness', 'Change screen brightness (if the tool offers it)'],
  ['18-sleep-time', 'Sleep time: never → 1 min'],
  ['19-knob', 'Change any knob setting (if the tool offers it)'],
  ['20-game-mode', 'Toggle game mode / Win-key lock'],
  ['21-polling-rate', 'Change polling rate (if the tool offers it)'],
] as const;

export interface ExperimentRecord {
  experiment: string;
  description: string;
  timestamp: string;
  device: { vendorId: string; productId: string; product?: string; bcdDevice?: string };
  host: { os: string; tool: string };
  beforeState: string;
  afterState: string;
  observedEffect: string;
  packets: {
    t: number;
    direction: 'host->device' | 'device->host';
    kind: 'feature-set' | 'feature-get' | 'output' | 'input' | 'control';
    interface?: number;
    endpoint?: string;
    reportId: number;
    hex: string;
    decoded?: string;
  }[];
}
