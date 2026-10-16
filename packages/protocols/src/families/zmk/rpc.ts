import { ProtocolError, TimeoutError } from '@openkey/core';
import { decodeMessage, encodeRequest } from './messages.js';
import type { ZmkCall, ZmkMessage, ZmkResult } from './messages.js';
import { Deframer, frame } from './wire.js';

/** A byte stream to the keyboard: Web Serial in the browser, the simulator in tests and the demo. */
export interface ByteChannel {
  write(bytes: Uint8Array): Promise<void>;
  /** Registers the receiver; returns a function that removes it. */
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
}

export class ZmkLockedError extends ProtocolError {
  constructor() {
    super('The keyboard is locked. Press its Studio unlock key (&studio_unlock), then try again.');
  }
}

/** ZMK Studio RPC client: one request at a time, answers matched by request id. */
export class ZmkRpc {
  private next = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly deframer = new Deframer();
  private readonly waiting = new Map<number, (m: ZmkMessage) => void>();
  private readonly listeners = new Set<(m: ZmkMessage) => void>();
  private readonly off: () => void;

  constructor(
    readonly channel: ByteChannel,
    private readonly timeoutMs = 2000,
  ) {
    this.off = channel.onData((bytes) => {
      for (const payload of this.deframer.push(bytes)) {
        let m: ZmkMessage;
        try {
          m = decodeMessage(payload);
        } catch {
          continue; // a corrupt frame is dropped; the request times out with a clear error
        }
        if (m.kind === 'notification') this.listeners.forEach((l) => l(m));
        else this.waiting.get(m.requestId)?.(m);
      }
    });
  }

  onNotification(cb: (m: ZmkMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  call(call: ZmkCall): Promise<ZmkResult> {
    const run = async (): Promise<ZmkResult> => {
      const id = this.next++;
      const answer = new Promise<ZmkMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting.delete(id);
          reject(new TimeoutError('The keyboard did not answer the ZMK Studio request.'));
        }, this.timeoutMs);
        this.waiting.set(id, (m) => {
          clearTimeout(timer);
          this.waiting.delete(id);
          resolve(m);
        });
      });
      await this.channel.write(frame(encodeRequest(id, call)));
      const m = await answer;
      if (m.kind !== 'response' || !m.result)
        throw new ProtocolError('The keyboard sent an answer OpenKey cannot read.');
      if ('meta' in m.result && m.result.meta === 'error') {
        if (m.result.error === 'unlockRequired') throw new ZmkLockedError();
        throw new ProtocolError(`The keyboard refused the request (${m.result.error}).`);
      }
      return m.result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async close(): Promise<void> {
    this.off();
    this.waiting.clear();
    await this.channel.close();
  }
}
