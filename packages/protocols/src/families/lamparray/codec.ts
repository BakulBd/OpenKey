import { ProtocolError } from '@openkey/core';
import type { HidCollection, HidReportInfo } from '@openkey/hid';

/**
 * HID LampArray (USB-IF HID Usage Tables, Lighting And Illumination page 0x59; Microsoft "Dynamic
 * Lighting"). A public standard: the device describes its own lamps (position, purpose, colour
 * depth, the key each lamp sits under), and the host sets colours. Report IDs are chosen by each
 * device, so they are found by the logical collection that names each report.
 *
 * Field layout follows the HID Usage Tables 1.3+ LampArray section and Microsoft's reference
 * descriptor; it is cross-checked against OpenRGB's HIDLampArrayController (GPL-2.0, facts only).
 */
export const LAMPARRAY_PROTOCOL_ID = 'hid-lamparray';
export const LIGHTING_PAGE = 0x59;

export const Usage = {
  LAMP_ARRAY: 0x01,
  ATTRIBUTES_REPORT: 0x02,
  ATTRIBUTES_REQUEST: 0x20,
  ATTRIBUTES_RESPONSE: 0x22,
  MULTI_UPDATE: 0x50,
  RANGE_UPDATE: 0x60,
  CONTROL: 0x70,
} as const;

/** LampPurposes bits. */
export const Purpose = {
  CONTROL: 0x01,
  ACCENT: 0x02,
  BRANDING: 0x04,
  STATUS: 0x08,
  ILLUMINATION: 0x10,
  PRESENTATION: 0x20,
} as const;

export const KIND_NAMES: Record<number, string> = {
  1: 'keyboard',
  2: 'mouse',
  3: 'game controller',
  4: 'peripheral',
  5: 'scene',
  6: 'notification',
  7: 'chassis',
  8: 'wearable',
  9: 'furniture',
  10: 'art',
};

/** LampUpdateFlags bit: the last report of a frame; the device shows the frame now. */
export const UPDATE_COMPLETE = 0x01;

/** Report sizes (bytes, without report ID) of the standard layout. */
export const SIZE = {
  attributes: 22,
  request: 2,
  response: 28,
  range: 9,
  control: 1,
} as const;
/** A multi-update report carries a count, flags, then n lamp ids (u16) and n RGBI tuples. */
export const multiUpdateCapacity = (size: number) => (size - 2) / 6;

export interface ReportMap {
  attributes: number;
  request: number;
  response: number;
  multi: number;
  range: number;
  control: number;
  /** Lamps per multi-update report, from its size. */
  multiCapacity: number;
}

type Found = { reportId: number; size: number } | undefined;

function reportOf(c: HidCollection): Found {
  const r: HidReportInfo | undefined =
    c.featureReports[0] ?? c.outputReports[0] ?? c.inputReports[0];
  return r ? { reportId: r.reportId, size: r.size } : undefined;
}

export const isLampArray = (c: HidCollection) =>
  c.usagePage === LIGHTING_PAGE && c.usage === Usage.LAMP_ARRAY;

/**
 * The report IDs of a LampArray collection, or the reason they cannot be used. Every report must be
 * present with the standard size: a device with other field widths is refused rather than guessed.
 */
export function reportMap(c: HidCollection): ReportMap | string {
  if (!isLampArray(c)) return 'not a LampArray collection (59:01)';
  const children = c.children ?? [];
  if (!children.length)
    return 'this platform does not expose the LampArray report layout (nested collections)';
  const find = (usage: number): Found =>
    reportOf(
      children.find((ch) => ch.usagePage === LIGHTING_PAGE && ch.usage === usage) ?? {
        usagePage: 0,
        usage: 0,
        inputReports: [],
        outputReports: [],
        featureReports: [],
      },
    );
  const a = find(Usage.ATTRIBUTES_REPORT);
  const q = find(Usage.ATTRIBUTES_REQUEST);
  const r = find(Usage.ATTRIBUTES_RESPONSE);
  const m = find(Usage.MULTI_UPDATE);
  const g = find(Usage.RANGE_UPDATE);
  const k = find(Usage.CONTROL);
  const missing = [
    [a, 'LampArrayAttributesReport'],
    [q, 'LampAttributesRequestReport'],
    [r, 'LampAttributesResponseReport'],
    [m, 'LampMultiUpdateReport'],
    [g, 'LampRangeUpdateReport'],
    [k, 'LampArrayControlReport'],
  ]
    .filter(([x]) => !x)
    .map(([, n]) => n);
  if (missing.length) return `missing ${missing.join(', ')}`;
  const wrong: string[] = [];
  if (a!.size !== SIZE.attributes) wrong.push(`attributes ${a!.size} B`);
  if (q!.size !== SIZE.request) wrong.push(`request ${q!.size} B`);
  if (r!.size !== SIZE.response) wrong.push(`response ${r!.size} B`);
  if (g!.size !== SIZE.range) wrong.push(`range update ${g!.size} B`);
  if (k!.size !== SIZE.control) wrong.push(`control ${k!.size} B`);
  const cap = multiUpdateCapacity(m!.size);
  if (!Number.isInteger(cap) || cap < 1) wrong.push(`multi update ${m!.size} B`);
  if (wrong.length) return `non-standard report sizes (${wrong.join(', ')})`;
  return {
    attributes: a!.reportId,
    request: q!.reportId,
    response: r!.reportId,
    multi: m!.reportId,
    range: g!.reportId,
    control: k!.reportId,
    multiCapacity: cap,
  };
}

export interface ArrayAttributes {
  lampCount: number;
  /** Bounding box in micrometres. */
  width: number;
  height: number;
  depth: number;
  kind: number;
  minUpdateIntervalUs: number;
}

export interface Lamp {
  id: number;
  /** Position of the lamp's centre in micrometres, from the array's top-left corner. */
  x: number;
  y: number;
  z: number;
  updateLatencyUs: number;
  purposes: number;
  levels: { r: number; g: number; b: number; i: number };
  programmable: boolean;
  /** HID Keyboard usage of the key above the lamp; 0 when the lamp is not under a key. */
  binding: number;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function decodeAttributes(b: Uint8Array): ArrayAttributes {
  if (b.length < SIZE.attributes) throw new ProtocolError('LampArray attributes report too short');
  const v = view(b);
  return {
    lampCount: v.getUint16(0, true),
    width: v.getUint32(2, true),
    height: v.getUint32(6, true),
    depth: v.getUint32(10, true),
    kind: v.getUint32(14, true),
    minUpdateIntervalUs: v.getUint32(18, true),
  };
}

export function decodeLamp(b: Uint8Array): Lamp {
  if (b.length < SIZE.response) throw new ProtocolError('LampAttributes response too short');
  const v = view(b);
  return {
    id: v.getUint16(0, true),
    x: v.getUint32(2, true),
    y: v.getUint32(6, true),
    z: v.getUint32(10, true),
    updateLatencyUs: v.getUint32(14, true),
    purposes: v.getUint32(18, true),
    levels: { r: b[22]!, g: b[23]!, b: b[24]!, i: b[25]! },
    programmable: b[26] !== 0,
    binding: b[27]!,
  };
}

export function encodeRequest(lampId: number): Uint8Array {
  const out = new Uint8Array(SIZE.request);
  view(out).setUint16(0, lampId, true);
  return out;
}

export interface LampColor {
  r: number;
  g: number;
  b: number;
  /** Intensity channel; 255 unless the lamp has a separate intensity control. */
  i: number;
}

/** One multi-update report for up to `capacity` lamps. */
export function encodeMultiUpdate(
  capacity: number,
  lamps: readonly { id: number; color: LampColor }[],
  complete: boolean,
): Uint8Array {
  if (lamps.length < 1 || lamps.length > capacity)
    throw new ProtocolError(`A multi-update carries 1–${capacity} lamps`);
  const out = new Uint8Array(2 + capacity * 6);
  const v = view(out);
  out[0] = lamps.length;
  out[1] = complete ? UPDATE_COMPLETE : 0;
  lamps.forEach(({ id, color }, k) => {
    v.setUint16(2 + k * 2, id, true);
    out.set([color.r, color.g, color.b, color.i], 2 + capacity * 2 + k * 4);
  });
  return out;
}

export function encodeRangeUpdate(
  first: number,
  last: number,
  color: LampColor,
  complete = true,
): Uint8Array {
  const out = new Uint8Array(SIZE.range);
  const v = view(out);
  out[0] = complete ? UPDATE_COMPLETE : 0;
  v.setUint16(1, first, true);
  v.setUint16(3, last, true);
  out.set([color.r, color.g, color.b, color.i], 5);
  return out;
}

/** AutonomousMode 1: the device runs its own lighting; 0: the host sets the lamps. */
export const encodeControl = (autonomous: boolean) => Uint8Array.of(autonomous ? 1 : 0);

/**
 * Scales an 8-bit channel to the lamp's levels. Lamps with full 8-bit channels (255 or 256 levels,
 * or a count the 8-bit field cannot hold) take the value as is; a single-level lamp is on or off.
 */
export function toLevel(value: number, levels: number): number {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  if (levels === 0 || levels >= 255) return v;
  if (levels === 1) return v >= 128 ? 1 : 0;
  return Math.round((v * (levels - 1)) / 255);
}

export function purposeName(p: number): string {
  if (p & Purpose.CONTROL) return 'Key';
  if (p & Purpose.BRANDING) return 'Logo';
  if (p & Purpose.STATUS) return 'Status';
  if (p & Purpose.ACCENT) return 'Accent';
  if (p & Purpose.PRESENTATION) return 'Display';
  if (p & Purpose.ILLUMINATION) return 'Light';
  return 'Lamp';
}
