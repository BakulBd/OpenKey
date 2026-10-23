import type { Capabilities, FeatureId, FeatureStatus } from './model/capabilities.js';
import { FEATURES } from './model/capabilities.js';
import type { Evidence } from './evidence.js';
import type { TransportMode } from './model/device.js';
import type { ProtocolCheckResult } from './model/diagnostics.js';

export const SUPPORT_BUNDLE_FORMAT = 'openkey-support-bundle';
/**
 * v2: reports are structured `{ reportId, size }` (v1 stored display strings) so a bundle can be
 * re-analysed offline; `usage` may be null when a source did not record it; optional transport.
 */
export const SUPPORT_BUNDLE_VERSION = 2;

export interface SupportEnvironment {
  appVersion: string;
  userAgent: string;
  platform: string;
  webHid: boolean;
  secureContext: boolean;
}

/** One declared report: ID and payload size in bytes (excluding the report-ID byte). */
export interface SupportReport {
  reportId: number;
  size: number;
}

export interface SupportCollection {
  /** Hex, e.g. `0xFF13`. */
  usagePage: string;
  /** Hex, or null when the source of the diagnostic did not record the usage. */
  usage: string | null;
  inputReports: SupportReport[];
  outputReports: SupportReport[];
  featureReports: SupportReport[];
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
  /** Link the device was connected over, when known. */
  transport?: TransportMode;
  interfaces: { interfaceNumber?: number; collections: SupportCollection[] }[];
}

/** Why one adapter was or was not considered for the device (no packet payloads). */
export interface SupportCandidate {
  id: string;
  family: string;
  applicable: boolean;
  score: number;
  reasons: string[];
  rejections: string[];
  consent?: { required: boolean; granted: boolean };
  probe?: {
    status: string;
    summary: string;
    identified: boolean;
    steps: { name: string; status: string; detail: string }[];
  };
}

/** One vendor-defined collection and how it can carry commands. */
export interface SupportChannel {
  interfaceIndex: number;
  usagePage: string;
  usage: string | null;
  /**
   * - command: output and input reports with the same ID (request / answer pairs);
   * - feature: feature reports (set and get on the same report);
   * - output-only: commands without an answer on this collection;
   * - input-only: the keyboard reports something by itself (e.g. a status or a key event).
   */
  kind: 'command' | 'feature' | 'output-only' | 'input-only' | 'none';
  reportIds: number[];
  /** Largest report on the collection including the report-ID byte, as written on the wire. */
  frameBytes: number;
}

/** What is publicly known about a protocol family the device appears to belong to. */
export interface ProtocolHint {
  id: string;
  title: string;
  /** `identity`: the USB identity is a known model; `descriptor`: only the report layout matches. */
  basis: 'identity' | 'descriptor';
  facts: string[];
  sources: string[];
}

export interface SupportFeatureEvidence {
  status: FeatureStatus;
  confidence: string;
  read: string;
  write: boolean;
}

/** Derived from the descriptors and the session; helps a maintainer place the device. */
export interface SupportAnalysis {
  /** Order-independent description of the HID layout. */
  signature: string;
  /** Short stable hash of `signature`: identical boards give the same fingerprint. */
  fingerprint: string;
  channels: SupportChannel[];
  hints: ProtocolHint[];
  candidates: SupportCandidate[];
  features: Partial<Record<FeatureId, SupportFeatureEvidence>>;
  protocolChecks: ProtocolCheckResult[];
}

export interface SupportBundle {
  format: typeof SUPPORT_BUNDLE_FORMAT;
  version: typeof SUPPORT_BUNDLE_VERSION;
  createdAt: string;
  environment: SupportEnvironment;
  device: SupportDevice | null;
  adapter: { id: string; family: string; evidence: Evidence } | null;
  detection: {
    confidence: string;
    verdict?: string;
    reasons: string[];
    candidates: string[];
  } | null;
  capabilities: Partial<Record<FeatureId, FeatureStatus>>;
  connectionState: string;
  recentErrors: { at: string; kind: string; title: string }[];
  /** What was deliberately left out, so reviewers know the bundle is incomplete on purpose. */
  excluded: string[];
  /** Added in OpenKey 0.3; absent from older packages and from imported files. */
  analysis?: SupportAnalysis;
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
  candidates?: SupportCandidate[];
  hints?: ProtocolHint[];
  /** Results of protocol checks the user ran (reply shapes only). */
  protocolChecks?: ProtocolCheckResult[];
  now?: Date;
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
export const hexId = hex;

const isVendorPage = (page: string) => parseInt(page, 16) >= 0xff00;

/** Order-independent description of a device's HID layout (identity excluded). */
export function descriptorSignature(device: SupportDevice): string {
  return device.interfaces
    .map((i) => i.collections.map(sig).sort().join(' + '))
    .sort()
    .join(' | ');
}

/** FNV-1a 32-bit hash of the signature, as 8 hex digits. */
export function descriptorFingerprint(device: SupportDevice): string {
  let h = 0x811c9dc5;
  for (const ch of descriptorSignature(device)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The vendor-defined collections and how each can carry commands. */
export function vendorChannels(device: SupportDevice): SupportChannel[] {
  const out: SupportChannel[] = [];
  device.interfaces.forEach((iface, interfaceIndex) => {
    for (const c of iface.collections) {
      if (!isVendorPage(c.usagePage)) continue;
      const ins = new Set(c.inputReports.map((r) => r.reportId));
      const outs = c.outputReports.map((r) => r.reportId);
      const all = [...c.inputReports, ...c.outputReports, ...c.featureReports];
      const kind: SupportChannel['kind'] = outs.some((id) => ins.has(id))
        ? 'command'
        : c.featureReports.length
          ? 'feature'
          : outs.length
            ? 'output-only'
            : ins.size
              ? 'input-only'
              : 'none';
      out.push({
        interfaceIndex,
        usagePage: c.usagePage,
        usage: c.usage,
        kind,
        reportIds: [...new Set(all.map((r) => r.reportId))].sort((a, b) => a - b),
        frameBytes: all.reduce((m, r) => Math.max(m, r.size + (r.reportId ? 1 : 0)), 0),
      });
    }
  });
  return out;
}

/** Step details are kept short and never carry serial numbers or raw bytes. */
function sanitizeCandidate(c: SupportCandidate): SupportCandidate {
  const clip = (t: string) => (t.length > 160 ? `${t.slice(0, 157)}…` : t);
  return {
    ...c,
    reasons: c.reasons.slice(0, 8).map(clip),
    rejections: c.rejections.slice(0, 8).map(clip),
    ...(c.probe
      ? {
          probe: {
            ...c.probe,
            summary: clip(c.probe.summary),
            steps: c.probe.steps
              .slice(0, 12)
              .map((s) =>
                /serial|\bsn\b/i.test(s.name)
                  ? { name: s.name, status: s.status, detail: '(redacted)' }
                  : { name: s.name, status: s.status, detail: clip(s.detail) },
              ),
          },
        }
      : {}),
  };
}

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
  const features: Partial<Record<FeatureId, SupportFeatureEvidence>> = {};
  if (input.capabilities)
    for (const f of FEATURES) {
      const c = input.capabilities[f];
      caps[f] = c.status;
      if (c.status !== 'UNKNOWN')
        features[f] = { status: c.status, confidence: c.confidence, read: c.read, write: c.write };
    }
  const analysis: SupportAnalysis | undefined = device
    ? {
        signature: descriptorSignature(device),
        fingerprint: descriptorFingerprint(device),
        channels: vendorChannels(device),
        hints: input.hints ?? [],
        candidates: (input.candidates ?? []).map(sanitizeCandidate),
        features,
        protocolChecks: (input.protocolChecks ?? []).map((r) => {
          // Facts are short identifiers from an adapter's allowlist; anything else is dropped.
          const facts = Object.fromEntries(
            Object.entries(r.facts ?? {}).filter(
              ([k, v]) => /^[A-Za-z0-9]{1,32}$/.test(k) && /^[A-Za-z0-9_]{1,32}$/.test(v),
            ),
          );
          const { facts: _raw, ...rest } = r;
          return {
            ...rest,
            detail: r.detail.slice(0, 200),
            ...(Object.keys(facts).length ? { facts } : {}),
          };
        }),
      }
    : undefined;
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
    recentErrors: (input.recentErrors ?? [])
      .slice(-20)
      .map(({ at, kind, title }) => ({ at, kind, title })),
    excluded,
    ...(analysis ? { analysis } : {}),
  };
}

const fmtReports = (r: SupportReport[]): string =>
  r.map((x) => `${x.reportId}:${x.size}B`).join(',');

function analysisLines(a: SupportAnalysis | undefined): string[] {
  if (!a) return [];
  const lines = [`### Analysis`, `- Descriptor fingerprint \`${a.fingerprint}\``];
  for (const c of a.channels)
    lines.push(
      `- Vendor channel ${c.usagePage}:${c.usage ?? '?'} (interface ${c.interfaceIndex}): ${c.kind}, report ${c.reportIds.join('/') || '—'}, ${c.frameBytes}-byte frames`,
    );
  for (const h of a.hints)
    lines.push(
      `- Known family (${h.basis}): ${h.title}${h.facts.length ? ` — ${h.facts[0]}` : ''}`,
    );
  const applicable = a.candidates.filter((c) => c.applicable);
  for (const c of applicable)
    lines.push(
      `- Adapter \`${c.id}\`: score ${c.score}${c.consent?.required ? `, consent ${c.consent.granted ? 'given' : 'not given'}` : ''}${c.probe ? `, probe ${c.probe.status}${c.probe.identified ? ' (identified)' : ''}` : ''}`,
    );
  if (!applicable.length && a.candidates.length) {
    const near = [...a.candidates].sort((x, y) => y.score - x.score).slice(0, 3);
    for (const c of near)
      lines.push(`- Not matched \`${c.id}\`: ${c.rejections[0] ?? 'no reason recorded'}`);
  }
  for (const r of a.protocolChecks)
    lines.push(
      `- Protocol check ${r.title} (\`${r.command}\`): ${r.status}${r.reply ? `, report ${r.reply.reportId}, ${r.reply.length} B, first byte ${r.reply.firstByte}${r.reply.echo ? ' (echo)' : ''}, ${r.reply.nonZeroBytes} non-zero` : ''}${
        r.facts && Object.keys(r.facts).length
          ? `; ${Object.entries(r.facts)
              .map(([k, v]) => `${k} \`${v}\``)
              .join(', ')}`
          : ''
      }`,
    );
  lines.push(``);
  return lines;
}

/** A researcher's note, with how it is known. Never included in a package unless the user asks. */
export interface ResearchNote {
  text: string;
  evidence: 'hardware' | 'vendor-software' | 'inferred' | 'hypothesis';
  at: string;
}

const NOTE_LABEL: Record<ResearchNote['evidence'], string> = {
  hardware: 'observed on hardware',
  'vendor-software': 'from vendor software',
  inferred: 'inferred',
  hypothesis: 'hypothesis',
};

/** Markdown body for a "Request device support" GitHub issue. Notes are added only when passed. */
export function supportBundleToIssue(b: SupportBundle, notes: ResearchNote[] = []): string {
  const d = b.device;
  const lines = [
    `### Device`,
    d
      ? `- ${d.manufacturer ?? '?'} ${d.productName} (${d.vendorId}:${d.productId})${d.transport ? `, ${d.transport}` : ''}`
      : '- none connected',
    ``,
    `### Interfaces`,
    ...(d?.interfaces.flatMap((i) =>
      i.collections.map(
        (c) =>
          `- ${i.interfaceNumber !== undefined ? `if${i.interfaceNumber} ` : ''}${c.usagePage}:${c.usage ?? '?'} in[${fmtReports(c.inputReports)}] out[${fmtReports(c.outputReports)}] feature[${fmtReports(c.featureReports)}]`,
      ),
    ) ?? []),
    ``,
    `### Detection`,
    b.detection
      ? `- ${b.detection.verdict ? `${b.detection.verdict}, ` : ''}${b.detection.confidence}: ${b.detection.reasons.join('; ')}`
      : '- not run',
    ``,
    ...analysisLines(b.analysis),
    ...(notes.length
      ? [
          `### Research notes`,
          ...notes.map(
            (n) => `- (${NOTE_LABEL[n.evidence]}) ${n.text.replace(/\s+/g, ' ').trim()}`,
          ),
          ``,
        ]
      : []),
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

// ---------------------------------------------------------------------------------------------
// Import. Diagnostic files come from strangers: they are parsed as data, bounded in size, and
// reduced to the fields offline analysis needs. Nothing in them can select a write path.

/** Largest diagnostic file accepted, in characters of JSON. */
export const MAX_DIAGNOSTIC_CHARS = 512 * 1024;
const MAX_INTERFACES = 32;
const MAX_COLLECTIONS = 64;
const MAX_REPORTS = 256;
/** Largest report size in bytes any HID transport can carry (16-bit report count × 8-bit size). */
const MAX_REPORT_BYTES = 65535;

export class DiagnosticFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticFormatError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function hexField(v: unknown, what: string, allowNull = false): string | null {
  if (v === null && allowNull) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff) return hex(v);
  if (typeof v === 'string' && /^(0x)?[0-9a-f]{1,4}$/i.test(v.trim()))
    return hex(parseInt(v.trim().replace(/^0x/i, ''), 16));
  throw new DiagnosticFormatError(`${what} must be a 16-bit hex value`);
}

function parseReports(v: unknown, what: string): SupportReport[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new DiagnosticFormatError(`${what} must be a list`);
  if (v.length > MAX_REPORTS) throw new DiagnosticFormatError(`${what}: too many reports`);
  return v.map((r, i) => {
    let reportId: unknown;
    let size: unknown;
    if (typeof r === 'string') {
      // v1 display form: "id 6: 519 B"
      const m = /^id\s+(\d+):\s*(\d+)\s*B$/.exec(r.trim());
      if (!m)
        throw new DiagnosticFormatError(`${what}[${i}]: unreadable report "${r.slice(0, 40)}"`);
      reportId = Number(m[1]);
      size = Number(m[2]);
    } else if (isObj(r)) {
      reportId = r.reportId;
      size = r.size;
    }
    if (!Number.isInteger(reportId) || (reportId as number) < 0 || (reportId as number) > 255)
      throw new DiagnosticFormatError(`${what}[${i}]: report ID must be 0–255`);
    if (!Number.isInteger(size) || (size as number) < 0 || (size as number) > MAX_REPORT_BYTES)
      throw new DiagnosticFormatError(`${what}[${i}]: report size out of range`);
    return { reportId: reportId as number, size: size as number };
  });
}

function parseDevice(v: unknown): SupportDevice {
  if (!isObj(v)) throw new DiagnosticFormatError('The file has no device section');
  if (!Array.isArray(v.interfaces) || v.interfaces.length === 0)
    throw new DiagnosticFormatError('The device section lists no HID interfaces');
  if (v.interfaces.length > MAX_INTERFACES) throw new DiagnosticFormatError('Too many interfaces');
  let total = 0;
  const interfaces = v.interfaces.map((raw, ii) => {
    if (!isObj(raw) || !Array.isArray(raw.collections))
      throw new DiagnosticFormatError(`interfaces[${ii}] has no collections`);
    total += raw.collections.length;
    if (total > MAX_COLLECTIONS) throw new DiagnosticFormatError('Too many collections');
    const n = raw.interfaceNumber;
    return {
      ...(Number.isInteger(n) && (n as number) >= 0 && (n as number) < 256
        ? { interfaceNumber: n as number }
        : {}),
      collections: raw.collections.map((c, ci): SupportCollection => {
        const at = `interfaces[${ii}].collections[${ci}]`;
        if (!isObj(c)) throw new DiagnosticFormatError(`${at} is not an object`);
        return {
          usagePage: hexField(c.usagePage, `${at}.usagePage`)!,
          usage: hexField(c.usage ?? null, `${at}.usage`, true),
          inputReports: parseReports(c.inputReports, `${at}.inputReports`),
          outputReports: parseReports(c.outputReports, `${at}.outputReports`),
          featureReports: parseReports(c.featureReports, `${at}.featureReports`),
        };
      }),
    };
  });
  const str = (x: unknown, max = 128): string | undefined =>
    typeof x === 'string' ? x.slice(0, max) : undefined;
  const transport = ['usb', '2.4ghz', 'bluetooth', 'unknown'].includes(v.transport as string)
    ? (v.transport as TransportMode)
    : undefined;
  const manufacturer = str(v.manufacturer);
  const release = v.release !== undefined ? hexField(v.release, 'release') : null;
  // Serial numbers are never imported: offline analysis does not need them.
  return {
    vendorId: hexField(v.vendorId, 'vendorId')!,
    productId: hexField(v.productId, 'productId')!,
    productName: str(v.productName) ?? '',
    ...(manufacturer !== undefined ? { manufacturer } : {}),
    ...(release ? { release } : {}),
    ...(transport ? { transport } : {}),
    interfaces,
  };
}

/**
 * Parses an OpenKey diagnostic file (support bundle v1 or v2). Returns the bundle with only the
 * fields offline analysis uses, migrated to v2. Throws `DiagnosticFormatError` with a readable
 * message for anything else.
 */
export function parseSupportBundle(text: string): SupportBundle {
  if (text.length > MAX_DIAGNOSTIC_CHARS)
    throw new DiagnosticFormatError('The file is too large for a diagnostic package');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DiagnosticFormatError('The file is not valid JSON');
  }
  if (!isObj(json) || json.format !== SUPPORT_BUNDLE_FORMAT)
    throw new DiagnosticFormatError('This is not an OpenKey diagnostic package');
  if (json.version !== 1 && json.version !== 2)
    throw new DiagnosticFormatError(
      `Diagnostic format version ${String(json.version)} is not supported`,
    );
  const env = isObj(json.environment) ? json.environment : {};
  return {
    format: SUPPORT_BUNDLE_FORMAT,
    version: SUPPORT_BUNDLE_VERSION,
    createdAt: typeof json.createdAt === 'string' ? json.createdAt.slice(0, 40) : '',
    environment: {
      appVersion: typeof env.appVersion === 'string' ? env.appVersion.slice(0, 40) : '?',
      userAgent: '',
      platform: typeof env.platform === 'string' ? env.platform.slice(0, 40) : '?',
      webHid: env.webHid === true,
      secureContext: env.secureContext === true,
    },
    device: parseDevice(json.device),
    adapter: null,
    detection: null,
    capabilities: {},
    connectionState: 'OFFLINE',
    recentErrors: [],
    excluded: [
      'everything except device identity and HID descriptors (imported for offline analysis)',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Comparison of two diagnostic packages (e.g. the same model on two firmwares, or wired vs dongle).

export interface CollectionDiff {
  /** `PAGE:USAGE in[…] out[…] feature[…]`, independent of interface order. */
  signature: string;
  side: 'both' | 'a' | 'b';
}

export interface DiagnosticComparison {
  identity: { field: string; a: string; b: string; same: boolean }[];
  collections: CollectionDiff[];
  /** True when both describe exactly the same HID layout. */
  sameDescriptors: boolean;
}

const sig = (c: SupportCollection): string => {
  const r = (l: SupportReport[]) =>
    l
      .map((x) => `${x.reportId}:${x.size}`)
      .sort()
      .join(',');
  return `${c.usagePage}:${c.usage ?? '?'} in[${r(c.inputReports)}] out[${r(c.outputReports)}] feature[${r(c.featureReports)}]`;
};

export function compareDiagnostics(a: SupportDevice, b: SupportDevice): DiagnosticComparison {
  const field = (name: string, x: string | undefined, y: string | undefined) => ({
    field: name,
    a: x ?? '—',
    b: y ?? '—',
    same: (x ?? '') === (y ?? ''),
  });
  const identity = [
    field('VID', a.vendorId, b.vendorId),
    field('PID', a.productId, b.productId),
    field('product', a.productName, b.productName),
    field('manufacturer', a.manufacturer, b.manufacturer),
    field('release', a.release, b.release),
    field('transport', a.transport, b.transport),
    field('interfaces', String(a.interfaces.length), String(b.interfaces.length)),
  ];
  const sa = a.interfaces.flatMap((i) => i.collections.map(sig));
  const sb = b.interfaces.flatMap((i) => i.collections.map(sig));
  const all = [...new Set([...sa, ...sb])].sort();
  const collections: CollectionDiff[] = all.map((s) => ({
    signature: s,
    side: sa.includes(s) && sb.includes(s) ? 'both' : sa.includes(s) ? 'a' : 'b',
  }));
  return { identity, collections, sameDescriptors: collections.every((c) => c.side === 'both') };
}
