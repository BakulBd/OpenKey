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
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX', model: 'AK820 MAX / MAX PLUS (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'experimental', hardware: AK820_TFT, definition: 'ak820-max-plus', evidence: 'Official driver V1.0.0.5; detection, handshake and per-key read verified on hardware (fw 1.07)' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0x800a, productName: 'AK820 MAX', model: 'AK820 MAX / MAX PLUS (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'community', hardware: AK820_TFT, definition: 'ak820-max-plus', evidence: 'Official driver V1.0.0.5 config.xml; PID not seen on hardware' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0x8009, productName: 'AK820', model: 'AK820 Pro (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature or sonix-aa55', status: 'community', hardware: AK820_TFT, definition: 'ak820-pro', evidence: 'Official AK820 PRO driver V1.0.0.5; online driver config 3141-32777-AK820; two firmware generations' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0x800a, productName: 'AK820', model: 'AK820 Pro (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'community', hardware: AK820_TFT, definition: 'ak820-pro', evidence: 'Official AK820 PRO driver V1.0.0.5' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0xfdfd, model: 'AK820 Pro / MAX 2.4 GHz receiver', link: '2.4ghz', mcu: 'Sonix', family: 'sonix-dongle', status: 'research', hardware: {}, definition: 'ak820-dongle', evidence: 'Official driver config.xml; afonsusousa/mrworldwide' },
  { brand: 'AJAZZ', vendorId: 0x05ac, productId: 0x024f, model: 'AK820 MAX 2.4 GHz receiver', link: '2.4ghz', mcu: 'Sonix', family: 'sonix-dongle', status: 'research', hardware: {}, definition: 'ak820-dongle', evidence: 'Official AK820 MAX driver config.xml' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0xfefe, model: 'AK820 Pro / MAX (Bluetooth)', link: 'bluetooth', mcu: 'Sonix + CH582F', family: 'none', status: 'unsupported', hardware: AK820_TFT, evidence: 'Official driver: settings not supported over Bluetooth' },
  { brand: 'AJAZZ', vendorId: 0x0c45, productId: 0x80b1, model: 'AK820 MAX HE (magnetic)', link: 'usb', mcu: 'Sonix', family: 'sonix-aa55', status: 'community', hardware: { rgb: true, hallEffect: true }, evidence: 'Online driver config; baloghd/ak820max-rgb' },
  { brand: 'AJAZZ', vendorId: 0x258a, productId: 0x010c, model: 'AK820 MAX PLUS "BY edition" (SinoWealth)', link: 'usb', mcu: 'SinoWealth', family: 'sinowealth', status: 'research', hardware: { rgb: true }, evidence: 'Official driver "AK820 MAX PLUS BY version V2.0" Dev/kb/*/KB.ini' },
  { brand: 'AJAZZ', vendorId: 0x3554, productId: 0xfa09, model: 'AK820 MAX PLUS "BY edition" receiver (SinoWealth)', link: '2.4ghz', mcu: 'SinoWealth', family: 'sinowealth', status: 'research', hardware: {}, evidence: 'Official driver "AK820 MAX PLUS BY version V2.0"' },
  { brand: 'AJAZZ', vendorId: 0x3151, productId: 0x4011, model: 'AK820 MAX magnetic tri-mode screen (YiChip) receiver', link: '2.4ghz', mcu: 'YiChip YC3121', family: 'royuan', status: 'research', hardware: {}, evidence: 'Official driver "AK820 MAX magnetic screen V2.1.77" device table; ROYUAN family per Sharkfin' },
  { brand: 'AJAZZ', vendorId: 0x3151, productId: 0x4015, model: 'AK820 MAX magnetic tri-mode screen (YiChip)', link: 'usb', mcu: 'YiChip YC3121', family: 'royuan', status: 'research', hardware: { rgb: true, tft: true, hallEffect: true }, evidence: 'Official driver "AK820 MAX magnetic screen V2.1.77" device table; ROYUAN family per Sharkfin' },
  { brand: 'AJAZZ', vendorId: 0x1a2c, productId: 0x9605, model: 'AK820 wired single-colour', link: 'usb', mcu: 'CRS', family: 'crs', status: 'research', hardware: {}, evidence: 'Official driver "AK820 wired white/blue light V1.0" config.xml' },
  { brand: 'AJAZZ', vendorId: 0x1a2c, productId: 0x8fff, model: 'AK820 Max Plus (CRS)', link: 'usb', mcu: 'CRS', family: 'crs-aa55cc33', status: 'community', hardware: { rgb: true, perKeyRgb: true }, definition: 'ak820-max-crs', evidence: 'armoredvortex/ajazz-ak820-max-plus' },
  { brand: 'AJAZZ', vendorId: 0x1a2c, productId: 0xa036, model: 'AK820 Max Plus (CRS)', link: '2.4ghz', mcu: 'CRS', family: 'crs-aa55cc33', status: 'community', hardware: { rgb: true, perKeyRgb: true }, definition: 'ak820-max-crs', evidence: 'arafatamim/OpenRGBAK820Plugin' },
  { brand: 'AULA', vendorId: 0x258a, productId: 0x010c, model: 'F75 (wired)', link: 'usb', mcu: 'disputed (SinoWealth / Telink)', family: 'aula-sinowealth', status: 'research', hardware: { rgb: true, perKeyRgb: true, encoder: true }, evidence: 'cloudglides/aula-f75-linux-drivers, not-ayan/openaula; shares VID:PID with the AJAZZ "BY edition"' },
  { brand: 'AULA', vendorId: 0x3554, productId: 0xfa09, model: 'F75 2.4 GHz receiver', link: '2.4ghz', mcu: 'disputed', family: 'aula-sinowealth', status: 'research', hardware: {}, evidence: 'cloudglides/aula-f75-linux-drivers; shares VID:PID with the AJAZZ "BY edition" receiver' },
];

/** All catalogue entries for an identity. Several entries mean the identity is shared. */
export function lookupCatalogAll(identity: { vendorId: number; productId: number; productName: string }): CatalogEntry[] {
  const byId = CATALOG.filter((e) => e.vendorId === identity.vendorId && e.productId === identity.productId);
  const exact = byId.filter((e) => e.productName === identity.productName.trim());
  return exact.length ? exact : byId.filter((e) => !e.productName);
}

/**
 * The catalogue entry naming this identity, or undefined when none or several match. A shared
 * VID:PID (e.g. 258A:010C) is never resolved to one model.
 */
export function lookupCatalog(identity: { vendorId: number; productId: number; productName: string }): CatalogEntry | undefined {
  const all = lookupCatalogAll(identity);
  return all.length === 1 ? all[0] : undefined;
}
