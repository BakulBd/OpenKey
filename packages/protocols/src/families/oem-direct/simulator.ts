import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';

/** A direct-lighting keyboard: one vendor collection that accepts reports and keeps them for tests. */
export class DirectSimulator {
  readonly device: MockHidDevice;
  readonly reports: { op: 'feature' | 'output'; id: number; data: Uint8Array }[] = [];

  constructor(identity: DeviceIdentity, collection: HidCollection) {
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0x01,
              usage: 0x06,
              inputReports: [],
              outputReports: [],
              featureReports: [],
            },
          ],
        },
        behavior: {},
      },
      {
        info: { collections: [collection] },
        behavior: {
          onFeatureSet: (id, d) => void this.reports.push({ op: 'feature', id, data: d.slice() }),
          onOutput: (id, d) => void this.reports.push({ op: 'output', id, data: d.slice() }),
        },
      },
    ]);
  }
}

const col = (
  usagePage: number,
  feature: [number, number] | null,
  output: [number, number] | null,
): HidCollection => ({
  usagePage,
  usage: 0x01,
  inputReports: [],
  outputReports: output ? [{ reportId: output[0], size: output[1] }] : [],
  featureReports: feature ? [{ reportId: feature[0], size: feature[1] }] : [],
});

export const bloodyB820RSimulator = () =>
  new DirectSimulator(
    { vendorId: 0x09da, productId: 0xfa10, productName: 'Bloody B820R' },
    { ...col(0xff52, [7, 63], null), usage: 0x0210 },
  );
export const hyperxOriginsSimulator = () =>
  new DirectSimulator(
    { vendorId: 0x0951, productId: 0x16e5, productName: 'HyperX Alloy Origins' },
    col(0xff90, [0, 64], null),
  );
export const duckySimulator = (productId = 0x0348) =>
  new DirectSimulator(
    { vendorId: 0x04d9, productId, productName: 'Ducky One 2 RGB' },
    col(0xff00, null, [0, 64]),
  );

/** A SteelSeries Apex lighting channel: answers the firmware read, keeps commands and frames. */
export class SteelSeriesSimulator {
  readonly device: MockHidDevice;
  readonly commands: number[] = [];
  readonly frames: Uint8Array[] = [];
  constructor(productId = 0x1614, firmware = '1.19.7') {
    this.device = new MockHidDevice(
      { vendorId: 0x1038, productId, productName: 'SteelSeries Apex Pro TKL' },
      [
        {
          info: {
            collections: [
              {
                usagePage: 0x01,
                usage: 0x06,
                inputReports: [],
                outputReports: [],
                featureReports: [],
              },
            ],
          },
          behavior: {},
        },
        {
          info: {
            collections: [
              {
                usagePage: 0xffc0,
                usage: 0x01,
                inputReports: [{ reportId: 0, size: 64 }],
                outputReports: [{ reportId: 0, size: 64 }],
                featureReports: [{ reportId: 0, size: 642 }],
              },
            ],
          },
          behavior: {
            onOutput: (_id, d, ctx) => {
              this.commands.push(d[0]!);
              if (d[0] === 0x90) {
                const r = new Uint8Array(64);
                r[0] = 0x90;
                r.set(new TextEncoder().encode(firmware), 1);
                ctx.emitInput(r);
              }
            },
            onFeatureSet: (_id, d) => void this.frames.push(d.slice()),
          },
        },
      ],
    );
  }
}
