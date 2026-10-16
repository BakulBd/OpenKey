import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { FAILED, HMK_USAGE, HMK_USAGE_PAGE, HmkCmd, REPORT_SIZE } from './constants.js';

/**
 * The demo board's metadata: an OpenKey-authored 2 × 6 layout with 4 profiles and 4 layers,
 * gzip-compressed the way libhmk's build compresses it.
 */
export const HMK_DEMO_METADATA: Uint8Array = Uint8Array.from(
  atob(
    'H4sIAAAAAAAC/42RXU+DMBSG/wo5142RbWzYO40mGESNXhIuKj1szaAlhc6Rhf9u6SYXGsJumnPePH3P1wkkqxAovNUoY+y8KIk9jpXyoicgcEDJlX7mQFfLMFgTqLXiJm8vymZBwDRfkdjuPmtEKxasbJAA4/kHNqo0rVASqG85aap3rQpRYmP/uvyFdajHzFZvRvSeH5jMkZ/F0GmPne1V5IPUarXHhB0fhORCbkePhOVavSo+1PBtuyXrlGmBnmCPXcVqoGnqYqC3BL4tRGDn3qNTBr0nF8KfJRazxPI/cRP8YVazLsEkkZHfedZnZnCf9NnMVgpnibsrJvKvWO70drOsJ8CxYKZsY3c2e800638Av+1SjawCAAA=',
  ),
  (c) => c.charCodeAt(0),
);

const KEYS = 12;
const LAYERS = 4;
const PROFILES = 4;

/** libhmk firmware, as far as the protocol goes: metadata, keymaps and actuation per profile. */
export class HmkSimulator {
  readonly device: MockHidDevice;
  readonly keymap: Uint8Array[][];
  readonly actuation: number[][][];
  readonly commands: number[] = [];

  constructor(
    identity?: DeviceIdentity,
    readonly metadata: Uint8Array = HMK_DEMO_METADATA,
  ) {
    // Base layer: Esc Q W E R T / Tab A S D F MO(1); upper layers transparent.
    const base = [0x27, 0x12, 0x18, 0x06, 0x13, 0x15, 0x29, 0x02, 0x14, 0x05, 0x07, 0xc1];
    this.keymap = Array.from({ length: PROFILES }, () =>
      Array.from({ length: LAYERS }, (_, l) =>
        Uint8Array.from(l === 0 ? base : new Array(KEYS).fill(0x01)),
      ),
    );
    this.actuation = Array.from({ length: PROFILES }, () =>
      Array.from({ length: KEYS }, () => [128, 0, 0, 0]),
    );
    this.device = new MockHidDevice(
      identity ?? { vendorId: 0xab50, productId: 0xab60, productName: 'OpenKey HMK demo HE' },
      [
        {
          info: {
            collections: [
              {
                usagePage: HMK_USAGE_PAGE,
                usage: HMK_USAGE,
                inputReports: [{ reportId: 0, size: REPORT_SIZE }],
                outputReports: [{ reportId: 0, size: REPORT_SIZE }],
                featureReports: [],
              },
            ],
          },
          behavior: { onOutput: (_id, d, ctx) => ctx.emitInput(this.onCommand(d)) },
        },
      ],
    );
  }

  private onCommand(d: Uint8Array): Uint8Array {
    const r = new Uint8Array(REPORT_SIZE);
    const id = d[0]!;
    this.commands.push(id);
    r[0] = id;
    const fail = () => {
      r[0] = FAILED;
      return r;
    };
    switch (id) {
      case HmkCmd.FIRMWARE_VERSION:
        r.set([0x02, 0x01], 1); // 1.2
        break;
      case HmkCmd.GET_PROFILE:
        r[1] = 0;
        break;
      case HmkCmd.GET_METADATA: {
        const off = d[1]! | (d[2]! << 8) | (d[3]! << 16) | (d[4]! << 24);
        if (off >= this.metadata.length) return fail();
        const left = this.metadata.length - off;
        r.set([left & 0xff, (left >> 8) & 0xff, (left >> 16) & 0xff, left >>> 24], 1);
        r.set(this.metadata.subarray(off, off + Math.min(59, left)), 5);
        break;
      }
      case HmkCmd.GET_KEYMAP: {
        const [p, l, off] = [d[1]!, d[2]!, d[3]!];
        if (p >= PROFILES || l >= LAYERS || off >= KEYS) return fail();
        r.set(this.keymap[p]![l]!.subarray(off, off + 63), 1);
        break;
      }
      case HmkCmd.SET_KEYMAP: {
        const [p, l, off, len] = [d[1]!, d[2]!, d[3]!, d[4]!];
        if (p >= PROFILES || l >= LAYERS || off >= KEYS || len > 59 || off + len > KEYS)
          return fail();
        this.keymap[p]![l]!.set(d.subarray(5, 5 + len), off);
        break;
      }
      case HmkCmd.GET_ACTUATION_MAP: {
        const [p, off] = [d[1]!, d[2]!];
        if (p >= PROFILES || off >= KEYS) return fail();
        this.actuation[p]!.slice(off, off + 15).forEach((a, i) => r.set(a, 1 + i * 4));
        break;
      }
      case HmkCmd.SET_ACTUATION_MAP: {
        const [p, off, len] = [d[1]!, d[2]!, d[3]!];
        if (p >= PROFILES || off >= KEYS || len > 15 || off + len > KEYS) return fail();
        for (let i = 0; i < len; i++)
          this.actuation[p]![off + i] = [...d.subarray(4 + i * 4, 8 + i * 4)];
        break;
      }
      default:
        return fail();
    }
    return r;
  }
}
