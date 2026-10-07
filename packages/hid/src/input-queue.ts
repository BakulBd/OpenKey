/** FIFO of input reports with timed waits, shared by all transports. */
export class InputQueue {
  private readonly items: Uint8Array[] = [];
  private readonly waiters: {
    resolve: (v: Uint8Array | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(private readonly capacity = 256) {}

  push(report: Uint8Array): void {
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(report);
      return;
    }
    this.items.push(report);
    if (this.items.length > this.capacity) this.items.shift();
  }

  next(timeoutMs: number): Promise<Uint8Array | null> {
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(entry);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(null);
        }, timeoutMs),
      };
      this.waiters.push(entry);
    });
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Resolve all pending waits with null (used on close). */
  cancelAll(): void {
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
  }
}
