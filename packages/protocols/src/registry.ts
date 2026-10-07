import { Confidence, PacketLog, confidenceRank } from '@openak820/core';
import type { KeyboardDriver, StateStore, TransportMode } from '@openak820/core';
import { LoggingTransport } from '@openak820/hid';
import { lookupCatalog } from '@openak820/profiles';
import type { CatalogEntry } from '@openak820/profiles';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openak820/hid';

/** How much I/O detection may perform. */
export type ProbeLevel =
  /** Descriptors only, nothing is sent to the keyboard. */
  | 'descriptor'
  /** Reads only (e.g. GET_FEATURE without a preceding command). */
  | 'passive'
  /** Official, documented handshake/info commands with no configuration effect. */
  | 'handshake';

export interface CandidateMatch {
  applicable: boolean;
  /** 0–100 descriptor-level score; probes decide among applicable candidates. */
  score: number;
  reasons: string[];
  /** Why the candidate was rejected (when not applicable). */
  rejections: string[];
}

export interface ProbeStep {
  name: string;
  status: 'pass' | 'fail' | 'skipped' | 'info';
  detail: string;
  /** Hex of the bytes involved, for fixtures and the research log. */
  raw?: string;
}

export interface ProbeResult {
  status: 'pass' | 'fail' | 'skipped' | 'error';
  confidence: Confidence;
  summary: string;
  steps: ProbeStep[];
  /** Protocol-specific facts learned (device-info fields, variant id …). */
  facts: Record<string, unknown>;
}

export interface ProbeContext {
  group: HidDeviceGroup;
  level: ProbeLevel;
  log: PacketLog;
  /** Opens an interface wrapped in a LoggingTransport; closed automatically after the probe. */
  open(iface: HidInterfaceInfo): Promise<HidTransport>;
}

export interface DriverOptions {
  log: PacketLog;
  store: StateStore;
  probe?: ProbeResult;
  /** Override the delay between commands (tests use 0). */
  cmdDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Allows writes whose evidence is below STRONGLY_SUPPORTED. Off by default. */
  allowExperimental?: boolean;
}

export interface ProtocolDefinition {
  id: string;
  name: string;
  family: string;
  /** Higher runs first and wins ties of equal confidence and score. */
  priority: number;
  supportedDevices: string;
  supportedFirmware: string;
  requiredUsagePages: number[];
  requiredReports: string[];
  /** Evidence sources, shown in Diagnostics and docs. */
  evidence: string[];
  match(group: HidDeviceGroup): CandidateMatch;
  probe(ctx: ProbeContext): Promise<ProbeResult>;
  createDriver(group: HidDeviceGroup, opts: DriverOptions): Promise<KeyboardDriver>;
}

export interface CandidateReport {
  protocol: { id: string; name: string; family: string };
  match: CandidateMatch;
  probe?: ProbeResult;
}

export interface DetectionReport {
  device: {
    key: string;
    vendorId: number;
    productId: number;
    productName: string;
    manufacturer?: string;
    release?: number;
    backend: string;
    transportHint: TransportMode;
  };
  interfaces: { interfaceNumber?: number; path?: string; collections: HidCollection[] }[];
  level: ProbeLevel;
  candidates: CandidateReport[];
  selected: { protocolId: string; confidence: Confidence; reasons: string[] } | null;
  /** True when several protocols passed equally and the user must decide. */
  ambiguous: boolean;
  notes: string[];
  /** Known-device catalogue entry for naming (never used to choose the protocol). */
  catalog?: CatalogEntry;
}

export class ProtocolRegistry {
  private readonly protocols: ProtocolDefinition[] = [];

  register(p: ProtocolDefinition): this {
    if (this.protocols.some((x) => x.id === p.id))
      throw new Error(`Protocol ${p.id} already registered`);
    this.protocols.push(p);
    this.protocols.sort((a, b) => b.priority - a.priority);
    return this;
  }

  list(): readonly ProtocolDefinition[] {
    return this.protocols;
  }

  get(id: string): ProtocolDefinition | undefined {
    return this.protocols.find((p) => p.id === id);
  }

  async detect(
    group: HidDeviceGroup,
    opts: { level?: ProbeLevel; log?: PacketLog } = {},
  ): Promise<DetectionReport> {
    const level = opts.level ?? 'descriptor';
    const log = opts.log ?? new PacketLog();
    const report: DetectionReport = {
      device: {
        key: group.key,
        vendorId: group.identity.vendorId,
        productId: group.identity.productId,
        productName: group.identity.productName,
        ...(group.identity.manufacturer ? { manufacturer: group.identity.manufacturer } : {}),
        ...(group.identity.release !== undefined ? { release: group.identity.release } : {}),
        backend: group.backend,
        transportHint: group.transportHint,
      },
      interfaces: group.interfaces.map((i) => ({
        ...(i.interfaceNumber !== undefined ? { interfaceNumber: i.interfaceNumber } : {}),
        ...(i.path ? { path: i.path } : {}),
        collections: i.collections,
      })),
      level,
      candidates: [],
      selected: null,
      ambiguous: false,
      notes: [],
    };
    const known = lookupCatalog(group.identity);
    if (known) {
      report.catalog = known;
      if (known.status === 'identified' || known.status === 'unsupported') {
        report.notes.push(`Recognised as ${known.model} (${known.mcu}). OpenAK820 does not configure this revision yet: ${known.evidence}.`);
      }
    }
    if (group.transportHint === 'bluetooth') {
      report.notes.push(
        'Bluetooth link: the official driver states keyboard settings are not supported over Bluetooth.',
      );
    }

    for (const p of this.protocols) {
      const match = p.match(group);
      const cand: CandidateReport = {
        protocol: { id: p.id, name: p.name, family: p.family },
        match,
      };
      report.candidates.push(cand);
      if (!match.applicable) continue;
      const confirmed = report.candidates.find((c) => c.probe?.status === 'pass' && c.probe.confidence === Confidence.CONFIRMED);
      if (confirmed && level !== 'descriptor') {
        // Never send another family's packets to a device whose protocol is already confirmed.
        cand.probe = {
          status: 'skipped',
          confidence: Confidence.UNVERIFIED,
          summary: `Not probed: ${confirmed.protocol.id} is already confirmed for this device.`,
          steps: [],
          facts: {},
        };
        continue;
      }
      if (level === 'descriptor') {
        cand.probe = {
          status: 'skipped',
          confidence: Confidence.INFERRED,
          summary: 'Descriptor signature only (no I/O performed).',
          steps: [],
          facts: {},
        };
        continue;
      }
      const opened: HidTransport[] = [];
      const ctx: ProbeContext = {
        group,
        level,
        log,
        async open(iface) {
          const t = new LoggingTransport(await group.openInterface(iface), log);
          opened.push(t);
          return t;
        },
      };
      try {
        cand.probe = await p.probe(ctx);
      } catch (e) {
        cand.probe = {
          status: 'error',
          confidence: Confidence.UNVERIFIED,
          summary: e instanceof Error ? e.message : String(e),
          steps: [],
          facts: { errorCode: (e as { code?: string }).code },
        };
      } finally {
        for (const t of opened) await t.close().catch(() => undefined);
      }
    }
    selectCandidate(report);
    return report;
  }
}

/** Picks the winner; never silently chooses between equally strong candidates. */
export function selectCandidate(report: DetectionReport): void {
  const passed = report.candidates.filter(
    (c) =>
      c.match.applicable &&
      c.probe &&
      (c.probe.status === 'pass' ||
        (c.probe.status === 'skipped' && c.probe.confidence !== Confidence.UNVERIFIED)),
  );
  if (passed.length === 0) return;
  const rank = (c: CandidateReport): number => {
    const conf = confidenceRank(c.probe!.confidence);
    const passBonus = c.probe!.status === 'pass' ? 1 : 0;
    return conf * 1000 + passBonus * 500 + c.match.score;
  };
  passed.sort((a, b) => rank(b) - rank(a));
  const best = passed[0]!;
  const runnerUp = passed[1];
  if (runnerUp && rank(runnerUp) === rank(best)) {
    report.ambiguous = true;
    report.notes.push(
      `Ambiguous: ${best.protocol.id} and ${runnerUp.protocol.id} matched equally. Choose a protocol explicitly or run a handshake-level probe.`,
    );
    return;
  }
  report.selected = {
    protocolId: best.protocol.id,
    confidence: best.probe!.confidence,
    reasons: [...best.match.reasons, best.probe!.summary],
  };
}

/** Helpers shared by protocol matchers. */
export function hasCollection(
  group: HidDeviceGroup,
  pred: (c: HidCollection) => boolean,
): HidInterfaceInfo | undefined {
  return group.interfaces.find((i) => i.collections.some(pred));
}

export function reportSize(list: { reportId: number; size: number }[], reportId = 0): number {
  return list.find((r) => r.reportId === reportId)?.size ?? 0;
}
