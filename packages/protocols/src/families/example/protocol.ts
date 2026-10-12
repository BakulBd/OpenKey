/**
 * EXAMPLE ADAPTER — a template, not a keyboard.
 *
 * It implements a fictional "echo" protocol so that contributors can see the whole adapter contract
 * in one small file: descriptor match → declared probe plan → identification → driver → capabilities
 * with read-back. It is never registered in `createDefaultRegistry()`, matches only the reserved
 * test identity below, and is exercised by `tests/conformance/example-adapter.test.ts` against
 * `ExampleSimulator`. Copy this folder to start a new family; docs/ADAPTER_GUIDE.md walks through it.
 *
 * Wire format (fictional): 32-byte output reports, report ID 0, answered by one 32-byte input report.
 *   HELLO   [01]                    → [01 'O' 'K' version]
 *   GET_KEY [10 slot]               → [10 slot usage mods]
 *   SET_KEY [11 slot usage mods]    → [11 slot 00]          (00 = accepted)
 */
import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  SafetyLevel,
  TimeoutError,
  configurable,
  emptyCapabilities,
  feature,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  KeyAction,
  KeyboardLayout,
  KeymapState,
  TransportMode,
} from '@openkey/core';
import { LoggingTransport, findInterface } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidTransport } from '@openkey/hid';
import { ADAPTER_API_VERSION } from '../../registry.js';
import type {
  CandidateMatch,
  DriverOptions,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';

// 1. Every magic number is a named constant. In a real adapter, each cites its evidence.
export const EXAMPLE_VENDOR_ID = 0xffff; // reserved test identity; no real product uses it
export const EXAMPLE_PRODUCT_ID = 0x0e0e;
const USAGE_PAGE = 0xffee;
const USAGE = 0x01;
const REPORT_BYTES = 32;
const REPLY_TIMEOUT_MS = 200;
export const ExampleCmd = { HELLO: 0x01, GET_KEY: 0x10, SET_KEY: 0x11 } as const;
export const EXAMPLE_SLOTS = 4;

const isCommandPipe = (c: HidCollection) =>
  c.usagePage === USAGE_PAGE &&
  c.usage === USAGE &&
  c.outputReports.some((r) => r.reportId === 0 && r.size === REPORT_BYTES) &&
  c.inputReports.some((r) => r.reportId === 0 && r.size === REPORT_BYTES);

/** 2. One request/response exchange. Serialised by the caller; bounded by a timeout. */
async function exchange(t: HidTransport, bytes: number[]): Promise<Uint8Array> {
  const req = new Uint8Array(REPORT_BYTES);
  req.set(bytes);
  t.drainInput();
  await t.sendOutputReport(0, req);
  const r = await t.readInputReport(REPLY_TIMEOUT_MS);
  if (!r) throw new TimeoutError(`example: no answer to command ${bytes[0]}`);
  if (r.length !== REPORT_BYTES || r[0] !== bytes[0])
    throw new ProtocolError('example: answer does not echo the command');
  return r;
}

const LAYOUT: KeyboardLayout = {
  id: 'example-4key',
  name: 'Example 4-key pad',
  width: 4,
  height: 1,
  source: 'example adapter (fictional)',
  keys: ['A', 'B', 'C', 'D'].map((label, slot) => ({
    id: label.toLowerCase(),
    label,
    slot,
    light: null,
    usage: 0x04 + slot,
    x: slot,
    y: 0,
    w: 1,
    h: 1,
  })),
};

class ExampleDriver extends BaseKeyboardDriver {
  readonly protocolId = 'example-echo';
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  // 3. One command at a time: a promise chain is enough for a request/response protocol.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly opts: DriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
  }

  private run<T>(fn: (t: HidTransport) => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (!this.t) throw new ProtocolError('example: not connected');
      return fn(this.t);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async connect(): Promise<void> {
    const iface = findInterface(this.group, isCommandPipe)!;
    this.t = new LoggingTransport(await this.group.openInterface(iface), this.opts.log);
  }
  async disconnect(): Promise<void> {
    await this.t?.close();
    this.t = null;
  }
  getLayout(): KeyboardLayout {
    return LAYOUT;
  }

  // 4. Capabilities state what is readable, writable and how sure we are. Read-back from the
  //    device ('device') lets transactions report VERIFIED; evidence stays INFERRED because this
  //    protocol was never tested on hardware, so the UI keeps writes behind the experimental opt-in.
  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.INFERRED,
    });
    c.keymap = configurable('device', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      note: 'Example protocol: read-back after every write.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const version = (this.opts.probe?.facts.version as number | undefined) ?? null;
    return {
      model: 'Example 4-key pad (fictional)',
      profileId: 'example-4key',
      identity: this.group.identity,
      firmware: {
        version: version === null ? null : String(version),
        source: 'HELLO reply',
        confidence: Evidence.INFERRED,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'Example echo protocol' },
      battery: null,
      fields: [],
    };
  }

  override async getKeymap(): Promise<KeymapState> {
    return this.run(async (t) => {
      const slots: Record<number, KeyAction> = {};
      for (let s = 0; s < EXAMPLE_SLOTS; s++) {
        const r = await exchange(t, [ExampleCmd.GET_KEY, s]);
        slots[s] =
          r[2] === 0 ? { kind: 'default' } : { kind: 'keyboard', usage: r[2]!, modifiers: r[3]! };
      }
      return { layer: 'base', slots, provenance: 'device' };
    });
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    // 5. Validate before sending anything; refuse what the wire format cannot express.
    for (const [slot, a] of Object.entries(state.slots)) {
      const s = Number(slot);
      if (s < 0 || s >= EXAMPLE_SLOTS)
        throw new ProtocolError(`example: slot ${slot} does not exist`);
      if (a.kind !== 'keyboard' && a.kind !== 'default')
        throw new ProtocolError(`example: ${a.kind} actions are not supported`);
    }
    await this.run(async (t) => {
      for (const [slot, a] of Object.entries(state.slots)) {
        const [usage, mods] = a.kind === 'keyboard' ? [a.usage, a.modifiers] : [0, 0];
        const r = await exchange(t, [ExampleCmd.SET_KEY, Number(slot), usage, mods]);
        if (r[2] !== 0) throw new ProtocolError(`example: slot ${slot} rejected (status ${r[2]})`);
      }
    });
  }
}

/** The definition registered with a `ProtocolRegistry`. */
export const exampleProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: 'example-echo',
  name: 'Example echo protocol (template, fictional)',
  family: 'example-echo',
  priority: 0,
  supportedDevices: 'none: template only',
  supportedFirmware: 'n/a',
  requiredUsagePages: [USAGE_PAGE],
  requiredReports: ['FFEE:0001 output/input id0 32B'],
  evidence: ['fictional; see the file header'],
  manifest: {
    version: '0.1.0',
    status: 'planned',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification: 'Template: tested against ExampleSimulator only.',
    safety: 'Probe is one read-only HELLO; writes are validated and read back.',
    provenance: [
      {
        source: 'public-specification',
        reference: 'packages/protocols/src/families/example/protocol.ts header',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Fictional protocol for documentation and tests; it configures no real keyboard.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },

  // 6. match(): descriptors only, pure. Report every reason and every rejection.
  match(group): CandidateMatch {
    const pipe = findInterface(group, isCommandPipe);
    const id =
      group.identity.vendorId === EXAMPLE_VENDOR_ID &&
      group.identity.productId === EXAMPLE_PRODUCT_ID;
    return pipe && id
      ? {
          applicable: true,
          score: 50,
          reasons: ['FFEE:0001 32-byte command pipe', 'reserved example identity'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: [pipe ? 'not the example identity' : 'no FFEE:0001 32-byte command pipe'],
        };
  },

  // 7. Declare every probe operation, and when it may run without asking.
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FFEE:0001',
        reportId: 0,
        payloadPrefix: '01',
        purpose: 'HELLO: read-only identification.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FFEE:0001',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'Answer 01 "OK" version.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
    ],
    autoConsent: (g) =>
      g.identity.vendorId === EXAMPLE_VENDOR_ID && g.identity.productId === EXAMPLE_PRODUCT_ID
        ? { auto: true, reason: 'reserved example identity' }
        : { auto: false, reason: 'not the example identity' },
  },

  // 8. probe(): only the declared operations; `identified` only on a family-specific answer.
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'No passive read in this protocol.',
        steps: [],
        facts: {},
      };
    const t = await ctx.open(findInterface(ctx.group, isCommandPipe)!);
    const r = await exchange(t, [ExampleCmd.HELLO]).catch(() => null);
    const ok = !!r && r[1] === 0x4f && r[2] === 0x4b;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `HELLO answered (version ${r![3]})` : 'No HELLO answer',
      steps: [{ name: 'HELLO', status: ok ? 'pass' : 'fail', detail: ok ? 'OK' : 'no answer' }],
      facts: ok ? { version: r![3] } : {},
      identified: ok,
    };
  },

  async createDriver(group, opts) {
    return new ExampleDriver(group, opts);
  },
};
