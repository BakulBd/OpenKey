import { useT } from '../i18n/i18n.js';
import { APP_VERSION, CONTRIBUTE_KEYBOARD_URL, ISSUES_URL, REPO_URL } from '../config.js';
import { Icon } from '../components/Icon.js';

/** Community footer: one quiet call to action, no pop-ups. */
export function Footer({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <footer className={`footer ${compact ? 'compact' : ''}`}>
      {!compact && <p className="footer-cta">{t('footer.cta')}</p>}
      <div className="footer-links">
        <a className="btn small" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="github" /> {t('footer.star')}
        </a>
        <a className="btn ghost small" href={CONTRIBUTE_KEYBOARD_URL} target="_blank" rel="noopener noreferrer">
          {t('footer.contribute')}
        </a>
        <a className="btn ghost small" href={`${ISSUES_URL}?labels=bug`} target="_blank" rel="noopener noreferrer">
          {t('footer.bug')}
        </a>
        <a className="btn ghost small" href={`${ISSUES_URL}?labels=device-support`} target="_blank" rel="noopener noreferrer">
          {t('footer.request')}
        </a>
      </div>
      <p className="muted small">
        {t('footer.tagline')} · v{APP_VERSION} · {t('footer.privacy')}
      </p>
    </footer>
  );
}
