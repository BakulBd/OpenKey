import { Evidence } from '@openkey/core';
import { LoggingTransport, findInterface } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';
import type { ProbeContext, ProbeResult, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { HMK_PROTOCOL_ID, HMK_USAGE, HMK_USAGE_PAGE } from './constants.js';
import { HmkDriver } from './driver.js';
import { HmkSession } from './session.js';

const isRaw = (c: HidCollection) => c.usagePage === HMK_USAGE_PAGE && c.usage === HMK_USAGE;

export const hmkProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: HMK_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification:
      'Implemented from the libhmk firmware sources and tested against a firmware simulator; not yet run by OpenKey on a libhmk keyboard.',
    safety:
      'Keymaps and actuation settings are read back after every write. Reboot, bootloader, factory reset, recalibration, calibration writes and profile reset/copy are never sent, and the bootloader key is never assigned.',
    provenance: [
      {
        source: 'public-specification',
        reference:
          'peppapighs/libhmk include/commands.h, src/commands.c, src/keycodes.c, scripts/metadata.py (GPL-3.0; facts only)',
        status: Evidence.OBSERVED,
      },
      {
        source: 'public-specification',
        reference: 'peppapighs/hmkconf metadata reading and layout placement (GPL-3.0; facts only)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Edits the active profile; switch profiles on the keyboard.',
      'Advanced keys (tap-hold, toggle, dynamic keystroke), macros, gamepad and calibration are left to hmkconf for now.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'libhmk (Hall-effect keyboards)',
  family: 'hmk',
  priority: 55,
  supportedDevices: 'Keyboards running the libhmk Hall-effect firmware',
  supportedFirmware: 'libhmk raw HID protocol',
  requiredUsagePages: [HMK_USAGE_PAGE],
  requiredReports: ['FFAB:00AB output 64B'],
  evidence: ['libhmk include/commands.h', 'hmkconf'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FFAB:00AB',
        reportId: 0,
        payloadPrefix: '00',
        purpose: 'COMMAND_FIRMWARE_VERSION: read-only, the first command hmkconf sends.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FFAB:00AB',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The answer echoes command 0 and carries the 16-bit firmware version.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    // FFAB is not a reserved page: ask before sending even this read-only query.
    autoConsent: () => ({
      auto: false,
      reason: 'usage page FFAB:00AB is libhmk’s, but other firmware could use it',
    }),
  },
  match(group) {
    const i = findInterface(group, isRaw);
    return i
      ? {
          applicable: true,
          score: 70,
          reasons: ['libhmk raw HID collection FFAB:00AB'],
          rejections: [],
        }
      : { applicable: false, score: 0, reasons: [], rejections: ['no FFAB:00AB collection'] };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new HmkSession(await ctx.open(findInterface(ctx.group, isRaw)!));
    const v = await s.firmwareVersion().catch(() => null);
    const ok = v !== null;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `libhmk firmware ${v >> 8}.${v & 0xff}` : 'No libhmk answer',
      steps: [
        {
          name: 'COMMAND_FIRMWARE_VERSION',
          status: ok ? 'pass' : 'fail',
          detail: ok ? 'answered' : 'no answer',
        },
      ],
      facts: { hmkVersion: v },
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const iface = findInterface(group, isRaw);
    if (!iface) throw new Error('libhmk raw HID interface missing');
    return new HmkDriver(
      group,
      iface,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    );
  },
};
