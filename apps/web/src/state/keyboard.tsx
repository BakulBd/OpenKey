import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  INITIAL_CONNECTION,
  PacketLog,
  SafetyLevel,
  canApply,
  explainError,
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
  Transaction,
  TxResult,
  WriteDecision,
} from '@openkey/core';
import { CATALOG } from '@openkey/devices/catalog';
import { WebHidBackend, webHidSupport } from '@openkey/hid';
import type { HidDeviceGroup, WebHidSupport } from '@openkey/hid';
import type { AdapterManifest, DetectionReport, DeviceFingerprint } from '@openkey/protocols';
import { IdbStateStore } from './db.js';
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

export interface DeviceSession {
  kind: 'device';
  driver: KeyboardDriver;
  detection: DetectionReport;
  fingerprint: DeviceFingerprint;
  manifest: AdapterManifest;
  info: DeviceInfo;
  caps: Capabilities;
  log: PacketLog;
  group: HidDeviceGroup;
  demo: boolean;
}

export interface UnknownSession {
  kind: 'unknown';
  detection: DetectionReport;
  fingerprint: DeviceFingerprint;
  group: HidDeviceGroup;
  log: PacketLog;
  /** Why no adapter took the device. */
  reason: ErrorExplanation;
}

export type Session = DeviceSession | UnknownSession;

export interface Notice {
  id: number;
  kind: 'ok' | 'error' | 'info' | 'warn';
  title: string;
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
  notices: Notice[];
  recentErrors: RecentError[];
  experimental: boolean;
  setExperimental(v: boolean): void;
  connect(): Promise<void>;
  inspect(): Promise<void>;
  connectDemo(): Promise<void>;
  disconnect(): Promise<void>;
  /** Runs a read with error reporting. */
  read<T>(label: string, fn: (d: KeyboardDriver) => Promise<T>, opts?: { quiet?: boolean }): Promise<T | undefined>;
  /** Write gate for a feature: what the safety policy allows right now. */
  gate(feature: FeatureId): WriteGate;
  /**
   * Runs a write through the safety policy and the transaction model. Returns the transaction
   * result, or undefined when the user declined or the policy blocked it.
   */
  apply<T>(feature: FeatureId, tx: Transaction<T>, previous: T | undefined, next: T): Promise<TxResult<T> | undefined>;
  /** Safety gate only (policy + confirmation); for multi-section writes such as a restore. */
  confirmWrite(feature: FeatureId, label: string): Promise<boolean>;
  /** Runs a confirmed multi-step write while the connection is in the APPLYING state. */
  writing<T>(label: string, fn: (d: KeyboardDriver) => Promise<T>): Promise<T | undefined>;
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

export function KeyboardProvider({ children, messages }: { children: ReactNode; messages: ProviderMessages }) {
  const support = useMemo(() => webHidSupport(), []);
  const store = useMemo(() => new IdbStateStore(), []);
  const [conn, dispatch] = useReducer(reducer, INITIAL_CONNECTION);
  const [session, setSession] = useState<Session | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  // Experimental writes are a per-session opt-in on purpose: it is never remembered.
  const [experimental, setExperimental] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmed = useRef(new Set<FeatureId>());
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const connRef = useRef(conn);
  connRef.current = conn;

  const notify = useCallback((n: Omit<Notice, 'id'>) => {
    const id = ++noticeId;
    setNotices((xs) => [...xs.slice(-3), { ...n, id }]);
    if (n.kind === 'ok' || n.kind === 'info') setTimeout(() => setNotices((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);

  const reportError = useCallback(
    (label: string, e: unknown): ErrorExplanation => {
      const x = explainError(e);
      setRecentErrors((xs) => [...xs.slice(-19), { at: new Date().toISOString(), kind: x.kind, title: x.title }]);
      notify({
        kind: 'error',
        title: `${label}: ${messages.errorTitle(x)}`,
        detail: [x.detail, messages.errorReason(x), messages.errorHint(x)].filter(Boolean).join(' — '),
      });
      return x;
    },
    [messages, notify],
  );

  const attach = useCallback(
    async (group: HidDeviceGroup, demo: boolean): Promise<boolean> => {
      const log = new PacketLog();
      // The protocol stack is loaded on the first connection, not with the landing page.
      const { buildFingerprint, connectKeyboard, createDefaultRegistry } = await import('@openkey/protocols');
      const registry = createDefaultRegistry();
      dispatch({ type: 'OPENED' });
      dispatch({ type: 'INSPECTED' });
      try {
        const res = await connectKeyboard(group, { registry, level: 'handshake', log, store, allowExperimental: experimental });
        dispatch({ type: 'DETECTED', mode: demo ? 'demo' : 'supported' });
        const info = await res.driver.getDeviceInfo();
        const def = registry.get(res.detection.selected?.protocolId ?? '')!;
        setSession({
          kind: 'device',
          driver: res.driver,
          detection: res.detection,
          fingerprint: buildFingerprint(res.detection),
          manifest: def.manifest,
          info,
          caps: res.driver.getCapabilities(),
          log,
          group,
          demo,
        });
        confirmed.current.clear();
        dispatch({ type: 'READ_DONE' });
        notify({ kind: 'ok', title: messages.connected(info.model), detail: demo ? messages.demoDetail : undefined });
        return true;
      } catch (e) {
        if (isOpenKeyError(e) && (e.code === 'UNSUPPORTED_DEVICE' || e.code === 'UNSUPPORTED_PROTOCOL')) {
          // Unknown-device mode: descriptors only from here on. Nothing is written.
          const detection = await registry.detect(group, { level: 'descriptor', log });
          setSession({ kind: 'unknown', detection, fingerprint: buildFingerprint(detection), group, log, reason: explainError(e) });
          dispatch({ type: 'DETECTED', mode: 'unknown' });
          notify({ kind: 'info', title: messages.unknownDevice(group.identity.productName) });
          return true;
        }
        reportError(messages.connectLabel, e);
        dispatch({ type: 'FAIL', message: explainError(e).title, recoverable: false });
        dispatch({ type: 'RESET' });
        return false;
      }
    },
    [experimental, messages, notify, reportError, store],
  );

  const request = useCallback(
    async (filters: HIDDeviceFilter[]) => {
      if (!support.available) return;
      dispatch({ type: 'REQUEST' });
      try {
        const groups = await new WebHidBackend().request(filters);
        if (groups.length === 0) {
          dispatch({ type: 'PERMISSION_DENIED', message: 'no device selected' });
          notify({ kind: 'info', title: messages.noDeviceSelected, detail: messages.noDeviceSelectedHint });
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

  const connect = useCallback(() => request(CONNECT_FILTERS), [request]);
  const inspect = useCallback(() => request([]), [request]);

  const connectDemo = useCallback(async () => {
    dispatch({ type: 'OPEN_DEMO' });
    const { sonixFeature } = await import('@openkey/protocols');
    const sim = new sonixFeature.SonixFeatureSimulator();
    await attach(sim.device.group(), true);
  }, [attach]);

  const disconnect = useCallback(async () => {
    dispatch({ type: 'DISCONNECT' });
    const s = sessionRef.current;
    if (s?.kind === 'device') await s.driver.disconnect().catch(() => undefined);
    setSession(null);
    confirmed.current.clear();
    dispatch({ type: 'CLOSED' });
  }, []);

  // Unplug: drop the session. Re-plug: offer to reconnect; never reconnect or write on our own.
  useEffect(() => {
    if (!support.available) return;
    const backend = new WebHidBackend();
    const offUnplug = backend.onDisconnect((d) => {
      const s = sessionRef.current;
      if (s && !(s.kind === 'device' && s.demo) && s.group.identity.vendorId === d.vendorId && s.group.identity.productId === d.productId) {
        setSession(null);
        dispatch({ type: 'LOST', reason: 'unplugged' });
        notify({ kind: 'warn', title: messages.disconnected, detail: messages.disconnectedHint });
      }
    });
    const offPlug = backend.onConnect(() => {
      if (sessionRef.current) return;
      notify({ kind: 'info', title: messages.replugged, action: { label: messages.connectLabel, run: () => void connect() } });
    });
    return () => {
      offUnplug();
      offPlug();
    };
  }, [connect, messages, notify, support.available]);

  const read = useCallback<Ctx['read']>(
    async (label, fn, opts = {}) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device') return undefined;
      try {
        return await fn(s.driver);
      } catch (e) {
        if (!opts.quiet || !(isOpenKeyError(e) && e.code === 'UNSUPPORTED_FEATURE')) reportError(label, e);
        if (isOpenKeyError(e) && e.code === 'TRANSPORT') {
          setSession(null);
          dispatch({ type: 'LOST', reason: 'transport error' });
        }
        return undefined;
      }
    },
    [reportError],
  );

  const safetyCtx = useCallback(
    () => ({ simulated: sessionRef.current?.kind === 'device' && sessionRef.current.demo, experimentalEnabled: experimental }),
    [experimental],
  );

  const gate = useCallback<Ctx['gate']>(
    (feature) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device') return { decision: { kind: 'blocked', reason: messages.noDevice }, allowed: false };
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

  const confirmWrite = useCallback<Ctx['confirmWrite']>(
    async (feature, label) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device' || !canApply(connRef.current)) return false;
      const support = s.caps[feature];
      const ctx = safetyCtx();
      const decision = writeDecision(support, ctx);
      if (decision.kind === 'blocked') {
        notify({ kind: 'error', title: messages.blocked(label), detail: decision.reason });
        return false;
      }
      const safety = support.safety ?? SafetyLevel.UNVERIFIED;
      // Ask when the opt-in is missing, once per feature per session, and every time for
      // high-risk operations. Simulated devices never ask.
      const needsAsk = !ctx.simulated && (!mayWrite(decision, ctx) || !confirmed.current.has(feature) || safety === SafetyLevel.HIGH_RISK);
      if (needsAsk) {
        // For experimental writes the dialog only confirms after the user enabled the opt-in.
        if (!(await ask(feature, label, decision, safety))) return false;
        confirmed.current.add(feature);
      }
      return true;
    },
    [ask, messages, notify, safetyCtx],
  );

  const writing = useCallback<Ctx['writing']>(
    async (label, fn) => {
      const s = sessionRef.current;
      if (s?.kind !== 'device' || !canApply(connRef.current)) return undefined;
      dispatch({ type: 'APPLY' });
      try {
        return await fn(s.driver);
      } catch (e) {
        reportError(label, e);
        return undefined;
      } finally {
        dispatch({ type: 'APPLY_SENT', verify: false });
      }
    },
    [reportError],
  );

  const apply = useCallback<Ctx['apply']>(
    async (feature, tx, previous, next) => {
      if (!(await confirmWrite(feature, tx.label))) return undefined;
      dispatch({ type: 'APPLY' });
      const result = await runTransaction(tx, previous, next);
      const verifying = !!tx.readbackFromDevice && result.outcome !== 'FAILED' && result.outcome !== 'REJECTED' && result.outcome !== 'NO_CHANGES';
      dispatch({ type: 'APPLY_SENT', verify: verifying });
      if (verifying) dispatch({ type: 'VERIFY_DONE' });
      const kind: Notice['kind'] =
        result.outcome === 'VERIFIED' || result.outcome === 'NO_CHANGES' ? 'ok' : result.outcome === 'SENT_UNVERIFIED' ? 'info' : 'error';
      notify({ kind, title: messages.txOutcome(tx.label, result.outcome), detail: result.outcome === 'FAILED' ? result.error?.detail : undefined });
      if (result.outcome === 'FAILED' && result.error)
        setRecentErrors((xs) => [...xs.slice(-19), { at: new Date().toISOString(), kind: 'WRITE_FAILED', title: result.error!.title }]);
      return result;
    },
    [confirmWrite, messages, notify],
  );

  const value: Ctx = {
    support,
    conn,
    session,
    device: session?.kind === 'device' ? session : null,
    notices,
    recentErrors,
    experimental,
    setExperimental,
    connect,
    inspect,
    connectDemo,
    disconnect,
    read,
    gate,
    apply,
    confirmWrite,
    writing,
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
  connected(model: string): string;
  demoDetail: string;
  unknownDevice(name: string): string;
  noDeviceSelected: string;
  noDeviceSelectedHint: string;
  disconnected: string;
  disconnectedHint: string;
  replugged: string;
  noDevice: string;
  blocked(label: string): string;
  txOutcome(label: string, outcome: TxResult<unknown>['outcome']): string;
  errorTitle(x: ErrorExplanation): string;
  errorReason(x: ErrorExplanation): string | undefined;
  errorHint(x: ErrorExplanation): string | undefined;
}
