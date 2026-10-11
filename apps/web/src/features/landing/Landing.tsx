import { CATALOG } from '@openkey/devices/catalog';
import type { CatalogStatus } from '@openkey/devices/catalog';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import type { IconName } from '../../components/Icon.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { HeroVisual } from './HeroVisual.js';
import { ConnectPanel } from '../connect/ConnectPanel.js';
import { Logo } from '../../app/App.js';
import { href } from '../../app/router.js';
import { CONTRIBUTE_KEYBOARD_URL, REPO_URL } from '../../config.js';

const PIPELINE = ['transport', 'discovery', 'detection', 'adapter', 'capabilities', 'ui'] as const;
const BRANDS = ['AJAZZ AK820', 'AULA F75 · F87 · F99', 'RK R75', 'Akko · MonsGeek (ROYUAN)', 'QMK / VIA', 'Vial', 'Any HID device: inspect'];
const FEATURES: [IconName, string][] = [
  ['keymap', 'keymap'],
  ['rgb', 'lighting'],
  ['macros', 'macros'],
  ['screen', 'screen'],
  ['backup', 'backup'],
  ['tester', 'tester'],
];
const STATUS_ORDER: CatalogStatus[] = ['verified', 'experimental', 'community', 'research', 'unsupported'];

export function Landing() {
  const t = useT();
  const { support, inspect, conn } = useKeyboard();
  const busy = conn.status !== 'DISCONNECTED';
  const counts = STATUS_ORDER.map((s) => [s, CATALOG.filter((e) => e.status === s).length] as const);

  return (
    <main id="main" className="landing" tabIndex={-1}>
      <header className="landing-top">
        <a className="brand" href={href('home')}>
          <Logo /> OpenKey
        </a>
        <nav aria-label={t('nav.label')} className="landing-nav">
          <a href={href('compat')}>{t('nav.compat')}</a>
          <a href={href('tester')}>{t('nav.tester')}</a>
          <a href={href('lab')}>{t('nav.lab')}</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <div className="hero-wrap">
        <section className="hero">
          <p className="eyebrow">{t('landing.eyebrow')}</p>
          <h1>{t('landing.title')}</h1>
          <p className="lead">{t('landing.lead')}</p>
          <ConnectPanel compact />
          <p className="muted small honest">{t('landing.honest')}</p>
        </section>
        <HeroVisual />
      </div>

      <section className="brand-strip" aria-labelledby="works-h">
        <h2 id="works-h" className="small muted">{t('landing.worksWith')}</h2>
        <ul>
          {BRANDS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="feat-h" className="feature-section">
        <h2 id="feat-h">{t('landing.featuresTitle')}</h2>
        <ul className="feature-grid">
          {FEATURES.map(([icon, key]) => (
            <li key={key} className="feature-card">
              <span className="feature-icon">
                <Icon name={icon} />
              </span>
              <strong>{t(`landing.feat.${key}` as MessageKey)}</strong>
              <span className="muted small">{t(`landing.feat.${key}.d` as MessageKey)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-grid" aria-labelledby="pipe-h">
        <div className="card span-2">
          <h2 id="pipe-h">{t('landing.pipelineTitle')}</h2>
          <ol className="pipeline">
            {PIPELINE.map((p, i) => (
              <li key={p}>
                <span className="step">{i + 1}</span>
                <strong>{t(`landing.pipe.${p}`)}</strong>
                <span className="muted small">{t(`landing.pipe.${p}.d`)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <h2>{t('landing.hardwareTitle')}</h2>
          <p>{t('landing.flagship')}</p>
          <ul className="status-counts">
            {counts.map(([s, n]) => (
              <li key={s}>
                <span className={`pill cs-${s}`}>{t(`compat.status.${s}`)}</span> <span className="num">{n}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('landing.countsNote')}</p>
          <a href={href('compat')} className="btn small">
            {t('landing.devices')}
          </a>
        </div>

        <div className="card">
          <h2>{t('landing.privacyTitle')}</h2>
          <ul className="ticks">
            <li>{t('landing.privacy.noAccount')}</li>
            <li>{t('landing.privacy.local')}</li>
            <li>{t('landing.privacy.typing')}</li>
            <li>{t('landing.privacy.permission')}</li>
          </ul>
          <a className="small" href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer">
            {t('landing.privacyLink')}
          </a>
        </div>

        <div className="card">
          <h2>{t('landing.unknownTitle')}</h2>
          <p>{t('landing.unknownBody')}</p>
          <button type="button" className="btn small" disabled={!support.available || busy} onClick={() => void inspect()}>
            <Icon name="lab" /> {t('action.inspect')}
          </button>
        </div>

        <div className="card">
          <h2>{t('landing.contributeTitle')}</h2>
          <ol className="steps small">
            <li>{t('landing.contribute.1')}</li>
            <li>{t('landing.contribute.2')}</li>
            <li>{t('landing.contribute.3')}</li>
            <li>{t('landing.contribute.4')}</li>
          </ol>
          <a className="btn small" href={CONTRIBUTE_KEYBOARD_URL} target="_blank" rel="noopener noreferrer">
            {t('footer.contribute')}
          </a>
        </div>
      </section>
    </main>
  );
}
