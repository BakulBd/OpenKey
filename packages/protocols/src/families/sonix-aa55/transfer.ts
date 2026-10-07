import {
  ProtocolError,
  SafetyBlockedError,
  TimeoutError,
  sleep as realSleep,
  toHex,
} from '@openkey/core';
import type { HidTransport } from '@openkey/hid';
import { maxReportSize } from '@openkey/hid';
import {
  BLOCKED_COMMANDS,
  CMD_NAMES,
  DEFAULT_PACKET_BYTES,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  HEADER_BYTES,
  IN_MAGIC,
  OUT_MAGIC,
  REPORT_ID,
} from './constants.js';

/**
 * Port of `ht(cmd, lenOrType, addr, payload, packetSize, otherHeader, customHeader, lastFlag)`:
 * [AA, cmd, lenOrType, addr lo, addr hi, other0, other1|lastFlag, other2, payload…]
 */
export function buildFrame(
  cmd: number,
  lenOrType: number,
  addr: number,
  payload: Uint8Array | undefined,
  packetSize: number,
  otherHeader?: number[],
  customHeader?: Uint8Array,
  lastPacket = false,
): Uint8Array {
  const f = new Uint8Array(packetSize);
  if (customHeader) {
    f.set(customHeader, 0);
    if (payload) f.set(payload.subarray(0, packetSize - customHeader.length), customHeader.length);
    return f;
  }
  f[0] = OUT_MAGIC;
  f[1] = cmd & 0xff;
  f[2] = lenOrType & 0xff;
  f[3] = addr & 0xff;
  f[4] = (addr >> 8) & 0xff;
  if (otherHeader)
    for (let i = 0; i < Math.min(3, otherHeader.length); i++)
      if (otherHeader[i] !== undefined) f[5 + i] = otherHeader[i]! & 0xff;
  if (!otherHeader || otherHeader.length < 2 || otherHeader[1] === undefined)
    f[6] = lastPacket ? 1 : 0;
  if (payload) f.set(payload.subarray(0, packetSize - HEADER_BYTES), HEADER_BYTES);
  return f;
}

export interface ParsedResponse {
  cmd: number;
  lenOrType: number;
  addr: number;
  data: Uint8Array;
  raw: Uint8Array;
}

/** Port of `hd`: responses start with 0x55. */
export function parseResponse(r: Uint8Array): ParsedResponse | null {
  if (r[0] !== IN_MAGIC) return null;
  return {
    cmd: r[1]!,
    lenOrType: r[2]!,
    addr: r[3]! | (r[4]! << 8),
    data: r.subarray(HEADER_BYTES),
    raw: r,
  };
}

export interface TransferOptions {
  cmd: number;
  contentSize?: number;
  addrStart?: number;
  data?: Uint8Array;
  timeoutMs?: number;
  maxRetries?: number;
  headerCount?: number;
  customHeader?: Uint8Array;
  otherHeader?: number[];
  responseCmd?: number;
  /** Clear the last-packet flag on every packet (first phase of two-phase writes). */
  isNeedLastPacketFlag?: boolean;
  checkAddr?: boolean;
  skipResponse?: boolean;
}

/** Port of the official transfer loop `ya` on top of an HidTransport. */
export class Aa55Link {
  readonly packetSize: number;
  /** Output report ID declared by the collection (0 when none). */
  readonly reportId: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly transport: HidTransport,
    opts: { sleep?: (ms: number) => Promise<void>; packetSize?: number } = {},
  ) {
    this.packetSize =
      opts.packetSize ??
      (maxReportSize(transport.info.collections[0]?.outputReports ?? [], REPORT_ID) ||
        DEFAULT_PACKET_BYTES);
    this.sleep = opts.sleep ?? realSleep;
    this.reportId = transport.info.collections[0]?.outputReports[0]?.reportId ?? REPORT_ID;
  }

  private async waitFor(cmd: number, timeoutMs: number, addr?: number): Promise<ParsedResponse> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new TimeoutError(`Command 0x${cmd.toString(16)} timed out`);
      const r = await this.transport.readInputReport(left);
      if (!r) continue;
      const p = parseResponse(r);
      if (!p || p.cmd !== cmd) continue;
      if (addr !== undefined && p.addr !== addr) continue;
      return p;
    }
  }

  async transfer(o: TransferOptions): Promise<ParsedResponse[]> {
    if (BLOCKED_COMMANDS.has(o.cmd))
      throw new SafetyBlockedError(
        `Command 0x${o.cmd.toString(16)} is blocked by the OpenKey safety policy`,
      );
    const contentSize = o.contentSize ?? 24;
    const header = o.headerCount ?? HEADER_BYTES;
    const per = this.packetSize - header;
    const chunks = Math.ceil(contentSize / per);
    const responses: ParsedResponse[] = [];
    const retries = o.maxRetries ?? DEFAULT_RETRIES;
    for (let i = 0; i < chunks; i++) {
      const addr = (o.addrStart ?? 0) + i * per;
      const remaining = contentSize - i * per;
      const last = (o.isNeedLastPacketFlag ?? true) ? i === chunks - 1 : false;
      const size = i === chunks - 1 ? remaining : per;
      const slice = o.data
        ? o.data.subarray(i * per, Math.min(i * per + per, o.data.length))
        : undefined;
      const frame = buildFrame(
        o.cmd,
        size,
        addr,
        slice,
        this.packetSize,
        o.otherHeader,
        o.customHeader,
        last,
      );
      if (o.skipResponse) {
        await this.transport.sendOutputReport(this.reportId, frame);
        continue;
      }
      let attempt = 0;
      for (;;) {
        this.transport.drainInput();
        await this.transport.sendOutputReport(this.reportId, frame);
        try {
          responses.push(
            await this.waitFor(
              o.responseCmd ?? o.cmd,
              o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              o.checkAddr ? addr : undefined,
            ),
          );
          break;
        } catch {
          if (retries === 0) return responses;
          if (++attempt > retries) {
            throw new ProtocolError(
              `No response to ${CMD_NAMES[o.cmd] ?? o.cmd} after ${retries} retries`,
              { frame: toHex(frame.subarray(0, 16)) },
            );
          }
          await this.sleep(10);
        }
      }
    }
    return responses;
  }

  /** Concatenates the payloads of a multi-packet read (`flatMap(slice(8))`). */
  async read(
    cmd: number,
    contentSize: number,
    opts: Partial<TransferOptions> = {},
  ): Promise<Uint8Array> {
    const rs = await this.transfer({ cmd, contentSize, ...opts });
    const out = new Uint8Array(rs.reduce((n, r) => n + r.data.length, 0));
    let off = 0;
    for (const r of rs) {
      out.set(r.data, off);
      off += r.data.length;
    }
    return out.subarray(0, contentSize);
  }
}
