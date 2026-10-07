import { Evidence, PacketLog, evidenceRank } from '@openkey/core';
import type { EvidenceSource, KeyboardDriver, StateStore, TransportMode } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import { lookupCatalog, lookupCatalogAll } from '@openkey/devices';
import type { CatalogEntry } from '@openkey/devices';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';

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
  confidence: Evidence;
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
  /** Allows writes whose evidence is below OBSERVED. Off by default. */
  allowExperimental?: boolean;
}

/**
 * Maturity of an adapter, as shown in the compatibility center.
 * - verified: reads and writes verified on hardware.
 * - experimental: implemented from primary evidence; some operations not yet verified on hardware.
 * - community: implemented from community documentation only.
 * - research: identification only; no configuration.
 * - planned: descriptor signature only; never sends anything.
 */
export type AdapterStatus = 'verified' | 'experimental' | 'community' | 'research' | 'planned';

export interface AdapterManifest {
  /** Adapter version, bumped when its wire behaviour changes. */
  version: string;
  status: AdapterStatus;
  /**
   * Links the keyboard *types* over versus links that carry configuration. Never inferred from each
   * other: many keyboards type over Bluetooth but cannot be configured over it.
   */
  transports: { input: TransportMode[]; configuration: TransportMode[] };
  /** What has been verified, in one sentence. */
  verification: string;
  /** Safety policy summary shown in Diagnostics. */
  safety: string;
  provenance: { source: EvidenceSource; reference: string; status: Evidence }[];
}

export interface ProtocolDefinition {
  id: string;
  manifest: AdapterManifest;
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

/**
 * An adapter that exists only as research: a descriptor signature used to name *possible* protocol
 * families for unknown devices. It has no probe and no driver, so it can never send a packet.
 */
export interface PlannedAdapter {
  id: string;
  name: string;
  family: string;
  manifest: AdapterManifest;
  /** Descriptor-only signature; must not perform I/O. */
  signature(group: HidDeviceGroup): CandidateMatch;
  /** Why it is not implemented yet. */
  blockers: string[];
}

export interface PossibleFamily {
  id: string;
  name: string;
  family: string;
  status: AdapterStatus;
  score: number;
  reasons: string[];
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
  selected: { protocolId: string; confidence: Evidence; reasons: string[] } | null;
  /** True when several protocols passed equally and the user must decide. */
  ambiguous: boolean;
  notes: string[];
  /** Known-device catalogue entry for naming (never used to choose the protocol). */
  catalog?: CatalogEntry;
  /** Families whose descriptor signature matches, including planned ones. Informational only. */
  possibleFamilies: PossibleFamily[];
}

export class ProtocolRegistry {
  private readonly protocols: ProtocolDefinition[] = [];
  private readonly plannedAdapters: PlannedAdapter[] = [];

  /** Registers a research-only adapter (signature, no I/O). */
  plan(p: PlannedAdapter): this {
    if (this.plannedAdapters.some((x) => x.id === p.id) || this.get(p.id))
      throw new Error(`Adapter ${p.id} already registered`);
    this.plannedAdapters.push(p);
    return this;
  }

  planned(): readonly PlannedAdapter[] {
    return this.plannedAdapters;
  }

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
      possibleFamilies: [],
    };
    const known = lookupCatalog(group.identity);
    if (known) {
      report.catalog = known;
      if (known.status === 'research' || known.status === 'unsupported') {
        report.notes.push(`Recognised as ${known.brand} ${known.model} (${known.mcu}). OpenKey does not configure it yet: ${known.evidence}.`);
      }
    } else {
      const shared = lookupCatalogAll(group.identity);
      if (shared.length > 1)
        report.notes.push(
          `This USB identity is shared by different products (${shared.map((e) => `${e.brand} ${e.model}`).join('; ')}); it does not identify the model.`,
        );
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
      const confirmed = report.candidates.find((c) => c.probe?.status === 'pass' && c.probe.confidence === Evidence.VERIFIED);
      if (confirmed && level !== 'descriptor') {
        // Never send another family's packets to a device whose protocol is already confirmed.
        cand.probe = {
          status: 'skipped',
          confidence: Evidence.HYPOTHESIS,
          summary: `Not probed: ${confirmed.protocol.id} is already confirmed for this device.`,
          steps: [],
          facts: {},
        };
        continue;
      }
      if (level === 'descriptor') {
        cand.probe = {
          status: 'skipped',
          confidence: Evidence.INFERRED,
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
          confidence: Evidence.HYPOTHESIS,
          summary: e instanceof Error ? e.message : String(e),
          steps: [],
          facts: { errorCode: (e as { code?: string }).code },
        };
      } finally {
        for (const t of opened) await t.close().catch(() => undefined);
      }
    }
    selectCandidate(report);
    report.possibleFamilies = this.possibleFamilies(group, report);
    return report;
  }

  /** Descriptor-level family hints for diagnostics and unknown-device mode. Performs no I/O. */
  possibleFamilies(group: HidDeviceGroup, report?: DetectionReport): PossibleFamily[] {
    const out: PossibleFamily[] = [];
    for (const p of this.protocols) {
      const m = report?.candidates.find((c) => c.protocol.id === p.id)?.match ?? p.match(group);
      if (m.applicable)
        out.push({ id: p.id, name: p.name, family: p.family, status: p.manifest.status, score: m.score, reasons: m.reasons });
    }
    for (const p of this.plannedAdapters) {
      const m = p.signature(group);
      if (m.applicable)
        out.push({ id: p.id, name: p.name, family: p.family, status: p.manifest.status, score: m.score, reasons: m.reasons });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

/** Picks the winner; never silently chooses between equally strong candidates. */
export function selectCandidate(report: DetectionReport): void {
  const passed = report.candidates.filter(
    (c) =>
      c.match.applicable &&
      c.probe &&
      (c.probe.status === 'pass' ||
        (c.probe.status === 'skipped' && c.probe.confidence !== Evidence.HYPOTHESIS)),
  );
  if (passed.length === 0) return;
  const rank = (c: CandidateReport): number => {
    const conf = evidenceRank(c.probe!.confidence);
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
