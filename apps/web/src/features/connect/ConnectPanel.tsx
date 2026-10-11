import { DEMO_KINDS, useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { Spinner } from '../../components/ui.js';
import { href } from '../../app/router.js';
import { AccessHelp, PlatformGuide } from './PlatformSetup.js';

type Check = { ok: boolean | null; label: MessageKey; help?: MessageKey };

/** Best-effort platform facts; used only to explain, never to decide what the browser can do. */
function platform(): { mobile: boolean; linux: boolean } {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };
  const ua = navigator.userAgent;
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(ua);
  const linux = /Linux/i.test(nav.userAgentData?.platform ?? navigator.platform ?? '') && !/Android/i.test(ua);
  return { mobile, linux };
}

const STEPS = ['REQUESTING_PERMISSION', 'CONNECTING', 'DETECTING', 'READING', 'READY'] as const;

/**
 * The connection journey in one place: what this browser can do, devices already allowed, progress
 * while a keyboard is identified, and what to do when it fails. Used by the landing page and by any
 * device page opened without a keyboard.
 */
export function ConnectPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { support, connect, connectDemo, inspect, conn, status, authorized, openAuthorized, accessProblem } = useKeyboard();
  const busy = conn.status !== 'DISCONNECTED';
  const p = platform();
  const checks: Check[] = [
    { ok: support.available, label: support.available ? 'connect.check.webhid' : 'connect.check.noWebhid', help: support.available ? undefined : p.mobile ? 'connect.check.mobile' : 'browser.useDemo' },
    { ok: support.secureContext, label: support.secureContext ? 'connect.check.secure' : 'connect.check.insecure' },
  ];
  if (p.linux && support.available) checks.push({ ok: null, label: 'connect.check.linux', help: 'connect.check.linuxHelp' });
  const failed = conn.status === 'DISCONNECTED' && conn.error && conn.error !== 'no device selected' ? conn.error : null;
  const stepIndex = STEPS.indexOf((conn.status === 'INSPECTING' ? 'DETECTING' : conn.status) as (typeof STEPS)[number]);

  return (
    <div className={`connect-panel ${compact ? 'compact' : ''}`}>
      {accessProblem && !busy && <AccessHelp problem={accessProblem} />}
      <div className="hero-actions">
        <button type="button" className="btn primary large" disabled={!support.available || busy} onClick={() => void connect()}>
          <Icon name="plug" /> {t('action.connect')}
        </button>
        <button type="button" className="btn large" disabled={busy} onClick={() => void connectDemo()}>
          <Icon name="play" /> {t('action.demo')}
        </button>
        <button type="button" className="btn ghost large" disabled={!support.available || busy} onClick={() => void inspect()}>
          <Icon name="lab" /> {t('action.inspect')}
        </button>
      </div>
      <div className="demo-picker" role="group" aria-label={t('demo.pick')}>
        <span className="small muted">{t('demo.pick')}</span>
        {DEMO_KINDS.map((k) => (
          <button key={k} type="button" className="chip" disabled={busy} onClick={() => void connectDemo(k)}>
            {t(`demo.${k}` as MessageKey)}
          </button>
        ))}
      </div>

      {status.mode === 'connecting' && (
        <ol className="connect-steps" aria-label={t('connect.progress')}>
          {STEPS.slice(0, 4).map((s, i) => (
            <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
              {i === stepIndex ? <Spinner /> : i < stepIndex ? <Icon name="check" size={14} /> : <span className="step-dot" aria-hidden="true" />}
              {t(`connect.step.${s}` as MessageKey)}
            </li>
          ))}
        </ol>
      )}

      {failed && !accessProblem && (
        <div className="callout danger small" role="alert">
          <strong>{t('connect.failed', { error: failed })}</strong> {t('connect.failedHint')}
        </div>
      )}

      <ul className="env-checks" aria-label={t('connect.environment')}>
        {checks.map((c) => (
          <li key={c.label} className={c.ok === false ? 'bad' : c.ok ? 'good' : 'note'}>
            <Icon name={c.ok === false ? 'warn' : c.ok ? 'check' : 'info'} size={16} />
            <span>
              {t(c.label)}
              {c.help && <span className="muted"> {t(c.help)}</span>}
            </span>
          </li>
        ))}
      </ul>

      {support.available && !accessProblem && <PlatformGuide defaultOpen={!compact} />}

      {authorized.length > 0 && !busy && (
        <div className="authorized">
          <h2 className="h-sub">{t('connect.authorized')}</h2>
          <ul>
            {authorized.map((d) => (
              <li key={d.key}>
                <span>
                  <strong>{d.productName || t('dev.unnamed')}</strong>{' '}
                  <code className="muted">
                    {d.vendorId.toString(16).toUpperCase().padStart(4, '0')}:{d.productId.toString(16).toUpperCase().padStart(4, '0')}
                  </code>
                </span>
                <button type="button" className="btn small" onClick={() => void openAuthorized(d.key)}>
                  {t('connect.open')}
                </button>
              </li>
            ))}
          </ul>
          <p className="small muted">{t('connect.authorizedNote')}</p>
        </div>
      )}

      {!compact && (
        <p className="small muted">
          {t('connect.noDevice')} <a href={href('lab')}>{t('connect.offlineLink')}</a>
        </p>
      )}

      <details className="small">
        <summary>{t('connect.troubleTitle')}</summary>
        <ul>
          <li>{t('connect.trouble.cable')}</li>
          <li>{t('connect.trouble.wired')}</li>
          <li>{t('connect.trouble.linux')}</li>
          <li>{t('connect.trouble.busy')}</li>
          <li>{t('connect.trouble.protected')}</li>
        </ul>
      </details>
    </div>
  );
}
