import {
  MemoryStateStore,
  PacketLog,
  UnsupportedDeviceError,
  UnsupportedProtocolError,
} from '@openkey/core';
import type { KeyboardDriver, StateStore } from '@openkey/core';
import type { HidDeviceGroup } from '@openkey/hid';
import type { DetectionReport, DriverOptions, ProbeLevel, ProtocolRegistry } from './registry.js';

export interface ConnectOptions {
  registry: ProtocolRegistry;
  level?: ProbeLevel;
  log?: PacketLog;
  store?: StateStore;
  /** Force a protocol id (bypasses ranking but still requires a descriptor match). */
  protocolId?: string;
  allowExperimental?: boolean;
  cmdDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ConnectedKeyboard {
  driver: KeyboardDriver;
  detection: DetectionReport;
  log: PacketLog;
}

/** Detects the protocol of a device group and returns a connected driver. */
export async function connectKeyboard(
  group: HidDeviceGroup,
  opts: ConnectOptions,
): Promise<ConnectedKeyboard> {
  const log = opts.log ?? new PacketLog();
  const detection = await opts.registry.detect(group, { level: opts.level ?? 'handshake', log });
  let protocolId = detection.selected?.protocolId;
  if (opts.protocolId) {
    const cand = detection.candidates.find((c) => c.protocol.id === opts.protocolId);
    if (!cand?.match.applicable) {
      throw new UnsupportedProtocolError(
        `Protocol ${opts.protocolId} does not match this device's HID descriptors`,
        {
          rejections: cand?.match.rejections,
        },
      );
    }
    protocolId = opts.protocolId;
  }
  if (!protocolId) {
    const applicable = detection.candidates.filter((c) => c.match.applicable);
    if (detection.ambiguous) {
      throw new UnsupportedProtocolError(
        'More than one protocol matched equally; choose one explicitly.',
        { notes: detection.notes },
      );
    }
    if (applicable.length === 0) {
      throw new UnsupportedDeviceError(
        detection.catalog
          ? `${detection.catalog.model} (${detection.catalog.mcu}) is recognised but not configurable yet.`
          : `No known protocol matches "${group.identity.productName}".`,
        {
          candidates: detection.candidates.map((c) => ({
            id: c.protocol.id,
            rejections: c.match.rejections,
          })),
        },
      );
    }
    throw new UnsupportedProtocolError('Matching protocols were found but none passed its probe.', {
      probes: applicable.map((c) => ({ id: c.protocol.id, probe: c.probe?.summary })),
    });
  }
  const def = opts.registry.get(protocolId)!;
  const driverOpts: DriverOptions = {
    log,
    store: opts.store ?? new MemoryStateStore(),
    ...(detection.candidates.find((c) => c.protocol.id === protocolId)?.probe
      ? { probe: detection.candidates.find((c) => c.protocol.id === protocolId)!.probe! }
      : {}),
    ...(opts.cmdDelayMs !== undefined ? { cmdDelayMs: opts.cmdDelayMs } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.allowExperimental ? { allowExperimental: true } : {}),
  };
  const driver = await def.createDriver(group, driverOpts);
  await driver.connect();
  return { driver, detection, log };
}
