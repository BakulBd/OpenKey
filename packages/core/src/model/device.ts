import type { Evidence } from '../evidence.js';

/** How the keyboard is currently attached to the host. */
export type TransportMode = 'usb' | '2.4ghz' | 'bluetooth' | 'unknown';

/** USB / HID identity as reported by the OS or browser. Never sufficient on its own to pick a protocol. */
export interface DeviceIdentity {
  vendorId: number;
  productId: number;
  productName: string;
  manufacturer?: string;
  serialNumber?: string;
  /** USB bcdDevice, e.g. 0x0107. WebHID does not expose it. */
  release?: number;
}

/** One decoded device-information field together with the evidence behind it. */
export interface InfoField {
  key: string;
  label: string;
  value: string | number | boolean | null;
  confidence: Evidence;
  source: string;
}

export interface DeviceInfo {
  /** Display name, e.g. "AJAZZ AK820 MAX / MAX PLUS". */
  model: string;
  /** Profile id the detector resolved to, e.g. "ak820-max-plus". */
  profileId: string;
  identity: DeviceIdentity;
  firmware: { version: string | null; source: string; confidence: Evidence };
  transport: TransportMode;
  protocol: { id: string; name: string; revision?: string };
  battery?: { level: number; charging: boolean } | null;
  fields: InfoField[];
  /** Raw bytes of any device-info response, hex encoded, preserved for fixtures. */
  raw?: Record<string, string>;
}

/** Formats a USB bcdDevice value (0x0107 -> "1.07"). */
export function formatBcd(bcd: number): string {
  const major = ((bcd >> 12) & 0xf) * 10 + ((bcd >> 8) & 0xf);
  const minor = ((bcd >> 4) & 0xf) * 10 + (bcd & 0xf);
  return `${major}.${minor.toString().padStart(2, '0')}`;
}
