import { Evidence, FeatureStatus, SafetyLevel, configurable, emptyCapabilities, feature } from '@openkey/core';
import type { Capabilities, TransportMode } from '@openkey/core';
import type { SonixFeatureVariant } from './variants.js';

const S = Evidence.OBSERVED;
const C = Evidence.VERIFIED;

/** USB product ID of the unit the writes were verified on. */
export const TESTED_PRODUCT_ID = 0x8009;

/** The unit the writes were verified on: AK820 MAX / MAX PLUS (`0C45:8009` "AK820 MAX") over USB. */
export function isTestedUnit(variant: SonixFeatureVariant, transport: TransportMode, productId: number): boolean {
  return variant.known && variant.id === 'ak820-max' && transport === 'usb' && productId === TESTED_PRODUCT_ID;
}

/**
 * Capabilities of the Windows-driver firmware family, per link. Every status cites its evidence;
 * "not implemented" is never reported as "not supported".
 */
export function sonixFeatureCapabilities(variant: SonixFeatureVariant, transport: TransportMode, productId: number): Capabilities {
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
    const bt = (note: string) =>
      feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: S, note, source: 'official driver message 62' });
    for (const f of ['keymap', 'fnLayer', 'macros', 'rgb', 'perKeyRgb', 'realtimeRgb', 'tft', 'tftGif', 'tftClock', 'sleep', 'keyResponse', 'winLock', 'altLocks', 'factoryDefaults'] as const) {
      caps[f] = bt('Keyboard settings are not available over Bluetooth; connect by USB cable.');
    }
    caps.battery = feature(FeatureStatus.UNKNOWN, { note: 'Bluetooth battery reporting depends on the host stack.' });
    caps.pollingRate = feature(FeatureStatus.UNKNOWN, { note: 'Bluetooth link timing is negotiated by the host.' });
    return caps;
  }

  // Safety classes: settings the firmware cannot report are CAUTION (the previous value is lost
  // unless a backup exists); bulk screen uploads and default restores are HIGH_RISK.
  const { CAUTION, HIGH_RISK, SAFE_PERSISTENT, SAFE_VOLATILE } = SafetyLevel;
  // Writes verified on hardware (fixtures/verification/ak820-max-plus-owner-test-hw.json) apply to
  // the unit that was tested — the AK820 MAX / MAX PLUS over USB. Siblings keep the driver evidence.
  const W = isTestedUnit(variant, transport, productId) ? C : S;
  const tested = W === C ? { source: 'official driver; verified on an AK820 MAX PLUS (USB, fw 1.07)' } : {};
  caps.keymap = configurable('mirror', true, W, { safety: CAUTION, ...tested, note: 'The firmware cannot report its keymap; OpenKey shows what it last wrote.' });
  caps.fnLayer = configurable('mirror', true, W, { safety: CAUTION, ...tested });
  caps.macros = configurable('mirror', true, W, { safety: CAUTION, ...tested, note: W === C ? 'The firmware cannot report its macros; OpenKey shows what it last wrote.' : 'Trigger-mode byte values are INFERRED from the online driver.' });
  caps.rgb = configurable('mirror', true, W, { safety: CAUTION, ...tested, note: W === C ? 'The firmware cannot report its lighting; OpenKey shows what it last wrote.' : 'Direction codes and which controls each effect honours are not yet verified.' });
  caps.perKeyRgb = configurable('device', true, W, { safety: SAFE_PERSISTENT, source: W === C ? 'read and write verified on hardware' : 'F5 read verified on hardware; write from the official driver', note: 'Writes are checked by read-back.' });
  caps.realtimeRgb = configurable('none', true, S, { safety: SAFE_VOLATILE });
  if (p.tft) {
    caps.tft = configurable('none', true, W, { safety: HIGH_RISK, value: `${p.tft.width}×${p.tft.height} RGB565`, note: 'Upload only; images cannot be read back.' });
    caps.tftGif = configurable('none', true, W, { safety: HIGH_RISK, value: `up to ${p.tft.maxFrames} frames` });
    caps.tftClock = configurable('none', true, W, { safety: SAFE_PERSISTENT });
  } else {
    for (const f of ['tft', 'tftGif', 'tftClock', 'tftBuiltIn'] as const) caps[f] = feature(FeatureStatus.NOT_SUPPORTED, { confidence: S, note: 'This model has no screen.' });
  }
  caps.sleep = configurable('mirror', true, W, { safety: CAUTION });
  caps.keyResponse = configurable('mirror', true, W, { safety: CAUTION });
  caps.winLock = configurable('mirror', true, W, { safety: CAUTION, source: 'FUN_00414060 byte 4' });
  caps.altLocks = configurable('mirror', true, W, { safety: CAUTION, source: 'FUN_00414060 bytes 2–3' });
  caps.factoryDefaults = configurable('none', true, Evidence.INFERRED, { safety: HIGH_RISK, note: 'Keymap/Fn defaults via an all-default table; no factory-reset command is sent.' });
  // Battery: official software polls it only through the 2.4 GHz receiver (FUN_00435890).
  caps.battery = feature(FeatureStatus.NOT_SUPPORTED, {
    confidence: S,
    value: transport === 'usb' ? 'Not reported over the USB cable' : undefined,
    note: 'Shown on the keyboard screen. The PC can read it only through the 2.4 GHz receiver (ping 20 01, byte 3).',
    source: 'FUN_00435890 (mode 2 only); 8 s passive listen on all vendor pipes: no status reports',
  });
  caps.pollingRate = feature(transport === 'usb' ? FeatureStatus.FIXED : FeatureStatus.UNKNOWN, {
    confidence: transport === 'usb' ? C : Evidence.UNKNOWN,
    value: transport === 'usb' ? 'Declared interval 1 ms (bInterval); measured cadence: not measured' : undefined,
    note: 'bInterval is the declared USB interrupt interval, a ceiling for the host — not a measured report rate. No polling-rate setting exists in the official software. Measure the cadence in the Latency Lab or with `openkey polling`.',
    source: 'lsusb -v / sysfs bInterval; official driver',
  });
  // debounce, profiles, firmware, actuation …: no evidence either way, so they stay UNKNOWN.
  return caps;
}
