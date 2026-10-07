import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { PacketLog, explainError, isOpenKeyError } from '@openkey/core';
import type { Capabilities, DeviceInfo, KeyboardDriver } from '@openkey/core';
import { WebHidBackend, webHidSupport } from '@openkey/hid';
import type { HidDeviceGroup, WebHidSupport } from '@openkey/hid';
import { connectKeyboard, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import type { DetectionReport } from '@openkey/protocols';
import { LocalStorageStateStore, readPref, writePref } from './storage.js';

/** Broad filters: identification happens after the chooser, from descriptors and probes. */
const FILTERS: HIDDeviceFilter[] = [
  { vendorId: 0x0c45 },
  { vendorId: 0x1a2c },
  { vendorId: 0x05ac, productId: 0x024f },
];

export interface Connection {
  driver: KeyboardDriver;
  detection: DetectionReport;
  info: DeviceInfo;
  caps: Capabilities;
  log: PacketLog;
  demo: boolean;
  group: HidDeviceGroup;
}

export interface Notice {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface Ctx {
  support: WebHidSupport;
  status: 'idle' | 'connecting' | 'connected';
  conn: Connection | null;
  /** Detection reports of every device offered by the chooser (for Diagnostics when none matched). */
  lastDetections: DetectionReport[];
  notices: Notice[];
  experimental: boolean;
  setExperimental(v: boolean): void;
  connect(): Promise<void>;
  connectDemo(): Promise<void>;
  disconnect(): Promise<void>;
  /** Runs a device operation with error reporting; writes ask for confirmation once per session. */
  run<T>(
    label: string,
    fn: (d: KeyboardDriver) => Promise<T>,
    opts?: { write?: boolean; quiet?: boolean },
  ): Promise<T | undefined>;
  dismiss(id: number): void;
  store: LocalStorageStateStore;
}

const KeyboardContext = createContext<Ctx | null>(null);

export function useKeyboard(): Ctx {
  const c = useContext(KeyboardContext);
  if (!c) throw new Error('useKeyboard outside provider');
  return c;
}

let noticeId = 0;

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const support = useMemo(() => webHidSupport(), []);
  const store = useMemo(() => new LocalStorageStateStore(), []);
  const [status, setStatus] = useState<Ctx['status']>('idle');
  const [conn, setConn] = useState<Connection | null>(null);
  const [lastDetections, setLastDetections] = useState<DetectionReport[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [experimental, setExp] = useState(readPref('experimental', '0') === '1');
  const writesConfirmed = useRef(false);
  const connRef = useRef<Connection | null>(null);
  connRef.current = conn;

  const notify = useCallback((n: Omit<Notice, 'id'>) => {
    const id = ++noticeId;
    setNotices((xs) => [...xs.slice(-3), { ...n, id }]);
    if (n.kind !== 'error')
      setTimeout(() => setNotices((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);

  const finishConnect = useCallback(
    async (group: HidDeviceGroup, demo: boolean): Promise<boolean> => {
      const log = new PacketLog();
      const registry = createDefaultRegistry();
      try {
        const res = await connectKeyboard(group, {
          registry,
          level: 'handshake',
          log,
          store,
          allowExperimental: experimental,
        });
        const info = await res.driver.getDeviceInfo();
        setConn({
          driver: res.driver,
          detection: res.detection,
          info,
          caps: res.driver.getCapabilities(),
          log,
          demo,
          group,
        });
        setLastDetections([res.detection]);
        setStatus('connected');
        notify({
          kind: 'ok',
          title: `Connected: ${info.model}`,
          detail: `${res.detection.selected?.protocolId} · ${res.detection.selected?.confidence}`,
        });
        return true;
      } catch (e) {
        const report = await registry.detect(group, { level: 'descriptor' }).catch(() => null);
        if (report) setLastDetections((xs) => [...xs, report]);
        const x = explainError(e);
        notify({
          kind: 'error',
          title: x.title,
          detail: `${x.detail}${x.hint ? ` — ${x.hint}` : ''}`,
        });
        return false;
      }
    },
    [experimental, notify, store],
  );

  const connect = useCallback(async () => {
    if (!support.available) return;
    setStatus('connecting');
    setLastDetections([]);
    try {
      const backend = new WebHidBackend();
      const groups = await backend.request(FILTERS);
      if (groups.length === 0) {
        notify({
          kind: 'info',
          title: 'No device selected',
          detail: 'Pick your keyboard in the browser dialog. Use a USB data cable and wired mode.',
        });
        setStatus('idle');
        return;
      }
      for (const g of groups) if (await finishConnect(g, false)) return;
      setStatus('idle');
    } catch (e) {
      const x = explainError(e);
      notify({ kind: 'error', title: x.title, detail: x.detail });
      setStatus('idle');
    }
  }, [finishConnect, notify, support.available]);

  const connectDemo = useCallback(async () => {
    setStatus('connecting');
    const sim = new sonixFeature.SonixFeatureSimulator();
    if (!(await finishConnect(sim.device.group(), true))) setStatus('idle');
  }, [finishConnect]);

  const disconnect = useCallback(async () => {
    await connRef.current?.driver.disconnect().catch(() => undefined);
    setConn(null);
    setStatus('idle');
    writesConfirmed.current = false;
  }, []);

  // Physical unplug: drop the connection instead of leaving a dead handle around.
  useEffect(() => {
    if (!support.available) return;
    const backend = new WebHidBackend();
    return backend.onDisconnect((d) => {
      const c = connRef.current;
      if (
        c &&
        !c.demo &&
        c.group.identity.vendorId === d.vendorId &&
        c.group.identity.productId === d.productId
      ) {
        void disconnect();
        notify({ kind: 'info', title: 'Keyboard disconnected' });
      }
    });
  }, [disconnect, notify, support.available]);

  const run = useCallback<Ctx['run']>(
    async (label, fn, opts = {}) => {
      const c = connRef.current;
      if (!c) return undefined;
      if (opts.write && !writesConfirmed.current) {
        const ok = window.confirm(
          `${label}\n\nOpenKey is about to write to the keyboard. It only sends packets reproduced from the official AJAZZ software and never touches firmware or the bootloader. Settings the firmware cannot report are remembered in this browser.\n\nContinue? (asked once per session)`,
        );
        if (!ok) return undefined;
        writesConfirmed.current = true;
      }
      try {
        const r = await fn(c.driver);
        if (opts.write && !opts.quiet) notify({ kind: 'ok', title: `${label}: done` });
        return r;
      } catch (e) {
        const x = explainError(e);
        notify({
          kind: 'error',
          title: `${label}: ${x.title}`,
          detail: `${x.detail}${x.hint ? ` — ${x.hint}` : ''}`,
        });
        if (isOpenKeyError(e) && e.code === 'TRANSPORT') await disconnect();
        return undefined;
      }
    },
    [disconnect, notify],
  );

  const value: Ctx = {
    support,
    status,
    conn,
    lastDetections,
    notices,
    experimental,
    setExperimental: (v) => {
      setExp(v);
      writePref('experimental', v ? '1' : '0');
    },
    connect,
    connectDemo,
    disconnect,
    run,
    dismiss: (id) => setNotices((xs) => xs.filter((x) => x.id !== id)),
    store,
  };
  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}
