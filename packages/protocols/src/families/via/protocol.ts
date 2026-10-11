import { Evidence, hex16, toHex } from '@openkey/core';
import { LoggingTransport, findInterface } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';
import type { CandidateMatch, ProbeContext, ProbeResult, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { RAW_USAGE, RAW_USAGE_PAGE, VIA_PROTOCOL_ID } from './constants.js';
import { ViaDriver } from './driver.js';
import { ViaSession } from './session.js';

const isRaw = (c: HidCollection) => c.usagePage === RAW_USAGE_PAGE && c.usage === RAW_USAGE;

export const viaProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: VIA_PROTOCOL_ID,
  manifest: {
    version: '1.0.0',
    status: 'community',
    transports: { input: ['usb', 'bluetooth', '2.4ghz'], configuration: ['usb'] },
    verification:
      'Implemented from the VIA protocol in QMK (quantum/via.c). Tested against a firmware simulator; not yet run by OpenKey on a physical VIA keyboard.',
    safety:
      'Keymaps, macros and lighting are read back after every write. The keymap reset, EEPROM reset, macro reset and bootloader commands are never sent, and bootloader/erase keycodes are never offered for assignment.',
    provenance: [
      { source: 'public-specification', reference: 'QMK quantum/via.h, via.c, dynamic_keymap.c, keycodes.h (GPL-2.0; facts only)', status: Evidence.OBSERVED },
      { source: 'public-specification', reference: 'VIA definition specification (the-via/website docs/specification.md)', status: Evidence.OBSERVED },
    ],
    license: 'MIT',
    limitations: [
      'The physical layout comes from a VIA definition or QMK info.json you load once per keyboard model; without one, a matrix grid is used.',
      'Lighting effect names assume every QMK effect is compiled in, as in the VIA app; the effect number is always shown.',
      'Tap dance, combos and other Vial-only features are not configured; Vial boards work through their VIA commands.',
      'Rotary encoder mapping and layout options are not edited yet.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'VIA (QMK raw HID): any keyboard with VIA or Vial firmware',
  family: 'qmk-via',
  priority: 60,
  supportedDevices: 'Keyboards running QMK with VIA enabled (Keychron, GMMK Pro, many custom boards) and Vial firmware',
  supportedFirmware: 'VIA protocol 0x0009 and later (keycodes v1 and v2)',
  requiredUsagePages: [RAW_USAGE_PAGE],
  requiredReports: ['FF60:0061 output 32B'],
  evidence: ['QMK quantum/via.c', 'QMK raw HID documentation', 'VIA definition specification'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FF60:0061',
        reportId: 0,
        payloadPrefix: '01',
        purpose: 'VIA id_get_protocol_version: read-only, the first command every VIA client sends.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FF60:0061',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'Answer echoes 01 followed by the 16-bit protocol version.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: () => ({ auto: true, reason: 'public specification: FF60:0061 is QMK raw HID and the query is read-only' }),
  },
  match(group): CandidateMatch {
    const i = findInterface(group, isRaw);
    // The AK820 2.4 GHz receiver also exposes FF60 (afonsusousa/mrworldwide); leave it to sonix-dongle.
    const dongle = /dongle|2\.4g/i.test(group.identity.productName) || group.identity.productId === 0xfdfd;
    return i && !dongle
      ? { applicable: true, score: 70, reasons: ['QMK raw HID collection FF60:0061 (VIA)'], rejections: [] }
      : { applicable: false, score: 0, reasons: [], rejections: [dongle ? 'receiver identity' : 'no FF60:0061 raw HID collection'] };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake') return { status: 'skipped', confidence: Evidence.INFERRED, summary: 'Descriptor signature only.', steps: [], facts: {} };
    const iface = findInterface(ctx.group, isRaw)!;
    const s = new ViaSession(await ctx.open(iface));
    const version = await s.protocolVersion().catch(() => null);
    const ok = version !== null;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `VIA protocol version ${hex16(version!)}` : 'No VIA answer',
      steps: [{ name: 'VIA id_get_protocol_version', status: ok ? 'pass' : 'fail', detail: ok ? 'answered' : 'no answer', ...(ok ? { raw: toHex(Uint8Array.of(version! >> 8, version! & 0xff)) } : {}) }],
      facts: { viaVersion: version },
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const iface = findInterface(group, isRaw);
    if (!iface) throw new Error('VIA raw HID interface missing');
    return new ViaDriver(group, iface, { store: opts.store, open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log) });
  },
};
