import { describe, expect, it } from 'vitest';
import { doctorSummary, runDoctor } from '@openkey/core';
import type { DoctorCollection, DoctorDevice } from '@openkey/core';

const kbd: DoctorCollection = { usagePage: 0x01, usage: 0x06, featureReports: 0, outputReports: 1 };
const consumer: DoctorCollection = {
  usagePage: 0x0c,
  usage: 0x01,
  featureReports: 0,
  outputReports: 0,
};
const vendor: DoctorCollection = {
  usagePage: 0xff13,
  usage: 0x01,
  featureReports: 1,
  outputReports: 0,
};
const via: DoctorCollection = {
  usagePage: 0xff60,
  usage: 0x61,
  featureReports: 0,
  outputReports: 1,
};

const device = (over: Partial<DoctorDevice> = {}): DoctorDevice => ({
  vendorId: 0x0c45,
  productId: 0x8009,
  productName: 'AK820 MAX',
  interfaces: [[kbd], [vendor]],
  openError: null,
  known: [{ model: 'AK820 MAX', link: 'usb', family: 'sonix-feature' }],
  ...over,
});

const byId = (checks: ReturnType<typeof runDoctor>, id: string) => checks.find((c) => c.id === id);

describe('connection doctor', () => {
  it('passes a healthy wired keyboard in a WebHID browser', () => {
    const checks = runDoctor({
      runtime: 'browser',
      os: 'windows',
      webHid: true,
      secureContext: true,
      device: device(),
    });
    expect(doctorSummary(checks)).toBe('pass');
    expect(byId(checks, 'interface')?.status).toBe('pass');
  });

  it('sends Firefox and Safari users to a Chromium browser or the CLI', () => {
    const c = byId(runDoctor({ runtime: 'browser', os: 'macos', webHid: false }), 'browser')!;
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/Chrome/);
    expect(c.fix).toMatch(/command-line/);
  });

  it('explains that phones cannot configure keyboards', () => {
    const c = byId(runDoctor({ runtime: 'browser', os: 'android', webHid: false }), 'browser')!;
    expect(c.status).toBe('fail');
    expect(c.title).toMatch(/Phones/);
  });

  it('gives the Linux udev fix with the exact device id', () => {
    const c = byId(
      runDoctor({
        runtime: 'browser',
        os: 'linux',
        webHid: true,
        secureContext: true,
        device: device({ vendorId: 0x258a, productId: 0x015e, openError: 'Failed to open' }),
      }),
      'access',
    )!;
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('--device 258A:015E');
  });

  it('blames the vendor app, not permissions, on Windows and macOS', () => {
    for (const os of ['windows', 'macos'] as const) {
      const c = byId(
        runDoctor({ runtime: 'browser', os, webHid: true, device: device({ openError: 'busy' }) }),
        'access',
      )!;
      expect(c.title).toMatch(/Another program/);
      expect(c.fix).toMatch(/vendor driver app/);
    }
  });

  it('spots a typing-only grant and says to pick the vendor entry', () => {
    const c = byId(
      runDoctor({ runtime: 'cli', os: 'linux', device: device({ interfaces: [[kbd, consumer]] }) }),
      'interface',
    )!;
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/other entry/);
  });

  it('recognises the VIA raw HID page on uncatalogued boards', () => {
    const checks = runDoctor({
      runtime: 'cli',
      os: 'linux',
      device: device({
        vendorId: 0x3434,
        productId: 0x0111,
        interfaces: [[kbd], [via]],
        known: [],
      }),
    });
    expect(byId(checks, 'interface')?.status).toBe('pass');
    expect(byId(checks, 'known')?.title).toMatch(/Open firmware/);
  });

  it('does not call vendor firmware VIA just because it reuses page FF60', () => {
    // The AK820 MAX 2.4 GHz receiver declares FF60:0061 next to its vendor pages.
    const checks = runDoctor({
      runtime: 'cli',
      os: 'linux',
      device: device({
        vendorId: 0x05ac,
        productId: 0x024f,
        interfaces: [[kbd], [via, { ...vendor, usagePage: 0xff59 }]],
        known: [{ model: 'AK820 MAX receiver', link: '2.4ghz', family: 'sonix-dongle' }],
      }),
    });
    expect(byId(checks, 'interface')?.title).toMatch(/vendor configuration interface/);
  });

  it('names boards from VIA’s catalogue', () => {
    const c = byId(
      runDoctor({
        runtime: 'cli',
        os: 'macos',
        device: device({
          vendorId: 0x3434,
          productId: 0x0100,
          known: [],
          viaNames: ['Keychron Q1'],
        }),
      }),
      'known',
    )!;
    expect(c.status).toBe('pass');
    expect(c.title).toContain('Keychron Q1');
  });

  it('tells receiver and Bluetooth users to use the cable', () => {
    const rx = byId(
      runDoctor({
        runtime: 'cli',
        os: 'windows',
        device: device({
          known: [{ model: 'F75 receiver', link: '2.4ghz', family: 'aula-receiver' }],
        }),
      }),
      'link',
    )!;
    expect(rx.status).toBe('warn');
    expect(rx.fix).toMatch(/USB cable/);
    const bt = byId(
      runDoctor({
        runtime: 'cli',
        os: 'windows',
        device: device({ known: [{ model: 'AK820 (BT)', link: 'bluetooth', family: 'none' }] }),
      }),
      'link',
    )!;
    expect(bt.status).toBe('fail');
  });

  it('flags identities shared by several models or families', () => {
    const c = byId(
      runDoctor({
        runtime: 'cli',
        os: 'linux',
        device: device({
          known: [
            { model: 'AK820 MAX', link: 'usb', family: 'sonix-feature' },
            { model: 'AK820 Pro', link: 'usb', family: 'sonix-feature' },
          ],
        }),
      }),
      'shared-id',
    )!;
    expect(c.status).toBe('info');
    expect(c.detail).toMatch(/own answers/);
  });

  it('runs no device checks without a device and no browser checks in the CLI', () => {
    expect(runDoctor({ runtime: 'cli', os: 'linux' })).toEqual([]);
    const b = runDoctor({ runtime: 'browser', os: 'linux', webHid: true, secureContext: true });
    expect(b.map((c) => c.id)).toEqual(['browser']);
  });
});
