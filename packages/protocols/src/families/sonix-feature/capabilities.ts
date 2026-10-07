import { Evidence, FeatureStatus, configurable, emptyCapabilities, feature } from '@openkey/core';
import type { Capabilities, TransportMode } from '@openkey/core';
import type { SonixFeatureVariant } from './variants.js';

const S = Evidence.OBSERVED;
const C = Evidence.VERIFIED;

/**
 * Capabilities of the Windows-driver firmware family, per link. Every status cites its evidence;
 * "not implemented" is never reported as "not supported".
 */
export function sonixFeatureCapabilities(variant: SonixFeatureVariant, transport: TransportMode): Capabilities {
  const caps = emptyCapabilities();
  const p = variant.profile;
  caps.deviceInfo = feature(FeatureStatus.READ_ONLY, {
    read: 'device',
    confidence: C,
    note: 'From USB/HID descriptors; this firmware has no device-information command.',
    source: 'descriptors; official driver has no info command',
  });
  // Knob: the OS receives standard Consumer Control usages; no remap exists in the official software.
  caps.encoder = feature(FeatureStatus.PHYSICALLY_PRESENT, {
    confidence: S,
    value: 'Volume up / down, mute (standard HID Consumer Control)',
    note: 'No knob or wheel mapping exists in the official AK820 MAX/PRO software; a vendor remap command is not known.',
    source: 'official driver strings/menus; Linux input device "SONiX AK820 MAX Consumer Control"',
  });
  caps.gameMode = feature(FeatureStatus.NOT_SUPPORTED, {
    confidence: S,
    note: 'The official software has no game-mode command. Use the Win-key / Alt-Tab locks instead.',
    source: 'official driver UI (language table, settings packet)',
  });
  caps.tftBuiltIn = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
    confidence: Evidence.INFERRED,
    note: 'Built-in animations are switched on the keyboard; no PC command was found in the official driver.',
  });

  if (transport === 'bluetooth') {
    const bt = (note: string) => feature(FeatureStatus.NOT_SUPPORTED, { confidence: S, note, source: 'official driver message 62' });
    for (const f of ['keymap', 'fnLayer', 'macros', 'rgb', 'perKeyRgb', 'realtimeRgb', 'tft', 'tftGif', 'tftClock', 'sleep', 'keyResponse', 'winLock', 'altLocks', 'factoryDefaults'] as const) {
      caps[f] = bt('Keyboard settings are not supported over Bluetooth; connect by USB cable or the 2.4 GHz receiver.');
    }
    caps.battery = feature(FeatureStatus.UNKNOWN, { note: 'Bluetooth battery reporting depends on the host stack.' });
    caps.pollingRate = feature(FeatureStatus.UNKNOWN, { note: 'Bluetooth link timing is negotiated by the host.' });
    return caps;
  }

  caps.keymap = configurable('mirror', true, S, { note: 'The firmware cannot report its keymap; OpenKey shows what it last wrote.' });
  caps.fnLayer = configurable('mirror', true, S);
  caps.macros = configurable('mirror', true, S);
  caps.rgb = configurable('mirror', true, S);
  caps.perKeyRgb = configurable('device', true, S, { source: 'F5 read confirmed on hardware' });
  caps.realtimeRgb = configurable('none', true, S);
  if (p.tft) {
    caps.tft = configurable('none', true, S, { value: `${p.tft.width}×${p.tft.height} RGB565`, note: 'Upload only; images cannot be read back.' });
    caps.tftGif = configurable('none', true, S, { value: `up to ${p.tft.maxFrames} frames` });
    caps.tftClock = configurable('none', true, S);
  } else {
    for (const f of ['tft', 'tftGif', 'tftClock', 'tftBuiltIn'] as const) caps[f] = feature(FeatureStatus.NOT_SUPPORTED, { confidence: S, note: 'This model has no screen.' });
  }
  caps.sleep = configurable('mirror', true, S);
  caps.keyResponse = configurable('mirror', true, S);
  caps.winLock = configurable('mirror', true, S, { source: 'FUN_00414060 byte 4' });
  caps.altLocks = configurable('mirror', true, S, { source: 'FUN_00414060 bytes 2–3' });
  caps.factoryDefaults = configurable('none', true, Evidence.INFERRED, { note: 'Keymap/Fn defaults via an all-default table; no factory-reset command is sent.' });
  // Battery: official software polls it only through the 2.4 GHz receiver (FUN_00435890).
  caps.battery = feature(FeatureStatus.NOT_SUPPORTED, {
    confidence: S,
    value: transport === 'usb' ? 'Not reported over the USB cable' : undefined,
    note: 'Shown on the keyboard screen. The PC can read it only through the 2.4 GHz receiver (ping 20 01, byte 3).',
    source: 'FUN_00435890 (mode 2 only); 8 s passive listen on all vendor pipes: no status reports',
  });
  caps.pollingRate = feature(FeatureStatus.FIXED, {
    confidence: C,
    value: transport === 'usb' ? '1000 Hz ceiling (bInterval 1 ms), fixed' : 'set by the receiver',
    note: 'Declared USB interrupt interval 1 ms on all interfaces. No polling-rate command exists in the official software. Actual report cadence: measure with `openkey polling`.',
    source: 'lsusb -v / sysfs bInterval; official driver',
  });
  return caps;
}
