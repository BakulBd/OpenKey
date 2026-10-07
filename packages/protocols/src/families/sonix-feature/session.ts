import { ProtocolError, TimeoutError, sleep as realSleep, toHex } from '@openkey/core';
import type { HidTransport } from '@openkey/hid';
import {
  CMD_DELAY_MS,
  CMD_NAMES,
  DATA_ACK_TIMEOUT_MS,
  DATA_CHUNK_SIZE,
  MAX_PACKET_RETRIES,
  PACKET_SIZE,
  READ_ACK_DELAY_MS,
  READ_PRE_DELAY_MS,
  REPORT_ID,
} from './constants.js';
import type { CommandArgs } from './frame.js';
import { commandPacket, parseAck } from './frame.js';
import type { AckInfo } from './frame.js';

export interface SessionOptions {
  cmdDelayMs?: number;
  /** Report IDs taken from the HID descriptors (0 when the collection declares none). */
  featureReportId?: number;
  dataReportId?: number;
  /** Injected for tests so they do not sleep in real time. */
  sleep?: (ms: number) => Promise<void>;
}

/** Simple async mutex: one transaction at a time per keyboard. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Faithful reimplementation of the official driver's transfer helpers:
 * - FUN_0044eed0: delayed SET_FEATURE (+ optional GET_FEATURE handshake), multi-packet writes.
 * - FUN_0044f3a0: SET_FEATURE command, handshake, then N × 64-byte GET_FEATURE reads.
 * - FUN_0044f2d0: 4096-byte output report on the data pipe followed by a 300 ms input read.
 */
export class SonixFeatureSession {
  private readonly mutex = new Mutex();
  private readonly cmdDelay: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly featureId: number;
  private readonly dataId: number;

  constructor(
    readonly control: HidTransport,
    readonly data: HidTransport | null,
    opts: SessionOptions = {},
  ) {
    this.cmdDelay = opts.cmdDelayMs ?? CMD_DELAY_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.featureId = opts.featureReportId ?? REPORT_ID;
    this.dataId = opts.dataReportId ?? REPORT_ID;
  }

  /** Runs a multi-step transaction exclusively. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  /** Sends one 64-byte packet; with `handshake`, reads the acknowledgement and returns it. */
  async sendPacket(
    packet: Uint8Array,
    handshake: boolean,
  ): Promise<{ ack?: AckInfo; response?: Uint8Array }> {
    if (packet.length !== PACKET_SIZE)
      throw new ProtocolError(`Packet must be ${PACKET_SIZE} bytes, got ${packet.length}`);
    await this.sleep(this.cmdDelay);
    await this.control.sendFeatureReport(this.featureId, packet);
    if (!handshake) return {};
    await this.sleep(this.cmdDelay);
    const response = await this.control.receiveFeatureReport(this.featureId, PACKET_SIZE);
    const ack = parseAck(response, packet[1] ?? 0);
    return { ack, response };
  }

  /** `04 <cmd> …` with handshake; throws when the device does not acknowledge. */
  async command(
    cmd: number,
    args: CommandArgs = {},
    opts: { handshake?: boolean; requireAck?: boolean } = {},
  ): Promise<AckInfo | undefined> {
    const handshake = opts.handshake ?? true;
    const { ack, response } = await this.sendPacket(commandPacket(cmd, args), handshake);
    if (handshake && (opts.requireAck ?? true) && ack && !ack.ok) {
      throw new ProtocolError(
        `Keyboard did not acknowledge ${CMD_NAMES[cmd] ?? cmd.toString(16)}`,
        {
          response: response ? toHex(response) : undefined,
          status: ack.status,
        },
      );
    }
    return ack;
  }

  /** Writes a buffer as consecutive 64-byte feature packets (multi-packet branch of FUN_0044eed0). */
  async sendTable(buffer: Uint8Array): Promise<void> {
    if (buffer.length % PACKET_SIZE !== 0)
      throw new ProtocolError(`Table length ${buffer.length} is not a multiple of ${PACKET_SIZE}`);
    await this.sleep(this.cmdDelay);
    for (let off = 0; off < buffer.length; off += PACKET_SIZE) {
      const pkt = buffer.slice(off, off + PACKET_SIZE);
      let attempt = 0;
      for (;;) {
        try {
          await this.control.sendFeatureReport(this.featureId, pkt);
          break;
        } catch (e) {
          if (++attempt >= MAX_PACKET_RETRIES) throw e;
          await this.sleep(this.cmdDelay);
        }
      }
      await this.sleep(this.cmdDelay);
    }
  }

  /** FUN_0044f3a0: command, acknowledgement, then `packets` × 64-byte reads. */
  async readTable(cmd: number, packets: number): Promise<Uint8Array> {
    await this.sleep(READ_PRE_DELAY_MS);
    const pkt = commandPacket(cmd, { arg8: packets });
    await this.control.sendFeatureReport(this.featureId, pkt);
    await this.sleep(READ_ACK_DELAY_MS);
    let ackResp: Uint8Array | null = null;
    for (let attempt = 0; attempt < MAX_PACKET_RETRIES && !ackResp; attempt++) {
      try {
        ackResp = await this.control.receiveFeatureReport(this.featureId, PACKET_SIZE);
      } catch (e) {
        if (attempt === MAX_PACKET_RETRIES - 1) throw e;
        await this.sleep(READ_ACK_DELAY_MS);
      }
    }
    const ack = parseAck(ackResp!, cmd);
    if (!ack.ok) {
      throw new ProtocolError(`Keyboard did not acknowledge read ${CMD_NAMES[cmd] ?? cmd}`, {
        response: toHex(ackResp!),
      });
    }
    const out = new Uint8Array(packets * PACKET_SIZE);
    for (let i = 0; i < packets; i++) {
      await this.sleep(READ_PRE_DELAY_MS);
      const part = await this.control.receiveFeatureReport(this.featureId, PACKET_SIZE);
      if (part.length !== PACKET_SIZE)
        throw new ProtocolError(`Short read in table (${part.length} bytes)`);
      out.set(part, i * PACKET_SIZE);
    }
    return out;
  }

  /** FUN_0044f2d0: one 4096-byte output report on the data pipe, then wait for its input report. */
  async sendDataChunk(chunk: Uint8Array): Promise<Uint8Array | null> {
    if (!this.data) throw new ProtocolError('The data interface (FF68) is not open');
    if (chunk.length !== DATA_CHUNK_SIZE)
      throw new ProtocolError(`Data chunk must be ${DATA_CHUNK_SIZE} bytes`);
    await this.data.sendOutputReport(this.dataId, chunk);
    // The official driver ignores the content of this read but waits for it (aks075-linux showed
    // that skipping it breaks persistence).
    return this.data.readInputReport(DATA_ACK_TIMEOUT_MS);
  }

  /** Passive read of the feature report without sending anything first. */
  async peek(): Promise<Uint8Array> {
    return this.control.receiveFeatureReport(this.featureId, PACKET_SIZE);
  }

  async delay(ms = this.cmdDelay): Promise<void> {
    await this.sleep(ms);
  }
}

export function assertAck(ack: AckInfo | undefined, what: string): void {
  if (ack && !ack.ok) throw new TimeoutError(`${what}: keyboard did not acknowledge`);
}
