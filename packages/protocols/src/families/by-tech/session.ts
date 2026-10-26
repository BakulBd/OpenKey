import { sleep as realSleep } from '@openkey/core';
import type { HidTransport } from '@openkey/hid';
import {
  Cmd,
  IDENTITY_BYTES,
  INFO_IDENTITY,
  PAGE_BYTES,
  REPORT_BYTES,
  RETRY_DELAY_MS,
  SETTINGS_PAGE_BYTES,
  SET_RETRIES,
  TRANSFER_DELAY_MS,
} from './constants.js';
import { frame, packageCount, replyData, writeFrames } from './frame.js';

export interface ByTechSessionOptions {
  /** Delay before every transfer (vendor driver: 20 ms). Tests pass 0. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** One open command channel. Every transfer is paced like the vendor driver; nothing is cached. */
export class ByTechSession {
  private readonly delay: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly transport: HidTransport,
    readonly reportId: number,
    opts: ByTechSessionOptions = {},
  ) {
    this.delay = opts.delayMs ?? TRANSFER_DELAY_MS;
    this.sleep = opts.sleep ?? realSleep;
  }

  private async setFeature(report: Uint8Array): Promise<void> {
    let last: unknown;
    for (let i = 0; i < SET_RETRIES; i++) {
      try {
        await this.transport.sendFeatureReport(this.reportId, report);
        return;
      } catch (e) {
        last = e;
        await this.sleep(this.delay === 0 ? 0 : RETRY_DELAY_MS);
      }
    }
    throw last;
  }

  /**
   * Transfers run one after another: a read is a request and a reply on the same report, so two
   * at once (two editors loading together) would take each other's replies.
   */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Requests `len` bytes with a read command (bit 7 set) and returns them. */
  read(command: number, parameter: number, len: number): Promise<Uint8Array> {
    return this.serial(() => this.readNow(command, parameter, len));
  }

  private async readNow(command: number, parameter: number, len: number): Promise<Uint8Array> {
    const n = packageCount(len);
    const out = new Uint8Array(len);
    for (let index = 0, got = 0; index < n; index++) {
      const chunk = Math.min(PAGE_BYTES, len - got);
      await this.sleep(this.delay);
      await this.setFeature(frame(command, parameter, n, index, undefined, chunk));
      await this.sleep(this.delay);
      const reply = await this.transport.receiveFeatureReport(this.reportId, REPORT_BYTES);
      out.set(replyData(reply, command, chunk), got);
      got += chunk;
    }
    return out;
  }

  /** Sends `data` with a write command, split into numbered packages. */
  write(command: number, parameter: number, data: Uint8Array): Promise<void> {
    return this.serial(async () => {
      for (const report of writeFrames(command, parameter, data)) {
        await this.sleep(this.delay);
        await this.setFeature(report);
      }
    });
  }

  /** The six-byte model code the vendor driver matches against `Psd=`. */
  identity(): Promise<Uint8Array> {
    return this.read(Cmd.GET_INFO, INFO_IDENTITY, IDENTITY_BYTES);
  }

  readSettingsPage(): Promise<Uint8Array> {
    return this.read(Cmd.GET_LED, 0, SETTINGS_PAGE_BYTES);
  }

  writeSettingsPage(page: Uint8Array): Promise<void> {
    return this.write(Cmd.SET_LED, 0, page);
  }
}
