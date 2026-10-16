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

  /**
   * Vial commands (prefix 0xFE). Their replies carry data from byte 0, so they are not checked for an
   * echo. Only the allow-listed sub-commands are sent; see families/via/vial.ts.
   */
  private vial(bytes: readonly number[], allowed: (b: readonly number[]) => boolean) {
    const run = async (): Promise<Uint8Array | null> => {
      if (bytes[0] !== 0xfe || !allowed(bytes))
        throw new ProtocolError(
          `Vial command ${bytes
            .slice(0, 3)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ')} is not one OpenKey sends.`,
        );
      const report = new Uint8Array(this.reportSize);
      report.set(bytes.slice(0, this.reportSize));
      this.transport.drainInput();
      await this.transport.sendOutputReport(0, report);
      const reply = await this.transport.readInputReport(this.timeoutMs);
      if (!reply) throw new TimeoutError('No reply to the Vial command');
      return reply;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Vial reads: keyboard id, definition, QMK settings query/get, dynamic-entry counts and gets. */
  vialRead(bytes: readonly number[]): Promise<Uint8Array | null> {
    return this.vial(
      bytes,
      (b) =>
        [0x00, 0x01, 0x02, 0x09, 0x0a].includes(b[1]!) ||
        (b[1] === 0x0d && [0x00, 0x01, 0x03, 0x05].includes(b[2]!)),
    );
  }

  /** Vial writes: one QMK setting, or one tap dance / combo / key override entry. */
  async vialWrite(bytes: readonly number[]): Promise<Uint8Array> {
    const r = await this.vial(
      bytes,
      (b) => b[1] === 0x0b || (b[1] === 0x0d && [0x02, 0x04, 0x06].includes(b[2]!)),
    );
    return r!;
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

  /** Keycode of one encoder direction (clockwise = 1); null when the firmware has no encoder map. */
  async getEncoder(layer: number, id: number, clockwise: boolean): Promise<number | null> {
    const r = await this.command([Cmd.KEYMAP_GET_ENCODER, layer, id, clockwise ? 1 : 0]);
    return r ? (r[4]! << 8) | r[5]! : null;
  }

  async setEncoder(layer: number, id: number, clockwise: boolean, code: number): Promise<void> {
    await this.must([Cmd.KEYMAP_SET_ENCODER, layer, id, clockwise ? 1 : 0, code >> 8, code & 0xff]);
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

  /** A custom-menu value bound to [channel, value id, …extra]; null when the firmware does not answer it. */
  async getBound(command: readonly number[], len: number): Promise<number[] | null> {
    const r = await this.command([Cmd.CUSTOM_GET_VALUE, ...command]);
    if (!r || command.some((b, i) => r[1 + i] !== b)) return null;
    return Array.from(r.subarray(1 + command.length, 1 + command.length + len));
  }

  async setBound(command: readonly number[], data: readonly number[]): Promise<void> {
    await this.must([Cmd.CUSTOM_SET_VALUE, ...command, ...data]);
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
