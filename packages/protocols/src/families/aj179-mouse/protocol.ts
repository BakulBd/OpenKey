import { Evidence } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroupInfo } from '@openkey/hid';
import type { ProbeContext, ProbeResult, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { AJ179_IDENTITIES, AJ179_PROTOCOL_ID, Cmd, REPORT_LEN, decodeInfo } from './codec.js';
import { Aj179MouseDriver, Aj179Session } from './driver.js';

/** The configuration interface: 32-byte input and output reports without a report ID. */
const isConfig = (c: HidCollection) =>
  c.usagePage !== 0x0001 &&
  c.inputReports.some((r) => r.reportId === 0 && r.size === REPORT_LEN) &&
  c.outputReports.some((r) => r.reportId === 0 && r.size === REPORT_LEN);
const known = (g: HidDeviceGroupInfo) =>
  AJ179_IDENTITIES.some(
    (i) => i.vendorId === g.identity.vendorId && i.productId === g.identity.productId,
  );
const configIface = (g: HidDeviceGroupInfo) =>
  g.interfaces.find((i) => i.collections.some(isConfig));

export const aj179MouseProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: AJ179_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from a public protocol reference reverse-engineered from the vendor driver and checked by its author on an AJ179 (cable and receiver); tested against a simulator, not yet run by OpenKey on the mouse.',
    safety:
      'Every setting is read first, written, and read back. Button mapping and macros cannot be read back: they are written behind the experimental opt-in, and the left button always stays a left click. The resets and the firmware updater are never sent.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'Rockeyxx/aj179-linux docs/PROTOCOL.md and src/protocol.c (MIT)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Button mapping and macros cannot be read from the mouse: OpenKey shows what it last wrote. Long macros (more than six presses and releases) are sent in chunks as the vendor app does; only short ones were checked on the mouse by the source.',
      'Through the receiver, settings need the mouse awake (move it).',
      'Only the tested AJ179 rates (125–1000 Hz) are offered unless the mouse reports faster ones.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'AJAZZ AJ179 mouse (AJAZZ Driver X protocol)',
  family: AJ179_PROTOCOL_ID,
  priority: 50,
  supportedDevices: 'AJAZZ AJ179: receiver 249A:5C2F, cable 248A:5C2E / 5D2E / 5E2E',
  supportedFirmware: 'AJAZZ Driver (X) device type 105',
  requiredUsagePages: [],
  requiredReports: ['input + output 32B, no report ID'],
  evidence: ['Rockeyxx/aj179-linux'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'vendor (32-byte reports)',
        reportId: 0,
        payloadPrefix: '10 00 00 00',
        purpose:
          'Device info read: the vendor driver sends it whenever the receiver opens or the mouse comes online.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'vendor (32-byte reports)',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The reply echoes 0x10 and carries the device id ("M179"), sensor and battery.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: (g) =>
      known(g)
        ? { auto: true, reason: 'the vendor driver sends this read to this exact identity' }
        : { auto: false, reason: 'not an AJ179 identity' },
  },
  match(group) {
    const i = configIface(group);
    return known(group) && i
      ? {
          applicable: true,
          score: 80,
          reasons: ['AJ179 identity', '32-byte vendor configuration interface'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: [
            known(group) ? 'no 32-byte configuration interface' : 'not an AJ179 identity',
          ],
        };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const iface = configIface(ctx.group);
    if (ctx.level !== 'handshake' || !iface)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const wireless = ctx.group.transportHint !== 'usb';
    const s = new Aj179Session(await ctx.open(iface), wireless ? 3000 : 1000);
    const r = await s.read(Cmd.INFO).catch(() => null);
    const info = r ? decodeInfo(r) : null;
    const ok = !!info && /^M\d{3}$/.test(info.id);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `AJAZZ mouse ${info!.id}` : 'No AJ179 answer to the info read',
      steps: [
        {
          name: 'device info (10)',
          status: ok ? 'pass' : 'fail',
          detail: info ? info.id : 'no answer',
        },
      ],
      facts: ok ? { deviceId: info!.id, sensor: info!.sensor } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const iface = configIface(group);
    if (!iface) throw new Error('AJ179 configuration interface missing');
    return new Aj179MouseDriver(
      group,
      iface,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      opts.store,
    );
  },
};
