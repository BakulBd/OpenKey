import type { ByteChannel } from './rpc.js';
import type { ZmkBinding } from './messages.js';
import { Deframer, Writer, fields, first, frame, toInt32, unzigzag } from './wire.js';

interface SimBehavior {
  id: number;
  name: string;
  /** Parameter kinds of param1 (one metadata set). */
  param1?: 'hidUsage' | 'layerId';
}

/** Behaviour ids are arbitrary on real firmware; these are the simulator's. */
export const ZMK_SIM_BEHAVIORS: readonly SimBehavior[] = [
  { id: 1, name: 'Key Press', param1: 'hidUsage' },
  { id: 2, name: 'Transparent' },
  { id: 3, name: 'None' },
  { id: 4, name: 'Momentary Layer', param1: 'layerId' },
  { id: 5, name: 'Toggle Layer', param1: 'layerId' },
  { id: 6, name: 'Caps Word' },
  { id: 7, name: 'Bootloader' },
  { id: 8, name: 'Studio Unlock' },
];

const kp = (usage: number, mods = 0): ZmkBinding => ({
  behaviorId: 1,
  param1: ((mods << 24) | (0x07 << 16) | usage) >>> 0,
  param2: 0,
});

/**
 * ZMK firmware with Studio, as far as the RPC goes: device info, the lock (unlock() plays the
 * Studio unlock key), behaviours, a 2 × 6 split physical layout and two layers. Requests it was
 * sent are recorded so tests can prove what was (and was not) sent.
 */
export class ZmkSimulator {
  locked: boolean;
  /** Bindings by layer; the saved copy is what survives a "reboot". */
  layers: { id: number; name: string; bindings: ZmkBinding[] }[];
  saved: string;
  readonly requests: string[] = [];
  private receiver: ((b: Uint8Array) => void) | null = null;
  private readonly deframer = new Deframer();

  constructor(opts: { locked?: boolean; name?: string } = {}) {
    this.locked = opts.locked ?? false;
    this.name = opts.name ?? 'OpenKey ZMK demo split';
    const base = [0x29, 0x14, 0x1a, 0x08, 0x15, 0x17, 0x2b, 0x04, 0x16, 0x07, 0x09, 0x0a].map((u) =>
      kp(u),
    );
    base[11] = { behaviorId: 4, param1: 1, param2: 0 }; // momentary layer "Lower"
    const lower: ZmkBinding[] = Array.from({ length: 12 }, () => ({
      behaviorId: 2,
      param1: 0,
      param2: 0,
    }));
    lower[0] = kp(0x1e);
    lower[1] = { behaviorId: 6, param1: 0, param2: 0 };
    lower[2] = { behaviorId: 9, param1: 3, param2: 0x10004 }; // a behaviour OpenKey does not model
    this.layers = [
      { id: 0, name: 'Base', bindings: base },
      { id: 1, name: 'Lower', bindings: lower },
    ];
    this.saved = JSON.stringify(this.layers);
  }

  readonly name: string;

  /** The keyboard's Studio unlock key was pressed. */
  unlock(): void {
    this.locked = false;
    this.emit(new Writer().message(2, new Writer().message(2, new Writer().uint32(1, 1))));
  }

  channel(): ByteChannel {
    return {
      write: async (bytes) => {
        for (const payload of this.deframer.push(bytes)) this.onRequest(payload);
      },
      onData: (cb) => {
        this.receiver = cb;
        return () => {
          this.receiver = null;
        };
      },
      close: async () => {
        this.receiver = null;
      },
    };
  }

  private emit(w: Writer): void {
    const bytes = frame(w.finish());
    // Deliver asynchronously and in two pieces, as a serial port does.
    queueMicrotask(() => {
      this.receiver?.(bytes.subarray(0, 3));
      this.receiver?.(bytes.subarray(3));
    });
  }

  private reply(id: number, field: number, body: Writer): void {
    this.emit(new Writer().message(1, new Writer().uint32(1, id).message(field, body)));
  }

  private error(id: number, code: number): void {
    this.reply(id, 2, new Writer().uint32(2, code));
  }

  private binding(b: ZmkBinding): Writer {
    return new Writer().sint32(1, b.behaviorId).uint32(2, b.param1).uint32(3, b.param2);
  }

  private onRequest(payload: Uint8Array): void {
    const fs = fields(payload);
    const id = first(fs, 1)?.value ?? 0;
    const core = first(fs, 3);
    const beh = first(fs, 4);
    const km = first(fs, 5);
    if (core) {
      const c = fields(core.bytes)[0]!;
      this.requests.push(`core.${c.field}`);
      if (c.field === 1)
        return this.reply(
          id,
          3,
          new Writer().message(
            1,
            new Writer().string(1, this.name).bytes(2, Uint8Array.of(0xde, 0xad, 0xbe, 0xef)),
          ),
        );
      if (c.field === 2) return this.reply(id, 3, new Writer().uint32(2, this.locked ? 0 : 1));
      return this.error(id, 2); // reset_settings / lock: not simulated, and never sent by OpenKey
    }
    // Everything else is a secured RPC.
    if (this.locked) return this.error(id, 1);
    if (beh) {
      const b = fields(beh.bytes)[0]!;
      this.requests.push(`behaviors.${b.field}`);
      if (b.field === 1) {
        const list = new Writer();
        for (const x of ZMK_SIM_BEHAVIORS) list.uint32(1, x.id);
        list.uint32(1, 9);
        return this.reply(id, 4, new Writer().message(1, list));
      }
      const bid = first(fields(b.bytes), 1)?.value ?? 0;
      const sim = ZMK_SIM_BEHAVIORS.find((x) => x.id === bid) ?? {
        id: 9,
        name: 'Mod-Tap',
        param1: 'hidUsage' as const,
      };
      const set = new Writer();
      if (sim.param1) {
        const desc = new Writer().string(1, sim.param1 === 'hidUsage' ? 'Key' : 'Layer');
        if (sim.param1 === 'hidUsage')
          desc.message(5, new Writer().uint32(1, 0xff).uint32(2, 0xfff));
        else desc.message(6, new Writer());
        set.message(1, desc);
        if (bid === 9)
          set.message(2, new Writer().string(1, 'Tap').message(5, new Writer().uint32(1, 0xff)));
      }
      return this.reply(
        id,
        4,
        new Writer().message(2, new Writer().uint32(1, sim.id).string(2, sim.name).message(3, set)),
      );
    }
    if (km) {
      const k = fields(km.bytes)[0]!;
      this.requests.push(`keymap.${k.field}`);
      switch (k.field) {
        case 1: {
          const m = new Writer();
          for (const l of this.layers) {
            const lw = new Writer().uint32(1, l.id).string(2, l.name);
            for (const b of l.bindings) lw.message(3, this.binding(b));
            m.message(1, lw);
          }
          m.uint32(2, 4).uint32(3, 20);
          return this.reply(id, 5, new Writer().message(1, m));
        }
        case 2: {
          const r = fields(k.bytes);
          const layerId = first(r, 1)?.value ?? 0;
          const pos = toInt32(first(r, 2)?.value ?? 0);
          const bf = fields(first(r, 3)?.bytes ?? new Uint8Array());
          const binding = {
            behaviorId: unzigzag(first(bf, 1)?.value ?? 0),
            param1: first(bf, 2)?.value ?? 0,
            param2: first(bf, 3)?.value ?? 0,
          };
          const layer = this.layers.find((l) => l.id === layerId);
          if (!layer || pos < 0 || pos >= layer.bindings.length)
            return this.reply(id, 5, new Writer().uint32(2, 1));
          if (
            !ZMK_SIM_BEHAVIORS.some((x) => x.id === binding.behaviorId) &&
            binding.behaviorId !== 9
          )
            return this.reply(id, 5, new Writer().uint32(2, 2));
          layer.bindings[pos] = binding;
          return this.reply(id, 5, new Writer().int32(2, 0));
        }
        case 3:
          return this.reply(
            id,
            5,
            new Writer().bool(3, JSON.stringify(this.layers) !== this.saved),
          );
        case 4:
          this.saved = JSON.stringify(this.layers);
          return this.reply(id, 5, new Writer().message(4, new Writer().bool(1, true)));
        case 5:
          this.layers = JSON.parse(this.saved) as typeof this.layers;
          return this.reply(id, 5, new Writer().bool(5, true));
        case 6: {
          const layout = new Writer().string(1, '2 × 6 split');
          for (let i = 0; i < 12; i++) {
            const half = i % 6 < 3 ? 0 : 150;
            layout.message(
              2,
              new Writer()
                .sint32(1, 100)
                .sint32(2, 100)
                .sint32(3, (i % 6) * 100 + half)
                .sint32(4, Math.floor(i / 6) * 100),
            );
          }
          return this.reply(
            id,
            5,
            new Writer().message(6, new Writer().uint32(1, 0).message(2, layout)),
          );
        }
        default:
          return this.error(id, 2);
      }
    }
    this.error(id, 2);
  }
}
