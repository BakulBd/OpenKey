import { MockHidDevice } from '@openkey/hid';
import type { MockBehavior } from '@openkey/hid';
import type { DeviceIdentity } from '@openkey/core';
import {
  ACK_OFFSET,
  ACK_OK,
  CONTROL_USAGE,
  CONTROL_USAGE_PAGE,
  COMMAND_PREFIX,
  Cmd,
  DATA_CHUNK_SIZE,
  DATA_USAGE,
  DATA_USAGE_PAGE,
  PACKET_SIZE,
  TABLE_BYTES,
} from './constants.js';

/** Interface layout of the AK820 MAX test unit (re/descriptors). */
export function sonixFeatureInterfaces() {
  return {
    keyboard: {
      interfaceNumber: 0,
      collections: [
        {
          usagePage: 0x01,
          usage: 0x06,
          inputReports: [{ reportId: 0, size: 8 }],
          outputReports: [{ reportId: 0, size: 1 }],
          featureReports: [],
        },
      ],
    },
    media: {
      interfaceNumber: 1,
      collections: [
        {
          usagePage: 0x0c,
          usage: 0x01,
          inputReports: [{ reportId: 3, size: 2 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0x01,
          usage: 0x80,
          inputReports: [{ reportId: 2, size: 1 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0x01,
          usage: 0x06,
          inputReports: [{ reportId: 1, size: 15 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0x01,
          usage: 0x02,
          inputReports: [{ reportId: 6, size: 4 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0xffff,
          usage: 0x01,
          inputReports: [{ reportId: 5, size: 3 }],
          outputReports: [],
          featureReports: [],
        },
      ],
    },
    data: {
      interfaceNumber: 2,
      collections: [
        {
          usagePage: DATA_USAGE_PAGE,
          usage: DATA_USAGE,
          inputReports: [{ reportId: 0, size: 64 }],
          outputReports: [{ reportId: 0, size: DATA_CHUNK_SIZE }],
          featureReports: [],
        },
      ],
    },
    control: {
      interfaceNumber: 3,
      collections: [
        {
          usagePage: CONTROL_USAGE_PAGE,
          usage: CONTROL_USAGE,
          inputReports: [{ reportId: 0, size: 64 }],
          outputReports: [{ reportId: 0, size: 64 }],
          featureReports: [{ reportId: 0, size: 64 }],
        },
      ],
    },
  };
}

type Pending = { cmd: number; expectBytes: number; buffer: number[] } | null;

/** Observable firmware state. */
export interface SonixFeatureSimState {
  transactions: number;
  saves: number;
  lighting: Uint8Array | null;
  settings: Uint8Array | null;
  time: Uint8Array | null;
  keymapBase: Uint8Array | null;
  keymapFn: Uint8Array | null;
  perKey: Uint8Array;
  macros: Uint8Array | null;
  tft: { slot: number; chunks: number; data: Uint8Array } | null;
  lastPacket: Uint8Array;
  unknownCommands: number[];
}

/**
 * Behavioural model of the firmware, derived from what the official driver expects. Used by CI
 * tests and the web demo; it is not evidence about the real firmware.
 */
export class SonixFeatureSimulator {
  readonly state: SonixFeatureSimState = {
    transactions: 0,
    saves: 0,
    lighting: null,
    settings: null,
    time: null,
    keymapBase: null,
    keymapFn: null,
    perKey: new Uint8Array(TABLE_BYTES),
    macros: null,
    tft: null,
    lastPacket: new Uint8Array(PACKET_SIZE),
    unknownCommands: [],
  };
  private pending: Pending = null;
  private expectData: number | null = null;
  private readQueue: Uint8Array[] = [];
  private tftExpected = 0;
  private tftChunks: Uint8Array[] = [];
  readonly device: MockHidDevice;

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x0c45,
      productId: 0x8009,
      productName: 'AK820 MAX',
      manufacturer: 'SONiX',
      release: 0x0107,
    },
  ) {
    // Observed on hardware: every entry carries its own slot index, unused LEDs are black.
    for (let n = 0; n < TABLE_BYTES / 4; n++) this.state.perKey.set([n, 0, 0, 0], n * 4);
    for (let n = 1; n < 122; n++) this.state.perKey.set([n, 0xff, 0xff, 0xff], n * 4);
    const ifs = sonixFeatureInterfaces();
    const control: MockBehavior = {
      onFeatureSet: (_id, data) => this.onFeature(data),
      onFeatureGet: () => {
        const next = this.readQueue.shift();
        if (next) return next;
        const echo = this.state.lastPacket.slice();
        echo[ACK_OFFSET] = ACK_OK;
        return echo;
      },
    };
    const dataPipe: MockBehavior = {
      onOutput: (_id, data, ctx) => {
        if (data.length !== DATA_CHUNK_SIZE)
          throw new Error(`sim: data chunk must be ${DATA_CHUNK_SIZE} bytes`);
        this.tftChunks.push(data.slice());
        ctx.emitInput(Uint8Array.from([0x01, 0x5a, 0x02, 0x00, ...new Array(60).fill(0)]));
        if (this.tftChunks.length === this.tftExpected && this.state.tft) {
          const all = new Uint8Array(this.tftExpected * DATA_CHUNK_SIZE);
          this.tftChunks.forEach((c, i) => all.set(c, i * DATA_CHUNK_SIZE));
          this.state.tft.data = all;
        }
      },
    };
    this.device = new MockHidDevice(identity, [
      { info: ifs.keyboard, behavior: {} },
      { info: ifs.media, behavior: {} },
      { info: ifs.data, behavior: dataPipe },
      { info: ifs.control, behavior: control },
    ]);
  }

  private onFeature(data: Uint8Array): void {
    if (data.length !== PACKET_SIZE) throw new Error('sim: feature report must be 64 bytes');
    this.state.lastPacket = data.slice();
    // Multi-packet table in progress.
    if (this.pending) {
      this.pending.buffer.push(...data);
      if (this.pending.buffer.length >= this.pending.expectBytes) this.finishTable();
      return;
    }
    if (this.expectData !== null) {
      const cmd = this.expectData;
      this.expectData = null;
      if (cmd === Cmd.LIGHT_MODE) this.state.lighting = data.slice();
      else if (cmd === Cmd.SETTINGS) this.state.settings = data.slice();
      else if (cmd === Cmd.TIME) this.state.time = data.slice();
      return;
    }
    if (data[0] !== COMMAND_PREFIX) return;
    const cmd = data[1]!;
    const arg8 = data[8]!;
    switch (cmd) {
      case Cmd.START:
        this.state.transactions++;
        break;
      case Cmd.SAVE:
        this.state.saves++;
        break;
      case Cmd.FINISH:
      case Cmd.MACRO_BEGIN:
        break;
      case Cmd.LIGHT_MODE:
      case Cmd.SETTINGS:
      case Cmd.TIME:
        this.expectData = cmd;
        break;
      case Cmd.KEYMAP_BASE:
      case Cmd.KEYMAP_FN:
      case Cmd.PER_KEY_RGB:
      case Cmd.MACRO_DATA:
      case Cmd.REALTIME_RGB:
        this.pending = { cmd, expectBytes: arg8 * PACKET_SIZE, buffer: [] };
        break;
      case Cmd.READ_PER_KEY_RGB: {
        const ack = data.slice();
        ack[ACK_OFFSET] = ACK_OK;
        this.readQueue = [ack];
        for (let i = 0; i < arg8; i++)
          this.readQueue.push(this.state.perKey.slice(i * PACKET_SIZE, (i + 1) * PACKET_SIZE));
        break;
      }
      case Cmd.IMAGE:
        this.tftExpected = data[8]! | (data[9]! << 8);
        this.tftChunks = [];
        this.state.tft = { slot: data[2]!, chunks: this.tftExpected, data: new Uint8Array() };
        break;
      default:
        this.state.unknownCommands.push(cmd);
    }
  }

  private finishTable(): void {
    const p = this.pending!;
    this.pending = null;
    const bytes = Uint8Array.from(p.buffer);
    switch (p.cmd) {
      case Cmd.KEYMAP_BASE:
        this.state.keymapBase = bytes;
        break;
      case Cmd.KEYMAP_FN:
        this.state.keymapFn = bytes;
        break;
      case Cmd.PER_KEY_RGB:
        this.state.perKey = bytes;
        break;
      case Cmd.MACRO_DATA:
        this.state.macros = bytes;
        break;
    }
  }
}
