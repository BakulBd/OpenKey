/**
 * "Is my keyboard supported?" — popular models by name, with how OpenKey handles each. Unlike the
 * catalogue (exact USB identities with evidence), a model name often covers several hardware
 * revisions, so every entry says which revision works and why. Support is always decided by the
 * keyboard OpenKey detects, never by this list.
 *
 * Levels:
 * - verified: configuration verified on hardware.
 * - adapter: an OpenKey adapter configures it (experimental or community; see the adapter).
 * - via: works through the VIA adapter when the keyboard runs QMK/VIA or Vial firmware.
 * - depends: some revisions use a supported protocol, others do not.
 * - vendor-only: closed, model-specific protocol with no public documentation; OpenKey does not guess.
 * - nothing-to-configure: the keyboard has no configuration interface (settings are on the board).
 *
 * Every keyboard, supported or not, works in the Keyboard tester and Latency lab, and can be
 * inspected read-only and reported from the Device Lab.
 */
export type GuideLevel =
  'verified' | 'adapter' | 'via' | 'depends' | 'vendor-only' | 'nothing-to-configure';

export interface GuideEntry {
  brand: string;
  model: string;
  group: 'bangladesh' | 'asia' | 'gaming' | 'enthusiast';
  level: GuideLevel;
  /** OpenKey adapters that can take it, by id. */
  adapters: string[];
  /** What works, or what to do instead. One or two sentences. */
  note: string;
}

const VIA_NOTE =
  'QMK/VIA firmware: keymaps on every layer, macros and lighting through the VIA adapter. Load the VIA definition once.';
const VENDOR = (sw: string) =>
  `Closed, model-specific protocol (${sw}) with no public documentation; OpenKey does not send guessed commands. Typing works everywhere; use the tester, or inspect and report it.`;

export const MODEL_GUIDE: readonly GuideEntry[] = [
  // Bangladesh market
  {
    brand: 'Redragon',
    model: 'K552 Kumara',
    group: 'bangladesh',
    level: 'vendor-only',
    adapters: [],
    note:
      VENDOR('Redragon software') +
      ' Some newer Redragon tri-mode boards (K736 PRO) are ROYUAN and get lighting.',
  },
  {
    brand: 'Fantech',
    model: 'MAXFIT87',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['royuan'],
    note: 'Some Fantech MAXFIT boards use the ROYUAN protocol (MAXFIT81 does); if OpenKey identifies ROYUAN, lighting works. Otherwise inspection only.',
  },
  {
    brand: 'Fantech',
    model: 'ATOM MK874',
    group: 'bangladesh',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Fantech software'),
  },
  {
    brand: 'A4Tech',
    model: 'Bloody B820R',
    group: 'bangladesh',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Bloody software'),
  },
  {
    brand: 'AJAZZ',
    model: 'AK820',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['sonix-feature', 'sonix-aa55', 'crs-aa55cc33'],
    note: 'AK820 Pro (screen): keymap, lighting, macros, screen and settings (community). The wired single-colour CRS revision (1A2C:9605) is not supported yet.',
  },
  {
    brand: 'AJAZZ',
    model: 'AK820 MAX Plus',
    group: 'bangladesh',
    level: 'verified',
    adapters: ['sonix-feature', 'royuan', 'crs-aa55cc33', 'by-tech'],
    note: 'Sonix revision (0C45:8009): everything verified on hardware over USB. Magnetic YiChip revision: lighting and key maps (ROYUAN). CRS and "BY edition" revisions: community adapters.',
  },
  {
    brand: 'Royal Kludge',
    model: 'RK61',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['rk-classic'],
    note: 'RK61, RK61 RGB, RK61 Plus, ISO and Bluetooth dual-mode models: lighting effect, colour, brightness, speed and sleep over USB (classic RK protocol). Key maps not yet.',
  },
  {
    brand: 'Royal Kludge',
    model: 'RK84',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['rk-classic'],
    note: 'RK84 N, RK84 Pro N and RK84 ISO: lighting and sleep (classic RK protocol). The first RK84RGB (258A:0059) and the newest RK84 web-software models are not supported yet.',
  },
  {
    brand: 'Royal Kludge',
    model: 'RK87',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['rk-classic', 'qmk-via'],
    note: 'RK87, RK87 RGB, RK87T and RK87 (882): lighting and sleep (classic RK protocol). The R87 Pro runs QMK/VIA and works through the VIA adapter.',
  },
  {
    brand: 'Royal Kludge',
    model: 'R75',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech'],
    note: 'R75 RGB wired (258A:015E): BY Tech protocol; teach OpenKey its lighting layout with two key presses, then lighting is configurable. Newer R75 revisions using RK’s web software are not supported yet.',
  },
  {
    brand: 'AULA',
    model: 'F75',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'sonix-feature'],
    note: 'Wired F75 (258A:010C): lighting effect, colour, brightness, speed and sleep (BY Tech). The F75 Max uses AJAZZ’s Sonix protocol. Settings through the 2.4 GHz receiver: no.',
  },
  {
    brand: 'AULA',
    model: 'F99',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'aula-receiver'],
    note: 'Cable (258A:010C, model code …00 A4): lighting effect, colour, brightness, speed and sleep. Receiver (3554:FA09): identification, battery and lighting read-only.',
  },
  {
    brand: 'AULA',
    model: 'F99 Pro',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'aula-receiver'],
    note: 'Cable (258A:010C, model code …01 58): lighting and sleep. Receiver: identification, battery and lighting read-only. Key maps not yet: sources disagree on the table framing.',
  },
  {
    brand: 'AULA',
    model: 'F99 Max',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'No public source documents the F99 Max, and AULA “Max” boards can use a different chip (the F75 Max is Sonix). Not assumed compatible: inspect it and send the diagnostic.',
  },
  {
    brand: 'AULA',
    model: 'F87 Pro',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech'],
    note: 'Identified by its model code (BY Tech): lighting and sleep over USB.',
  },

  // Asia / custom keyboard market
  {
    brand: 'Keychron',
    model: 'K2',
    group: 'asia',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'K2 Pro, K2 Max and K2 HE run QMK/VIA: fully configurable through VIA. The original K2 (V1–V3) firmware has no configuration interface at all.',
  },
  {
    brand: 'Keychron',
    model: 'K8',
    group: 'asia',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'K8 Pro and K8 Max: QMK/VIA, fully configurable. The original K8 has no configuration interface.',
  },
  {
    brand: 'Keychron',
    model: 'Q1 (all versions)',
    group: 'asia',
    level: 'via',
    adapters: ['qmk-via'],
    note: VIA_NOTE,
  },
  {
    brand: 'Akko',
    model: '5075B Plus',
    group: 'asia',
    level: 'adapter',
    adapters: ['royuan'],
    note: 'ROYUAN protocol (yc500): lighting effect, colour, brightness and speed, and key maps on the base and Fn layers (each key written and read back) over USB. Macros not yet.',
  },
  {
    brand: 'MonsGeek',
    model: 'M1',
    group: 'asia',
    level: 'depends',
    adapters: ['royuan', 'qmk-via'],
    note: 'M1 V5 and M1 HES are ROYUAN (lighting). M1 boards running QMK/VIA firmware are configured through VIA.',
  },
  {
    brand: 'Leobog',
    model: 'Hi75',
    group: 'asia',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'If the firmware exposes VIA, OpenKey configures it through VIA; otherwise inspect it and report it.',
  },
  {
    brand: 'VGN',
    model: 'V87',
    group: 'asia',
    level: 'depends',
    adapters: ['royuan'],
    note: 'Several VGN boards use the ROYUAN protocol; if OpenKey identifies ROYUAN, lighting works. Otherwise inspection only.',
  },
  {
    brand: 'Dareu',
    model: 'A98',
    group: 'asia',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Dareu software'),
  },
  {
    brand: 'MCHOSE',
    model: 'G75 Pro',
    group: 'asia',
    level: 'depends',
    adapters: ['royuan'],
    note: 'Some G75 boards report the ROYUAN protocol; if identified, lighting works. Otherwise inspection only.',
  },
  {
    brand: 'Xinmeng',
    model: 'M75',
    group: 'asia',
    level: 'depends',
    adapters: ['royuan'],
    note: 'Xinmeng boards commonly use ROYUAN gen2; if identified, lighting works.',
  },
  {
    brand: 'MageGee',
    model: 'MK-Box',
    group: 'asia',
    level: 'adapter',
    adapters: ['royuan'],
    note: 'ROYUAN gen2 (3151:502C): lighting effect, colour, brightness and speed over USB; key map shown read-only.',
  },

  // Global gaming
  {
    brand: 'Wooting',
    model: '80HE',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'Configured by Wooting’s own browser app, Wootility. OpenKey shows it in the tester and latency lab; analog settings stay in Wootility.',
  },
  {
    brand: 'Wooting',
    model: '60HE',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'Configured by Wootility (browser). Tester and latency lab work in OpenKey.',
  },
  {
    brand: 'Wooting',
    model: '60HE V2',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'Configured by Wootility (browser). Tester and latency lab work in OpenKey.',
  },
  {
    brand: 'Razer',
    model: 'Huntsman V3 Pro TKL',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Razer Synapse'),
  },
  {
    brand: 'Razer',
    model: 'BlackWidow V4',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Razer Synapse'),
  },
  {
    brand: 'Logitech',
    model: 'G Pro X TKL',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Logitech G HUB'),
  },
  {
    brand: 'Logitech',
    model: 'G915',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Logitech G HUB'),
  },
  {
    brand: 'SteelSeries',
    model: 'Apex Pro TKL',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('SteelSeries GG'),
  },
  {
    brand: 'Corsair',
    model: 'K70',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Corsair iCUE'),
  },
  {
    brand: 'Corsair',
    model: 'K100',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Corsair iCUE'),
  },
  {
    brand: 'HyperX',
    model: 'Alloy Origins',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('HyperX NGENUITY'),
  },
  {
    brand: 'ASUS',
    model: 'ROG Azoth',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('Armoury Crate'),
  },

  // Global typing / enthusiast
  {
    brand: 'Ducky',
    model: 'One 3',
    group: 'enthusiast',
    level: 'vendor-only',
    adapters: [],
    note: VENDOR('DuckyHub') + ' Boards flashed with community QMK/VIA firmware work through VIA.',
  },
  {
    brand: 'Leopold',
    model: 'FC750R',
    group: 'enthusiast',
    level: 'nothing-to-configure',
    adapters: [],
    note: 'No configuration software exists: layout options are DIP switches on the board. The tester and latency lab work.',
  },
  {
    brand: 'PFU',
    model: 'HHKB Professional Hybrid',
    group: 'enthusiast',
    level: 'vendor-only',
    adapters: [],
    note: 'Key maps are written by PFU’s own keymap tool; DIP switches set the layout. The tester works in OpenKey.',
  },
  {
    brand: 'Keychron',
    model: 'V1',
    group: 'enthusiast',
    level: 'via',
    adapters: ['qmk-via'],
    note: VIA_NOTE,
  },
  {
    brand: 'NuPhy',
    model: 'Halo75',
    group: 'enthusiast',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'Halo75 V2 runs QMK/VIA: configurable through VIA. The original Halo75 uses NuPhy Console (closed).',
  },
];
