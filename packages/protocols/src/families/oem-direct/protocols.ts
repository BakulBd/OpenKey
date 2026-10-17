import { Evidence } from '@openkey/core';
import type { Rgb, StateStore } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type {
  HidCollection,
  HidDeviceGroup,
  HidDeviceGroupInfo,
  HidInterfaceInfo,
  HidTransport,
} from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { DirectLightingDriver } from '../common/direct-lighting.js';

/**
 * Direct-lighting keyboards documented by OpenRGB (GPL-2.0; facts only: USB identities, report
 * layouts and LED order, re-implemented here). None of them has a read command, so each is
 * identified from its USB identity plus the exact report layout, and nothing is sent while
 * detecting.
 */
type Open = (i: HidInterfaceInfo) => Promise<HidTransport>;
interface DriverOpts {
  store: StateStore;
  open: Open;
}

interface DirectProtocol {
  id: string;
  name: string;
  ids: readonly { vendorId: number; productId: number; model: string }[];
  channel: (c: HidCollection) => boolean;
  channelText: string;
  reference: string;
  make: (
    group: HidDeviceGroup,
    iface: HidInterfaceInfo,
    model: string,
    opts: DriverOpts,
  ) => DirectLightingDriver;
  limitations?: string[];
}

function defineDirect(p: DirectProtocol): ProtocolDefinition {
  const modelOf = (g: HidDeviceGroupInfo) =>
    p.ids.find((m) => m.vendorId === g.identity.vendorId && m.productId === g.identity.productId);
  const channel = (g: HidDeviceGroupInfo) =>
    g.interfaces.find((i) => i.collections.some(p.channel));
  return {
    apiVersion: ADAPTER_API_VERSION,
    id: p.id,
    manifest: {
      version: '0.1.0',
      status: 'community',
      transports: { input: ['usb'], configuration: ['usb'] },
      verification: `Implemented from OpenRGB, whose users run it on these keyboards; tested against a simulator, not yet run by OpenKey.`,
      safety:
        'Direct lighting only: colours are not stored by the keyboard, and “Keyboard’s own lighting” gives control back. Nothing is sent while detecting.',
      provenance: [
        { source: 'public-reverse-engineering', reference: p.reference, status: Evidence.INFERRED },
      ],
      license: 'MIT',
      limitations: [
        'Lighting only (direct mode): key maps, macros and the keyboard’s stored effects are not documented.',
        'Colours are not stored and cannot be read back; OpenKey shows what it last sent.',
        ...(p.limitations ?? []),
      ],
      fixtures: [],
      verifiedIdentities: [],
    },
    name: p.name,
    family: p.id,
    priority: 42,
    supportedDevices: p.ids
      .map(
        (m) =>
          `${m.model} (${m.vendorId.toString(16).padStart(4, '0').toUpperCase()}:${m.productId.toString(16).padStart(4, '0').toUpperCase()})`,
      )
      .join(', '),
    supportedFirmware: 'stock firmware with the direct-lighting interface',
    requiredUsagePages: [],
    requiredReports: [p.channelText],
    evidence: [p.reference],
    probePlan: {
      operations: [],
      autoConsent: (g) =>
        modelOf(g)
          ? {
              auto: true,
              reason:
                'no packet is sent: the keyboard is identified from its USB identity and report layout',
            }
          : { auto: false, reason: 'not a listed identity' },
      identifiedBy: 'vendor-model-list',
    },
    match(group): CandidateMatch {
      const m = modelOf(group);
      if (!m)
        return {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: ['USB identity not listed'],
        };
      if (!channel(group))
        return {
          applicable: false,
          score: 0,
          reasons: [m.model],
          rejections: [`no ${p.channelText}`],
        };
      return { applicable: true, score: 60, reasons: [m.model, p.channelText], rejections: [] };
    },
    async probe(ctx: ProbeContext): Promise<ProbeResult> {
      const m = modelOf(ctx.group);
      const ok = !!m && !!channel(ctx.group);
      return {
        status: ok ? 'pass' : 'fail',
        confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
        summary: ok
          ? `${m!.model}: identified from its USB identity and report layout (no read command exists)`
          : 'Not listed',
        steps: [
          {
            name: 'model list',
            status: ok ? 'pass' : 'fail',
            detail: ok ? m!.model : 'not listed',
          },
        ],
        facts: ok ? { model: m!.model } : {},
        identified: ok,
      };
    },
    async createDriver(group, opts) {
      const m = modelOf(group);
      const ch = channel(group);
      if (!m || !ch) throw new Error(`Not a ${p.name} keyboard`);
      return p.make(group, ch, m.model, {
        store: opts.store,
        open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      });
    },
  };
}

const notKeyboard = (c: HidCollection) =>
  !(c.usagePage === 0x01 && (c.usage === 0x06 || c.usage === 0x02));
const OPENRGB = (path: string) => `OpenRGB Controllers/${path} (GPL-2.0; facts only)`;

// ---------------------------------------------------------------- A4Tech Bloody B820R

/** LED order: a full-size board row by row, Fn in place of the right Win key. */
const B820R_LEDS = [
  'Esc',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'PrtSc',
  'ScrLk',
  'Pause',
  '`',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '-',
  '=',
  'Backspace',
  'Ins',
  'Home',
  'PgUp',
  'NumLock',
  'KP/',
  'KP*',
  'KP-',
  'Tab',
  'Q',
  'W',
  'E',
  'R',
  'T',
  'Y',
  'U',
  'I',
  'O',
  'P',
  '[',
  ']',
  '\\',
  'Del',
  'End',
  'PgDn',
  'KP7',
  'KP8',
  'KP9',
  'KP+',
  'Caps',
  'A',
  'S',
  'D',
  'F',
  'G',
  'H',
  'J',
  'K',
  'L',
  ';',
  "'",
  'Enter',
  'KP4',
  'KP5',
  'KP6',
  'LShift',
  'Z',
  'X',
  'C',
  'V',
  'B',
  'N',
  'M',
  ',',
  '.',
  '/',
  'RShift',
  'Up',
  'KP1',
  'KP2',
  'KP3',
  'KPEnter',
  'LCtrl',
  'LWin',
  'LAlt',
  'Space',
  'RAlt',
  'Fn',
  'Menu',
  'RCtrl',
  'Left',
  'Down',
  'Right',
  'KP0',
  'KP.',
];
const B820R_REPORT = 7;
const B820R_BYTES = 63;
/** Bytes of each colour plane per report (offset 5 of the data, i.e. byte 6 with the report ID). */
const B820R_PLANE = 58;

export class BloodyB820RDriver extends DirectLightingDriver {
  private send(d: number[]): Promise<void> {
    const p = new Uint8Array(B820R_BYTES);
    p.set(d);
    return this.tr().sendFeatureReport(B820R_REPORT, p);
  }
  private async control(on: boolean): Promise<void> {
    await this.send([0x03, 0x06, 0x01]);
    await this.send([0x03, 0x06, 0x00, 0, 0, 0, 0, on ? 0x01 : 0x00]);
  }
  protected takeControl(): Promise<void> {
    return this.control(true);
  }
  protected override releaseControl(): Promise<void> {
    return this.control(false);
  }
  protected async sendFrame(frame: Rgb[]): Promise<void> {
    // Six reports: red, green and blue planes, each split in two halves of 58 LEDs.
    for (const [sub, plane, half] of [
      [0x07, 'r', 0],
      [0x08, 'r', 1],
      [0x09, 'g', 0],
      [0x0a, 'g', 1],
      [0x0b, 'b', 0],
      [0x0c, 'b', 1],
    ] as const) {
      const d = [0x03, 0x06, sub, 0, 0];
      for (let i = 0; i < B820R_PLANE; i++) d.push(frame[half * B820R_PLANE + i]?.[plane] ?? 0);
      await this.send(d);
    }
  }
}

export const bloodyB820RProtocol = defineDirect({
  id: 'bloody-b820r',
  name: 'A4Tech Bloody B820R (direct lighting)',
  ids: [{ vendorId: 0x09da, productId: 0xfa10, model: 'Bloody B820R' }],
  channel: (c) =>
    c.usagePage === 0xff52 &&
    c.featureReports.some((r) => r.reportId === B820R_REPORT && r.size === B820R_BYTES),
  channelText: 'FF52 feature report 7 (63 B)',
  reference: OPENRGB('A4TechController/BloodyB820RController'),
  make: (g, i, model, o) =>
    new BloodyB820RDriver(
      g,
      i,
      {
        protocolId: 'bloody-b820r',
        protocolName: 'A4Tech Bloody direct lighting (feature report 7)',
        model: `A4Tech ${model}`,
        leds: B820R_LEDS,
        size: 'full',
        rightMods: 'fn',
        source: OPENRGB('A4TechController/BloodyB820RController'),
        evidence: Evidence.INFERRED,
        canRelease: true,
      },
      o,
    ),
});

// ---------------------------------------------------------------- HyperX Alloy Origins

/** LED order of the Alloy Origins (column by column); '' = ISO-only keys. */
const ORIGINS_LEDS = [
  'Esc',
  '`',
  'Tab',
  'Caps',
  'LShift',
  'LCtrl',
  '',
  '1',
  'Q',
  'A',
  'Z',
  'LWin',
  'F1',
  '2',
  'W',
  'S',
  'X',
  'LAlt',
  'F2',
  '3',
  'E',
  'D',
  'C',
  'F3',
  '4',
  'R',
  'F',
  'V',
  'F4',
  '5',
  'T',
  'G',
  'B',
  'Space',
  'F5',
  '6',
  'Y',
  'H',
  'N',
  'F6',
  '7',
  'U',
  'J',
  'M',
  'F7',
  '8',
  'I',
  'K',
  ',',
  'RAlt',
  'F8',
  '9',
  'O',
  'L',
  '.',
  'F9',
  '0',
  'P',
  ';',
  '/',
  'Fn',
  'F10',
  '-',
  '[',
  "'",
  'F11',
  '=',
  ']',
  '',
  'Menu',
  'F12',
  'Backspace',
  '\\',
  'Enter',
  'RShift',
  'RCtrl',
  'PrtSc',
  'Ins',
  'Del',
  'Left',
  'ScrLk',
  'Home',
  'End',
  'Up',
  'Down',
  'Pause',
  'PgUp',
  'PgDn',
  'Right',
  'NumLock',
  'KP7',
  'KP4',
  'KP1',
  'KP0',
  'KP/',
  'KP8',
  'KP5',
  'KP2',
  'KP*',
  'KP9',
  'KP6',
  'KP3',
  'KP.',
  'KP-',
  'KP+',
  'KPEnter',
];
/** Wire slots the firmware skips (inserted as black between the LEDs). */
const ORIGINS_SKIP = [
  23, 29, 41, 47, 59, 70, 71, 87, 88, 93, 99, 100, 102, 108, 113, 114, 120, 123, 124,
];

export class HyperXOriginsDriver extends DirectLightingDriver {
  private send(d: number[]): Promise<void> {
    const p = new Uint8Array(64);
    p.set(d);
    return this.tr().sendFeatureReport(0, p);
  }
  protected async takeControl(): Promise<void> {
    // The direct initialisation is part of every frame (as in OpenRGB).
  }
  protected async sendFrame(frame: Rgb[]): Promise<void> {
    const wire: Rgb[] = [...frame];
    for (const s of ORIGINS_SKIP) wire.splice(s, 0, { r: 0, g: 0, b: 0 });
    await this.send([0x04, 0xf2, 0, 0, 0, 0, 0, 0, 0x09]);
    for (let pkt = 0; pkt < 9; pkt++) {
      const d: number[] = [];
      const slice = wire.slice(pkt * 16, pkt * 16 + 16);
      for (const c of slice.length ? slice : [{ r: 0, g: 0, b: 0 }]) d.push(0x81, c.r, c.g, c.b);
      await this.send(d);
    }
  }
}

export const hyperxOriginsProtocol = defineDirect({
  id: 'hyperx-alloy-origins',
  name: 'HyperX Alloy Origins (direct lighting)',
  ids: [
    { vendorId: 0x0951, productId: 0x16e5, model: 'HyperX Alloy Origins' },
    { vendorId: 0x03f0, productId: 0x0591, model: 'HyperX Alloy Origins (HP)' },
  ],
  channel: (c) => notKeyboard(c) && c.featureReports.some((r) => r.reportId === 0 && r.size === 64),
  channelText: 'vendor feature report 0 (64 B)',
  reference: OPENRGB('HyperXKeyboardController/HyperXAlloyOriginsController'),
  limitations: [
    'There is no command to give the lighting back: unplug the keyboard to see its own effects again.',
  ],
  make: (g, i, model, o) =>
    new HyperXOriginsDriver(
      g,
      i,
      {
        protocolId: 'hyperx-alloy-origins',
        protocolName: 'HyperX direct lighting (64-byte feature reports)',
        model,
        leds: ORIGINS_LEDS,
        size: 'full',
        rightMods: 'fn',
        source: OPENRGB('HyperXKeyboardController/HyperXAlloyOriginsController'),
        evidence: Evidence.INFERRED,
        canRelease: false,
      },
      o,
    ),
});

// ---------------------------------------------------------------- Ducky One 2 RGB / Shine 7

const DUCKY_LEDS = [
  'Esc',
  '`',
  'Tab',
  'Caps',
  'LShift',
  'LCtrl',
  '',
  '1',
  'Q',
  'A',
  '',
  'LWin',
  'F1',
  '2',
  'W',
  'S',
  'Z',
  'LAlt',
  'F2',
  '3',
  'E',
  'D',
  'X',
  '',
  'F3',
  '4',
  'R',
  'F',
  'C',
  '',
  'F4',
  '5',
  'T',
  'G',
  'V',
  '',
  '',
  '6',
  'Y',
  'H',
  'B',
  'Space',
  'F5',
  '7',
  'U',
  'J',
  'N',
  '',
  'F6',
  '8',
  'I',
  'K',
  'M',
  '',
  'F7',
  '9',
  'O',
  'L',
  ',',
  '',
  'F8',
  '0',
  'P',
  ';',
  '.',
  'RAlt',
  'F9',
  '-',
  '[',
  "'",
  '/',
  '',
  'F10',
  '=',
  ']',
  '',
  '',
  'RWin',
  'F11',
  '',
  '',
  '',
  'RShift',
  'Fn',
  'F12',
  'Backspace',
  '\\',
  'Enter',
  '',
  'RCtrl',
  'PrtSc',
  'Ins',
  'Del',
  '',
  '',
  'Left',
  'ScrLk',
  'Home',
  'End',
  '',
  'Up',
  'Down',
  'Pause',
  'PgUp',
  'PgDn',
  '',
  '',
  'Right',
  'NumLock',
  'KP7',
  'KP4',
  'KP1',
  'KP0',
  '',
  'KP/',
  'KP8',
  'KP5',
  'KP2',
  '',
  '',
  'KP*',
  'KP9',
  'KP6',
  'KP3',
  'KP.',
  '',
  'KP-',
  'KP+',
  '',
  '',
  'KPEnter',
  ...new Array<string>(155 - 131).fill(''),
];

export class DuckyDriver extends DirectLightingDriver {
  private send(d: number[]): Promise<void> {
    const p = new Uint8Array(64);
    p.set(d);
    return this.tr().sendOutputReport(0, p);
  }
  protected async takeControl(): Promise<void> {
    await this.send([0x41, 0x01]);
  }
  protected async sendFrame(frame: Rgb[]): Promise<void> {
    const data = frame.flatMap((c) => [c.r, c.g, c.b]);
    await this.send([0x56, 0x81, 0, 0, 0x01, 0, 0, 0, 0x08, 0, 0, 0, 0xaa, 0xaa, 0xaa, 0xaa]);
    let at = 0;
    for (let pkt = 0; pkt < 8; pkt++) {
      const head =
        pkt === 0
          ? [
              0x56, 0x83, 0, 0, 0x01, 0, 0, 0, 0x80, 0x01, 0, 0xc1, 0, 0, 0, 0, 0xff, 0xff, 0xff,
              0xff, 0, 0, 0, 0,
            ]
          : [0x56, 0x83, pkt, 0];
      const room = 64 - head.length;
      await this.send([...head, ...data.slice(at, at + room)]);
      at += room;
    }
    await this.send([0x51, 0x28, 0, 0, 0xff]);
  }
}

export const duckyProtocol = defineDirect({
  id: 'ducky-rgb',
  name: 'Ducky One 2 RGB / Shine 7 (direct lighting)',
  ids: [
    { vendorId: 0x04d9, productId: 0x0348, model: 'Ducky One 2 RGB / Shine 7' },
    { vendorId: 0x04d9, productId: 0x0356, model: 'Ducky One 2 RGB TKL' },
  ],
  channel: (c) => notKeyboard(c) && c.outputReports.some((r) => r.reportId === 0 && r.size === 64),
  channelText: 'vendor output report 0 (64 B)',
  reference: OPENRGB('DuckyKeyboardController'),
  limitations: [
    'There is no command to give the lighting back: unplug the keyboard to see its own effects again.',
    'The Ducky One 3 is not covered: its protocol is not public.',
  ],
  make: (g, i, model, o) =>
    new DuckyDriver(
      g,
      i,
      {
        protocolId: 'ducky-rgb',
        protocolName: 'Ducky direct lighting (64-byte output reports)',
        model,
        leds: DUCKY_LEDS,
        size: g.identity.productId === 0x0356 ? 'tkl' : 'full',
        rightMods: 'fn',
        source: OPENRGB('DuckyKeyboardController'),
        evidence: Evidence.INFERRED,
        canRelease: false,
      },
      o,
    ),
});
