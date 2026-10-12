import { ProtocolError, TimeoutError } from '@openkey/core';
import type { HidTransport } from '@openkey/hid';
import {
  CHUNK,
  Cmd,
  FORBIDDEN,
  KeyboardValue,
  REPLY_TIMEOUT_MS,
  REPORT_SIZE,
  UNHANDLED,
} from './constants.js';

const FORBIDDEN_IDS = new Set<number>(Object.values(FORBIDDEN));

/** One VIA command channel. Commands run one at a time; every reply must echo its command. */
export class ViaSession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly transport: HidTransport,
    private readonly reportSize = REPORT_SIZE,
    private readonly timeoutMs = REPLY_TIMEOUT_MS,
  ) {}

  /** Sends `bytes` (command first) and returns the 32-byte reply. `null` when the firmware says unhandled. */
  command(bytes: readonly number[]): Promise<Uint8Array | null> {
    const run = async (): Promise<Uint8Array | null> => {
      const id = bytes[0]!;
      if (FORBIDDEN_IDS.has(id))
        throw new ProtocolError(
          `VIA command 0x${id.toString(16)} resets or reflashes the keyboard; OpenKey never sends it.`,
        );
      const report = new Uint8Array(this.reportSize);
      report.set(bytes.slice(0, this.reportSize));
      this.transport.drainInput();
      await this.transport.sendOutputReport(0, report);
      const reply = await this.transport.readInputReport(this.timeoutMs);
      if (!reply) throw new TimeoutError(`No VIA reply to command 0x${id.toString(16)}`);
      if (reply[0] === UNHANDLED && id !== UNHANDLED) return null;
      if (reply[0] !== id)
        throw new ProtocolError(
          `VIA reply echoes 0x${reply[0]?.toString(16)}, expected 0x${id.toString(16)}`,
        );
      return reply;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async must(bytes: readonly number[]): Promise<Uint8Array> {
    const r = await this.command(bytes);
    if (!r)
      throw new ProtocolError(
        `The firmware does not handle VIA command 0x${bytes[0]!.toString(16)}`,
      );
    return r;
  }

  async protocolVersion(): Promise<number> {
    const r = await this.must([Cmd.GET_PROTOCOL_VERSION]);
    return (r[1]! << 8) | r[2]!;
  }

  /** A 32-bit keyboard value (firmware version, layout options …); null when unhandled. */
  async keyboardValue(id: number): Promise<number | null> {
    const r = await this.command([Cmd.GET_KEYBOARD_VALUE, id]);
    if (!r || r[1] !== id) return null;
    return ((r[2]! << 24) | (r[3]! << 16) | (r[4]! << 8) | r[5]!) >>> 0;
  }

  firmwareVersion(): Promise<number | null> {
    return this.keyboardValue(KeyboardValue.FIRMWARE_VERSION);
  }

  async layerCount(): Promise<number> {
    return (await this.must([Cmd.KEYMAP_GET_LAYER_COUNT]))[1]!;
  }

  async getKeycode(layer: number, row: number, col: number): Promise<number> {
    const r = await this.must([Cmd.KEYMAP_GET_KEYCODE, layer, row, col]);
    return (r[4]! << 8) | r[5]!;
  }

  async setKeycode(layer: number, row: number, col: number, code: number): Promise<void> {
    await this.must([Cmd.KEYMAP_SET_KEYCODE, layer, row, col, code >> 8, code & 0xff]);
  }

  /** Reads `size` bytes of the dynamic keymap from an absolute offset (big-endian keycodes, layer-major, row-major). */
  readKeymapBuffer(start: number, size: number): Promise<Uint8Array> {
    return this.readBuffer(Cmd.KEYMAP_GET_BUFFER, size, start);
  }

  async writeKeymapBuffer(offset: number, data: Uint8Array): Promise<void> {
    await this.writeBuffer(Cmd.KEYMAP_SET_BUFFER, offset, data);
  }

  async macroCount(): Promise<number> {
    const r = await this.command([Cmd.MACRO_GET_COUNT]);
    return r ? r[1]! : 0;
  }

  async macroBufferSize(): Promise<number> {
    const r = await this.command([Cmd.MACRO_GET_BUFFER_SIZE]);
    return r ? (r[1]! << 8) | r[2]! : 0;
  }

  readMacroBuffer(size: number): Promise<Uint8Array> {
    return this.readBuffer(Cmd.MACRO_GET_BUFFER, size, 0);
  }

  writeMacroBuffer(data: Uint8Array): Promise<void> {
    return this.writeBuffer(Cmd.MACRO_SET_BUFFER, 0, data);
  }

  /** Lighting value on a channel; null when the firmware has no such channel or value. */
  async getValue(channel: number, value: number, len = 1): Promise<number[] | null> {
    const r = await this.command([Cmd.CUSTOM_GET_VALUE, channel, value]);
    if (!r || r[1] !== channel || r[2] !== value) return null;
    return Array.from(r.subarray(3, 3 + len));
  }

  async setValue(channel: number, value: number, data: number[]): Promise<void> {
    await this.must([Cmd.CUSTOM_SET_VALUE, channel, value, ...data]);
  }

  /** Persists the channel's values (VIA sets them without saving). */
  async save(channel: number): Promise<void> {
    await this.must([Cmd.CUSTOM_SAVE, channel]);
  }

  private async readBuffer(cmd: number, size: number, start: number): Promise<Uint8Array> {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i += CHUNK) {
      const n = Math.min(CHUNK, size - i);
      const offset = start + i;
      const r = await this.must([cmd, offset >> 8, offset & 0xff, n]);
      out.set(r.subarray(4, 4 + n), i);
    }
    return out;
  }

  private async writeBuffer(cmd: number, start: number, data: Uint8Array): Promise<void> {
    for (let i = 0; i < data.length; i += CHUNK) {
      const n = Math.min(CHUNK, data.length - i);
      const offset = start + i;
      await this.must([cmd, offset >> 8, offset & 0xff, n, ...data.subarray(i, i + n)]);
    }
  }
}
