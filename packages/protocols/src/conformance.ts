import { fromHex } from '@openkey/core';
import type { HidDeviceGroup } from '@openkey/hid';
import { ADAPTER_API_VERSION } from './registry.js';
import type { PlannedAdapter, ProbeLevel, ProtocolDefinition } from './registry.js';

/**
 * Adapter conformance kit. Every adapter in the default registry passes these checks in CI
 * (`tests/conformance/`), and adapter authors run the same functions against their own work. They
 * use no test framework: each returns a list of violations, empty when the adapter conforms.
 */
export interface ConformanceIssue {
  adapter: string;
  rule: string;
  detail: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_BYTES = /^([0-9A-F]{2}( [0-9A-F]{2})*)?$/;

function isProtocol(def: ProtocolDefinition | PlannedAdapter): def is ProtocolDefinition {
  return 'probe' in def;
}

/** Static checks of the manifest and probe plan. */
export function checkManifest(def: ProtocolDefinition | PlannedAdapter): ConformanceIssue[] {
  const out: ConformanceIssue[] = [];
  const bad = (rule: string, detail: string): void =>
    void out.push({ adapter: def.id, rule, detail });
  const m = def.manifest;
  if (!KEBAB.test(def.id)) bad('id', 'id must be kebab-case');
  if (!SEMVER.test(m.version)) bad('version', `"${m.version}" is not x.y.z`);
  if (!m.license.trim()) bad('license', 'the adapter must declare the licence of its own code');
  if (m.provenance.length === 0) bad('provenance', 'every adapter cites at least one source');
  if (m.transports.input.length === 0)
    bad('transports', 'declare the links the keyboard types over');
  if (m.status !== 'verified' && m.limitations.length === 0)
    bad('limitations', 'an adapter that is not fully verified must list its limitations');
  if (m.status === 'verified' && m.verifiedIdentities.length === 0)
    bad('verified', 'status "verified" needs at least one hardware-verified identity');
  for (const v of m.verifiedIdentities)
    if (!v.evidence.trim()) bad('verifiedIdentities', 'each verified identity cites its evidence');

  if (!isProtocol(def)) {
    if (m.transports.configuration.length)
      bad('planned', 'a planned adapter configures nothing on any link');
    return out;
  }
  if (def.apiVersion !== ADAPTER_API_VERSION)
    bad('apiVersion', `implements v${def.apiVersion}, expected v${ADAPTER_API_VERSION}`);
  for (const [i, op] of def.probePlan.operations.entries()) {
    const at = `probePlan.operations[${i}]`;
    if (!op.purpose.trim()) bad('probe-plan', `${at} has no purpose`);
    if (!HEX_BYTES.test(op.payloadPrefix))
      bad('probe-plan', `${at}.payloadPrefix must be upper-case hex bytes`);
    const sends = op.op === 'feature-set' || op.op === 'output';
    if (sends && op.level === 'passive')
      bad('probe-plan', `${at}: a passive probe never sends anything`);
    if (sends && !op.payloadPrefix)
      bad('probe-plan', `${at}: a sent report must declare its identifying bytes`);
    if (sends && (op.evidence === 'HYPOTHESIS' || op.evidence === 'UNKNOWN'))
      bad('probe-plan', `${at}: probes never send operations without evidence`);
  }
  return out;
}

/**
 * `match()` must be a pure function of the descriptors: no transport is opened and two calls give
 * the same answer.
 */
export function checkMatchPurity(
  def: ProtocolDefinition,
  group: HidDeviceGroup,
): ConformanceIssue[] {
  let opened = 0;
  const guarded: HidDeviceGroup = {
    ...group,
    openInterface: () => {
      opened++;
      return Promise.reject(new Error('match() must not open interfaces'));
    },
  };
  const a = JSON.stringify(def.match(guarded));
  const b = JSON.stringify(def.match(guarded));
  const out: ConformanceIssue[] = [];
  if (opened)
    out.push({ adapter: def.id, rule: 'match-pure', detail: 'match() opened an interface' });
  if (a !== b)
    out.push({ adapter: def.id, rule: 'match-pure', detail: 'match() is not deterministic' });
  return out;
}

export interface TrafficRecord {
  op: 'output' | 'feature-set' | 'feature-get';
  reportId: number;
  data: Uint8Array;
}

const LEVEL_RANK: Record<ProbeLevel, number> = { descriptor: 0, passive: 1, handshake: 2 };

/**
 * Every report a probe exchanged at `level` must be one its probe plan declares, at or below that
 * level, with the declared report ID and identifying bytes. Anything else is an undeclared packet.
 */
export function checkProbeTraffic(
  def: ProtocolDefinition,
  traffic: readonly TrafficRecord[],
  level: ProbeLevel,
): ConformanceIssue[] {
  const out: ConformanceIssue[] = [];
  const allowed = def.probePlan.operations.filter((o) => LEVEL_RANK[o.level] <= LEVEL_RANK[level]);
  for (const [i, t] of traffic.entries()) {
    const declared = allowed.some((o) => {
      if (o.op !== t.op || o.reportId !== t.reportId) return false;
      const prefix = fromHex(o.payloadPrefix);
      return prefix.every((b, k) => t.data[k] === b);
    });
    if (!declared)
      out.push({
        adapter: def.id,
        rule: 'probe-traffic',
        detail: `#${i} ${t.op} id ${t.reportId} [${[...t.data.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')} …] is not declared for level ${level}`,
      });
  }
  return out;
}
