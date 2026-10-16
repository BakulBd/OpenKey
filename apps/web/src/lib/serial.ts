import type { zmk } from '@openkey/protocols';

/** The part of the Web Serial API OpenKey uses (Chrome and Edge; the DOM typings do not include it). */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(o?: object): Promise<SerialPortLike>;
  addEventListener(type: 'disconnect', cb: (e: Event) => void): void;
  removeEventListener(type: 'disconnect', cb: (e: Event) => void): void;
}

export function webSerial(): SerialLike | null {
  const nav = globalThis.navigator as Navigator & { serial?: SerialLike };
  return nav?.serial ?? null;
}

/**
 * Asks the user to pick a serial port and opens it as a byte channel for ZMK Studio. ZMK's CDC ACM
 * port ignores the baud rate; 12500 is what the official client uses.
 */
export async function openSerialChannel(): Promise<{
  channel: zmk.ByteChannel;
  usb: { vendorId: number; productId: number };
  port: SerialPortLike;
}> {
  const serial = webSerial();
  if (!serial) throw new Error('This browser has no Web Serial. Use Chrome or Edge.');
  const port = await serial.requestPort({});
  await port.open({ baudRate: 12500 });
  if (!port.readable || !port.writable) throw new Error('The serial port cannot be used.');
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  const sink: { receive: ((b: Uint8Array) => void) | null } = { receive: null };
  let open = true;
  void (async () => {
    while (open) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) sink.receive?.(value);
    }
  })().catch(() => undefined);
  const info = port.getInfo();
  return {
    port,
    usb: { vendorId: info.usbVendorId ?? 0, productId: info.usbProductId ?? 0 },
    channel: {
      write: (b) => writer.write(b),
      onData: (cb) => {
        sink.receive = cb;
        return () => {
          sink.receive = null;
        };
      },
      close: async () => {
        open = false;
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        writer.releaseLock();
        await port.close().catch(() => undefined);
      },
    },
  };
}
