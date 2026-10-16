import { describe, expect, it } from 'vitest';
import { Evidence } from '@openkey/core';
import { zmk } from '@openkey/protocols';

const {
  Deframer,
  Writer,
  ZmkSimulator,
  ZmkStudioDriver,
  decodeMessage,
  encodeRequest,
  fields,
  frame,
} = zmk;

describe('ZMK Studio wire format', () => {
  it('frames payloads, escaping SOF/ESC/EOF, and deframes split deliveries', () => {
    const payload = Uint8Array.of(0x01, 0xab, 0x02, 0xac, 0xad, 0x03);
    const framed = frame(payload);
    expect([...framed]).toEqual([0xab, 0x01, 0xac, 0xab, 0x02, 0xac, 0xac, 0xac, 0xad, 0x03, 0xad]);
    const d = new Deframer();
    expect(d.push(Uint8Array.of(0x00, ...framed.subarray(0, 4)))).toEqual([]); // noise is ignored
    expect(d.push(framed.subarray(4))).toEqual([payload]);
  });

  it('writes varints, zig-zag sint32 and ten-byte negative int32 as protobuf does', () => {
    expect([...new Writer().uint32(1, 300).finish()]).toEqual([0x08, 0xac, 0x02]);
    expect([...new Writer().sint32(1, -1).finish()]).toEqual([0x08, 0x01]);
    expect([...new Writer().sint32(1, 2).finish()]).toEqual([0x08, 0x04]);
    const neg = new Writer().int32(2, -1).finish();
    expect([...neg]).toEqual([0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(fields(neg)[0]!.value | 0).toBe(-1);
  });

  it('encodes requests with the request id and subsystem fields of studio.proto', () => {
    // request_id 7, keymap (5) { get_keymap (1) = true }
    expect([...encodeRequest(7, { keymap: 'getKeymap' })]).toEqual([
      0x08, 0x07, 0x2a, 0x02, 0x08, 0x01,
    ]);
    const set = fields(
      encodeRequest(1, {
        keymap: 'setLayerBinding',
        layerId: 2,
        keyPosition: 5,
        binding: { behaviorId: 1, param1: 0x70004, param2: 0 },
      }),
    );
    expect(set.map((f) => f.field)).toEqual([1, 5]);
  });

  it('reads an unlock-required error and a lock notification', () => {
    const err = new Writer()
      .message(1, new Writer().uint32(1, 3).message(2, new Writer().uint32(2, 1)))
      .finish();
    expect(decodeMessage(err)).toEqual({
      kind: 'response',
      requestId: 3,
      result: { meta: 'error', error: 'unlockRequired' },
    });
    const note = new Writer()
      .message(2, new Writer().message(2, new Writer().uint32(1, 1)))
      .finish();
    expect(decodeMessage(note)).toEqual({ kind: 'notification', lockState: 'unlocked' });
  });
});

describe('ZMK Studio driver (firmware simulator)', () => {
  it('reads the physical layout and keymap, mapping behaviours to key actions', async () => {
    const sim = new ZmkSimulator();
    const d = new ZmkStudioDriver(sim.channel());
    await d.connect();
    expect(d.name).toBe('OpenKey ZMK demo split');
    expect(d.getLayout().keys).toHaveLength(12);
    expect(d.getLayout().keys[3]!.x).toBe(4.5); // split gap of 1.5 keys
    expect(d.getLayerIds()).toEqual(['base', 'fn']);
    const base = await d.getKeymap('base');
    expect(base.slots[0]).toEqual({ kind: 'keyboard', usage: 0x29, modifiers: 0 });
    expect(base.slots[11]).toEqual({ kind: 'layer', layer: 1, mode: 'momentary' });
    const lower = await d.getKeymap('fn');
    expect(lower.slots[1]).toMatchObject({ kind: 'special', label: 'Caps Word' });
    expect(lower.slots[2]).toMatchObject({ kind: 'raw' }); // mod-tap: kept as it is
    expect(lower.slots[3]).toMatchObject({ kind: 'special', label: 'Transparent' });
    expect(d.getCapabilities().keymap).toMatchObject({
      write: true,
      confidence: Evidence.OBSERVED,
    });
  });

  it('writes changed keys, saves and reads back; raw bindings round-trip untouched', async () => {
    const sim = new ZmkSimulator();
    const d = new ZmkStudioDriver(sim.channel());
    await d.connect();
    const lower = await d.getKeymap('fn');
    sim.requests.length = 0;
    await d.setKeymap({
      ...lower,
      slots: { ...lower.slots, 0: { kind: 'keyboard', usage: 0x04, modifiers: 0x02 } },
    });
    expect(sim.requests.filter((r) => r === 'keymap.2')).toHaveLength(1);
    expect(sim.requests).toContain('keymap.4');
    expect(sim.layers[1]!.bindings[0]).toEqual({ behaviorId: 1, param1: 0x02070004, param2: 0 });
    expect(sim.layers[1]!.bindings[2]).toEqual({ behaviorId: 9, param1: 3, param2: 0x10004 });
    expect(JSON.parse(sim.saved)[1].bindings[0].param1).toBe(0x02070004);
  });

  it('never offers or assigns Bootloader, and never sends reset or lock', async () => {
    const sim = new ZmkSimulator();
    const d = new ZmkStudioDriver(sim.channel());
    await d.connect();
    expect(d.getSpecialActions().map((s) => s.label)).not.toContain('Bootloader');
    expect(d.getSpecialActions().map((s) => s.label)).toContain('Caps Word');
    const base = await d.getKeymap('base');
    await expect(
      d.setKeymap({ ...base, slots: { ...base.slots, 0: { kind: 'special', code: 0x10000 + 7 } } }),
    ).rejects.toThrow(/never assigned/);
    expect(sim.requests.filter((r) => r === 'core.3' || r === 'core.4')).toEqual([]);
    expect(sim.layers[0]!.bindings[0]!.behaviorId).toBe(1);
  });

  it('waits for the Studio unlock key before reading the keymap', async () => {
    const sim = new ZmkSimulator({ locked: true });
    const d = new ZmkStudioDriver(sim.channel());
    await d.connect();
    expect(d.locked).toBe(true);
    expect(d.getCapabilities().keymap.write).toBe(false);
    await expect(d.getKeymap()).rejects.toThrow(/Unlock/);
    const unlocked = d.waitForUnlock(1000);
    sim.unlock();
    await unlocked;
    expect(d.getCapabilities().keymap.write).toBe(true);
    expect((await d.getKeymap()).slots[0]).toMatchObject({ kind: 'keyboard' });
  });
});
