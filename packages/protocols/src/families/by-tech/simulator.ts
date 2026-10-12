import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { HidInterfaceInfo, MockBehavior } from '@openkey/hid';
import {
  Cmd,
  HEADER_BYTES,
  INFO_IDENTITY,
  REPORT_BYTES,
  SETTINGS_PAGE_BYTES,
} from './constants.js';
import { AULA_LAYOUT, slotOffset } from './page.js';
import type { PageLayout } from './page.js';

/**
 * The settings page an AULA F75 returned on hardware (leisiji/AulaSofwareLinux config_page.rs test
 * data, MIT): effect 1 ("Fixed on"), sleep 0x0A, per-effect table from 0x3A, end marker 5A A5.
 */
export const F75_PAGE = Uint8Array.from([
  0x00, 0x03, 0x03, 0x01, 0x00, 0x00, 0x04, 0x04, 0x07, 0x00, 0x01, 0x20, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x02, 0x01, 0x00, 0xff, 0x0a, 0x00, 0x00, 0x00, 0x01, 0x00, 0x03, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x09, 0x40, 0x09, 0x47, 0x09, 0x47,
  0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47,
  0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x47, 0x09, 0x37, 0x09, 0x37, 0x09, 0x37,
  0x09, 0x37, 0x07, 0x47, 0x07, 0x47, 0x07, 0x44, 0x07, 0x44, 0x07, 0x44, 0x07, 0x44, 0x07, 0x44,
  0x07, 0x44, 0x07, 0x44, 0x04, 0x09, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x5a, 0xa5,
]);

export const F75_IDENTITY = Uint8Array.from([0x03, 0x00, 0x00, 0x00, 0x00, 0xcd]);
export const R75_IDENTITY = Uint8Array.from([0x0a, 0x00, 0x00, 0x00, 0x00, 0x00]);

/** HID layout of the RK R75 RGB vendor interface (sysfs report descriptor, 258A:015E). */
export function byTechInterfaces(reportId = 6): {
  keyboard: HidInterfaceInfo;
  vendor: HidInterfaceInfo;
} {
  return {
    keyboard: {
      interfaceNumber: 0,
      collections: [
        {
          usagePage: 0x0001,
          usage: 0x0006,
          inputReports: [{ reportId: 0, size: 8 }],
          outputReports: [{ reportId: 0, size: 1 }],
          featureReports: [],
        },
      ],
    },
    vendor: {
      interfaceNumber: 1,
      collections: [
        {
          usagePage: 0x000c,
          usage: 0x0001,
          inputReports: [{ reportId: 2, size: 2 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0xff00,
          usage: 0x0001,
          inputReports: [{ reportId: 3, size: 3 }],
          outputReports: [],
          featureReports: [],
        },
        {
          usagePage: 0xff00,
          usage: 0x0001,
          inputReports: [],
          outputReports: [],
          featureReports: [{ reportId: 5, size: 5 }],
        },
        {
          usagePage: 0xff00,
          usage: 0x0001,
          inputReports: [],
          outputReports: [],
          featureReports: [{ reportId, size: REPORT_BYTES }],
        },
      ],
    },
  };
}

export interface ByTechSimulatorOptions {
  identity?: DeviceIdentity;
  modelCode?: Uint8Array;
  page?: Uint8Array;
  /** Where the simulated firmware keeps its fields (for learn-mode tests of unknown models). */
  layout?: PageLayout;
  reportId?: number;
}

/**
 * Firmware simulator for the BY Tech OEM protocol: answers GET_INFO and GET_LED, stores SET_LED
 * pages, and can play the keyboard's own lighting shortcuts. Used by the demo and the tests.
 */
export class ByTechSimulator {
  readonly device: MockHidDevice;
  page: Uint8Array;
  readonly modelCode: Uint8Array;
  readonly layout: PageLayout;
  private reply: Uint8Array | null = null;
  /** Every SET_LED page written, in order. */
  readonly writes: Uint8Array[] = [];

  constructor(opts: ByTechSimulatorOptions = {}) {
    this.page = (opts.page ?? F75_PAGE).slice();
    this.modelCode = opts.modelCode ?? F75_IDENTITY;
    this.layout = opts.layout ?? AULA_LAYOUT;
    const reportId = opts.reportId ?? 6;
    const ifs = byTechInterfaces(reportId);
    const vendor: MockBehavior = {
      onFeatureSet: (id, data) => {
        if (id === reportId) this.onCommand(data);
      },
      onFeatureGet: (id) => {
        if (id !== reportId) return new Uint8Array(5);
        const r = this.reply ?? new Uint8Array(REPORT_BYTES);
        this.reply = null;
        return r;
      },
    };
    this.device = new MockHidDevice(
      opts.identity ?? {
        vendorId: 0x258a,
        productId: 0x010c,
        productName: 'Gaming Keyboard',
        manufacturer: 'BY Tech',
      },
      [
        { info: ifs.keyboard, behavior: {} },
        { info: ifs.vendor, behavior: vendor },
      ],
    );
  }

  private answer(cmd: number, data: Uint8Array): void {
    const r = new Uint8Array(REPORT_BYTES);
    r[0] = cmd;
    r[3] = 1;
    r[5] = data.length & 0xff;
    r[6] = data.length >> 8;
    r.set(data, HEADER_BYTES);
    this.reply = r;
  }

  private onCommand(data: Uint8Array): void {
    if (data.length !== REPORT_BYTES)
      throw new Error(`sim: command report must be ${REPORT_BYTES} bytes`);
    const [cmd, param] = [data[0]!, data[1]!];
    const len = data[5]! | (data[6]! << 8);
    if (cmd === Cmd.GET_INFO && param === INFO_IDENTITY) return this.answer(cmd, this.modelCode);
    if (cmd === Cmd.GET_LED) return this.answer(cmd, this.page.slice(0, len));
    if (cmd === Cmd.SET_LED) {
      const page = data.slice(HEADER_BYTES, HEADER_BYTES + len);
      this.writes.push(page);
      if (page.length === SETTINGS_PAGE_BYTES) this.page = page;
      return;
    }
    // Anything else is not a command OpenKey sends; the firmware ignores it.
    this.reply = null;
  }

  /** The keyboard's own "next effect" shortcut (Fn + light key). */
  pressNextEffect(): void {
    this.page[this.layout.effect] = (this.page[this.layout.effect]! % 18) + 1;
  }

  /** The keyboard's own "brightness up" shortcut for the live effect. */
  pressBrightnessUp(): void {
    const at = slotOffset(this.layout, this.page[this.layout.effect]!);
    if (at !== null)
      this.page[at] =
        Math.min(9, this.page[at]! + 1) === this.page[at] ? this.page[at]! - 1 : this.page[at]! + 1;
  }
}
