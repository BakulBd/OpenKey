import { describe, expect, it } from 'vitest';
import { parseReportDescriptor } from '@openak820/hid';
import { fixture, hex, readRe } from '../helpers.js';

interface DeviceFixture {
  interfaces: { interfaceNumber: number; descriptorHex: string }[];
}

describe('HID report descriptor parser', () => {
  it('parses the FF68 data pipe of the AK820 MAX (interface 2)', () => {
    const c = parseReportDescriptor(readRe('descriptors/interface2.bin'));
    expect(c).toEqual([
      {
        usagePage: 0xff68,
        usage: 0x61,
        inputReports: [{ reportId: 0, size: 64 }],
        outputReports: [{ reportId: 0, size: 4096 }],
        featureReports: [],
      },
    ]);
  });

  it('parses the FF13 control pipe of the AK820 MAX (interface 3)', () => {
    const c = parseReportDescriptor(readRe('descriptors/interface3.bin'));
    expect(c).toEqual([
      {
        usagePage: 0xff13,
        usage: 0x01,
        inputReports: [{ reportId: 0, size: 64 }],
        outputReports: [{ reportId: 0, size: 64 }],
        featureReports: [{ reportId: 0, size: 64 }],
      },
    ]);
  });

  it('splits the multi-collection interface 1 with report IDs', () => {
    const fx = fixture<DeviceFixture>('device-info/ak820-max-plus-usb-1.07.json');
    const c = parseReportDescriptor(hex(fx.interfaces[1]!.descriptorHex));
    expect(c.map((x) => [x.usagePage, x.usage, x.inputReports[0]])).toEqual([
      [0x0c, 0x01, { reportId: 3, size: 2 }],
      [0x01, 0x80, { reportId: 2, size: 1 }],
      [0x01, 0x06, { reportId: 1, size: 15 }],
      [0x01, 0x02, { reportId: 6, size: 4 }],
      [0xffff, 0x01, { reportId: 5, size: 3 }],
    ]);
  });

  it('parses the boot keyboard interface', () => {
    const fx = fixture<DeviceFixture>('device-info/ak820-max-plus-usb-1.07.json');
    const [kb] = parseReportDescriptor(hex(fx.interfaces[0]!.descriptorHex));
    expect(kb).toMatchObject({
      usagePage: 1,
      usage: 6,
      inputReports: [{ reportId: 0, size: 8 }],
      outputReports: [{ reportId: 0, size: 1 }],
    });
  });
});
