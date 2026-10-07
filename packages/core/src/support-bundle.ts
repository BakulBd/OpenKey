import type { Capabilities, FeatureId, FeatureStatus } from './model/capabilities.js';
import { FEATURES } from './model/capabilities.js';
import type { Evidence } from './evidence.js';

export const SUPPORT_BUNDLE_FORMAT = 'openkey-support-bundle';
export const SUPPORT_BUNDLE_VERSION = 1;

export interface SupportEnvironment {
  appVersion: string;
  userAgent: string;
  platform: string;
  webHid: boolean;
  secureContext: boolean;
}

export interface SupportCollection {
  usagePage: string;
  usage: string;
  inputReports: string[];
  outputReports: string[];
  featureReports: string[];
}

export interface SupportDevice {
  vendorId: string;
  productId: string;
  productName: string;
  manufacturer?: string;
  /** Present only when the user opted in; otherwise replaced by `serialRedacted`. */
  serialNumber?: string;
  serialRedacted?: boolean;
  release?: string;
  interfaces: { interfaceNumber?: number; collections: SupportCollection[] }[];
}

export interface SupportBundle {
  format: typeof SUPPORT_BUNDLE_FORMAT;
  version: typeof SUPPORT_BUNDLE_VERSION;
  createdAt: string;
  environment: SupportEnvironment;
  device: SupportDevice | null;
  adapter: { id: string; family: string; evidence: Evidence } | null;
  detection: { confidence: string; reasons: string[]; candidates: string[] } | null;
  capabilities: Partial<Record<FeatureId, FeatureStatus>>;
  connectionState: string;
  recentErrors: { at: string; kind: string; title: string }[];
  /** What was deliberately left out, so reviewers know the bundle is incomplete on purpose. */
  excluded: string[];
}

export interface SupportBundleInput {
  environment: SupportEnvironment;
  device: SupportDevice | null;
  adapter?: SupportBundle['adapter'];
  detection?: SupportBundle['detection'];
  capabilities?: Capabilities;
  connectionState: string;
  recentErrors?: SupportBundle['recentErrors'];
  /** Opt-in: include the serial number (off by default). */
  includeSerial?: boolean;
  now?: Date;
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
export const hexId = hex;

/**
 * Builds a sanitized diagnostic package. It never contains typing data, macro contents, keymaps or
 * packet payloads; serial numbers are removed unless the user opts in.
 */
export function buildSupportBundle(input: SupportBundleInput): SupportBundle {
  const excluded = ['typing data', 'macro contents', 'keymaps', 'packet payloads', 'file names'];
  let device = input.device;
  if (device && !input.includeSerial && device.serialNumber !== undefined) {
    const { serialNumber: _drop, ...rest } = device;
    device = { ...rest, serialRedacted: true };
  }
  if (!input.includeSerial) excluded.push('serial number');
  const caps: Partial<Record<FeatureId, FeatureStatus>> = {};
  if (input.capabilities) for (const f of FEATURES) caps[f] = input.capabilities[f].status;
  return {
    format: SUPPORT_BUNDLE_FORMAT,
    version: SUPPORT_BUNDLE_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    environment: input.environment,
    device,
    adapter: input.adapter ?? null,
    detection: input.detection ?? null,
    capabilities: caps,
    connectionState: input.connectionState,
    // Error titles only: details can echo packet bytes.
    recentErrors: (input.recentErrors ?? []).slice(-20).map(({ at, kind, title }) => ({ at, kind, title })),
    excluded,
  };
}

/** Markdown body for a "Request device support" GitHub issue. */
export function supportBundleToIssue(b: SupportBundle): string {
  const d = b.device;
  const lines = [
    `### Device`,
    d ? `- ${d.manufacturer ?? '?'} ${d.productName} (${d.vendorId}:${d.productId})` : '- none connected',
    ``,
    `### Interfaces`,
    ...(d?.interfaces.flatMap((i) =>
      i.collections.map(
        (c) =>
          `- ${i.interfaceNumber !== undefined ? `if${i.interfaceNumber} ` : ''}${c.usagePage}:${c.usage} in[${c.inputReports.join(',')}] out[${c.outputReports.join(',')}] feature[${c.featureReports.join(',')}]`,
      ),
    ) ?? []),
    ``,
    `### Detection`,
    b.detection ? `- ${b.detection.confidence}: ${b.detection.reasons.join('; ')}` : '- not run',
    ``,
    `### Environment`,
    `- OpenKey ${b.environment.appVersion}, ${b.environment.platform}, WebHID ${b.environment.webHid ? 'available' : 'unavailable'}`,
    ``,
    `<details><summary>Full diagnostic package (sanitized)</summary>`,
    ``,
    '```json',
    JSON.stringify(b, null, 2),
    '```',
    `</details>`,
  ];
  return lines.join('\n');
}
