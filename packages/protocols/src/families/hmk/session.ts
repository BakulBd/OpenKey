import { ProtocolError, TimeoutError } from '@openkey/core';
import type { HidTransport } from '@openkey/hid';
import {
  ACTUATION_CHUNK,
  FAILED,
  HMK_FORBIDDEN,
  HmkCmd,
  KEYMAP_GET_CHUNK,
  KEYMAP_SET_CHUNK,
  METADATA_CHUNK,
  REPLY_TIMEOUT_MS,
  REPORT_SIZE,
} from './constants.js';

const FORBIDDEN = new Set<number>(Object.values(HMK_FORBIDDEN));
const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/** Per-key Hall-effect settings (common.h actuation_t): positions are 0–255 of the key travel. */
export interface HmkActuation {
  actuationPoint: number;
  /** Rapid Trigger press sensitivity; 0 turns Rapid Trigger off for the key. */
  rtDown: number;
  /** Rapid Trigger release sensitivity (0 = same as press). */
  rtUp: number;
  /** Continuous Rapid Trigger: stays active until the key is fully released. */
  continuous: boolean;
}

/** One libhmk command channel: one command at a time, every reply must echo its command id. */
export class HmkSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    private readonly timeoutMs = REPLY_TIMEOUT_MS,
  ) {}

  command(id: number, payload: readonly number[] = []): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      if (FORBIDDEN.has(id))
        throw new ProtocolError(
          `libhmk command ${id} reboots, resets or recalibrates the keyboard; OpenKey never sends it.`,
        );
      const report = new Uint8Array(REPORT_SIZE);
      report[0] = id;
      report.set(payload.slice(0, REPORT_SIZE - 1), 1);
      this.transport.drainInput();
      await this.transport.sendOutputReport(0, report);
      const reply = await this.transport.readInputReport(this.timeoutMs);
      if (!reply) throw new TimeoutError(`No reply to libhmk command ${id}`);
      if (reply[0] === FAILED)
        throw new ProtocolError(`The keyboard refused libhmk command ${id}.`);
      if (reply[0] !== id)
        throw new ProtocolError(`libhmk reply echoes ${reply[0]}, expected ${id}`);
      return reply.subarray(1);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async firmwareVersion(): Promise<number> {
    const r = await this.command(HmkCmd.FIRMWARE_VERSION);
    return r[0]! | (r[1]! << 8);
  }

  async currentProfile(): Promise<number> {
    return (await this.command(HmkCmd.GET_PROFILE))[0]!;
  }

  /** The gzip-compressed metadata JSON, read 59 bytes at a time (len = bytes left from the offset). */
  async metadataBytes(max = 64 * 1024): Promise<Uint8Array> {
    const out: number[] = [];
    for (;;) {
      const r = await this.command(HmkCmd.GET_METADATA, le32(out.length));
      const left = (r[0]! | (r[1]! << 8) | (r[2]! << 16) | (r[3]! << 24)) >>> 0;
      const n = Math.min(left, METADATA_CHUNK);
      out.push(...r.subarray(4, 4 + n));
      if (left <= METADATA_CHUNK) break;
      if (out.length > max) throw new ProtocolError('The keyboard metadata is implausibly large.');
    }
    return Uint8Array.from(out);
  }

  async readKeymap(profile: number, layer: number, keys: number): Promise<Uint8Array> {
    const out = new Uint8Array(keys);
    for (let off = 0; off < keys; off += KEYMAP_GET_CHUNK) {
      const r = await this.command(HmkCmd.GET_KEYMAP, [profile, layer, off]);
      out.set(r.subarray(0, Math.min(KEYMAP_GET_CHUNK, keys - off)), off);
    }
    return out;
  }

  async writeKeymap(
    profile: number,
    layer: number,
    offset: number,
    codes: number[],
  ): Promise<void> {
    for (let i = 0; i < codes.length; i += KEYMAP_SET_CHUNK) {
      const part = codes.slice(i, i + KEYMAP_SET_CHUNK);
      await this.command(HmkCmd.SET_KEYMAP, [profile, layer, offset + i, part.length, ...part]);
    }
  }

  async readActuations(profile: number, keys: number): Promise<HmkActuation[]> {
    const out: HmkActuation[] = [];
    for (let off = 0; off < keys; off += ACTUATION_CHUNK) {
      const r = await this.command(HmkCmd.GET_ACTUATION_MAP, [profile, off]);
      for (let i = 0; i < Math.min(ACTUATION_CHUNK, keys - off); i++)
        out.push({
          actuationPoint: r[i * 4]!,
          rtDown: r[i * 4 + 1]!,
          rtUp: r[i * 4 + 2]!,
          continuous: r[i * 4 + 3] !== 0,
        });
    }
    return out;
  }

  async writeActuations(profile: number, offset: number, list: HmkActuation[]): Promise<void> {
    for (let i = 0; i < list.length; i += ACTUATION_CHUNK) {
      const part = list.slice(i, i + ACTUATION_CHUNK);
      await this.command(HmkCmd.SET_ACTUATION_MAP, [
        profile,
        offset + i,
        part.length,
        ...part.flatMap((a) => [a.actuationPoint, a.rtDown, a.rtUp, a.continuous ? 1 : 0]),
      ]);
    }
  }
}

/** Unpacks gzip with the platform's DecompressionStream (browsers, Node 18+). */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
