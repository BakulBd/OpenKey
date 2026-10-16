import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LinuxHidRawTransport, NodeHidTransport, groupNodeHidDevices } from '@openkey/hid-node';
import { createDefaultRegistry } from '@openkey/protocols';

/** What hidapi reports for the AK820 MAX on Windows: one entry per top-level collection, no sizes. */
const WINDOWS_AK820 = [
  {
    vendorId: 0x0c45,
    productId: 0x8009,
    product: 'AK820 MAX',
    manufacturer: 'SONiX',
    release: 0x0107,
    interface: 0,
    usagePage: 1,
    usage: 6,
    path: '\\\\?\\hid#vid_0c45&pid_8009&mi_00#a',
  },
  {
    vendorId: 0x0c45,
    productId: 0x8009,
    product: 'AK820 MAX',
    manufacturer: 'SONiX',
    release: 0x0107,
    interface: 1,
    usagePage: 0x0c,
    usage: 1,
    path: '\\\\?\\hid#vid_0c45&pid_8009&mi_01&col01#b',
  },
  {
    vendorId: 0x0c45,
    productId: 0x8009,
    product: 'AK820 MAX',
    manufacturer: 'SONiX',
    release: 0x0107,
    interface: 2,
    usagePage: 0xff68,
    usage: 0x61,
    path: '\\\\?\\hid#vid_0c45&pid_8009&mi_02#c',
  },
  {
    vendorId: 0x0c45,
    productId: 0x8009,
    product: 'AK820 MAX',
    manufacturer: 'SONiX',
    release: 0x0107,
    interface: 3,
    usagePage: 0xff13,
    usage: 1,
    path: '\\\\?\\hid#vid_0c45&pid_8009&mi_03#d',
  },
  {
    vendorId: 0x046d,
    productId: 0xc52b,
    product: 'Receiver',
    usagePage: 1,
    usage: 2,
    path: '\\\\?\\hid#vid_046d#e',
  },
];

describe('node-hid enumeration (macOS / Windows)', () => {
  it('groups collections by device, filters by vendor and marks report sizes unknown', () => {
    const groups = groupNodeHidDevices(WINDOWS_AK820, { vendorIds: [0x0c45] });
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.backend).toBe('node-hid');
    expect(g.identity).toMatchObject({
      vendorId: 0x0c45,
      productId: 0x8009,
      productName: 'AK820 MAX',
      release: 0x0107,
    });
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

describe('hidapi transport quirks', () => {
  const fake = (reads: number[][]) => ({
    read: async () => reads.shift() ?? null,
    write: async (b: Buffer) => b.length,
    sendFeatureReport: async (b: Buffer) => b.length,
    getFeatureReport: async (_id: number, n: number) => Buffer.alloc(n),
    close: async () => undefined,
  });
  const iface = (inputIds: number[]) => ({
    path: '/dev/null',
    collections: [
      {
        usagePage: 0xff02,
        usage: 2,
        inputReports: inputIds.map((reportId) => ({ reportId, size: 4 })),
        outputReports: [],
        featureReports: [],
      },
    ],
  });

  it('strips the report ID hidapi puts in front of numbered input reports, as WebHID does', async () => {
    const t = new NodeHidTransport(iface([0x13]));
    (t as unknown as { dev: unknown }).dev = fake([[0x13, 1, 2, 3, 4]]);
    expect([...(await t.readInputReport(10))!]).toEqual([1, 2, 3, 4]);
  });

  it('leaves unnumbered input reports alone, even when they start with a report-ID-like byte', async () => {
    const t = new NodeHidTransport(iface([0]));
    (t as unknown as { dev: unknown }).dev = fake([[0x13, 1, 2, 3]]);
    expect([...(await t.readInputReport(10))!]).toEqual([0x13, 1, 2, 3]);
  });

  it.runIf(process.platform === 'linux' && process.getuid?.() !== 0)(
    'tells read-only access apart from no access on Linux',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'openkey-'));
      const ro = path.join(dir, 'hidraw-ro');
      const none = path.join(dir, 'hidraw-none');
      await writeFile(ro, '');
      await writeFile(none, '');
      await chmod(ro, 0o444);
      await chmod(none, 0o000);
      await expect(new LinuxHidRawTransport({ path: ro, collections: [] }).open()).rejects.toThrow(
        /readable but not writable/,
      );
      await expect(
        new LinuxHidRawTransport({ path: none, collections: [] }).open(),
      ).rejects.toThrow(/No read\/write permission/);
      await rm(dir, { recursive: true, force: true });
    },
  );
});
