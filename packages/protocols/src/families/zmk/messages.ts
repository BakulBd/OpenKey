/**
 * ZMK Studio RPC messages (zmkfirmware/zmk-studio-messages, MIT): the requests OpenKey sends and the
 * responses it reads. Field numbers follow studio.proto, core.proto, behaviors.proto and
 * keymap.proto. Requests OpenKey never builds: core.reset_settings, core.lock, and the layer
 * add/remove/move/restore and physical-layout switch requests.
 */
import { WireError, Writer, fields, first, text, toInt32, unzigzag } from './wire.js';
import type { Field } from './wire.js';

export type ZmkCall =
  | { core: 'getDeviceInfo' | 'getLockState' }
  | { behaviors: 'listAll' }
  | { behaviors: 'details'; id: number }
  | {
      keymap:
        | 'getKeymap'
        | 'getPhysicalLayouts'
        | 'checkUnsavedChanges'
        | 'saveChanges'
        | 'discardChanges';
    }
  | { keymap: 'setLayerBinding'; layerId: number; keyPosition: number; binding: ZmkBinding };

export interface ZmkBinding {
  behaviorId: number;
  param1: number;
  param2: number;
}

export function encodeRequest(id: number, call: ZmkCall): Uint8Array {
  const w = new Writer().uint32(1, id);
  if ('core' in call) w.message(3, new Writer().bool(call.core === 'getDeviceInfo' ? 1 : 2, true));
  else if ('behaviors' in call)
    w.message(
      4,
      call.behaviors === 'listAll'
        ? new Writer().bool(1, true)
        : new Writer().message(2, new Writer().uint32(1, call.id)),
    );
  else {
    const k = new Writer();
    switch (call.keymap) {
      case 'getKeymap':
        k.bool(1, true);
        break;
      case 'setLayerBinding':
        k.message(
          2,
          new Writer()
            .uint32(1, call.layerId)
            .int32(2, call.keyPosition)
            .message(
              3,
              new Writer()
                .sint32(1, call.binding.behaviorId)
                .uint32(2, call.binding.param1)
                .uint32(3, call.binding.param2),
            ),
        );
        break;
      case 'checkUnsavedChanges':
        k.bool(3, true);
        break;
      case 'saveChanges':
        k.bool(4, true);
        break;
      case 'discardChanges':
        k.bool(5, true);
        break;
      case 'getPhysicalLayouts':
        k.bool(6, true);
        break;
    }
    w.message(5, k);
  }
  return w.finish();
}

// ---------------------------------------------------------------- responses

export type ZmkMetaError =
  'generic' | 'unlockRequired' | 'rpcNotFound' | 'decodeFailed' | 'encodeFailed';
const META_ERRORS: ZmkMetaError[] = [
  'generic',
  'unlockRequired',
  'rpcNotFound',
  'decodeFailed',
  'encodeFailed',
];

export interface ZmkLayer {
  id: number;
  name: string;
  bindings: ZmkBinding[];
}
export interface ZmkKeymap {
  layers: ZmkLayer[];
  availableLayers: number;
  maxLayerNameLength: number;
}
export interface ZmkKeyAttrs {
  width: number;
  height: number;
  x: number;
  y: number;
  r: number;
  rx: number;
  ry: number;
}
export interface ZmkPhysicalLayouts {
  activeLayoutIndex: number;
  layouts: { name: string; keys: ZmkKeyAttrs[] }[];
}
export type ZmkParamValue =
  | { kind: 'nil'; name: string }
  | { kind: 'constant'; name: string; value: number }
  | { kind: 'range'; name: string; min: number; max: number }
  | { kind: 'hidUsage'; name: string; keyboardMax: number; consumerMax: number }
  | { kind: 'layerId'; name: string };
export interface ZmkBehaviorDetails {
  id: number;
  displayName: string;
  metadata: { param1: ZmkParamValue[]; param2: ZmkParamValue[] }[];
}

export type ZmkResult =
  | { meta: 'noResponse' }
  | { meta: 'error'; error: ZmkMetaError }
  | { deviceInfo: { name: string; serialNumber: Uint8Array } }
  | { lockState: 'locked' | 'unlocked' }
  | { behaviors: number[] }
  | { behaviorDetails: ZmkBehaviorDetails }
  | { keymap: ZmkKeymap }
  | { setLayerBinding: 'ok' | 'invalidLocation' | 'invalidBehavior' | 'invalidParameters' }
  | { unsavedChanges: boolean }
  | { saveChanges: { ok: true } | { ok: false; error: number } }
  | { discardChanges: boolean }
  | { physicalLayouts: ZmkPhysicalLayouts };

export type ZmkMessage =
  | { kind: 'response'; requestId: number; result: ZmkResult | null }
  | { kind: 'notification'; lockState?: 'locked' | 'unlocked'; unsavedChanges?: boolean };

const num = (fs: Field[], n: number) => first(fs, n)?.value ?? 0;
const sub = (fs: Field[], n: number) => fields(first(fs, n)?.bytes ?? new Uint8Array());
const all = (fs: Field[], n: number) => fs.filter((f) => f.field === n);
const lock = (v: number) => (v === 1 ? 'unlocked' : 'locked');

/** Repeated uint32: packed (wire 2) as proto3 sends it, or one field per value. */
function repeatedUint(fs: Field[], n: number): number[] {
  const out: number[] = [];
  for (const f of all(fs, n)) {
    if (f.wire === 0) out.push(f.value);
    else {
      const b = f.bytes;
      let p = 0;
      while (p < b.length) {
        let v = 0;
        let shift = 0;
        for (;;) {
          const x = b[p++];
          if (x === undefined) throw new WireError('Truncated packed field');
          if (shift < 32) v |= (x & 0x7f) << shift;
          shift += 7;
          if (!(x & 0x80)) break;
        }
        out.push(v >>> 0);
      }
    }
  }
  return out;
}

const binding = (b: Uint8Array): ZmkBinding => {
  const fs = fields(b);
  return { behaviorId: unzigzag(num(fs, 1)), param1: num(fs, 2), param2: num(fs, 3) };
};

function paramValue(b: Uint8Array): ZmkParamValue {
  const fs = fields(b);
  const name = text(first(fs, 1)?.bytes ?? new Uint8Array());
  if (first(fs, 3)) return { kind: 'constant', name, value: num(fs, 3) };
  if (first(fs, 4)) {
    const r = sub(fs, 4);
    return { kind: 'range', name, min: toInt32(num(r, 1)), max: toInt32(num(r, 2)) };
  }
  if (first(fs, 5)) {
    const h = sub(fs, 5);
    return { kind: 'hidUsage', name, keyboardMax: num(h, 1), consumerMax: num(h, 2) };
  }
  if (first(fs, 6)) return { kind: 'layerId', name };
  return { kind: 'nil', name };
}

function keymap(fs: Field[]): ZmkKeymap {
  return {
    layers: all(fs, 1).map((l) => {
      const lf = fields(l.bytes);
      return {
        id: num(lf, 1),
        name: text(first(lf, 2)?.bytes ?? new Uint8Array()),
        bindings: all(lf, 3).map((x) => binding(x.bytes)),
      };
    }),
    availableLayers: num(fs, 2),
    maxLayerNameLength: num(fs, 3),
  };
}

function result(fs: Field[]): ZmkResult | null {
  const meta = first(fs, 2);
  if (meta) {
    const m = fields(meta.bytes);
    if (first(m, 2)) return { meta: 'error', error: META_ERRORS[num(m, 2)] ?? 'generic' };
    return { meta: 'noResponse' };
  }
  const core = first(fs, 3);
  if (core) {
    const c = fields(core.bytes);
    if (first(c, 1)) {
      const d = sub(c, 1);
      return {
        deviceInfo: {
          name: text(first(d, 1)?.bytes ?? new Uint8Array()),
          serialNumber: Uint8Array.from(first(d, 2)?.bytes ?? []),
        },
      };
    }
    if (first(c, 2)) return { lockState: lock(num(c, 2)) };
    return null;
  }
  const beh = first(fs, 4);
  if (beh) {
    const b = fields(beh.bytes);
    if (first(b, 1)) return { behaviors: repeatedUint(sub(b, 1), 1) };
    if (first(b, 2)) {
      const d = sub(b, 2);
      return {
        behaviorDetails: {
          id: num(d, 1),
          displayName: text(first(d, 2)?.bytes ?? new Uint8Array()),
          metadata: all(d, 3).map((m) => {
            const mf = fields(m.bytes);
            return {
              param1: all(mf, 1).map((x) => paramValue(x.bytes)),
              param2: all(mf, 2).map((x) => paramValue(x.bytes)),
            };
          }),
        },
      };
    }
    return null;
  }
  const km = first(fs, 5);
  if (km) {
    const k = fields(km.bytes);
    if (first(k, 1)) return { keymap: keymap(sub(k, 1)) };
    if (first(k, 2))
      return {
        setLayerBinding:
          (['ok', 'invalidLocation', 'invalidBehavior', 'invalidParameters'] as const)[num(k, 2)] ??
          'invalidParameters',
      };
    if (first(k, 3)) return { unsavedChanges: num(k, 3) === 1 };
    if (first(k, 4)) {
      const s = sub(k, 4);
      return {
        saveChanges: first(s, 2) ? { ok: false, error: num(s, 2) } : { ok: true },
      };
    }
    if (first(k, 5)) return { discardChanges: num(k, 5) === 1 };
    if (first(k, 6)) {
      const p = sub(k, 6);
      return {
        physicalLayouts: {
          activeLayoutIndex: num(p, 1),
          layouts: all(p, 2).map((l) => {
            const lf = fields(l.bytes);
            return {
              name: text(first(lf, 1)?.bytes ?? new Uint8Array()),
              keys: all(lf, 2).map((x) => {
                const a = fields(x.bytes);
                const s = (n: number) => unzigzag(num(a, n));
                return { width: s(1), height: s(2), x: s(3), y: s(4), r: s(5), rx: s(6), ry: s(7) };
              }),
            };
          }),
        },
      };
    }
  }
  return null;
}

export function decodeMessage(b: Uint8Array): ZmkMessage {
  const fs = fields(b);
  const rr = first(fs, 1);
  if (rr) {
    const r = fields(rr.bytes);
    return { kind: 'response', requestId: num(r, 1), result: result(r) };
  }
  const n = fields(first(fs, 2)?.bytes ?? new Uint8Array());
  const core = first(n, 2);
  const km = first(n, 5);
  return {
    kind: 'notification',
    ...(core ? { lockState: lock(num(fields(core.bytes), 1)) } : {}),
    ...(km ? { unsavedChanges: num(fields(km.bytes), 1) === 1 } : {}),
  };
}
