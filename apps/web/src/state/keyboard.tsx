import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  Evidence,
  INITIAL_CONNECTION,
  OperationLock,
  PacketLog,
  SafetyLevel,
  SessionEpoch,
  canApply,
  explainError,
  explainForLink,
  guardWrites,
  isOpenKeyError,
  mayWrite,
  runTransaction,
  transition,
  writeDecision,
} from '@openkey/core';
import type {
  Capabilities,
  ConnectionEvent,
  ConnectionState,
  DeviceInfo,
  ErrorExplanation,
  FeatureId,
  KeyboardDriver,
  Operation,
  Transaction,
  TxResult,
  WriteDecision,
} from '@openkey/core';
import { CATALOG } from '@openkey/devices/catalog';
import { WebHidBackend, webHidSupport } from '@openkey/hid';
import type { HidDeviceGroup, WebHidSupport } from '@openkey/hid';
import type {
  zmk,
  AdapterManifest,
  DetectionReport,
  DetectionVerdict,
  DeviceFingerprint,
} from '@openkey/protocols';
import { IdbStateStore } from './db.js';
import { summarize } from './status.js';
import { currentOs } from '../lib/platform.js';
import { isAccessFailure, openDenied } from '../lib/access.js';
import { openSerialChannel, webSerial } from '../lib/serial.js';
import type { OsName } from '../lib/platform.js';
import type { StatusSummary } from './status.js';
import { SafetyDialog } from '../components/SafetyDialog.js';

/**
 * Chooser filters for "Connect keyboard": vendor IDs from the catalogue plus the VIA/Vial raw-HID
 * page. They only decide what the browser lists; identification happens afterwards from
 * descriptors and read-only probes. "Inspect any HID device" uses no filter at all.
 */
const CONNECT_FILTERS: HIDDeviceFilter[] = [
  ...[...new Set(CATALOG.map((e) => e.vendorId))].map((vendorId) => ({ vendorId })),
  { usagePage: 0xff60, usage: 0x61 },
];

interface SessionBase {
  /**
   * Session epoch. Changes on every connect, disconnect and unplug; device-specific views are keyed
   * by it, and answers that arrive for an older epoch are discarded.
   */
  id: number;
  detection: DetectionReport;
  fingerprint: DeviceFingerprint;
  verdict: DetectionVerdict;
  group: HidDeviceGroup;
  log: PacketLog;
}

export interface DeviceSession extends SessionBase {
  kind: 'device';
  driver: KeyboardDriver;
  manifest: AdapterManifest;
  info: DeviceInfo;
  caps: Capabilities;
  demo: boolean;
  /** Chip of the model revision the keyboard answered as, when the model guide names exactly one. */
  chip?: string;
}

export interface UnknownSession extends SessionBase {
  kind: 'unknown';
  /** Reports OpenKey sent to the device in this session (identification handshakes only). */
  sentReports: number;
  /** Why no driver was opened, when an adapter refused. */
  reason?: ErrorExplanation;
}

/** Reports sent to the device; reads and descriptor access are not counted. */
function countSent(log: PacketLog): number {
  return log
    .all()
    .filter(
      (p) => p.direction === 'host->device' && (p.kind === 'output' || p.kind === 'feature-set'),
    ).length;
}

export type Session = DeviceSession | UnknownSession;

export interface Notice {
  id: number;
  kind: 'ok' | 'error' | 'info' | 'warn';
  /** What happened. */
  title: string;
  /** What it means (likely reason). */
  reason?: string;
  /** The safest next action. */
  hint?: string;
  /** Technical detail, shown collapsed. */
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface RecentError {
  at: string;
  kind: string;
  title: string;
}

export interface WriteGate {
  decision: WriteDecision;
  /** True when a write may be sent now (after the confirmation step). */
  allowed: boolean;
}

/**
 * The browser listed a device but could not open it. On Linux this almost always means the udev
 * rule is missing; elsewhere another program usually holds the device.
 */
export interface AccessProblem {
  os: OsName;
  kind: 'permission' | 'busy';
  device: { key: string; name: string; vendorId: number; productId: number };
  detail: string;
}

/** Simulated keyboards for the demo: one per protocol family OpenKey configures. */
export type DemoKind = 'ak820' | 'aula-f75' | 'rk-r75' | 'via' | 'vial' | 'zmk' | 'hmk';
export const DEMO_KINDS: readonly DemoKind[] = [
  'ak820',
  'via',
  'vial',
  'zmk',
  'hmk',
  'aula-f75',
  'rk-r75',
];

/** A device the site already has permission for and that is plugged in now. */
export interface AuthorizedDevice {
  key: string;
  vendorId: number;
  productId: number;
  productName: string;
  interfaces: number;
}

interface PendingConfirm {
  feature: FeatureId;
  label: string;
  decision: WriteDecision;
  safety: SafetyLevel;
  resolve(ok: boolean): void;
}

interface Ctx {
  support: WebHidSupport;
  conn: ConnectionState;
  session: Session | null;
  /** The configurable device session, or null in unknown-device mode. */
  device: DeviceSession | null;
  /** One derived description of the session for every surface (status bar, chip, overview). */
  status: StatusSummary;
  /** The device-changing operation in progress (confirming, writing, verifying), if any. */
  operation: Operation | null;
  /** Devices this site is already allowed to open that are plugged in now. */
  authorized: AuthorizedDevice[];
  /** The last device that was listed but could not be opened, with the OS-specific fix. */
  accessProblem: AccessProblem | null;
  /** After fixing access (udev rule, closing other apps, replugging): try that device again. */
  retryAccess(): Promise<void>;
  notices: Notice[];
  recentErrors: RecentError[];
  experimental: boolean;
  setExperimental(v: boolean): void;
  connect(): Promise<void>;
  inspect(): Promise<void>;
  /** ZMK Studio keyboards: pick the USB serial port and connect. */
  connectZmk(): Promise<void>;
  /** Web Serial is available (ZMK Studio). */
  serialAvailable: boolean;
  /** Opens an already-authorised device without the browser chooser. */
  openAuthorized(key: string): Promise<void>;
  /** Opens a firmware simulator: the AK820 MAX (default), an AULA F75 or an RK R75. */
  connectDemo(kind?: DemoKind): Promise<void>;
  /** Unknown-device mode: run one adapter's identification handshake after the user allowed it. */
  identify(adapterId: string): Promise<void>;
  /** Re-identifies the connected keyboard with the consent it already has, refreshing capabilities. */
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Runs a read with error reporting. Answers for a previous session are discarded (undefined). */
  read<T>(
    label: string,
    fn: (d: KeyboardDriver) => Promise<T>,
    opts?: { quiet?: boolean },
  ): Promise<T | undefined>;
  /** Write gate for a feature: what the safety policy allows right now. */
  gate(feature: FeatureId): WriteGate;
  /**
   * Runs a write through the safety policy and the transaction model, one at a time. Returns the
   * transaction result, or undefined when the user declined, the policy blocked it, another
   * operation was running, or the device went away.
   */
  apply<T>(
    feature: FeatureId,
    tx: Transaction<T>,
    previous: T | undefined,
    next: T,
  ): Promise<TxResult<T> | undefined>;
  /** Safety gate only (policy + confirmation); for multi-section writes such as a restore. */
  confirmWrite(feature: FeatureId, label: string): Promise<boolean>;
  /** Runs a confirmed multi-step write while the connection is in the APPLYING state. */
  writing<T>(label: string, fn: (d: KeyboardDriver) => Promise<T>): Promise<T | undefined>;
  /**
   * Increments after every write that reached the device. Editors without local edits re-read when
   * it changes, because one write can change another editor's state (per-key colours switch the
   * lighting effect).
   */
  revision: number;
  /** Editors report local, unapplied changes; navigation and unload warn while any exist. */
  setUnsaved(owner: string, count: number): void;
  unsavedCount: number;
  notify(n: Omit<Notice, 'id'>): void;
  dismiss(id: number): void;
  store: IdbStateStore;
}

const KeyboardContext = createContext<Ctx | null>(null);

export function useKeyboard(): Ctx {
  const c = useContext(KeyboardContext);
  if (!c) throw new Error('useKeyboard outside provider');
  return c;
}

let noticeId = 0;

function reducer(s: ConnectionState, e: ConnectionEvent): ConnectionState {
  return transition(s, e, (state, ev) => {
    if (import.meta.env.DEV) console.debug(`[connection] ignored ${ev.type} in ${state.status}`);
  });
}

export function KeyboardProvider({
  children,
  messages,
}: {
  children: ReactNode;
  messages: ProviderMessages;
}) {
  const support = useMemo(() => webHidSupport(), []);
  const store = useMemo(() => new IdbStateStore(), []);
  const [conn, dispatch] = useReducer(reducer, INITIAL_CONNECTION);
  const [session, setSession] = useState<Session | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [authorized, setAuthorized] = useState<AuthorizedDevice[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [unsaved, setUnsavedMap] = useState<Record<string, number>>({});
  const [revision, setRevision] = useState(0);
  const [accessProblem, setAccessProblem] = useState<AccessProblem | null>(null);
  // Experimental writes are a per-session opt-in on purpose: it is never remembered.
  const [experimental, setExperimental] = useState(false);
  const experimentalRef = useRef(experimental);
  experimentalRef.current = experimental;
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;
  const confirmed = useRef(new Set<FeatureId>());
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const connRef = useRef(conn);
  connRef.current = conn;
  const epoch = useRef(new SessionEpoch());
  const lock = useMemo(() => new OperationLock(setOperation), []);

  const notify = useCallback((n: Omit<Notice, 'id'>) => {
    const id = ++noticeId;
    setNotices((xs) => [...xs.slice(-3), { ...n, id }]);
    if (n.kind === 'ok' || n.kind === 'info')
      setTimeout(() => setNotices((xs) => xs.filter((x) => x.id !== id)), 6000);
  }, []);

  const explainNotice = useCallback(
    (label: string, x: ErrorExplanation): Omit<Notice, 'id'> => ({
      kind: 'error',
      title: `${label}: ${messages.errorTitle(x)}`,
      reason: messages.errorReason(x),
      hint: messages.errorHint(x),
      detail: x.detail,
    }),
    [messages],
  );

  const reportError = useCallback(
    (label: string, e: unknown): ErrorExplanation => {
      // On a receiver or Bluetooth link, timeouts and transport errors mean something else.
      const cur = sessionRef.current;
      const link = cur
        ? cur.kind === 'device'
          ? cur.info.transport
          : cur.group.transportHint
        : 'usb';
      const x = explainForLink(explainError(e), link);
      setRecentErrors((xs) => [
        ...xs.slice(-19),
        { at: new Date().toISOString(), kind: x.kind, title: x.title },
      ]);
      notify(explainNotice(label, x));
      return x;
    },
    [explainNotice, notify],
  );

  /** Ends the current session everywhere: stale answers are dropped, the lock and any open confirmation released. */
  const endSession = useCallback(() => {
    epoch.current.next();
    lock.abandon();
    pendingRef.current?.resolve(false);
    setPending(null);
    setSession(null);
    confirmed.current.clear();
    setUnsavedMap({});
  }, [lock]);

  const refreshAuthorized = useCallback(async () => {
    if (!support.available) return;
    try {
      const groups = await new WebHidBackend().granted();
      setAuthorized(
        groups.map((g) => ({ key: g.key, ...g.identity, interfaces: g.interfaces.length })),
      );
    } catch {
      setAuthorized([]);
    }
  }, [support.available]);
  useEffect(() => void refreshAuthorized(), [refreshAuthorized]);

  const noteAccess = useCallback((group: HidDeviceGroup, detail: string) => {
    const os = currentOs();
    const { productName: name, vendorId, productId } = group.identity;
    setAccessProblem({
      os,
      kind: os === 'linux' ? 'permission' : 'busy',
      device: { key: group.key, name, vendorId, productId },
      detail,
    });
  }, []);

  const attach = useCallback(
    async (
      group: HidDeviceGroup,
      demo: boolean,
      {
        consent = [],
        log = new PacketLog(),
        reidentify = false,
      }: { consent?: string[]; log?: PacketLog; reidentify?: boolean } = {},
    ): Promise<boolean> => {
      const my = epoch.current.next();
      const stale = () => !epoch.current.isCurrent(my);
      // The protocol stack is loaded on the first connection, not with the landing page.
      const { buildFingerprint, createDefaultRegistry, detectionVerdict, openDriver } =
        await import('@openkey/protocols');
      const registry = createDefaultRegistry();
      if (!reidentify) {
        dispatch({ type: 'OPENED' });
        dispatch({ type: 'INSPECTED' });
      }
      let detection: DetectionReport | undefined;
      const unknown = (
        d: DetectionReport,
        verdict: DetectionVerdict,
        reason?: ErrorExplanation,
      ): boolean => {
        if (stale()) return false;
        // Unknown-device mode: no driver exists, so nothing can be written from here on.
        setAccessProblem(null);
        setSession({
          id: my,
          kind: 'unknown',
          detection: d,
          fingerprint: buildFingerprint(d),
          verdict,
          group,
          log,
          sentReports: countSent(log),
          ...(reason ? { reason } : {}),
        });
        dispatch({ type: 'DETECTED', mode: 'unknown' });
        return true;
      };
      try {
        detection = await registry.detect(group, { level: 'handshake', log, consent });
        // Disconnected (or another device picked) while identification ran: drop the result.
        if (stale()) return false;
        // Every matching adapter failed to *open* the device: that is a permission or busy problem,
        // not a protocol answer. End the attempt and show the fix instead of a misleading verdict.
        const probed = detection.candidates.filter(
          (c) => c.match.applicable && c.probe && c.probe.status !== 'skipped',
        );
        let denied =
          !demo &&
          probed.length &&
          probed.every(
            (c) =>
              c.probe!.status === 'error' &&
              isAccessFailure(c.probe!.facts.errorCode, c.probe!.summary),
          )
            ? probed[0]!.probe!.summary
            : null;
        // No probe opened the device (it waits for consent, or nothing matched): check that the OS
        // lets the browser open it at all, so a Linux permission problem is explained right away
        // instead of after the user allowed identification. Opening sends nothing to the keyboard.
        if (!demo && !denied && probed.length === 0) denied = await openDenied(group);
        if (stale()) return false;
        if (denied) {
          noteAccess(group, denied);
          dispatch({ type: 'FAIL', message: denied, recoverable: false });
          dispatch({ type: 'RESET' });
          return false;
        }
        const verdict = detectionVerdict(detection, registry);
        // Only a verdict whose family was identified by the device may open a driver.
        if (!verdict.writeEligible) return unknown(detection, verdict);
        const opened = await openDriver(group, detection, {
          registry,
          log,
          store,
          allowExperimental: experimental,
        });
        // Defence in depth: the UI gates writes too, but the driver itself refuses anything the
        // policy would not allow, with the opt-in read live from the current session state.
        const res = {
          ...opened,
          driver: guardWrites(opened.driver, () => ({
            simulated: demo,
            experimentalEnabled: experimentalRef.current,
          })),
        };
        if (stale()) {
          await res.driver.disconnect().catch(() => undefined);
          return false;
        }
        dispatch({ type: 'DETECTED', mode: demo ? 'demo' : 'supported' });
        const info = await res.driver.getDeviceInfo();
        if (stale()) {
          await res.driver.disconnect().catch(() => undefined);
          return false;
        }
        const protocolId = res.detection.selected?.protocolId ?? '';
        const def = registry.get(protocolId)!;
        // Same model name, different chips: name the revision the keyboard answered as.
        const { revisionsForId } = await import('@openkey/devices/guide');
        const chips = new Set(
          revisionsForId(group.identity.vendorId, group.identity.productId)
            .filter((x) => x.revision.adapter === protocolId)
            .map((x) => x.revision.chip),
        );
        const chip = chips.size === 1 ? [...chips][0] : undefined;
        setSession({
          id: my,
          kind: 'device',
          driver: res.driver,
          detection: res.detection,
          fingerprint: buildFingerprint(res.detection),
          verdict,
          manifest: def.manifest,
          info,
          caps: res.driver.getCapabilities(),
          log,
          group,
          demo,
          ...(chip ? { chip } : {}),
        });
        confirmed.current.clear();
        setAccessProblem(null);
        dispatch({ type: 'READ_DONE' });
        return true;
      } catch (e) {
        if (stale()) return false;
        if (!demo && isOpenKeyError(e) && isAccessFailure(e.code, e.message))
          noteAccess(group, e.message);
        if (
          detection &&
          isOpenKeyError(e) &&
          (e.code === 'UNSUPPORTED_DEVICE' || e.code === 'UNSUPPORTED_PROTOCOL')
        )
          return unknown(detection, detectionVerdict(detection, registry), explainError(e));
        reportError(messages.connectLabel, e);
        dispatch({ type: 'FAIL', message: explainError(e).title, recoverable: false });
        dispatch({ type: 'RESET' });
        return false;
      } finally {
        void refreshAuthorized();
      }
    },
    [experimental, messages, noteAccess, refreshAuthorized, reportError, store],
  );

  const identify = useCallback(
    async (adapterId: string) => {
      const s = sessionRef.current;
      if (s?.kind !== 'unknown' || lock.current) return;
      dispatch({ type: 'REIDENTIFY' });
      // Same log: the trace keeps the whole story, including what was sent with consent.
      await attach(s.group, false, { consent: [adapterId], log: s.log, reidentify: true });
    },
    [attach, lock],
  );

  const reconnect = useCallback(async () => {
    const s = sessionRef.current;
    if (s?.kind !== 'device' || lock.current) return;
    const protocolId = s.detection.selected?.protocolId;
    await s.driver.disconnect().catch(() => undefined);
    dispatch({ type: 'REIDENTIFY' });
    await attach(s.group, s.demo, {
      consent: protocolId ? [protocolId] : [],
      log: s.log,
      reidentify: true,
    });
  }, [attach, lock]);

  const request = useCallback(
    async (filters: HIDDeviceFilter[]) => {
      if (!support.available) return;
      dispatch({ type: 'REQUEST' });
      try {
        const groups = await new WebHidBackend().request(filters);
        if (groups.length === 0) {
          dispatch({ type: 'PERMISSION_DENIED', message: 'no device selected' });
          notify({
            kind: 'info',
            title: messages.noDeviceSelected,
            hint: currentOs() === 'linux' ? messages.notListedLinux : messages.noDeviceSelectedHint,
          });
          return;
        }
        dispatch({ type: 'PERMISSION_GRANTED' });
        for (const g of groups) if (await attach(g, false)) return;
      } catch (e) {
        dispatch({ type: 'PERMISSION_DENIED', message: explainError(e).title });
        reportError(messages.connectLabel, e);
      }
    },
    [attach, messages, notify, reportError, support.available],
  );

  const retryAccess = useCallback(async () => {
    const key = accessProblem?.device.key;
    await refreshAuthorized();
    // The same device, without the chooser when the browser still lists it; otherwise ask again.
    const granted = support.available ? await new WebHidBackend().granted().catch(() => []) : [];
    if (key && granted.some((g) => g.key === key)) await openAuthorizedRef.current?.(key);
    else await request(CONNECT_FILTERS);
  }, [accessProblem, refreshAuthorized, request, support.available]);

  const connect = useCallback(() => request(CONNECT_FILTERS), [request]);
  const inspect = useCallback(() => request([]), [request]);

  const openAuthorized = useCallback(
    async (key: string) => {
      if (!support.available || connRef.current.status !== 'DISCONNECTED') return;
      dispatch({ type: 'REQUEST' });
      try {
        const g = (await new WebHidBackend().granted()).find((x) => x.key === key);
        if (!g) {
          dispatch({ type: 'PERMISSION_DENIED', message: 'device no longer present' });
          notify({ kind: 'warn', title: messages.deviceGone, hint: messages.noDeviceSelectedHint });
          void refreshAuthorized();
          return;
        }
        dispatch({ type: 'PERMISSION_GRANTED' });
        await attach(g, false);
      } catch (e) {
        dispatch({ type: 'PERMISSION_DENIED', message: explainError(e).title });
        reportError(messages.connectLabel, e);
      }
    },
    [attach, messages, notify, refreshAuthorized, reportError, support.available],
  );

  const openAuthorizedRef = useRef(openAuthorized);
  openAuthorizedRef.current = openAuthorized;

  /**
   * ZMK Studio over USB serial. The keyboard identifies itself with get_device_info; writes need it
   * unlocked with its own Studio unlock key, which OpenKey waits for and never presses.
   */
  const attachZmk = useCallback(
    async (
      channel: zmk.ByteChannel,
      usb: { vendorId: number; productId: number },
      demo: boolean,
      onLocked?: () => void,
    ): Promise<boolean> => {
      const my = epoch.current.next();
      const stale = () => !epoch.current.isCurrent(my);
      const {
        zmk: z,
        ProtocolRegistry,
        buildFingerprint,
        detectionVerdict,
      } = await import('@openkey/protocols');
      dispatch({ type: 'OPENED' });
      dispatch({ type: 'INSPECTED' });
      const driver = new z.ZmkStudioDriver(channel);
      try {
        await driver.connect();
        if (driver.locked) {
          notify({ kind: 'info', title: messages.zmkUnlock, hint: messages.zmkUnlockHint });
          onLocked?.();
          await driver.waitForUnlock(120000);
        }
        if (stale()) {
          await driver.disconnect();
          return false;
        }
        const identity = { ...usb, productName: driver.name };
        const key = `serial:${usb.vendorId}:${usb.productId}:${driver.serial}`;
        const backend = demo ? ('mock' as const) : ('web-serial' as const);
        const group: HidDeviceGroup = {
          key,
          identity,
          interfaces: [],
          backend,
          transportHint: 'usb',
          openInterface: () => Promise.reject(new Error('ZMK Studio uses USB serial, not HID')),
        };
        const reasons = ['Answered ZMK Studio core.get_device_info over USB serial.'];
        const detection: DetectionReport = {
          device: { key, ...identity, backend, transportHint: 'usb' },
          interfaces: [],
          level: 'handshake',
          candidates: [
            {
              protocol: {
                id: z.ZMK_PROTOCOL_ID,
                name: z.zmkStudioProtocol.name,
                family: 'zmk-studio',
              },
              match: { applicable: true, score: 100, reasons, rejections: [] },
              probe: {
                status: 'pass',
                confidence: Evidence.VERIFIED,
                summary: `ZMK Studio: ${driver.name}`,
                steps: [],
                facts: {},
                identified: true,
              },
              probeLevel: 'handshake',
            },
          ],
          selected: {
            protocolId: z.ZMK_PROTOCOL_ID,
            confidence: Evidence.VERIFIED,
            reasons,
            identification: 'identified',
          },
          ambiguous: false,
          notes: [],
          possibleFamilies: [],
        };
        const registry = new ProtocolRegistry().register(z.zmkStudioProtocol);
        const verdict = detectionVerdict(detection, registry);
        const guarded = guardWrites(driver, () => ({
          simulated: demo,
          experimentalEnabled: experimentalRef.current,
        }));
        dispatch({ type: 'DETECTED', mode: demo ? 'demo' : 'supported' });
        const info = await guarded.getDeviceInfo();
        if (stale()) {
          await driver.disconnect();
          return false;
        }
        setSession({
          id: my,
          kind: 'device',
          driver: guarded,
          detection,
          fingerprint: buildFingerprint(detection),
          verdict,
          manifest: z.zmkStudioProtocol.manifest,
          info,
          caps: guarded.getCapabilities(),
          log: new PacketLog(),
          group,
          demo,
        });
        confirmed.current.clear();
        dispatch({ type: 'READ_DONE' });
        return true;
      } catch (e) {
        await driver.disconnect().catch(() => undefined);
        if (stale()) return false;
        reportError(messages.connectLabel, e);
        dispatch({ type: 'FAIL', message: explainError(e).title, recoverable: false });
        dispatch({ type: 'RESET' });
        return false;
      }
    },
    [messages, notify, reportError],
  );

  const connectZmk = useCallback(async () => {
    if (connRef.current.status !== 'DISCONNECTED') return;
    dispatch({ type: 'REQUEST' });
    let opened: Awaited<ReturnType<typeof openSerialChannel>>;
    try {
      opened = await openSerialChannel();
    } catch (e) {
      dispatch({ type: 'PERMISSION_DENIED', message: explainError(e).title });
      return;
    }
    dispatch({ type: 'PERMISSION_GRANTED' });
    await attachZmk(opened.channel, opened.usb, false);
  }, [attachZmk]);

  const connectDemo = useCallback(
    async (kind: DemoKind = 'ak820') => {
      dispatch({ type: 'OPEN_DEMO' });
      const { sonixFeature, byTech, via } = await import('@openkey/protocols');
      if (kind === 'ak820')
        return void (await attach(new sonixFeature.SonixFeatureSimulator().device.group(), true));
      if (kind === 'via') return void (await attach(new via.ViaSimulator().device.group(), true));
      if (kind === 'hmk') {
        const { hmk } = await import('@openkey/protocols');
        // A simulator cannot be harmed, so its identification read needs no consent.
        return void (await attach(new hmk.HmkSimulator().device.group(), true, {
          consent: ['hmk'],
        }));
      }
      if (kind === 'zmk') {
        const { zmk } = await import('@openkey/protocols');
        // The demo keyboard starts locked and "presses" its unlock key a moment after OpenKey asks.
        const sim = new zmk.ZmkSimulator({ locked: true });
        return void (await attachZmk(
          sim.channel(),
          { vendorId: 0x1d50, productId: 0x615e },
          true,
          () => setTimeout(() => sim.unlock(), 1200),
        ));
      }
      if (kind === 'vial')
        return void (await attach(
          new via.ViaSimulator({
            identity: { vendorId: 0xfeed, productId: 0x6061, productName: 'OpenKey Vial demo 60%' },
            vial: {
              definition: via.VIAL_DEMO_DEFINITION,
              settings: { 7: [2, 200], 21: [4, 0], 3: [1, 0], 4: [2, 175], 2: [2, 50] },
              tapDance: 4,
              combos: 4,
              keyOverrides: 2,
            },
            encoders: 1,
            custom: via.VIAL_DEMO_CUSTOM(),
          }).device.group(),
          true,
        ));
      const sim =
        kind === 'aula-f75'
          ? new byTech.ByTechSimulator()
          : new byTech.ByTechSimulator({
              identity: {
                vendorId: 0x258a,
                productId: 0x015e,
                productName: 'Gaming Keyboard',
                manufacturer: 'BY Tech',
              },
              modelCode: byTech.R75_IDENTITY,
            });
      // A simulator cannot be harmed, so its identification read needs no consent.
      await attach(sim.device.group(), true, { consent: ['by-tech'] });
    },
    [attach, attachZmk],
  );

  const disconnect = useCallback(async () => {
    dispatch({ type: 'DISCONNECT' });
    const s = sessionRef.current;
    endSession();
    if (s?.kind === 'device') await s.driver.disconnect().catch(() => undefined);
    dispatch({ type: 'CLOSED' });
    void refreshAuthorized();
  }, [endSession, refreshAuthorized]);

  // Unplug: drop the session. Re-plug: offer to reconnect; never reconnect or write on our own.
  useEffect(() => {
    if (!support.available) return;
    const backend = new WebHidBackend();
    const offUnplug = backend.onDisconnect((d) => {
      void refreshAuthorized();
      const s = sessionRef.current;
      if (
        s &&
        !(s.kind === 'device' && s.demo) &&
        s.group.identity.vendorId === d.vendorId &&
        s.group.identity.productId === d.productId
      ) {
        const running = lock.current;
        endSession();
        dispatch({ type: 'LOST', reason: 'unplugged' });
        notify(
          running
            ? {
                kind: 'error',
                title: messages.lostDuring(running.label),
                reason: messages.lostDuringReason,
                hint: messages.disconnectedHint,
              }
            : { kind: 'warn', title: messages.disconnected, hint: messages.disconnectedHint },
        );
      }
    });
    const offPlug = backend.onConnect(() => {
      void refreshAuthorized();
      if (sessionRef.current) return;
      notify({
        kind: 'info',
        title: messages.replugged,
        action: { label: messages.connectLabel, run: () => void connect() },
      });
    });
    return () => {
      offUnplug();
      offPlug();
    };
  }, [connect, endSession, lock, messages, notify, refreshAuthorized, support.available]);

  // Leaving the page with local edits: the browser asks first.
  const unsavedCount = Object.values(unsaved).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (!unsavedCount) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [unsavedCount]);
  const setUnsaved = useCallback((owner: string, count: number) => {
    setUnsavedMap((m) => {
      if ((m[owner] ?? 0) === count) return m;
      const next = { ...m };
      if (count) next[owner] = count;
      else delete next[owner];
      return next;
    });
  }, []);

  const read = useCallback<Ctx['read']>(
    async (label, fn, opts = {}) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device') return undefined;
      const my = epoch.current.current;
      try {
        const value = await fn(s.driver);
        // An answer for a device that is no longer selected must not reach the current views.
        return epoch.current.isCurrent(my) ? value : undefined;
      } catch (e) {
        if (!epoch.current.isCurrent(my)) return undefined;
        if (!opts.quiet || !(isOpenKeyError(e) && e.code === 'UNSUPPORTED_FEATURE'))
          reportError(label, e);
        if (isOpenKeyError(e) && e.code === 'TRANSPORT') {
          endSession();
          dispatch({ type: 'LOST', reason: 'transport error' });
        }
        return undefined;
      }
    },
    [endSession, reportError],
  );

  const safetyCtx = useCallback(
    () => ({
      simulated: sessionRef.current?.kind === 'device' && sessionRef.current.demo,
      experimentalEnabled: experimental,
    }),
    [experimental],
  );

  const gate = useCallback<Ctx['gate']>(
    (feature) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device')
        return { decision: { kind: 'blocked', reason: messages.noDevice }, allowed: false };
      const decision = writeDecision(s.caps[feature], safetyCtx());
      return { decision, allowed: mayWrite(decision, safetyCtx()) };
    },
    [messages.noDevice, safetyCtx],
  );

  const ask = useCallback(
    (feature: FeatureId, label: string, decision: WriteDecision, safety: SafetyLevel) =>
      new Promise<boolean>((resolve) => setPending({ feature, label, decision, safety, resolve })),
    [],
  );

  /** Policy and confirmation for one feature; assumes the caller holds the operation lock. */
  const confirmLocked = useCallback(
    async (feature: FeatureId, label: string): Promise<boolean> => {
      const s = sessionRef.current;
      if (s?.kind !== 'device' || !canApply(connRef.current)) return false;
      const support = s.caps[feature];
      const ctx = safetyCtx();
      const decision = writeDecision(support, ctx);
      if (decision.kind === 'blocked') {
        notify({
          kind: 'error',
          title: messages.blocked(label),
          reason: decision.reason,
          hint: messages.blockedHint,
        });
        return false;
      }
      const safety = support.safety ?? SafetyLevel.UNVERIFIED;
      // Ask when the opt-in is missing, once per feature per session, and every time for
      // high-risk operations. Simulated devices never ask.
      const needsAsk =
        !ctx.simulated &&
        (!mayWrite(decision, ctx) ||
          !confirmed.current.has(feature) ||
          safety === SafetyLevel.HIGH_RISK);
      if (needsAsk) {
        // For experimental writes the dialog only confirms after the user enabled the opt-in.
        if (!(await ask(feature, label, decision, safety))) return false;
        confirmed.current.add(feature);
      }
      return true;
    },
    [ask, messages, notify, safetyCtx],
  );

  /** Takes the operation lock, or explains why not. */
  const begin = useCallback(
    (label: string, phase: Operation['phase'], feature?: FeatureId): Operation | null => {
      const running = lock.current;
      if (running) {
        notify({ kind: 'info', title: messages.busy(running.label), reason: messages.busyReason });
        return null;
      }
      return lock.begin(epoch.current.current, label, phase, feature);
    },
    [lock, messages, notify],
  );

  const confirmWrite = useCallback<Ctx['confirmWrite']>(
    async (feature, label) => {
      const op = begin(label, 'confirming', feature);
      if (!op) return false;
      try {
        return await confirmLocked(feature, label);
      } finally {
        lock.end(op);
      }
    },
    [begin, confirmLocked, lock],
  );

  const writing = useCallback<Ctx['writing']>(
    async (label, fn) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device' || !canApply(connRef.current)) return undefined;
      const op = begin(label, 'writing');
      if (!op) return undefined;
      dispatch({ type: 'APPLY' });
      try {
        const r = await fn(s.driver);
        if (!epoch.current.isCurrent(op.epoch)) return undefined;
        setRevision((n) => n + 1);
        return r;
      } catch (e) {
        if (epoch.current.isCurrent(op.epoch)) reportError(label, e);
        return undefined;
      } finally {
        lock.end(op);
        if (epoch.current.isCurrent(op.epoch)) dispatch({ type: 'APPLY_SENT', verify: false });
      }
    },
    [begin, lock, reportError],
  );

  const apply = useCallback<Ctx['apply']>(
    async (feature, tx, previous, next) => {
      const op = begin(tx.label, 'confirming', feature);
      if (!op) return undefined;
      try {
        if (!(await confirmLocked(feature, tx.label))) return undefined;
        lock.phase(op, 'writing');
        dispatch({ type: 'APPLY' });
        const result = await runTransaction(tx, previous, next, (step) => {
          if (step.phase === 'ack' && tx.readbackFromDevice) lock.phase(op, 'verifying');
        });
        // The device went away mid-write: the result belongs to a session that no longer exists.
        if (!epoch.current.isCurrent(op.epoch)) return undefined;
        const verifying =
          !!tx.readbackFromDevice &&
          result.outcome !== 'FAILED' &&
          result.outcome !== 'REJECTED' &&
          result.outcome !== 'NO_CHANGES';
        dispatch({ type: 'APPLY_SENT', verify: verifying });
        if (verifying) dispatch({ type: 'VERIFY_DONE' });
        if (result.outcome === 'FAILED') {
          notify({
            kind: 'error',
            title: messages.txOutcome(tx.label, result.outcome),
            reason: messages.failedReason,
            hint: messages.failedHint,
            ...(result.error ? { detail: `${result.error.title}: ${result.error.detail}` } : {}),
          });
          if (result.error)
            setRecentErrors((xs) => [
              ...xs.slice(-19),
              { at: new Date().toISOString(), kind: 'WRITE_FAILED', title: result.error!.title },
            ]);
        } else if (result.outcome === 'MISMATCH') {
          notify({
            kind: 'error',
            title: messages.txOutcome(tx.label, result.outcome),
            hint: messages.mismatchHint,
          });
        }
        if (
          result.outcome === 'VERIFIED' ||
          result.outcome === 'SENT_UNVERIFIED' ||
          result.outcome === 'MISMATCH'
        )
          setRevision((n) => n + 1);
        // Successful outcomes are shown persistently by the editor's change bar, not only as a toast.
        return result;
      } finally {
        lock.end(op);
      }
    },
    [begin, confirmLocked, lock, messages, notify],
  );

  const status = useMemo(() => summarize(conn, session, operation), [conn, session, operation]);

  const value: Ctx = {
    support,
    conn,
    session,
    device: session?.kind === 'device' ? session : null,
    status,
    operation,
    authorized,
    accessProblem,
    retryAccess,
    notices,
    recentErrors,
    experimental,
    setExperimental,
    connect,
    inspect,
    openAuthorized,
    connectDemo,
    connectZmk,
    serialAvailable: !!webSerial(),
    identify,
    reconnect,
    disconnect,
    read,
    gate,
    apply,
    confirmWrite,
    writing,
    setUnsaved,
    unsavedCount,
    revision,
    notify,
    dismiss: (id) => setNotices((xs) => xs.filter((x) => x.id !== id)),
    store,
  };

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      {pending && (
        <SafetyDialog
          label={pending.label}
          decision={pending.decision}
          safety={pending.safety}
          experimental={experimental}
          onEnableExperimental={() => setExperimental(true)}
          onClose={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
    </KeyboardContext.Provider>
  );
}

/** Translated strings the provider needs; injected so state code stays free of UI imports. */
export interface ProviderMessages {
  connectLabel: string;
  noDeviceSelected: string;
  noDeviceSelectedHint: string;
  notListedLinux: string;
  deviceGone: string;
  disconnected: string;
  disconnectedHint: string;
  lostDuring(label: string): string;
  lostDuringReason: string;
  replugged: string;
  noDevice: string;
  blocked(label: string): string;
  blockedHint: string;
  busy(label: string): string;
  busyReason: string;
  failedReason: string;
  failedHint: string;
  mismatchHint: string;
  txOutcome(label: string, outcome: TxResult<unknown>['outcome']): string;
  errorTitle(x: ErrorExplanation): string;
  errorReason(x: ErrorExplanation): string | undefined;
  errorHint(x: ErrorExplanation): string | undefined;
  zmkUnlock: string;
  zmkUnlockHint: string;
}
