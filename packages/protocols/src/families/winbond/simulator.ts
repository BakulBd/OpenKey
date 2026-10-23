import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID, USAGE, USAGE_PAGE } from './protocol.js';

/** The MK870's interfaces as its owner's support bundle shows them; every packet is kept. */
export class WinbondSimulator {
  readonly device: MockHidDevice;
  readonly packets: Uint8Array[] = [];
  /** Whether the simulated keyboard answers the lighting query (tests both outcomes). */
  answersQueries = true;
  /** What the simulated keyboard answers to the model query. */
  modelCode = 'K223RGB';
  /** Whether the simulated keyboard acknowledges macro packets. */
  acksMacros = true;
  /** Macro records received, by slot. */
  readonly macroRecords = new Map<number, Uint8Array>();
  /** Last lighting record written (`07 00 …`); starts as static red at full brightness. */
  lighting = Uint8Array.from([
    0x07,
    0x00,
    0x00,
    0x00,
    0x0e,
    0x00,
    0x04,
    0x02,
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0x02,
    0x00,
    ...new Array(47).fill(0),
  ]);

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x0416,
      productId: 0xc345,
      productName: 'Gaming Keyboard',
    },
  ) {
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0x0c,
              usage: 0x01,
              inputReports: [{ reportId: 2, size: 3 }],
              outputReports: [],
              featureReports: [],
            },
            {
              usagePage: 0x01,
              usage: 0x02,
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
              usagePage: USAGE_PAGE,
              usage: USAGE,
              inputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              outputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              featureReports: [],
            },
          ],
        },
        behavior: {
          onOutput: (_id, d, ctx) => {
            this.packets.push(d);
            if (d[0] === 0x07 && d[1] === 0x00) this.lighting = d.slice();
            // Macro records are kept per slot (five packets each) and acknowledged.
            if (d[0] === 0x19 && this.acksMacros) {
              const record = this.macroRecords.get(d[1]!) ?? new Uint8Array(256);
              const offset = d[3]! * 0x3a;
              record.set(d.subarray(5, 5 + d[4]!), offset);
              this.macroRecords.set(d[1]!, record);
            }
            // Key-map and macro packets are acknowledged with an echo of the command.
            if (d[0] === 0x18 || (d[0] === 0x19 && this.acksMacros)) {
              const ack = new Uint8Array(REPORT_BYTES);
              ack.set(d.subarray(0, 5));
              ctx.emitInput(ack);
            }
            // Model query: answers with a model code (an assumption for tests; the real code is
            // what the protocol check is for).
            if (this.answersQueries && d[0] === 0x15) {
              const r = new Uint8Array(REPORT_BYTES);
              r[0] = 0x15;
              r.set(
                Array.from(this.modelCode, (c) => c.charCodeAt(0)),
                4,
              );
              ctx.emitInput(r);
            }
            // Lighting query: answers with the lighting record, as the official driver reads it.
            if (this.answersQueries && d[0] === 0x07 && d[1] === 0x01) {
              const r = this.lighting.slice();
              r[1] = 0x01;
              ctx.emitInput(r);
            }
          },
        },
      },
    ]);
  }
}
