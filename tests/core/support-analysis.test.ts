import { describe, expect, it } from 'vitest';
import {
  buildSupportBundle,
  descriptorFingerprint,
  descriptorSignature,
  parseSupportBundle,
  supportBundleToIssue,
  vendorChannels,
} from '@openkey/core';
import type { SupportDevice } from '@openkey/core';
import { protocolHints } from '@openkey/devices';

const env = {
  appVersion: 'test',
  userAgent: 'test',
  platform: 'Linux',
  webHid: true,
  secureContext: true,
};

/** The MK870 as its owner's support bundle (2026-10-23) reported it. */
const MK870: SupportDevice = {
  vendorId: '0x0416',
  productId: '0xC345',
  productName: 'Gaming Keyboard',
  transport: 'usb',
  interfaces: [
    {
      collections: [
        {
          usagePage: '0x000C',
          usage: '0x0001',
          inputReports: [{ reportId: 2, size: 3 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: '0x0001',
          usage: '0x0002',
          inputReports: [],
          outputReports: [],
          featureReports: [],
        },
      ],
    },
    {
      collections: [
        {
          usagePage: '0xFF1B',
          usage: '0x0091',
          inputReports: [{ reportId: 1, size: 63 }],
          outputReports: [{ reportId: 1, size: 63 }],
          featureReports: [],
        },
      ],
    },
  ],
};

describe('diagnostic analysis', () => {
  it('fingerprints the HID layout independently of interface order and identity', () => {
    const swapped: SupportDevice = {
      ...MK870,
      productId: '0x1234',
      interfaces: [...MK870.interfaces].reverse(),
    };
    expect(descriptorSignature(swapped)).toBe(descriptorSignature(MK870));
    expect(descriptorFingerprint(swapped)).toBe(descriptorFingerprint(MK870));
    expect(descriptorFingerprint(MK870)).toMatch(/^[0-9a-f]{8}$/);
    const other = {
      ...MK870,
      interfaces: [MK870.interfaces[0]!],
    };
    expect(descriptorFingerprint(other)).not.toBe(descriptorFingerprint(MK870));
  });

  it('classifies vendor channels: the MK870 has a 64-byte request/answer channel', () => {
    expect(vendorChannels(MK870)).toEqual([
      {
        interfaceIndex: 1,
        usagePage: '0xFF1B',
        usage: '0x0091',
        kind: 'command',
        reportIds: [1],
        frameBytes: 64,
      },
    ]);
    const r75: SupportDevice = {
      ...MK870,
      interfaces: [
        {
          collections: [
            {
              usagePage: '0xFF00',
              usage: '0x0001',
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 6, size: 519 }],
            },
          ],
        },
      ],
    };
    expect(vendorChannels(r75)[0]).toMatchObject({ kind: 'feature', frameBytes: 520 });
  });

  it('names the Winbond family for the MK870, with what the sources document', () => {
    const [hint] = protocolHints(MK870);
    expect(hint).toMatchObject({ id: 'winbond-oem', basis: 'identity' });
    expect(hint!.title).toMatch(/MK870/);
    expect(hint!.facts.join(' ')).toMatch(/18 key map/);
    // Same identity without the vendor channel: says what is missing.
    const hidden = { ...MK870, interfaces: [MK870.interfaces[0]!] };
    expect(protocolHints(hidden)[0]!.facts[0]).toMatch(/not visible/);
    // Unrelated device: no hint.
    expect(
      protocolHints({ ...MK870, vendorId: '0x1234', interfaces: [MK870.interfaces[0]!] }),
    ).toEqual([]);
  });

  it('adds the analysis to the package without payloads or serial numbers', () => {
    const b = buildSupportBundle({
      environment: env,
      device: { ...MK870, serialNumber: 'SN-777' },
      connectionState: 'READY',
      hints: protocolHints(MK870),
      candidates: [
        {
          id: 'winbond-lighting',
          family: 'winbond-lighting',
          applicable: true,
          score: 60,
          reasons: ['FF1B:0091 output report 1 (63 B)'],
          rejections: [],
          probe: {
            status: 'pass',
            summary: 'identified',
            identified: true,
            steps: [
              { name: 'model list', status: 'pass', detail: 'FL Esports MK870' },
              { name: 'device SN read', status: 'pass', detail: 'SN-777' },
            ],
          },
        },
      ],
      protocolChecks: [
        {
          id: 'lighting-query',
          title: 'Lighting query',
          command: '07 01',
          source: 'FL Esports driver',
          status: 'answered',
          reply: { reportId: 1, length: 63, echo: true, firstByte: '0x07', nonZeroBytes: 9 },
          detail: 'The keyboard answered.',
          at: '2026-10-23T00:00:00.000Z',
        },
      ],
    });
    const json = JSON.stringify(b);
    expect(json).not.toContain('SN-777');
    expect(b.analysis?.fingerprint).toBe(descriptorFingerprint(MK870));
    expect(b.analysis?.candidates[0]!.probe!.steps[1]!.detail).toBe('(redacted)');
    expect(b.analysis?.protocolChecks[0]!.reply).toEqual({
      reportId: 1,
      length: 63,
      echo: true,
      firstByte: '0x07',
      nonZeroBytes: 9,
    });
    const issue = supportBundleToIssue(b);
    expect(issue).toMatch(
      /Vendor channel 0xFF1B:0x0091 \(interface 1\): command, report 1, 64-byte frames/,
    );
    expect(issue).toMatch(/Known family \(identity\): Winbond/);
    expect(issue).toMatch(/Protocol check Lighting query \(`07 01`\): answered, report 1, 63 B/);
    // Imported packages keep only identity and descriptors.
    expect(parseSupportBundle(json).analysis).toBeUndefined();
  });

  it('lists the closest adapters and why they did not match when none applies', () => {
    const b = buildSupportBundle({
      environment: env,
      device: MK870,
      connectionState: 'READY',
      candidates: [
        {
          id: 'evision',
          family: 'evision',
          applicable: false,
          score: 0,
          reasons: [],
          rejections: ['no FF1C collection with output report 4 (63 B)'],
        },
      ],
    });
    expect(supportBundleToIssue(b)).toMatch(/Not matched `evision`: no FF1C collection/);
  });

  it('keeps only short identifiers as check facts', () => {
    const b = buildSupportBundle({
      environment: env,
      device: MK870,
      connectionState: 'READY',
      protocolChecks: [
        {
          id: 'model-query',
          title: 'Model query',
          command: '15',
          source: 'driver',
          status: 'answered',
          facts: { driverModel: 'K223RGB', note: 'free text with spaces' },
          detail: 'ok',
          at: '2026-10-24T00:00:00.000Z',
        },
      ],
    });
    expect(b.analysis?.protocolChecks[0]!.facts).toEqual({ driverModel: 'K223RGB' });
    expect(supportBundleToIssue(b)).toMatch(/driverModel `K223RGB`/);
  });
});
