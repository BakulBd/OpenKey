import { useT } from '../i18n/i18n.js';
import { APP_VERSION, CONTRIBUTE_KEYBOARD_URL, ISSUES_URL, REPO_URL } from '../config.js';
import { Icon } from '../components/Icon.js';
import people from './contributors.json' with { type: 'json' };

const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;

/**
 * Everyone who contributed to the repository (pnpm contributors refreshes the list). Avatars are
 * served by this site, so showing them never contacts GitHub.
 */
function Contributors() {
  const t = useT();
  return (
    <section className="contributors" aria-labelledby="contributors-h">
      <p id="contributors-h" className="contributors-title">
        {t('footer.builtWith')} <Icon name="heart" size={16} label={t('footer.love')} />{' '}
        {t('footer.byContributors')}
      </p>
      <ul className="avatar-wall">
        {people.contributors.map((c) => (
          <li key={c.login}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={t('footer.contributions', { name: c.login, n: c.contributions })}
            >
              <img
                src={`./${c.avatar}`}
                width={56}
                height={56}
                loading="lazy"
                decoding="async"
                alt={c.login}
              />
            </a>
          </li>
        ))}
        <li>
          <a
            className="avatar-join"
            href={CONTRIBUTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t('footer.join')}
            aria-label={t('footer.join')}
          >
            +
          </a>
        </li>
      </ul>
    </section>
  );
}

/** Community footer: one quiet call to action, no pop-ups. */
export function Footer({ compact = false }: { compact?: boolean }) {
  const t = useT();
  // Inside the workspace the footer stays out of the way: one line, no call to action.
  if (compact)
    return (
      <footer className="footer compact">
        <p className="muted small">
          OpenKey v{APP_VERSION} · {t('footer.privacy')} ·{' '}
          <a href={`${ISSUES_URL}?labels=bug`} target="_blank" rel="noopener noreferrer">
            {t('footer.bug')}
          </a>{' '}
          ·{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t('footer.source')}
          </a>
        </p>
      </footer>
    );
  return (
    <footer className={`footer ${compact ? 'compact' : ''}`}>
      <p className="footer-cta">{t('footer.cta')}</p>
      <div className="footer-links">
        <a className="btn small" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="github" /> {t('footer.star')}
        </a>
        <a
          className="btn ghost small"
          href={CONTRIBUTE_KEYBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('footer.contribute')}
        </a>
        <a
          className="btn ghost small"
          href={`${ISSUES_URL}?labels=bug`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('footer.bug')}
        </a>
        <a
          className="btn ghost small"
          href={`${ISSUES_URL}?labels=device-support`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('footer.request')}
        </a>
      </div>
      <Contributors />
      <p className="muted small">
        © {new Date().getFullYear()} {t('footer.copyright')} · {t('footer.tagline')} · v
        {APP_VERSION} · {t('footer.privacy')}
      </p>
    </footer>
  );
}
