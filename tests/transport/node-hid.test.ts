import { describe, expect, it } from 'vitest';
import { groupNodeHidDevices } from '@openkey/hid-node';
import { createDefaultRegistry } from '@openkey/protocols';

/** What hidapi reports for the AK820 MAX on Windows: one entry per top-level collection, no sizes. */
const WINDOWS_AK820 = [
  { vendorId: 0x0c45, productId: 0x8009, product: 'AK820 MAX', manufacturer: 'SONiX', release: 0x0107, interface: 0, usagePage: 1, usage: 6, path: '\\\\?\\hid#vid_0c45&pid_8009&mi_00#a' },
  { vendorId: 0x0c45, productId: 0x8009, product: 'AK820 MAX', manufacturer: 'SONiX', release: 0x0107, interface: 1, usagePage: 0x0c, usage: 1, path: '\\\\?\\hid#vid_0c45&pid_8009&mi_01&col01#b' },
  { vendorId: 0x0c45, productId: 0x8009, product: 'AK820 MAX', manufacturer: 'SONiX', release: 0x0107, interface: 2, usagePage: 0xff68, usage: 0x61, path: '\\\\?\\hid#vid_0c45&pid_8009&mi_02#c' },
  { vendorId: 0x0c45, productId: 0x8009, product: 'AK820 MAX', manufacturer: 'SONiX', release: 0x0107, interface: 3, usagePage: 0xff13, usage: 1, path: '\\\\?\\hid#vid_0c45&pid_8009&mi_03#d' },
  { vendorId: 0x046d, productId: 0xc52b, product: 'Receiver', usagePage: 1, usage: 2, path: '\\\\?\\hid#vid_046d#e' },
];

describe('node-hid enumeration (macOS / Windows)', () => {
  it('groups collections by device, filters by vendor and marks report sizes unknown', () => {
    const groups = groupNodeHidDevices(WINDOWS_AK820, { vendorIds: [0x0c45] });
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.backend).toBe('node-hid');
    expect(g.identity).toMatchObject({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX', release: 0x0107 });
    expect(g.interfaces).toHaveLength(4);
    expect(g.interfaces.every((i) => i.sizesKnown === false)).toBe(true);
  });

  it('without report sizes the flagship is only a candidate until its handshake answers', async () => {
    const [g] = groupNodeHidDevices(WINDOWS_AK820, { vendorIds: [0x0c45] });
    const report = await createDefaultRegistry().detect(g!, { level: 'descriptor' });
    const c = report.candidates.find((x) => x.protocol.id === 'sonix-feature')!;
    expect(c.match.applicable).toBe(true);
    expect(c.match.reasons.join(' ')).toMatch(/report sizes not exposed/);
    expect(report.selected?.identification).not.toBe('identified');
  });

  it('skips entries without a path', () => {
    expect(groupNodeHidDevices([{ vendorId: 1, productId: 2 }])).toEqual([]);
  });
});
