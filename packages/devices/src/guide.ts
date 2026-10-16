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

/**
 * One hardware revision of a model. Vendors ship one model name on several controllers (the AK820
 * exists on Sonix, YiChip, SinoWealth and CRS chips), so support is stated per revision, and the
 * keyboard's own answers decide which one is connected.
 * - verified: OpenKey owner-tested on this revision.
 * - community: an adapter built from public sources configures it; not tested by OpenKey.
 * - read-only: OpenKey identifies it and reads settings; writes are not safe to send yet.
 * - research: the identity is known, the configuration protocol is not.
 * - none: nothing to configure on this revision or link.
 */
export type RevisionStatus = 'verified' | 'community' | 'read-only' | 'research' | 'none';

export interface ModelRevision {
  /** How the revision is called: "wired, screen", "magnetic (HE)", "BY edition". */
  name: string;
  /** Controller maker as public evidence shows it (Sonix, YiChip, SinoWealth, CRS, QMK firmware…). */
  chip: string;
  /** OpenKey adapter id, or null when none applies. */
  adapter: string | null;
  /** USB identities as VVVV:PPPP, when known. */
  ids: string[];
  status: RevisionStatus;
  /** How to tell this revision apart without tools (box, vendor app, product string). */
  tell?: string;
}

/** An open-source project about the model; used for facts only, never copied. */
export interface GuideSource {
  /** GitHub owner/name. */
  repo: string;
  /** SPDX licence as GitHub reports it; null when the repository declares none. */
  license: string | null;
  /** What it documents or does, in a few words. */
  covers: string;
}

export interface GuideEntry {
  brand: string;
  model: string;
  group: 'bangladesh' | 'asia' | 'via' | 'gaming' | 'enthusiast';
  level: GuideLevel;
  /** OpenKey adapters that can take it, by id. */
  adapters: string[];
  /** What works, or what to do instead. One or two sentences. */
  note: string;
  /** Known hardware revisions, when the model ships on more than one controller or link. */
  revisions?: ModelRevision[];
  /** Community projects found for the model (research inventory). */
  sources?: GuideSource[];
}

const VIA_NOTE =
  'QMK/VIA firmware: keymaps on every layer, macros and lighting through the VIA adapter. Load the VIA definition once.';
const VENDOR = (sw: string) =>
  `Closed, model-specific protocol (${sw}) with no public documentation; OpenKey does not send guessed commands. Typing works everywhere; use the tester, or inspect and report it.`;

const SRC_AKS068: GuideSource[] = [
  {
    repo: 'xero/aks068-via',
    license: 'CC0-1.0',
    covers: 'VIA definitions, wired and tri-mode/Pro',
  },
  {
    repo: 'artsyfriedchicken/aks068-pro-config',
    license: 'GPL-3.0',
    covers: 'AKS068 Pro configuration',
  },
];
const SRC_AK680: GuideSource[] = [
  {
    repo: 'somenever/not-ajazz-ak680-max-webhid',
    license: 'GPL-3.0',
    covers: 'AK680 MAX WebHID utility',
  },
  { repo: '10ishk/ak680-studio', license: 'Apache-2.0', covers: 'AK680 V2 profile inspector' },
  { repo: 'shorekeeper/ajazzdesktopify', license: null, covers: 'AK680 MAX magnetic, Windows' },
];
const SRC_AK992: GuideSource[] = [
  { repo: 'J0hnBloodborne/rea-jazz', license: 'MIT', covers: 'AK992 lighting and visualiser' },
];
const SRC_AK870: GuideSource[] = [
  { repo: 'dedikisme/node-ajazz-ak870max', license: null, covers: 'AK870 MAX Node tool' },
];
const SRC_AK35: GuideSource[] = [
  {
    repo: 'dantje/ajazz-ak35i-v3-max',
    license: 'NOASSERTION',
    covers: 'AK35i V3 MAX command line',
  },
  { repo: 'Ike-li/ak35i-v3-max-macos-control-center', license: 'MIT', covers: 'clock sync' },
  { repo: 'KyleBoyer/TFTTimeSync-node', license: null, covers: 'screen clock sync' },
];
const SRC_AK33: GuideSource[] = [
  {
    repo: 'thanks4opensource/NotLinuxAjazzAK33RGB',
    license: 'GPL-3.0',
    covers: 'AK33 RGB utility',
  },
];
const SRC_F87: GuideSource[] = [
  { repo: 'marcoslor/Aula-F87-Controller', license: null, covers: 'F87 CLI and web app' },
  { repo: 'vndarkblue/aula-keybind', license: 'MIT', covers: 'Fn-layer remap' },
  { repo: 'Dylan-1107/aula-f87s-hid', license: 'MIT', covers: 'F87S 8K lighting, wired and 2.4G' },
];
const SRC_F108: GuideSource[] = [
  { repo: 'parsiya/f108-pro', license: 'MIT', covers: 'F108 Pro Go utility' },
  {
    repo: 'AuRoN89/AULA-F108-PRO-Reverse-Engineering',
    license: 'NOASSERTION',
    covers: 'F108 Pro protocol',
  },
  { repo: 'kidush/omarchy-aula-f108pro', license: 'MIT', covers: 'F108 Pro over 2.4 GHz' },
  { repo: 'Punkster81/AULA-F108-Driver', license: 'MIT', covers: 'F108 driver' },
];
const SRC_F65: GuideSource[] = [
  {
    repo: 'goyamamoto/F65-CustomFirmware',
    license: 'GPL-2.0',
    covers: 'F65 V1 open firmware (SH68F90)',
  },
  { repo: 'miracle1301/aula-f65', license: null, covers: 'F65 tool' },
];
const SRC_L99: GuideSource[] = [
  { repo: 'Salamor/aula-l99-open-widgets', license: null, covers: 'L99 touchscreen protocol' },
];
const SRC_R65: GuideSource[] = [
  { repo: 'iamdanielv/kb_rk_r65', license: 'GPL-3.0', covers: 'QMK firmware' },
  { repo: 'irfanjmdn/r65', license: null, covers: 'R65 wired files' },
  { repo: 'jmkl/rk65', license: null, covers: 'R65 wired VIA firmware' },
];
const SRC_M87: GuideSource[] = [
  { repo: 'ElXreno/rk-m87-sync', license: 'MIT', covers: 'M87 screen clock and volume sync' },
];

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
    revisions: [
      {
        name: 'Pro (screen), wired',
        chip: 'Sonix',
        adapter: 'sonix-feature',
        ids: ['0C45:8009', '0C45:800A'],
        status: 'community',
        tell: 'USB product string "AK820"; AJAZZ driver with the TFT page',
      },
      {
        name: 'MAX HE (magnetic)',
        chip: 'Sonix',
        adapter: 'sonix-aa55',
        ids: ['0C45:80B1'],
        status: 'community',
      },
      {
        name: 'Max Plus (CRS)',
        chip: 'CRS',
        adapter: 'crs-aa55cc33',
        ids: ['1A2C:8FFF', '1A2C:A036'],
        status: 'community',
      },
      {
        name: 'wired single-colour',
        chip: 'CRS',
        adapter: null,
        ids: ['1A2C:9605'],
        status: 'research',
      },
      {
        name: '2.4 GHz receiver',
        chip: 'Sonix',
        adapter: 'sonix-dongle',
        ids: ['0C45:FDFD', '05AC:024F'],
        status: 'research',
        tell: 'Use the USB cable for configuration',
      },
      { name: 'Bluetooth', chip: 'Sonix', adapter: null, ids: ['0C45:FEFE'], status: 'none' },
    ],
    sources: [
      { repo: 'fpb/ajazz-ak820-pro', license: 'GPL-2.0', covers: 'QMK port for the Pro' },
      {
        repo: 'TaxMachine/ajazz-keyboard-software-linux',
        license: null,
        covers: 'Pro: lighting, screen',
      },
      {
        repo: 'gohv/EPOMAKER-Ajazz-AK820-Pro',
        license: null,
        covers: 'Pro: lighting, sleep, clock',
      },
      {
        repo: 'Beattrey/ajazz-ak820-config',
        license: 'MIT',
        covers: 'Pro: clock and screen upload (WebHID)',
      },
      { repo: 'wsclx/ak820pro-modder', license: 'MIT', covers: 'Pro: macOS control' },
      {
        repo: 'MemerGamer/AjazzAk820ProUnofficialWebdriver',
        license: 'MIT',
        covers: 'Pro: web driver',
      },
      { repo: 'kabelklaus/ajazz-ak820-pro', license: 'MIT', covers: 'Pro: screen framing' },
      { repo: 'gusleig/ajazz-ak820-pro-mac', license: 'MIT', covers: 'Pro: clock, RGB, sleep' },
      {
        repo: 'afonsusousa/mrworldwide-rs',
        license: null,
        covers: 'Pro: Linux tool, receiver FF60',
      },
    ],
  },
  {
    brand: 'AJAZZ',
    model: 'AK820 MAX Plus',
    group: 'bangladesh',
    level: 'verified',
    adapters: ['sonix-feature', 'royuan', 'crs-aa55cc33', 'by-tech'],
    note: 'Sonix revision (0C45:8009): everything verified on hardware over USB. Magnetic YiChip revision: lighting and key maps (ROYUAN). CRS and "BY edition" revisions: community adapters.',
    revisions: [
      {
        name: 'Sonix, wired (screen)',
        chip: 'Sonix',
        adapter: 'sonix-feature',
        ids: ['0C45:8009'],
        status: 'verified',
        tell: 'USB product string "AK820 MAX"',
      },
      {
        name: 'Sonix, other PID',
        chip: 'Sonix',
        adapter: 'sonix-feature',
        ids: ['0C45:800A'],
        status: 'community',
      },
      {
        name: 'magnetic tri-mode screen',
        chip: 'YiChip',
        adapter: 'royuan',
        ids: ['3151:4015'],
        status: 'community',
        tell: 'Driver "AK820 MAX magnetic screen"',
      },
      {
        name: 'magnetic, receiver',
        chip: 'YiChip',
        adapter: 'royuan',
        ids: ['3151:4011'],
        status: 'research',
      },
      {
        name: 'BY edition, wired',
        chip: 'SinoWealth',
        adapter: 'by-tech',
        ids: ['258A:010C'],
        status: 'community',
        tell: 'BY Tech driver',
      },
      {
        name: 'BY edition, receiver',
        chip: 'SinoWealth',
        adapter: 'aula-receiver',
        ids: ['3554:FA09'],
        status: 'read-only',
      },
      {
        name: 'CRS',
        chip: 'CRS',
        adapter: 'crs-aa55cc33',
        ids: ['1A2C:8FFF', '1A2C:A036'],
        status: 'community',
      },
    ],
    sources: [
      {
        repo: 'uzuw/ajazz-ak820-max-software-for-linux',
        license: 'MIT',
        covers: 'MAX: Linux configurator',
      },
      {
        repo: 'arafatamim/OpenRGBAK820Plugin',
        license: 'GPL-2.0',
        covers: 'MAX Plus: per-key RGB (OpenRGB)',
      },
      { repo: 'NotAProton/ak820-go-drivers', license: 'MIT', covers: 'MAX Plus: per-key RGB' },
      {
        repo: 'swoop0147/just-another-ajazz-jailbreak',
        license: 'Unlicense',
        covers: 'MAX firmware study',
      },
      { repo: 'armoredvortex/ajazz-ak820-max-plus', license: null, covers: 'MAX Plus tool' },
    ],
  },
  {
    brand: 'Royal Kludge',
    model: 'RK61',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['rk-classic'],
    note: 'RK61, RK61 RGB, RK61 Plus, ISO and Bluetooth dual-mode models: lighting effect, colour, brightness, speed and sleep over USB (classic RK protocol). Key maps not yet.',
    sources: [
      { repo: 'oddlyspaced/rkcu', license: null, covers: 'RK61 USB configuration' },
      {
        repo: 'rnayabed/rangoli',
        license: 'GPL-3.0',
        covers: 'classic RK protocol and model list',
      },
    ],
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
    note: 'RK87, RK87 RGB, RK87T, RK87 (882) and the wired R87: lighting and sleep (classic RK protocol). R87 Pro: sources disagree (VIA, or a SinoWealth protocol at 258A:019F); connect it and OpenKey tries VIA.',
    revisions: [
      {
        name: 'RK87, RGB, RK87T, 882',
        chip: 'Sonix',
        adapter: 'rk-classic',
        ids: [],
        status: 'community',
        tell: 'Classic RK software',
      },
      {
        name: 'R87 Pro',
        chip: 'QMK firmware',
        adapter: 'qmk-via',
        ids: [],
        status: 'community',
        tell: 'Works in usevia.app',
      },
    ],
    sources: [
      {
        repo: 'NoRaincheck/kludgeknight-RK87',
        license: 'GPL-3.0',
        covers: 'RK87 browser software',
      },
      {
        repo: 'myxk1792/openrgb-rk-r87pro',
        license: 'GPL-2.0',
        covers: 'R87 Pro per-key RGB (258A:019F)',
      },
    ],
  },
  {
    brand: 'Royal Kludge',
    model: 'R75',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech'],
    note: 'R75 RGB wired (258A:015E): BY Tech protocol; teach OpenKey its lighting layout with two key presses, then lighting is configurable. Newer R75 revisions using RK’s web software are not supported yet.',
    revisions: [
      {
        name: 'RGB wired',
        chip: 'SinoWealth',
        adapter: 'by-tech',
        ids: ['258A:015E'],
        status: 'community',
        tell: 'USB product string "BY Tech Gaming Keyboard"',
      },
      {
        name: 'web-software revision',
        chip: 'unknown',
        adapter: null,
        ids: [],
        status: 'research',
        tell: 'Configured at RK’s web driver site',
      },
    ],
    sources: [
      {
        repo: 'snakkarike/Royal-Kludge-R75',
        license: 'GPL-3.0',
        covers: 'QMK firmware, wired ANSI',
      },
      { repo: 'iamdanielv/kb_rk_r75', license: 'GPL-3.0', covers: 'QMK firmware' },
      { repo: 'howozz/kblight', license: null, covers: 'R75 lighting (342D:E484)' },
      {
        repo: 'samuelcomeau6/signalrgb-rk-r75-pro-via',
        license: null,
        covers: 'R75 Pro VIA over 2.4 GHz',
      },
    ],
  },
  {
    brand: 'AULA',
    model: 'F75',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'sonix-feature'],
    note: 'Wired F75 (258A:010C): lighting effect, colour, brightness, speed and sleep (BY Tech). The F75 Max uses AJAZZ’s Sonix protocol. Settings through the 2.4 GHz receiver: no.',
    revisions: [
      {
        name: 'wired',
        chip: 'SinoWealth',
        adapter: 'by-tech',
        ids: ['258A:010C'],
        status: 'community',
        tell: 'Model code …00 CD',
      },
      {
        name: '2.4 GHz receiver',
        chip: 'SinoWealth',
        adapter: 'aula-receiver',
        ids: ['3554:FA09'],
        status: 'read-only',
      },
      {
        name: 'F75 Max',
        chip: 'Sonix',
        adapter: 'sonix-feature',
        ids: [],
        status: 'research',
        tell: 'AJAZZ-style driver with a screen page',
      },
    ],
    sources: [
      {
        repo: 'leisiji/AulaSofwareLinux',
        license: 'MIT',
        covers: 'BY Tech protocol and model codes',
      },
      { repo: 'not-ayan/openaula', license: null, covers: 'F75 web app' },
      { repo: 'Le-Maxime/Aula-F75-Web-Driver', license: null, covers: 'F75 web driver' },
      { repo: 'cloudglides/aula-f75-linux-drivers', license: null, covers: 'F75 WebHID app' },
      { repo: 'RustamSheoran/aula-f75', license: null, covers: 'F75 RGB, remap, sleep' },
      { repo: 'cvsqwe/OpenAula', license: null, covers: 'F75 browser tool' },
      { repo: 'SibteProf/keylux', license: 'Apache-2.0', covers: 'F75 per-key RGB' },
      {
        repo: 'trenbolone1122/aula-f75-linux',
        license: null,
        covers: 'F75 per-key RGB, remap, macros',
      },
      { repo: 'VitalyArt/Aula-F75-Max-Driver', license: 'MIT', covers: 'F75 Max (Sonix)' },
    ],
  },
  {
    brand: 'AULA',
    model: 'F99',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'aula-receiver'],
    note: 'Cable (258A:010C, model code …00 A4): lighting effect, colour, brightness, speed and sleep. Receiver (3554:FA09): identification, battery and lighting read-only.',
    revisions: [
      {
        name: 'wired',
        chip: 'SinoWealth',
        adapter: 'by-tech',
        ids: ['258A:010C'],
        status: 'community',
        tell: 'Model code …00 A4',
      },
      {
        name: '2.4 GHz receiver',
        chip: 'SinoWealth',
        adapter: 'aula-receiver',
        ids: ['3554:FA09'],
        status: 'read-only',
      },
    ],
    sources: [
      { repo: 'pradyumnac/aula-f99-controller', license: 'MIT', covers: 'F99 vendor HID protocol' },
      { repo: 'scottmudge/aula-f99-tool', license: 'MIT', covers: 'F99 configuration tool' },
      { repo: 'dnviti/aula-x99-pro-driver-linux', license: null, covers: 'F99 Pro receiver reads' },
    ],
  },
  {
    brand: 'AULA',
    model: 'F99 Pro',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech', 'aula-receiver'],
    note: 'Cable (258A:010C, model code …01 58): lighting and sleep. Receiver: identification, battery and lighting read-only. Key maps not yet: sources disagree on the table framing.',
    sources: [
      {
        repo: 'witchbladeq/AULA-F99-PRO-OpenRGB',
        license: 'MIT',
        covers: 'F99 Pro OpenRGB bridge',
      },
    ],
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
    sources: [
      { repo: 'Ahorts/aula-f87pro', license: 'MIT', covers: 'F87 Pro RGB commands' },
      {
        repo: 'meursault03/aula-f87pro-linux',
        license: 'MIT',
        covers: 'F87 Pro RGB, remap, profiles',
      },
      { repo: 'HowardJoness/aula-f87pro-rgb', license: 'MIT', covers: 'F87 Pro RGB protocol' },
      { repo: 'vndarkblue/aula-keybind', license: 'MIT', covers: 'F87/F75 Fn-layer remap' },
      { repo: 'kmohammedsu/F87-Studio-macOS', license: null, covers: 'F87 2.4 GHz RGB' },
    ],
  },

  // Asia / custom keyboard market
  {
    brand: 'Keychron',
    model: 'K2',
    group: 'asia',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'K2 Pro, K2 Max and K2 HE run QMK/VIA: fully configurable through VIA. The original K2 (V1–V3) firmware has no configuration interface at all.',
    revisions: [
      {
        name: 'K2 Pro / Max / HE',
        chip: 'QMK firmware',
        adapter: 'qmk-via',
        ids: [],
        status: 'community',
        tell: 'Works in usevia.app or Keychron Launcher',
      },
      {
        name: 'K2 V1–V3',
        chip: 'Sonix',
        adapter: null,
        ids: [],
        status: 'none',
        tell: 'No configuration software exists',
      },
    ],
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
    sources: [
      { repo: 'vaisajuh/viactl', license: 'MIT', covers: '5075B Plus-S over VIA' },
      { repo: 'rijojohn85/qmk_akko_5075Plus', license: null, covers: 'QMK board definition' },
      { repo: 'alejandro0619/akkontroler', license: null, covers: '5075B Plus Air lighting' },
    ],
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
  {
    brand: 'Lingbao',
    model: 'MK75',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['royuan', 'by-tech', 'qmk-via'],
    note: 'No public protocol documentation. Tri-mode boards like this usually speak ROYUAN, BY Tech or VIA, all of which OpenKey detects: connect it, and OpenKey configures it if it answers one of them; otherwise inspect it and send the diagnostic so it can be added.',
  },
  {
    brand: 'AULA',
    model: 'F75 Max',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['sonix-feature'],
    note: 'Uses AJAZZ’s Sonix protocol (0C45:800A, VitalyArt/Aula-F75-Max-Driver), unlike the plain F75. OpenKey identifies it with the AJAZZ handshake; writes stay experimental until verified.',
  },
  {
    brand: 'AULA',
    model: 'F2088',
    group: 'bangladesh',
    level: 'vendor-only',
    adapters: [],
    note: 'Older AULA generation on different silicon (not the BY Tech platform); no open protocol documentation.',
  },
  {
    brand: 'AJAZZ',
    model: 'AKS075',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['sonix-feature'],
    note: 'Public notes show it uses the AJAZZ Windows-driver framing. If OpenKey identifies the AJAZZ protocol, it is configurable (experimental).',
    sources: [
      { repo: 'aar-rafi/aks075-linux', license: 'MIT', covers: 'screen image and GIF upload' },
    ],
  },
  {
    brand: 'Royal Kludge',
    model: 'M75',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['rk-classic', 'by-tech', 'qmk-via'],
    note: 'Depends on the revision: newer RK boards use RK’s web software (not documented), some use BY Tech or VIA. Connect it to see what OpenKey detects.',
    revisions: [
      {
        name: 'classic RK software',
        chip: 'Sonix',
        adapter: 'rk-classic',
        ids: [],
        status: 'research',
      },
      { name: 'BY Tech', chip: 'SinoWealth', adapter: 'by-tech', ids: [], status: 'research' },
      {
        name: 'VIA',
        chip: 'QMK firmware',
        adapter: 'qmk-via',
        ids: [],
        status: 'research',
        tell: 'Works in usevia.app',
      },
    ],
    sources: [{ repo: 'Lightning-13/rk-m75', license: 'MIT', covers: 'M75 RGB library' }],
  },
  {
    brand: 'Fantech',
    model: 'ATOM61 / MK211, MK614, MK914',
    group: 'bangladesh',
    level: 'vendor-only',
    adapters: [],
    note: 'No open protocol documentation for these Fantech models; OpenKey does not guess. Tester and inspection work.',
  },
  {
    brand: 'Havit',
    model: 'gaming keyboards',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'No open protocol documentation; models differ. Inspect and report a specific model.',
  },
  {
    brand: 'T-WOLF',
    model: 'T20',
    group: 'gaming',
    level: 'nothing-to-configure',
    adapters: [],
    note: 'Budget keyboard without configuration software; lighting is switched on the keyboard.',
  },
  {
    brand: 'Jedel',
    model: 'KL69',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'No open protocol documentation.',
  },
  {
    brand: 'Rapoo',
    model: 'V500 Pro',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'Rapoo’s own software only; no open protocol documentation.',
  },
  {
    brand: 'Dareu',
    model: 'EK815',
    group: 'gaming',
    level: 'vendor-only',
    adapters: [],
    note: 'Dareu’s own software only; no open protocol documentation.',
  },
  {
    brand: 'Keychron',
    model: 'Q series (Q0–Q12, Q60, Q65, Q9 Plus …)',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'Keychron',
    model: 'V series (V1–V10)',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'Keychron',
    model: 'C1 / C2 / C3 Pro (incl. V2)',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'Keychron',
    model: 'S1',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'Akko',
    model: '5108, ACR87, Top40 (VIA editions)',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via', 'royuan'],
    note: 'The VIA-listed editions are configured through VIA. Other Akko boards are ROYUAN (lighting and key maps).',
  },
  {
    brand: 'MonsGeek',
    model: 'M1, M5, M6 (VIA editions)',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via', 'royuan'],
    note: 'VIA-listed editions through VIA; M1 V5 / HES and other ROYUAN boards through the ROYUAN adapter.',
  },
  {
    brand: 'Glorious',
    model: 'GMMK Pro, GMMK V2 65/96, GMMK Numpad',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'Redragon',
    model: 'K667',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA-listed. This does not apply to other Redragon models such as the K552.',
  },
  {
    brand: 'MelGeek',
    model: 'Mach80, MJ61/63/64/65, MoJo68, MOJO75, Tegic, Z70 Ultra',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'IDOBAO',
    model: 'ID42, ID61, ID63, ID67, ID75, ID80 (v3, ISO), ID87 (v2), ID96',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'KPrepublic',
    model: 'BM40, BM60, BM68, BM80, BM980, JJ40, JJ50, XD75',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  {
    brand: 'KBDfans',
    model: 'KBD67, KBD75, KBD8X families',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'VIA firmware: keymaps on every layer, macros and lighting. OpenKey downloads the layout from VIA with one click (or load the file).',
  },
  // Research inventory (owner-supplied list, October 2026): found on GitHub, protocol not in OpenKey.
  {
    brand: 'AJAZZ',
    model: 'AKS068',
    group: 'asia',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'The wired and tri-mode/Pro AKS068 speak VIA, but their layout is not in VIA’s catalogue: load the community VIA file (xero/aks068-via, CC0) once in Keymap, then keymaps and lighting work.',
    sources: SRC_AKS068,
  },
  {
    brand: 'AJAZZ',
    model: 'AK680 / AK680 MAX',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'Community tools exist for the AK680 MAX (magnetic) and AK680 V2, but their protocol is not in OpenKey yet. Connect it: OpenKey configures it if it answers a supported family; otherwise send the diagnostic.',
    sources: SRC_AK680,
  },
  {
    brand: 'AJAZZ',
    model: 'AK992',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'A community lighting controller exists (reverse-engineered); not in OpenKey yet. Connect it and send the diagnostic if it is not identified.',
    sources: SRC_AK992,
  },
  {
    brand: 'AJAZZ',
    model: 'AK870 / AK873 / AK966',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'No usable public protocol yet. AJAZZ uses several chips (Sonix, YiChip/ROYUAN, SinoWealth), so OpenKey identifies the board when it is connected; otherwise inspect it and send the diagnostic.',
    sources: SRC_AK870,
  },
  {
    brand: 'AJAZZ',
    model: 'AK35i V3 MAX',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'Community tools set its screen clock and settings; the protocol is not in OpenKey yet.',
    sources: SRC_AK35,
  },
  {
    brand: 'AJAZZ',
    model: 'AK33',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'An old community utility exists for the AK33 RGB (2019); not in OpenKey. The single-colour AK33 has nothing to configure.',
    sources: SRC_AK33,
  },
  {
    brand: 'AULA',
    model: 'F87',
    group: 'bangladesh',
    level: 'adapter',
    adapters: ['by-tech'],
    note: 'Wired F87 (258A:010C, model code …00 8F): lighting effect, colour, brightness, speed and sleep (BY Tech).',
    sources: SRC_F87,
  },
  {
    brand: 'AULA',
    model: 'F108 Pro',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'Community tools document its protocol (wired and 2.4 GHz) but it is not in OpenKey yet. The H108 is a different board (BY Tech, supported).',
    sources: SRC_F108,
  },
  {
    brand: 'AULA',
    model: 'F65',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'The F65 V1 is SinoWealth (SH68F90). Connect it: if it answers as BY Tech, OpenKey configures lighting; otherwise send the diagnostic.',
    sources: SRC_F65,
  },
  {
    brand: 'AULA',
    model: 'L99 / S75',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'The L99 touchscreen protocol has been studied by the community, not its configuration. Connect it to see what OpenKey detects.',
    sources: SRC_L99,
  },
  {
    brand: 'Royal Kludge',
    model: 'R65',
    group: 'bangladesh',
    level: 'depends',
    adapters: ['qmk-via'],
    note: 'Wired R65 boards flashed with the community QMK firmware work through VIA. Stock firmware: connect it to see what OpenKey detects.',
    sources: SRC_R65,
  },
  {
    brand: 'Royal Kludge',
    model: 'M87 / S98',
    group: 'bangladesh',
    level: 'depends',
    adapters: [],
    note: 'Screen boards configured by RK’s newer software. A community tool syncs the M87 clock; the protocol is not in OpenKey yet.',
    sources: SRC_M87,
  },
  {
    brand: 'Akko',
    model: '5075S',
    group: 'asia',
    level: 'depends',
    adapters: ['royuan', 'qmk-via'],
    note: 'Akko boards are ROYUAN or VIA depending on edition; OpenKey detects both. No 5075S-specific source yet.',
  },
  {
    brand: 'ZMK',
    model: 'Corne, Sofle, Lily58 and other ZMK boards',
    group: 'enthusiast',
    level: 'adapter',
    adapters: ['zmk-studio'],
    note: 'ZMK firmware built with Studio: keymaps on every layer over the USB cable (Web Serial, Chrome or Edge). Press the board’s Studio unlock key when asked.',
    sources: [
      { repo: 'zmkfirmware/zmk-studio-messages', license: 'MIT', covers: 'Studio RPC messages' },
      { repo: 'zmkfirmware/zmk-studio-ts-client', license: 'MIT', covers: 'serial framing' },
    ],
  },
  {
    brand: 'libhmk',
    model: 'Hall-effect boards running libhmk',
    group: 'enthusiast',
    level: 'adapter',
    adapters: ['hmk'],
    note: 'Keymaps on every layer and per-key actuation and Rapid Trigger, with the layout read from the keyboard. Calibration and advanced keys stay in hmkconf.',
    sources: [
      { repo: 'peppapighs/libhmk', license: 'GPL-3.0', covers: 'firmware commands and keycodes' },
      { repo: 'peppapighs/hmkconf', license: 'GPL-3.0', covers: 'metadata and layout' },
    ],
  },
  {
    brand: 'Vial',
    model: 'boards running Vial firmware',
    group: 'via',
    level: 'via',
    adapters: ['qmk-via'],
    note: 'The layout is read from the keyboard itself (no file), and QMK settings, tap dance, combos and key overrides are editable, besides keymaps, macros and lighting.',
    sources: [
      { repo: 'vial-kb/vial-qmk', license: 'GPL-2.0', covers: 'Vial protocol (facts only)' },
    ],
  },
];

/** Guide revisions that list this USB identity, with their model. */
export function revisionsForId(
  vendorId: number,
  productId: number,
): { entry: GuideEntry; revision: ModelRevision }[] {
  const id = `${vendorId.toString(16).toUpperCase().padStart(4, '0')}:${productId.toString(16).toUpperCase().padStart(4, '0')}`;
  return MODEL_GUIDE.flatMap((entry) =>
    (entry.revisions ?? [])
      .filter((r) => r.ids.includes(id))
      .map((revision) => ({ entry, revision })),
  );
}
