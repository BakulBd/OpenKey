import { useKeyboard } from '../state/keyboard.js';
import { useT } from '../i18n/i18n.js';
import { Icon } from '../components/Icon.js';

/** Live region for outcomes and errors; errors stay until dismissed. */
export function Notices() {
  const t = useT();
  const { notices, dismiss } = useKeyboard();
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice n-${n.kind}`} role={n.kind === 'error' ? 'alert' : undefined}>
          <Icon name={n.kind === 'ok' ? 'check' : n.kind === 'error' || n.kind === 'warn' ? 'warn' : 'info'} />
          <div className="notice-body">
            <strong>{n.title}</strong>
            {n.reason && (
              <div className="small">
                <span className="ep-label">{t('error.means')}</span> {n.reason}
              </div>
            )}
            {n.hint && (
              <div className="small">
                <span className="ep-label">{t('error.next')}</span> {n.hint}
              </div>
            )}
            {n.detail && (
              <details className="small">
                <summary>{t('error.technical')}</summary>
                <code className="wrap-any">{n.detail}</code>
              </details>
            )}
            {n.action && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  n.action!.run();
                  dismiss(n.id);
                }}
              >
                {n.action.label}
              </button>
            )}
          </div>
          <button type="button" className="btn ghost icon-only" onClick={() => dismiss(n.id)} aria-label={t('common.dismiss')}>
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
