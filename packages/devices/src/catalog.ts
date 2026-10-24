/**
 * Every keyboard identity found in official software or credible public research, used to name a
 * device and to build the compatibility center. Detection never relies on this table to pick a
 * protocol; descriptors and the device's own answers do that.
 *
 * `status` is OpenKey's own verification state, never the vendor's claim:
 * - verified: reads and writes verified on hardware by OpenKey.
 * - experimental: an OpenKey adapter exists and part of it is verified on hardware.
 * - community: an adapter exists, built from official or community sources, untested by OpenKey.
 * - research: identified only; protocol research needed.
 * - unsupported: evidence shows configuration is not possible on this link.
 */
export type CatalogStatus = 'verified' | 'experimental' | 'community' | 'research' | 'unsupported';

/** Physical hardware facts (true = present; undefined = not established). */
export interface CatalogHardware {
  rgb?: boolean;
  perKeyRgb?: boolean;
  tft?: boolean;
  encoder?: boolean;
  hallEffect?: boolean;
}

export interface CatalogEntry {
  brand: string;
  vendorId: number;
  productId: number;
  /** USB product string when the PID is shared between models. */
  productName?: string;
  model: string;
  link: 'usb' | '2.4ghz' | 'bluetooth';
  mcu: string;
  family: string;
  status: CatalogStatus;
  hardware: CatalogHardware;
  /** Device definition in devices/*.json, when one exists. */
  definition?: string;
  evidence: string;
}

const AK820_TFT: CatalogHardware = { rgb: true, perKeyRgb: true, tft: true, encoder: true };

/** Razer keyboards and keypads with a standard or extended Chroma command set (OpenRGB's table). */
const RAZER: readonly [number, string, 'usb' | '2.4ghz'][] = [
  [0x0241, 'BlackWidow 2019', 'usb'],
  [0x0203, 'BlackWidow Chroma', 'usb'],
  [0x0211, 'BlackWidow Chroma Overwatch', 'usb'],
  [0x0209, 'BlackWidow Chroma Tournament Edition', 'usb'],
  [0x0221, 'BlackWidow Chroma V2', 'usb'],
  [0x0228, 'BlackWidow Elite', 'usb'],
  [0x024e, 'BlackWidow V3', 'usb'],
  [0x025a, 'BlackWidow V3 Pro (Wired)', 'usb'],
  [0x025c, 'BlackWidow V3 Pro (Wireless)', '2.4ghz'],
  [0x0a24, 'BlackWidow V3 TKL', 'usb'],
  [0x0258, 'BlackWidow V3 Mini (Wired)', 'usb'],
  [0x0271, 'BlackWidow V3 Mini (Wireless)', '2.4ghz'],
  [0x0287, 'BlackWidow V4', 'usb'],
  [0x028d, 'BlackWidow V4 Pro', 'usb'],
  [0x02b3, 'BlackWidow V4 Pro 75% (Wired)', 'usb'],
  [0x02b4, 'BlackWidow V4 Pro 75% (Wireless)', '2.4ghz'],
  [0x02a5, 'BlackWidow V4 75% (Wired)', 'usb'],
  [0x0293, 'BlackWidow V4 X', 'usb'],
  [0x02d7, 'BlackWidow V4 TKL (Wired)', 'usb'],
  [0x02d5, 'BlackWidow V4 TKL (Wireless)', '2.4ghz'],
  [0x02d4, 'BlackWidow V4 Low Profile TKL (Wired)', 'usb'],
  [0x02d2, 'BlackWidow V4 Low Profile TKL (Wireless)', '2.4ghz'],
  [0x0216, 'BlackWidow X Chroma', 'usb'],
  [0x021a, 'BlackWidow X Chroma Tournament Edition', 'usb'],
  [0x022a, 'Cynosa Chroma', 'usb'],
  [0x025e, 'Cynosa v2', 'usb'],
  [0x023f, 'Cynosa Lite', 'usb'],
  [0x021e, 'Ornata Chroma', 'usb'],
  [0x025d, 'Ornata Chroma V2', 'usb'],
  [0x028f, 'Ornata V3', 'usb'],
  [0x02a1, 'Ornata V3 rev2', 'usb'],
  [0x02a3, 'Ornata V3 TKL', 'usb'],
  [0x0294, 'Ornata V3 X', 'usb'],
  [0x02a2, 'Ornata V3 X Rev2', 'usb'],
  [0x0295, 'Deathstalker V2', 'usb'],
  [0x0298, 'DeathStalker V2 Pro TKL (Wired)', 'usb'],
  [0x0296, 'DeathStalker V2 Pro TKL (Wireless)', '2.4ghz'],
  [0x0290, 'DeathStalker V2 Pro (Wireless)', '2.4ghz'],
  [0x0292, 'DeathStalker V2 Pro (Wired)', 'usb'],
  [0x0227, 'Huntsman', 'usb'],
  [0x0226, 'Huntsman Elite', 'usb'],
  [0x0266, 'Huntsman V2 Analog', 'usb'],
  [0x0257, 'Huntsman Mini', 'usb'],
  [0x0282, 'Huntsman Mini Analog', 'usb'],
  [0x0243, 'Huntsman Tournament Edition', 'usb'],
  [0x026b, 'Huntsman V2 TKL', 'usb'],
  [0x026c, 'Huntsman V2', 'usb'],
  [0x02a6, 'Huntsman V3 Pro', 'usb'],
  [0x02a7, 'Huntsman V3 Pro TKL White', 'usb'],
  [0x02e4, 'Huntsman V3 HE Magnetic Mini', 'usb'],
  [0x0244, 'Tartarus Pro', 'usb'],
  [0x022b, 'Tartarus V2', 'usb'],
];

/** Wooting boards of the RGB SDK (base product ids; v2 boards also use base + 1 and + 2). */
const WOOTING: readonly [number, number, string][] = [
  [0x03eb, 0xff01, 'One'],
  [0x03eb, 0xff02, 'Two'],
  [0x31e3, 0x1100, 'One'],
  [0x31e3, 0x1200, 'Two'],
  [0x31e3, 0x1210, 'Two Lekker Edition'],
  [0x31e3, 0x1220, 'Two HE'],
  [0x31e3, 0x1230, 'Two HE (ARM)'],
  [0x31e3, 0x1300, '60HE'],
  [0x31e3, 0x1310, '60HE (ARM)'],
  [0x31e3, 0x1320, '60HE+'],
  [0x31e3, 0x1340, '60HE V2'],
  [0x31e3, 0x1400, '80HE'],
  [0x31e3, 0x1510, 'UwU RGB'],
];

/** USB identities OpenRGB detects as EVision keyboards. */
const EVISION: readonly [number, number][] = [
  [0x0c45, 0x5004],
  [0x0c45, 0x5104],
  [0x0c45, 0x5204],
  [0x0c45, 0x652f],
  [0x0c45, 0x7672],
  [0x0c45, 0x7698],
  [0x0c45, 0x8520],
  [0x320f, 0x5000],
  [0x320f, 0x502a],
  // 320F:505B is the AJAZZ AK820 wired RGB (its own entry below).
  [0x320f, 0x5064],
  [0x320f, 0x5078],
  [0x320f, 0x5084],
];

const STEELSERIES: readonly [number, string, 'usb' | '2.4ghz'][] = [
  [0x161c, 'Apex 5', 'usb'],
  [0x1612, 'Apex 7', 'usb'],
  [0x1618, 'Apex 7 TKL', 'usb'],
  [0x1634, 'Apex 9 TKL', 'usb'],
  [0x1620, 'Apex 9 Mini', 'usb'],
  [0x1610, 'Apex Pro', 'usb'],
  [0x1614, 'Apex Pro TKL', 'usb'],
  [0x1628, 'Apex Pro TKL (2023)', 'usb'],
  [0x1630, 'Apex Pro TKL (2023) wireless', '2.4ghz'],
  [0x1632, 'Apex Pro TKL (2023) wireless', '2.4ghz'],
  [0x1642, 'Apex Pro TKL Gen 3', 'usb'],
  [0x1644, 'Apex Pro TKL Gen 3 wireless', '2.4ghz'],
  [0x1646, 'Apex Pro TKL Gen 3 wireless', '2.4ghz'],
  [0x1640, 'Apex Pro 3', 'usb'],
];

/** Logitech keyboards with HID++ per-key lighting (OpenRGB / Solaar). */
const LOGITECH: readonly [number, string, 'usb' | '2.4ghz'][] = [
  [0xc33e, 'G915 (cable)', 'usb'],
  [0xc541, 'G915 Lightspeed receiver', '2.4ghz'],
  [0xc343, 'G915 TKL (cable)', 'usb'],
  [0xc545, 'G915 TKL Lightspeed receiver', '2.4ghz'],
  [0xc547, 'G915 / G915 TKL Lightspeed receiver', '2.4ghz'],
  [0xc33f, 'G815', 'usb'],
];

export const CATALOG: readonly CatalogEntry[] = [
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x8009,
    productName: 'AK820 MAX',
    model: 'AK820 MAX / MAX PLUS (TFT)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-feature',
    status: 'verified',
    hardware: AK820_TFT,
    definition: 'ak820-max-plus',
    evidence:
      'Official driver V1.0.0.5; detection, reads and all configuration writes except live preview verified on hardware (fw 1.07, USB)',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x800a,
    productName: 'AK820 MAX',
    model: 'AK820 MAX / MAX PLUS (TFT)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-feature',
    status: 'community',
    hardware: AK820_TFT,
    definition: 'ak820-max-plus',
    evidence: 'Official driver V1.0.0.5 config.xml; PID not seen on hardware',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x8009,
    productName: 'AK820',
    model: 'AK820 Pro (TFT)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-feature or sonix-aa55',
    status: 'community',
    hardware: AK820_TFT,
    definition: 'ak820-pro',
    evidence:
      'Official AK820 PRO driver V1.0.0.5; online driver config 3141-32777-AK820; two firmware generations',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x800a,
    productName: 'AK820',
    model: 'AK820 Pro (TFT)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-feature',
    status: 'community',
    hardware: AK820_TFT,
    definition: 'ak820-pro',
    evidence: 'Official AK820 PRO driver V1.0.0.5',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0xfdfd,
    model: 'AK820 Pro / MAX 2.4 GHz receiver',
    link: '2.4ghz',
    mcu: 'Sonix',
    family: 'sonix-dongle',
    status: 'research',
    hardware: {},
    definition: 'ak820-dongle',
    evidence: 'Official driver config.xml; afonsusousa/mrworldwide',
  },
  // 05AC:024F (Apple's vendor ID) is a generic 2.4 GHz receiver identity used by several brands,
  // so the product string tells the receivers apart and an unknown string names no model.
  {
    brand: 'AJAZZ',
    vendorId: 0x05ac,
    productId: 0x024f,
    productName: 'AJAZZ AK820 MAX 2.4G',
    model: 'AK820 MAX 2.4 GHz receiver',
    link: '2.4ghz',
    mcu: 'Sonix',
    family: 'sonix-dongle',
    status: 'research',
    hardware: {},
    definition: 'ak820-dongle',
    evidence: 'Official AK820 MAX driver config.xml; product string seen on hardware (Linux)',
  },
  {
    brand: 'AULA',
    vendorId: 0x05ac,
    productId: 0x024f,
    productName: 'AULA-NOVA75-2',
    model: 'NOVA75 2.4 GHz receiver',
    link: '2.4ghz',
    mcu: 'Sonix',
    family: 'sonix-dongle',
    status: 'experimental',
    hardware: { rgb: true },
    definition: 'aula-nova75',
    evidence:
      'Official AULA NOVA75 driver Beta 1.0.0.2 config.xml lists 05AC:024F (MI_03) for 2.4 GHz, and rgb-keyboard.xml enables lighting without the screen there; packets from the official AK820 driver and VitalyArt/Aula-F75-Max-Driver (MIT). A user report from macOS showed no vendor endpoint, which macOS can hide from the browser',
  },
  {
    brand: 'Generic',
    vendorId: 0x05ac,
    productId: 0x024f,
    model: '2.4 GHz receiver (identity shared by several brands)',
    link: '2.4ghz',
    mcu: 'unknown',
    family: 'unknown',
    status: 'research',
    hardware: {},
    evidence:
      'Used by AJAZZ and AULA receivers among others; the product string decides which receiver it is',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0xfefe,
    model: 'AK820 Pro / MAX (Bluetooth)',
    link: 'bluetooth',
    mcu: 'Sonix + CH582F',
    family: 'none',
    status: 'unsupported',
    hardware: AK820_TFT,
    evidence: 'Official driver: settings not supported over Bluetooth',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x80b1,
    model: 'AK820 MAX HE (magnetic)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-aa55',
    status: 'community',
    hardware: { rgb: true, hallEffect: true },
    evidence: 'Online driver config; baloghd/ak820max-rgb',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x258a,
    productId: 0x010c,
    model: 'AK820 MAX PLUS "BY edition" (SinoWealth)',
    link: 'usb',
    mcu: 'BY Tech (SinoWealth)',
    family: 'by-tech',
    status: 'community',
    hardware: { rgb: true },
    evidence: 'Official driver "AK820 MAX PLUS BY version V2.0" Dev/kb/*/KB.ini',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x3554,
    productId: 0xfa09,
    model: 'AK820 MAX PLUS "BY edition" receiver (SinoWealth)',
    link: '2.4ghz',
    mcu: 'BY Tech (SinoWealth)',
    family: 'aula-receiver',
    status: 'community',
    hardware: {},
    evidence: 'Official driver "AK820 MAX PLUS BY version V2.0"',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x3151,
    productId: 0x4011,
    model: 'AK820 MAX magnetic tri-mode screen (YiChip) receiver',
    link: '2.4ghz',
    mcu: 'YiChip YC3121',
    family: 'royuan',
    status: 'research',
    hardware: {},
    evidence:
      'Official driver "AK820 MAX magnetic screen V2.1.77" device table; ROYUAN family per Sharkfin',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x3151,
    productId: 0x4015,
    model: 'AK820 MAX magnetic tri-mode screen (YiChip)',
    link: 'usb',
    mcu: 'YiChip YC3121',
    family: 'royuan',
    status: 'community',
    hardware: { rgb: true, tft: true, hallEffect: true },
    evidence:
      'Official driver "AK820 MAX magnetic screen V2.1.77" device table; ROYUAN family per Sharkfin',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x1a2c,
    productId: 0x9605,
    model: 'AK820 wired single-colour',
    link: 'usb',
    mcu: 'CRS',
    family: 'crs',
    status: 'research',
    hardware: {},
    evidence: 'Official driver "AK820 wired white/blue light V1.0" config.xml',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x1a2c,
    productId: 0x8fff,
    model: 'AK820 Max Plus (CRS)',
    link: 'usb',
    mcu: 'CRS',
    family: 'crs-aa55cc33',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    definition: 'ak820-max-crs',
    evidence: 'armoredvortex/ajazz-ak820-max-plus',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0x1a2c,
    productId: 0xa036,
    model: 'AK820 Max Plus (CRS)',
    link: '2.4ghz',
    mcu: 'CRS',
    family: 'crs-aa55cc33',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    definition: 'ak820-max-crs',
    evidence: 'arafatamim/OpenRGBAK820Plugin',
  },
  {
    brand: 'AULA',
    vendorId: 0x258a,
    productId: 0x010c,
    model: 'F75 / F87 / F99 / H108 (wired; the model code tells them apart)',
    link: 'usb',
    mcu: 'BY Tech (SinoWealth)',
    family: 'by-tech',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence:
      'leisiji/AulaSofwareLinux (MIT, verified on an F75); cloudglides/aula-f75-linux-drivers; shares VID:PID with the AJAZZ "BY edition"',
  },
  {
    brand: 'RK',
    vendorId: 0x258a,
    productId: 0x015e,
    model: 'R75 RGB (wired)',
    link: 'usb',
    mcu: 'BY Tech (SinoWealth)',
    family: 'by-tech',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, encoder: true },
    evidence:
      'RK driver configuration Dev/015E/KB.ini ("R75RGB wired", Psd, Fw=1, key table, LedOpt); report descriptor with the BY Tech command report (6 × 519 B), seen on the owner’s keyboard',
  },
  {
    brand: 'AULA',
    vendorId: 0x3554,
    productId: 0xfa09,
    model: 'F75 / F87 / F99 2.4 GHz receiver (read-only)',
    link: '2.4ghz',
    mcu: 'BY Tech (SinoWealth)',
    family: 'aula-receiver',
    status: 'community',
    hardware: {},
    evidence:
      'cloudglides/aula-f75-linux-drivers; shares VID:PID with the AJAZZ "BY edition" receiver',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0xa8a4,
    productId: 0x2255,
    model: 'AJ139 V2 MC mouse (cable)',
    link: 'usb',
    mcu: 'YJX',
    family: 'yjx-mouse',
    status: 'community',
    hardware: {},
    evidence:
      'Ripariav/Ajazz-AJ139V2MC-Linux-Driver (MIT): protocol captured from the vendor web configurator',
  },
  {
    brand: 'AJAZZ',
    vendorId: 0xa8a5,
    productId: 0x2255,
    model: 'AJ139 V2 MC mouse (2.4 GHz receiver)',
    link: '2.4ghz',
    mcu: 'YJX',
    family: 'yjx-mouse',
    status: 'community',
    hardware: {},
    evidence:
      'Ripariav/Ajazz-AJ139V2MC-Linux-Driver (MIT): same protocol, separate settings from the cable',
  },
  // ---- AJAZZ AJ179 mouse (Rockeyxx/aj179-linux, MIT)
  {
    brand: 'AJAZZ',
    vendorId: 0x249a,
    productId: 0x5c2f,
    model: 'AJ179 mouse (2.4 GHz receiver)',
    link: '2.4ghz',
    mcu: 'AJAZZ Driver (X), type 105',
    family: 'aj179-mouse',
    status: 'community',
    hardware: { rgb: true },
    evidence: 'Rockeyxx/aj179-linux (MIT): vendor driver decompiled, settings checked on the mouse',
  },
  ...[0x5c2e, 0x5d2e, 0x5e2e].map((productId): CatalogEntry => ({
    brand: 'AJAZZ',
    vendorId: 0x248a,
    productId,
    model: 'AJ179 mouse (cable)',
    link: 'usb',
    mcu: 'AJAZZ Driver (X), type 105',
    family: 'aj179-mouse',
    status: 'community',
    hardware: { rgb: true },
    evidence: 'Rockeyxx/aj179-linux (MIT): vendor config.xml; same protocol as the receiver',
  })),
  // ---- AJAZZ AK992 (J0hnBloodborne/rea-jazz, MIT)
  {
    brand: 'AJAZZ',
    vendorId: 0x1a2c,
    productId: 0x9c00,
    model: 'AK992 (wired, single colour)',
    link: 'usb',
    mcu: 'SEMICO (Holtek-style 8-bit)',
    family: 'semico-lighting',
    status: 'community',
    hardware: { rgb: false },
    evidence:
      'J0hnBloodborne/rea-jazz (MIT): vendor app and firmware parser traced, lighting tested on the keyboard',
  },
  // ---- AULA F87S 8K and AJAZZ AK680 (web-driver protocol)
  {
    brand: 'AULA',
    vendorId: 0x38a6,
    productId: 0x2908,
    model: 'F87S 8K',
    link: 'usb',
    mcu: 'AULA web-driver firmware',
    family: 'hub-aa55',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, encoder: true },
    evidence:
      'Dylan-1107/aula-f87s-hid (MIT): protocol and 87-key LED map verified on the keyboard',
  },
  {
    brand: 'AULA',
    vendorId: 0x0c45,
    productId: 0xfef9,
    model: 'F87S 8K 2.4 GHz receiver',
    link: '2.4ghz',
    mcu: 'AULA web-driver firmware',
    family: 'hub-aa55',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'Dylan-1107/aula-f87s-hid (MIT): same commands through the receiver (FF60:0061)',
  },
  ...[0x80bc, 0x80c1, 0x80c2].map((productId): CatalogEntry => ({
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId,
    model: 'AK680 V2 (magnetic)',
    link: 'usb',
    mcu: 'AJAZZ web-driver firmware',
    family: 'hub-aa55',
    status: 'community',
    hardware: { rgb: true, hallEffect: true },
    evidence: '10ishk/ak680-studio (Apache-2.0): device info and lighting packets on the keyboard',
  })),
  {
    brand: 'AJAZZ',
    vendorId: 0x0c45,
    productId: 0x80b2,
    model: 'AK680 MAX (RGB, magnetic)',
    link: 'usb',
    mcu: 'AJAZZ web-driver firmware',
    family: 'hub-aa55',
    status: 'community',
    hardware: { hallEffect: true },
    evidence: 'somenever/not-ajazz-ak680-max-webhid (GPL-3.0, facts only): framing and device info',
  },
  // ---- AULA F108 Pro (parsiya/f108-pro, MIT): the AJAZZ Windows-driver protocol
  {
    brand: 'AULA',
    vendorId: 0x0c45,
    productId: 0x800a,
    productName: 'AULA F108Pro',
    model: 'F108 Pro (240×135 screen)',
    link: 'usb',
    mcu: 'Sonix (HFD80CP100)',
    family: 'sonix-feature',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, tft: true, encoder: true },
    definition: 'aula-f108-pro',
    evidence:
      'parsiya/f108-pro (MIT): vendor config.xml and key table; lighting, per-key, clock and screen tested on the keyboard',
  },
  {
    brand: 'AULA',
    vendorId: 0x0c45,
    productId: 0x800a,
    productName: 'AULA-NOVA75',
    model: 'NOVA75 (240×135 screen, knob)',
    link: 'usb',
    mcu: 'Sonix',
    family: 'sonix-feature',
    status: 'experimental',
    hardware: { rgb: true, perKeyRgb: true, tft: true, encoder: true },
    definition: 'aula-nova75',
    evidence:
      'Official AULA NOVA75 driver Beta 1.0.0.2: config.xml (0C45:800A "AULA-NOVA75", MI_00) and layouts/rgb-keyboard.xml (80 keys, screen 240×135 ≤107 frames, brightness/speed 0–6); same protocol as the owner-verified AK820 MAX PLUS',
  },
  // ---- RK screen and newer boards on the BY Tech platform
  {
    brand: 'RK',
    vendorId: 0x258a,
    productId: 0x01a2,
    model: 'M87 (screen, wired)',
    link: 'usb',
    mcu: 'BY Tech (SinoWealth SH68F90A)',
    family: 'by-tech',
    status: 'community',
    hardware: { rgb: true, tft: true, encoder: true },
    evidence:
      'ElXreno/rk-m87-sync (MIT): CDevG5KB feature reports, screen clock tested on the keyboard',
  },
  {
    brand: 'RK',
    vendorId: 0x258a,
    productId: 0x0150,
    model: 'M87 2.4 GHz receiver',
    link: '2.4ghz',
    mcu: 'SinoWealth SH68F90A',
    family: 'rk-m87-receiver',
    status: 'community',
    hardware: { tft: true },
    evidence:
      'ElXreno/rk-m87-sync (MIT): CDev3632 report 0x13 with checksum; screen clock (SetScreenParam 0x0B) and link state (GetDongleStatus 0x07), run on an M87 receiver by the source',
  },
  {
    brand: 'RK',
    vendorId: 0x258a,
    productId: 0x0163,
    model: 'M75 (wired)',
    link: 'usb',
    mcu: 'BY Tech (SinoWealth)',
    family: 'by-tech',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, encoder: true },
    evidence:
      'Lightning-13/rk-m75 (MIT): feature report 9 × 520 B (CDevG5KB); model code not published, settings layout taught on the keyboard',
  },
  // ---- Razer (openrazer / OpenRGB, facts only)
  ...RAZER.map(([productId, model, link]): CatalogEntry => ({
    brand: 'Razer',
    vendorId: 0x1532,
    productId,
    model,
    link,
    mcu: 'Razer Chroma',
    family: 'razer-chroma',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence:
      'openrazer and OpenRGB (GPL-2.0, facts only): command set and transaction id per model',
  })),
  // ---- Wooting (WootingKb/wooting-rgb-sdk, MPL-2.0)
  ...WOOTING.map(([vendorId, productId, model]): CatalogEntry => ({
    brand: 'Wooting',
    vendorId,
    productId,
    model,
    link: 'usb',
    mcu: 'Wooting',
    family: 'wooting-rgb',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, hallEffect: true },
    evidence: 'WootingKb/wooting-rgb-sdk (official, MPL-2.0)',
  })),
  // ---- Winbond (USB vendor 0416) gaming keyboards
  {
    brand: 'FL Esports',
    vendorId: 0x0416,
    productId: 0xc345,
    productName: 'Gaming Keyboard',
    model: 'MK870',
    link: 'usb',
    mcu: 'Winbond / Nuvoton',
    family: 'winbond-lighting',
    status: 'verified',
    hardware: { rgb: true, perKeyRgb: true },
    evidence:
      'Owner-verified from OpenKey (issue #13): lighting (every effect), per-key colours, base-layer key map and all 10 macro slots; the FN1 layer and sleep time are still experimental. Commands from the official FL Esports driver V1.06.16 (0416:C345, Nuvoton M252); lighting matches 45 captures of the official app; descriptor FF1B:0091, report 1, 63 B',
  },
  {
    brand: 'Pulsar',
    vendorId: 0x0416,
    productId: 0xb23c,
    model: 'PCMK TKL (also sold as KT108 / Nautilus)',
    link: 'usb',
    mcu: 'Winbond / Nuvoton (NUC121)',
    family: 'winbond-lighting',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence:
      'Official FL Esports driver V1.06.16 device list (0416:B23C, NUC121); lighting and per-key packets tested on a PCMK TKL by DanielGibson (gist, facts only)',
  },
  // ---- EVision firmware boards (OpenRGB, facts only)
  {
    brand: 'AJAZZ',
    vendorId: 0x320f,
    productId: 0x505b,
    model: 'AK820 wired RGB (Moon switches, knob)',
    link: 'usb',
    mcu: 'Sonix (EVision firmware, VS11K28A)',
    family: 'evision',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, encoder: true },
    evidence:
      'Official AJAZZ "AK820 wired RGB" driver V1.0: its firmware updater targets 320F:505B (firmware 0103, bootloader 0C45:7687) and its keyboard picture gives the 82 LED indices; the identity is in OpenRGB’s EVision list (GPL-2.0, facts only)',
  },
  ...EVISION.map(([vendorId, productId]): CatalogEntry => ({
    brand: 'EVision (Redragon, Glorious, AJAZZ …)',
    vendorId,
    productId,
    model: `EVision keyboard ${vendorId.toString(16).toUpperCase().padStart(4, '0')}:${productId.toString(16).toUpperCase().padStart(4, '0')}`,
    link: 'usb',
    mcu: 'Sonix (EVision firmware)',
    family: 'evision',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'OpenRGB EVisionKeyboardController (GPL-2.0, facts only)',
  })),
  // ---- Direct-lighting boards documented by OpenRGB (facts only)
  {
    brand: 'A4Tech',
    vendorId: 0x09da,
    productId: 0xfa10,
    model: 'Bloody B820R',
    link: 'usb',
    mcu: 'A4Tech',
    family: 'bloody-b820r',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'OpenRGB A4TechController/BloodyB820RController (GPL-2.0, facts only)',
  },
  ...(
    [
      [0x0951, 0x16e5, 'Alloy Origins'],
      [0x03f0, 0x0591, 'Alloy Origins (HP)'],
    ] as const
  ).map(([vendorId, productId, model]): CatalogEntry => ({
    brand: 'HyperX',
    vendorId,
    productId,
    model,
    link: 'usb',
    mcu: 'HyperX',
    family: 'hyperx-alloy-origins',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'OpenRGB HyperXAlloyOriginsController (GPL-2.0, facts only)',
  })),
  ...(
    [
      [0x0348, 'One 2 RGB / Shine 7'],
      [0x0356, 'One 2 RGB TKL'],
    ] as const
  ).map(([productId, model]): CatalogEntry => ({
    brand: 'Ducky',
    vendorId: 0x04d9,
    productId,
    model,
    link: 'usb',
    mcu: 'Holtek',
    family: 'ducky-rgb',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'OpenRGB DuckyKeyboardController (GPL-2.0, facts only)',
  })),
  ...STEELSERIES.map(([productId, model, link]): CatalogEntry => ({
    brand: 'SteelSeries',
    vendorId: 0x1038,
    productId,
    model,
    link,
    mcu: 'SteelSeries',
    family: 'steelseries-apex',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true, hallEffect: model.includes('Pro') },
    evidence: 'OpenRGB SteelSeriesApexController (GPL-2.0, facts only)',
  })),
  ...LOGITECH.map(([productId, model, link]): CatalogEntry => ({
    brand: 'Logitech',
    vendorId: 0x046d,
    productId,
    model,
    link,
    mcu: 'Logitech HID++ 2.0',
    family: 'logitech-hidpp',
    status: 'community',
    hardware: { rgb: true, perKeyRgb: true },
    evidence: 'Solaar and OpenRGB LogitechController (GPL-2.0, facts only)',
  })),
];

/** All catalogue entries for an identity. Several entries mean the identity is shared. */
export function lookupCatalogAll(identity: {
  vendorId: number;
  productId: number;
  productName: string;
}): CatalogEntry[] {
  const byId = CATALOG.filter(
    (e) => e.vendorId === identity.vendorId && e.productId === identity.productId,
  );
  const exact = byId.filter((e) => e.productName === identity.productName.trim());
  return exact.length ? exact : byId.filter((e) => !e.productName);
}

/**
 * The catalogue entry naming this identity, or undefined when none or several match. A shared
 * VID:PID (e.g. 258A:010C) is never resolved to one model.
 */
export function lookupCatalog(identity: {
  vendorId: number;
  productId: number;
  productName: string;
}): CatalogEntry | undefined {
  const all = lookupCatalogAll(identity);
  return all.length === 1 ? all[0] : undefined;
}
