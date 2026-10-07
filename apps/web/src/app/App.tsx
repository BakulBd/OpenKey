import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TxOutcome } from '@openkey/core';
import { I18nProvider, useT } from '../i18n/i18n.js';
import type { MessageKey } from '../i18n/i18n.js';
import { KeyboardProvider, useKeyboard } from '../state/keyboard.js';
import type { ProviderMessages } from '../state/keyboard.js';
import { ROUTES, routeVisibility } from './routes.js';
import { href, useRoute } from './router.js';
import { Landing } from '../features/landing/Landing.js';
import { ConnectPrompt } from '../features/connect/ConnectPrompt.js';
import { ResearchNeeded } from '../features/connect/ResearchNeeded.js';
import { CommandPalette } from './CommandPalette.js';
import { Footer } from './Footer.js';
import { Notices } from './Notices.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/ui.js';
import { applyTheme } from '../state/theme.js';
import { UpdateBanner } from './UpdateBanner.js';

export function Root() {
  useEffect(() => applyTheme(), []);
  return (
    <I18nProvider>
      <ProvidersWithMessages />
    </I18nProvider>
  );
}

function ProvidersWithMessages() {
  const t = useT();
  const messages = useMemo<ProviderMessages>(
    () => ({
      connectLabel: t('action.connect'),
      connected: (model) => t('notice.connected', { model }),
      demoDetail: t('notice.demoDetail'),
      unknownDevice: (name) => t('notice.unknownDevice', { name }),
      noDeviceSelected: t('notice.noDeviceSelected'),
      noDeviceSelectedHint: t('notice.noDeviceSelectedHint'),
      disconnected: t('notice.disconnected'),
      disconnectedHint: t('notice.disconnectedHint'),
      replugged: t('notice.replugged'),
      noDevice: t('notice.noDevice'),
      blocked: (label) => t('notice.blocked', { label }),
      txOutcome: (label, outcome: TxOutcome) => t(`tx.${outcome}`, { label }),
      errorTitle: (x) => t(`error.${x.kind}.title` as MessageKey) || x.title,
      errorReason: (x) => x.reason && (t(`error.${x.kind}.reason` as MessageKey) || x.reason),
      errorHint: (x) => x.hint && (t(`error.${x.kind}.hint` as MessageKey) || x.hint),
    }),
    [t],
  );
  return (
    <KeyboardProvider messages={messages}>
      <App />
    </KeyboardProvider>
  );
}

function App() {
  const t = useT();
  const [route, go] = useRoute();
  const { session, device, disconnect, conn } = useKeyboard();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // A fresh connection lands on the overview (once per session); losing it leaves tool pages alone.
  const lastSession = useRef<unknown>(null);
  useEffect(() => {
    if (session && session !== lastSession.current && route === 'home')
      go('overview');
    lastSession.current = session;
  }, [session, route, go]);

  useEffect(() => setNavOpen(false), [route]);

  const caps = device?.caps ?? null;
  const visible = ROUTES.map((r) => ({ r, v: routeVisibility(r, caps, !!device, !!session) })).filter((x) => x.v !== 'hide');
  const active = ROUTES.find((r) => r.id === route);
  const activeVis = active ? routeVisibility(active, caps, !!device, !!session) : 'hide';

  const palette = paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} go={go} />;

  if (route === 'home' || !active) {
    return (
      <>
        <a className="skip" href="#main">
          {t('a11y.skip')}
        </a>
        <Landing />
        <Footer />
        <Notices />
        {palette}
        <UpdateBanner />
      </>
    );
  }

  const sections: { id: 'device' | 'workspace' | 'tools'; label: MessageKey }[] = [
    { id: 'device', label: 'nav.section.device' },
    { id: 'workspace', label: 'nav.section.workspace' },
    { id: 'tools', label: 'nav.section.tools' },
  ];
  const Page = active.component;
  const needsConnect = active.section === 'device' && activeVis === 'hide';

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip" href="#main">
        {t('a11y.skip')}
      </a>
      <aside className="side" aria-label={t('nav.label')}>
        <a className="brand" href={href('home')}>
          <Logo /> OpenKey
        </a>
        <DeviceChip />
        <nav>
          {sections.map((s) => {
            const items = visible.filter((x) => x.r.section === s.id);
            if (!items.length) return null;
            return (
              <div key={s.id} className="nav-section">
                <div className="nav-heading">{t(s.label)}</div>
                {items.map(({ r, v }) => (
                  <a key={r.id} href={href(r.id)} className={`nav-item ${route === r.id ? 'on' : ''}`} aria-current={route === r.id ? 'page' : undefined}>
                    <Icon name={r.icon} />
                    <span>{t(r.label)}</span>
                    {v === 'research' && <span className="pill tiny st-not_yet_reverse_engineered">{t('nav.research')}</span>}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <button type="button" className="btn ghost small kbd-hint" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" /> {t('palette.open')} <kbd>Ctrl K</kbd>
          </button>
          {session && (
            <button type="button" className="btn ghost small" onClick={() => void disconnect()}>
              {t('action.disconnect')}
            </button>
          )}
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <button type="button" className="btn ghost icon-only nav-toggle" aria-expanded={navOpen} aria-label={t('nav.toggle')} onClick={() => setNavOpen((o) => !o)}>
            <Icon name="menu" />
          </button>
          <span className={`conn-state cs-${conn.status.toLowerCase()}`} role="status">
            <span className="dot" aria-hidden="true" /> {t(`conn.${conn.status}`)}
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          {needsConnect ? (
            <ConnectPrompt />
          ) : activeVis === 'research' ? (
            <ResearchNeeded route={active} />
          ) : (
            <Suspense fallback={<Loading />}>
              <Page />
            </Suspense>
          )}
        </main>
        <Footer compact />
      </div>
      <Notices />
      {palette}
      <UpdateBanner />
    </div>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect x="2" y="7" width="28" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="7" y="12" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="14" y="12" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="21" y="12" width="4" height="3" rx="1" fill="var(--accent)" />
      <rect x="9" y="18" width="14" height="3" rx="1" fill="currentColor" />
    </svg>
  );
}

function DeviceChip() {
  const t = useT();
  const { session, device } = useKeyboard();
  if (!session) return <div className="dev-chip muted small">{t('dev.none')}</div>;
  if (session.kind === 'unknown')
    return (
      <div className="dev-chip">
        <div className="dev-name">{session.group.identity.productName || t('dev.unnamed')}</div>
        <div className="muted small">{t('dev.unknownMode')}</div>
      </div>
    );
  return (
    <div className="dev-chip">
      <div className="dev-name">{device!.info.model}</div>
      <div className="muted small">
        {device!.demo ? t('dev.demo') : device!.info.transport.toUpperCase()} · {t('dev.fw', { v: device!.info.firmware.version ?? '?' })}
      </div>
    </div>
  );
}
