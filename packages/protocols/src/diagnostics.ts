import { TransportError } from '@openkey/core';
import type { SupportBundle, SupportDevice, SupportReport } from '@openkey/core';
import type { HidCollection, HidDeviceGroup, HidReportInfo } from '@openkey/hid';
import { buildFingerprint } from './fingerprint.js';
import type { DeviceFingerprint } from './fingerprint.js';
import type { DetectionReport, ProtocolRegistry } from './registry.js';
import { detectionVerdict } from './verdict.js';
import type { DetectionVerdict } from './verdict.js';

const num = (h: string): number => parseInt(h.replace(/^0x/i, ''), 16);
const reports = (r: SupportReport[]): HidReportInfo[] =>
  r.map(({ reportId, size }) => ({ reportId, size }));

/**
 * A device group rebuilt from a diagnostic file. It has descriptors and nothing else: opening an
 * interface always fails, so no adapter can send a packet while analysing it.
 *
 * A usage that the file does not record becomes 0 (HID "undefined"), which no matcher requires, so
 * missing data can only make a match less likely, never more.
 */
export function offlineGroup(device: SupportDevice): HidDeviceGroup {
  const collections = (cs: SupportDevice['interfaces'][number]['collections']): HidCollection[] =>
    cs.map((c) => ({
      usagePage: num(c.usagePage),
      usage: c.usage === null ? 0 : num(c.usage),
      inputReports: reports(c.inputReports),
      outputReports: reports(c.outputReports),
      featureReports: reports(c.featureReports),
    }));
  return {
    key: `offline:${device.vendorId}:${device.productId}:${device.productName}`,
    identity: {
      vendorId: num(device.vendorId),
      productId: num(device.productId),
      productName: device.productName,
      ...(device.manufacturer !== undefined ? { manufacturer: device.manufacturer } : {}),
      ...(device.release !== undefined ? { release: num(device.release) } : {}),
    },
    interfaces: device.interfaces.map((i) => ({
      ...(i.interfaceNumber !== undefined ? { interfaceNumber: i.interfaceNumber } : {}),
      collections: collections(i.collections),
    })),
    backend: 'offline',
    transportHint: device.transport ?? 'usb',
    async openInterface() {
      throw new TransportError(
        'Offline analysis: the device is not connected, nothing can be sent.',
      );
    },
  };
}

export interface DiagnosticAnalysis {
  group: HidDeviceGroup;
  detection: DetectionReport;
  fingerprint: DeviceFingerprint;
  verdict: DetectionVerdict;
  /** Collections whose usage the file did not record. */
  missingUsages: number;
}

/** Descriptor-only detection of an imported diagnostic package. Performs no I/O by construction. */
export async function analyzeDiagnostic(
  bundle: SupportBundle,
  registry: ProtocolRegistry,
): Promise<DiagnosticAnalysis> {
  if (!bundle.device) throw new TransportError('The diagnostic package contains no device');
  const group = offlineGroup(bundle.device);
  const detection = await registry.detect(group, { level: 'descriptor' });
  return {
    group,
    detection,
    fingerprint: buildFingerprint(detection),
    verdict: detectionVerdict(detection, registry),
    missingUsages: bundle.device.interfaces
      .flatMap((i) => i.collections)
      .filter((c) => c.usage === null).length,
  };
}
