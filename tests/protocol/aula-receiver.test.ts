import { describe, expect, it } from 'vitest';
import { FeatureStatus, MemoryStateStore, PacketLog } from '@openkey/core';
import { aulaReceiver, byTech, createDefaultRegistry, openDriver } from '@openkey/protocols';

const { AulaReceiverSimulator, request, isReply, FORBIDDEN } = aulaReceiver;

async function connect(sim: InstanceType<typeof AulaReceiverSimulator>) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, {
    level: 'handshake',
    consent: ['aula-receiver'],
  });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { driver: kb.driver as InstanceType<typeof aulaReceiver.AulaReceiverDriver>, detection };
}

describe('AULA receiver protocol', () => {
  it('builds the identity request as published (13 05 01 00 … checksum)', () => {
    const r = request(0x05);
    expect(r.length).toBe(19);
    expect(Array.from(r.subarray(0, 3))).toEqual([0x05, 0x01, 0x00]);
    expect(r[18]).toBe((0x13 + 0x05 + 0x01) & 0xff);
  });

  it('refuses write, apply and reset opcodes', () => {
    for (const op of FORBIDDEN) expect(() => request(op)).toThrow(/never sends/);
  });

  it('accepts only replies with the right length, command and checksum', () => {
    const good = new Uint8Array(19);
    good.set([0x05, 1, 0, 10]);
    good[18] = (0x13 + 0x05 + 1 + 10) & 0xff;
    expect(isReply(good, 0x05)).toBe(true);
    expect(isReply(good.slice(0, 18), 0x05)).toBe(false);
    const bad = good.slice();
    bad[18] = bad[18]! ^ 1;
    expect(isReply(bad, 0x05)).toBe(false);
    expect(isReply(Uint8Array.of(0x05, 0), 0x05)).toBe(false);
  });
});

describe('AULA receiver driver (simulator)', () => {
  it('asks before the identity read and sends nothing until allowed', async () => {
    const sim = new AulaReceiverSimulator();
    const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(r.candidates.find((c) => c.protocol.id === 'aula-receiver')!.consent).toMatchObject({
      required: true,
    });
    expect(sim.sent).toEqual([]);
  });

  it('identifies an F99 Pro through the receiver, skipping other input reports', async () => {
    const { driver, detection } = await connect(new AulaReceiverSimulator());
    expect(detection.selected).toMatchObject({
      protocolId: 'aula-receiver',
      identification: 'identified',
    });
    expect(driver.model?.model).toBe('F99 Pro');
    const info = await driver.getDeviceInfo();
    expect(info.model).toBe('AULA F99 Pro (2.4 GHz receiver)');
    expect(info.battery).toEqual({ level: 87, charging: false });
  });

  it('reads the multi-page settings page with the cable layout, read-only', async () => {
    const { driver } = await connect(new AulaReceiverSimulator());
    expect(await driver.getRgbConfig()).toMatchObject({ effect: 1, brightness: 9, speed: 4 });
    const caps = driver.getCapabilities();
    expect(caps.rgb.status).toBe(FeatureStatus.READ_ONLY);
    expect(caps.rgb.write).toBe(false);
    expect(caps.keymap.status).toBe(FeatureStatus.TRANSPORT_LIMITED);
  });

  it('names an F99 (model code A4) and an F75 (CD) by the same table as the cable adapter', async () => {
    for (const [code, name] of [
      [0xa4, 'F99'],
      [0xcd, 'F75'],
    ] as const) {
      const { driver } = await connect(
        new AulaReceiverSimulator(Uint8Array.of(3, 0, 0, 0, 0, code)),
      );
      expect(driver.model?.model).toBe(name);
    }
    expect(byTech.modelFor(Uint8Array.of(3, 0, 0, 0, 1, 0x58))?.model).toBe('F99 Pro');
  });

  it('never sends a write, apply or reset command', async () => {
    const sim = new AulaReceiverSimulator();
    const { driver } = await connect(sim);
    await driver.getRgbConfig();
    await driver.getBattery();
    expect(sim.sent.every((c) => [0x05, 0x0b, 0x44].includes(c))).toBe(true);
  });
});
