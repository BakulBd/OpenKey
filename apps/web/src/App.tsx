import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { formatPacket, isAvailable, isDebugEnabled } from '@openak820/core';
import type { Capabilities, FeatureId } from '@openak820/core';
import { useKeyboard } from './state/keyboard.js';
import { ConnectScreen } from './pages/Connect.js';
import { Dashboard } from './pages/Dashboard.js';
import { KeymapPage } from './pages/Keymap.js';
import { PerKeyPage, RgbPage } from './pages/Rgb.js';
import { MacrosPage } from './pages/Macros.js';
import { TftPage } from './pages/Tft.js';
import { DevicePage } from './pages/Device.js';
import { DiagnosticsPage } from './pages/Diagnostics.js';
import { BackupPage } from './pages/Backup.js';
import { ProfilesPage } from './pages/Profiles.js';

interface Route {
  id: string;
  label: string;
  /** Hidden when none of these features is available on the connected keyboard. */
  needs?: FeatureId[];
  render: () => ReactElement;
}

const ROUTES: Route[] = [
  { id: 'dashboard', label: 'Dashboard', render: () => <Dashboard /> },
  { id: 'keymap', label: 'Keymap', needs: ['keymap'], render: () => <KeymapPage layer="base" /> },
  { id: 'fn', label: 'Fn layer', needs: ['fnLayer'], render: () => <KeymapPage layer="fn" /> },
  { id: 'rgb', label: 'RGB', needs: ['rgb'], render: () => <RgbPage /> },
  { id: 'perkey', label: 'Per-key RGB', needs: ['perKeyRgb'], render: () => <PerKeyPage /> },
  { id: 'macros', label: 'Macros', needs: ['macros'], render: () => <MacrosPage /> },
  { id: 'tft', label: 'Screen', needs: ['tft', 'tftClock'], render: () => <TftPage /> },
  { id: 'profiles', label: 'Profiles', render: () => <ProfilesPage /> },
  { id: 'device', label: 'Device', render: () => <DevicePage /> },
  { id: 'diagnostics', label: 'Diagnostics', render: () => <DiagnosticsPage /> },
  { id: 'backup', label: 'Backup / Restore', render: () => <BackupPage /> },
];

const visible = (r: Route, caps: Capabilities) =>
  !r.needs || r.needs.some((f) => isAvailable(caps[f]));

function useHashRoute(): [string, (r: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => setRoute(read());
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);
  return [route, (r) => (location.hash = `/${r}`)];
}

export function App() {
  const { conn, disconnect, notices, dismiss } = useKeyboard();
  const [route, go] = useHashRoute();

  useEffect(() => {
    if (!conn || !isDebugEnabled()) return;
    return conn.log.subscribe((r) => console.debug(formatPacket(r)));
  }, [conn]);

  const routes = conn ? ROUTES.filter((r) => visible(r, conn.caps)) : [];
  const active = routes.find((r) => r.id === route) ?? routes[0];

  return (
    <div className="app">
      {conn ? (
        <>
          <aside className="side">
            <div className="brand">OpenAK820</div>
            <div className="dev">
              <div className="dev-name">{conn.info.model}</div>
              <div className="dim">
                {conn.demo ? 'simulated' : conn.info.transport.toUpperCase()} · fw{' '}
                {conn.info.firmware.version ?? '?'}
              </div>
            </div>
            <nav>
              {routes.map((r) => (
                <a
                  key={r.id}
                  href={`#/${r.id}`}
                  className={active?.id === r.id ? 'on' : ''}
                  onClick={() => go(r.id)}
                >
                  {r.label}
                </a>
              ))}
            </nav>
            <button className="ghost small" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </aside>
          <main className="main">
            <h1>{active?.label}</h1>
            {active?.render()}
          </main>
        </>
      ) : (
        <main className="main solo">
          <ConnectScreen />
        </main>
      )}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`}>
            <strong>{n.title}</strong>
            {n.detail && <div>{n.detail}</div>}
            <button className="x" onClick={() => dismiss(n.id)} aria-label="dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
