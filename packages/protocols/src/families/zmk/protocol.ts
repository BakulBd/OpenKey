import { Evidence } from '@openkey/core';
import { ADAPTER_API_VERSION } from '../../registry.js';
import type { ProtocolDefinition } from '../../registry.js';
import { ZMK_PROTOCOL_ID } from './driver.js';

/**
 * ZMK Studio is reached over USB serial (Web Serial), not HID: this definition carries the manifest
 * and never matches a HID device. The web app opens the serial port and creates the driver itself.
 */
export const zmkStudioProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: ZMK_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', 'bluetooth'], configuration: ['usb'] },
    verification:
      'Implemented from the ZMK Studio protocol messages and tested against a firmware simulator and an independent protobuf encoder; not yet run by OpenKey on a ZMK keyboard.',
    safety:
      'Writes need the keyboard unlocked with its own Studio unlock key. Changed keys are saved and read back; a refused key discards every pending change. Bootloader, reset and soft-off are never assigned, and the settings-reset request is never sent.',
    provenance: [
      {
        source: 'public-specification',
        reference: 'zmkfirmware/zmk-studio-messages proto/zmk/*.proto (MIT)',
        status: Evidence.OBSERVED,
      },
      {
        source: 'public-specification',
        reference:
          'zmkfirmware/zmk-studio-ts-client framing (MIT); zmk-studio app (Apache-2.0; facts only)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Keymap on every layer; layer add, remove and rename are not edited yet.',
      'Behaviours with parameters other than a key or a layer (mod-tap, Bluetooth profiles …) are kept as they are and shown as raw.',
      'Needs a browser with Web Serial (Chrome, Edge) and ZMK firmware built with Studio support.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'ZMK Studio (ZMK firmware over USB serial)',
  family: 'zmk-studio',
  priority: 10,
  supportedDevices:
    'Keyboards running ZMK firmware with CONFIG_ZMK_STUDIO (Corne, Sofle, nice!nano boards …)',
  supportedFirmware: 'ZMK Studio RPC',
  requiredUsagePages: [],
  requiredReports: [],
  evidence: ['zmk-studio-messages'],
  probePlan: {
    operations: [],
    autoConsent: () => ({ auto: false, reason: 'ZMK Studio is reached over serial, not HID' }),
  },
  match: () => ({
    applicable: false,
    score: 0,
    reasons: [],
    rejections: ['ZMK Studio uses USB serial, not HID'],
  }),
  probe: async () => ({
    status: 'skipped',
    confidence: Evidence.UNKNOWN,
    summary: 'Not a HID protocol.',
    steps: [],
    facts: {},
  }),
  createDriver() {
    throw new Error('ZMK Studio connects over USB serial; use connectZmkStudio.');
  },
};
