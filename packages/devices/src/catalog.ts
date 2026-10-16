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
    mcu: 'unknown',
    family: 'unknown',
    status: 'research',
    hardware: {},
    evidence:
      'Same receiver identity as the AULA F75 Max and AJAZZ AK820 MAX receivers, whose vendor endpoints (FF59/FF60) carry the 2.4 GHz protocol (VitalyArt/Aula-F75-Max-Driver, Ghost-CR/F75_Initializer). A user report from macOS showed no vendor endpoint, which macOS can hide from the browser; not yet seen with them',
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
      'RK driver configuration Dev/015E/KB.ini ("R75RGB wired", Psd, Fw=1); report descriptor with the BY Tech command report (6 × 519 B)',
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
