import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { StatusBar } from './StatusBar.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { ConnectionLimits } from '../features/shared/ConnectionLimits.js';
import { ISSUES_URL } from '../config.js';

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
      noDeviceSelected: t('notice.noDeviceSelected'),
      noDeviceSelectedHint: t('notice.noDeviceSelectedHint'),
      notListedLinux: t('notice.notListedLinux'),
      deviceGone: t('notice.deviceGone'),
      disconnected: t('notice.disconnected'),
      disconnectedHint: t('notice.disconnectedHint'),
      lostDuring: (label) => t('notice.lostDuring', { label }),
      lostDuringReason: t('notice.lostDuringReason'),
      replugged: t('notice.replugged'),
      noDevice: t('notice.noDevice'),
      blocked: (label) => t('notice.blocked', { label }),
      blockedHint: t('notice.blockedHint'),
      busy: (label) => t('notice.busy', { label }),
      busyReason: t('notice.busyReason'),
      failedReason: t('notice.failedReason'),
      failedHint: t('notice.failedHint'),
      mismatchHint: t('notice.mismatchHint'),
      txOutcome: (label, outcome: TxOutcome) => t(`tx.${outcome}`, { label }),
      errorTitle: (x) => t(`error.${x.kind}.title` as MessageKey) || x.title,
      errorReason: (x) => x.reason && (t(`error.${x.kind}.reason` as MessageKey) || x.reason),
      errorHint: (x) => x.hint && (t(`error.${x.kind}.hint` as MessageKey) || x.hint),
      zmkUnlock: t('zmk.unlock'),
      zmkUnlockHint: t('zmk.unlockHint'),
    }),
    [t],
  );
  return (
    <KeyboardProvider messages={messages}>
      <App />
    </KeyboardProvider>
  );
}

/** True while the viewport uses the off-canvas navigation (keep in sync with the CSS breakpoint). */
function useNarrow(): boolean {
  const q = '(max-width: 860px)';
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const h = () => setNarrow(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return narrow;
}

function App() {
  const t = useT();
  const [route, goRaw] = useRoute();
  const { session, device, disconnect, unsavedCount } = useKeyboard();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const narrow = useNarrow();
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Local edits are lost when their page closes: ask before navigating away or disconnecting.
  const guarded = useCallback(
    (action: () => void) => {
      if (unsavedCount > 0) setLeaving(() => action);
      else action();
    },
    [unsavedCount],
  );
  const go = useCallback(
    (r: string) => (r === route ? undefined : guarded(() => goRaw(r))),
    [goRaw, guarded, route],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') setNavOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // A fresh connection lands on the overview (once per session); losing it leaves tool pages alone.
  const lastSession = useRef<unknown>(null);
  useEffect(() => {
    if (session && session !== lastSession.current && route === 'home') goRaw('overview');
    lastSession.current = session;
  }, [session, route, goRaw]);

  useEffect(() => setNavOpen(false), [route]);
  // Moving focus into the opened navigation, and back to its toggle when it closes.
  useEffect(() => {
    if (navOpen) navRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    else if (wasOpen.current && narrow) toggleRef.current?.focus();
    wasOpen.current = navOpen;
  }, [navOpen, narrow]);

  const caps = device?.caps ?? null;
  const visible = ROUTES.filter((r) => !r.hidden)
    .map((r) => ({ r, v: routeVisibility(r, caps, !!device, !!session) }))
    .filter((x) => x.v !== 'hide');
  const active = ROUTES.find((r) => r.id === route);
  const activeVis = active ? routeVisibility(active, caps, !!device, !!session) : 'hide';
  // A descriptive tab title per page (shared links, history, search snippets).
  const pageTitle = active ? t(active.label) : null;
  useEffect(() => {
    document.title = pageTitle
      ? `${pageTitle} · OpenKey`
      : 'OpenKey — open-source keyboard configurator in your browser';
  }, [pageTitle]);

  const palette = paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} go={go} />;
  const leaveDialog = leaving && (
    <Dialog
      title={t('leave.title', { n: unsavedCount })}
      tone="warn"
      onClose={() => setLeaving(null)}
      actions={
        <>
          <button type="button" className="btn ghost" autoFocus onClick={() => setLeaving(null)}>
            {t('leave.stay')}
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              const a = leaving;
              setLeaving(null);
              a();
            }}
          >
            {t('leave.discard')}
          </button>
        </>
      }
    >
      <p>{t('leave.body')}</p>
    </Dialog>
  );

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
  // Device pages hold device-specific state: a new session (another device, or a reconnect) remounts them.
  const pageKey = active.section === 'device' ? `${active.id}:${session?.id ?? 0}` : active.id;
  const navHidden = narrow && !navOpen;

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip" href="#main">
        {t('a11y.skip')}
      </a>
      {narrow && navOpen && (
        <div className="nav-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />
      )}
      <aside
        ref={navRef}
        className="side"
        aria-label={t('nav.label')}
        id="side-nav"
        inert={navHidden || undefined}
        aria-hidden={navHidden || undefined}
      >
        <a className="brand" href={href('home')} onClick={(e) => (e.preventDefault(), go('home'))}>
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
                  <a
                    key={r.id}
                    href={href(r.id)}
                    className={`nav-item ${route === r.id || (r.id === 'rgb' && route === 'perkey') ? 'on' : ''}`}
                    aria-current={route === r.id ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      go(r.id);
                    }}
                  >
                    <Icon name={r.icon} />
                    <span>{t(r.label)}</span>
                    {v === 'research' && (
                      <span className="pill tiny st-not_yet_reverse_engineered">
                        {t('nav.research')}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <button
            type="button"
            className="btn ghost small kbd-hint"
            onClick={() => setPaletteOpen(true)}
          >
            <Icon name="search" /> {t('palette.open')} <kbd>Ctrl K</kbd>
          </button>
          {session && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => guarded(() => void disconnect())}
            >
              {t('action.disconnect')}
            </button>
          )}
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <button
            ref={toggleRef}
            type="button"
            className="btn ghost icon-only nav-toggle"
            aria-expanded={navOpen}
            aria-controls="side-nav"
            aria-label={t('nav.toggle')}
            onClick={() => setNavOpen((o) => !o)}
          >
            <Icon name="menu" />
          </button>
          <StatusBar />
        </header>
        <main id="main" tabIndex={-1}>
          {needsConnect ? (
            <ConnectPrompt />
          ) : activeVis === 'research' ? (
            <ResearchNeeded route={active} />
          ) : (
            <>
              {active.section === 'device' && active.id !== 'overview' && (
                <div className="page-limits">
                  <ConnectionLimits compact />
                </div>
              )}
              <ErrorBoundary
                resetKey={pageKey}
                fallback={(e, reset) => <PageError error={e} onRetry={reset} />}
              >
                <Suspense fallback={<Loading />}>
                  <Page key={pageKey} />
                </Suspense>
              </ErrorBoundary>
            </>
          )}
        </main>
        <Footer compact />
      </div>
      <Notices />
      {palette}
      {leaveDialog}
      <UpdateBanner />
    </div>
  );
}

/** Shown when one page fails to render; the rest of the app and the connection keep working. */
function PageError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="page narrow">
      <div className="card" role="alert">
        <h1>{t('pageError.title')}</h1>
        <p>{t('pageError.body')}</p>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={onRetry}>
            {t('pageError.retry')}
          </button>
          <a
            className="btn"
            href={`${ISSUES_URL}?labels=bug`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.bug')}
          </a>
        </div>
        <details className="small">
          <summary>{t('error.technical')}</summary>
          <code className="wrap-any">{error.message}</code>
        </details>
      </div>
    </div>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect
        x="2"
        y="7"
        width="28"
        height="18"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <rect x="7" y="12" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="14" y="12" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="21" y="12" width="4" height="3" rx="1" fill="var(--accent)" />
      <rect x="9" y="18" width="14" height="3" rx="1" fill="currentColor" />
    </svg>
  );
}

function DeviceChip() {
  const t = useT();
  const { session, device, status } = useKeyboard();
  if (!session) return <div className="dev-chip muted small">{t('dev.none')}</div>;
  const name = device?.info.model ?? (session.group.identity.productName || t('dev.unnamed'));
  const link = device?.demo
    ? t('mode.simulated')
    : (device?.info.transport ?? session.group.transportHint).toUpperCase();
  const chip = device?.chip;
  return (
    <a className="dev-chip" href={href('overview')}>
      <div className="dev-name">{name}</div>
      <div className="muted small">
        {link}
        {chip ? ` · ${chip}` : ''}
        {status.identity && status.identity !== 'simulated'
          ? ` · ${t(`identity.${status.identity}`)}`
          : ''}
        {device && device.info.firmware.version
          ? ` · ${t('dev.fw', { v: device.info.firmware.version })}`
          : ''}
      </div>
    </a>
  );
}
