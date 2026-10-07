/**
 * Every AK820-family identity found in official AJAZZ software or credible public research.
 * Used to name a device even when OpenAK820 cannot configure it. Detection never relies on this
 * table to pick a protocol; descriptors and probes do that.
 */
export type CatalogStatus = 'supported' | 'experimental' | 'identified' | 'unsupported';

export interface CatalogEntry {
  vendorId: number;
  productId: number;
  /** USB product string when the PID is shared between models. */
  productName?: string;
  model: string;
  link: 'usb' | '2.4ghz' | 'bluetooth';
  mcu: string;
  family: string;
  status: CatalogStatus;
  evidence: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX', model: 'AK820 MAX / MAX PLUS (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'supported', evidence: 'Official driver "AK820 MAX&MAX PLUS 0.85in ColorScreen" V1.0.0.5; hardware' },
  { vendorId: 0x0c45, productId: 0x800a, productName: 'AK820 MAX', model: 'AK820 MAX / MAX PLUS (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'supported', evidence: 'Official driver V1.0.0.5 config.xml' },
  { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820', model: 'AK820 Pro (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature or sonix-aa55', status: 'supported', evidence: 'Official AK820 PRO driver V1.0.0.5; online driver config 3141-32777-AK820' },
  { vendorId: 0x0c45, productId: 0x800a, productName: 'AK820', model: 'AK820 Pro (TFT)', link: 'usb', mcu: 'Sonix', family: 'sonix-feature', status: 'supported', evidence: 'Official AK820 PRO driver V1.0.0.5' },
  { vendorId: 0x0c45, productId: 0xfdfd, model: 'AK820 Pro / MAX 2.4 GHz receiver', link: '2.4ghz', mcu: 'Sonix', family: 'sonix-dongle', status: 'experimental', evidence: 'Official driver config.xml; afonsusousa/mrworldwide' },
  { vendorId: 0x05ac, productId: 0x024f, model: 'AK820 MAX 2.4 GHz receiver', link: '2.4ghz', mcu: 'Sonix', family: 'sonix-dongle', status: 'experimental', evidence: 'Official AK820 MAX driver config.xml' },
  { vendorId: 0x0c45, productId: 0xfefe, model: 'AK820 Pro / MAX (Bluetooth)', link: 'bluetooth', mcu: 'Sonix + CH582F', family: 'none', status: 'unsupported', evidence: 'Official driver: settings not supported over Bluetooth' },
  { vendorId: 0x0c45, productId: 0x80b1, model: 'AK820 MAX HE (magnetic)', link: 'usb', mcu: 'Sonix', family: 'sonix-aa55', status: 'experimental', evidence: 'Online driver config; baloghd/ak820max-rgb' },
  { vendorId: 0x258a, productId: 0x010c, model: 'AK820 MAX PLUS "BY edition" (SinoWealth)', link: 'usb', mcu: 'SinoWealth', family: 'sinowealth', status: 'identified', evidence: 'Official driver "AK820 MAX PLUS BY version V2.0" Dev/kb/*/KB.ini' },
  { vendorId: 0x3554, productId: 0xfa09, model: 'AK820 MAX PLUS "BY edition" receiver (SinoWealth)', link: '2.4ghz', mcu: 'SinoWealth', family: 'sinowealth', status: 'identified', evidence: 'Official driver "AK820 MAX PLUS BY version V2.0"' },
  { vendorId: 0x3151, productId: 0x4011, model: 'AK820 MAX magnetic tri-mode screen (YiChip)', link: '2.4ghz', mcu: 'YiChip YC3121', family: 'rongyuan', status: 'identified', evidence: 'Official driver "AK820 MAX magnetic screen V2.1.77" device table' },
  { vendorId: 0x3151, productId: 0x4015, model: 'AK820 MAX magnetic tri-mode screen (YiChip)', link: 'usb', mcu: 'YiChip YC3121', family: 'rongyuan', status: 'identified', evidence: 'Official driver "AK820 MAX magnetic screen V2.1.77" device table' },
  { vendorId: 0x1a2c, productId: 0x9605, model: 'AK820 wired single-colour', link: 'usb', mcu: 'CRS', family: 'crs', status: 'identified', evidence: 'Official driver "AK820 wired white/blue light V1.0" config.xml' },
  { vendorId: 0x1a2c, productId: 0x8fff, model: 'AK820 Max Plus (CRS)', link: 'usb', mcu: 'CRS', family: 'crs-aa55cc33', status: 'experimental', evidence: 'armoredvortex/ajazz-ak820-max-plus' },
  { vendorId: 0x1a2c, productId: 0xa036, model: 'AK820 Max Plus (CRS)', link: '2.4ghz', mcu: 'CRS', family: 'crs-aa55cc33', status: 'experimental', evidence: 'arafatamim/OpenRGBAK820Plugin' },
];

export function lookupCatalog(identity: { vendorId: number; productId: number; productName: string }): CatalogEntry | undefined {
  const byId = CATALOG.filter((e) => e.vendorId === identity.vendorId && e.productId === identity.productId);
  return byId.find((e) => e.productName === identity.productName.trim()) ?? byId.find((e) => !e.productName);
}
