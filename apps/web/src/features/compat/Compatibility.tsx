import { useMemo, useState } from 'react';
import { CATALOG, getProfile } from '@openkey/devices';
import type { CatalogEntry, CatalogStatus } from '@openkey/devices';
import { createDefaultRegistry } from '@openkey/protocols';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { PageHeader, hex4 } from '../../components/ui.js';
import { Icon } from '../../components/Icon.js';
import { CONTRIBUTE_KEYBOARD_URL } from '../../config.js';
import { ModelGuide } from './ModelGuide.js';

const STATUSES: CatalogStatus[] = ['verified', 'experimental', 'community', 'research', 'unsupported'];
const LINKS = ['usb', '2.4ghz', 'bluetooth'] as const;
const LINK_LABEL: Record<(typeof LINKS)[number], string> = { usb: 'USB', '2.4ghz': '2.4 GHz', bluetooth: 'Bluetooth' };
const HARDWARE: [keyof CatalogEntry['hardware'], MessageKey][] = [
  ['rgb', 'compat.hw.rgb'],
  ['perKeyRgb', 'compat.hw.perKey'],
  ['tft', 'compat.hw.tft'],
  ['encoder', 'compat.hw.encoder'],
  ['hallEffect', 'compat.hw.he'],
];

/** Configuration support on a link, from the device definition when one exists. */
function linkConfig(e: CatalogEntry, link: (typeof LINKS)[number]): string | null {
  if (!e.definition) return null;
  return getProfile(e.definition)?.transportModes[link]?.configuration ?? null;
}

const keyOf = (e: CatalogEntry) => `${e.vendorId}-${e.productId}-${e.productName ?? ''}-${e.model}-${e.link}`;

function DeviceCard({ e }: { e: CatalogEntry }) {
  const t = useT();
  const hw = HARDWARE.filter(([k]) => e.hardware[k]);
  const links = LINKS.map((l) => [l, linkConfig(e, l)] as const).filter(([, v]) => v && v !== 'unsupported');
  return (
    <li className={`device-card cs-border-${e.status}`}>
      <div className="device-card-top">
        <span className="device-brand">{e.brand}</span>
        <span className={`pill cs-${e.status}`}>{t(`compat.status.${e.status}`)}</span>
      </div>
      <h3>{e.model}</h3>
      <p className="mono small muted">
        {hex4(e.vendorId)}:{hex4(e.productId)} · {LINK_LABEL[e.link as (typeof LINKS)[number]] ?? e.link} · {e.mcu}
      </p>
      {hw.length > 0 && (
        <ul className="hw-chips" aria-label={t('compat.hardware')}>
          {hw.map(([k, label]) => (
            <li key={k}>{t(label)}</li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <p className="small">
          <span className="muted">{t('compat.configures')}</span> {links.map(([l, v]) => `${LINK_LABEL[l]} (${v})`).join(' · ')}
        </p>
      )}
      <p className="small muted">
        {t('compat.col.family')}: <code>{e.family}</code>
      </p>
      <details className="small">
        <summary>{t('compat.evidence')}</summary>
        <p>{e.evidence}</p>
      </details>
    </li>
  );
}

/**
 * Compatibility center: what OpenKey supports, as cards. Every card states OpenKey's own verification
 * state; counts are shown per state and never added up into a single "supported" number. Families
 * that work for any brand (VIA) are shown separately, and so is everything that does not work yet.
 */
export default function Compatibility() {
  const t = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CatalogStatus | 'all'>('all');
  const [brand, setBrand] = useState<string>('all');
  const brands = useMemo(() => [...new Set(CATALOG.map((e) => e.brand))], []);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOG.filter((e) => status === 'all' || e.status === status)
      .filter((e) => brand === 'all' || e.brand === brand)
      .filter((e) => !needle || `${e.brand} ${e.model} ${e.family} ${e.mcu} ${hex4(e.vendorId)}:${hex4(e.productId)}`.toLowerCase().includes(needle));
  }, [q, status, brand]);
  const registry = useMemo(() => createDefaultRegistry(), []);
  const families = [...registry.list().map((p) => ({ id: p.id, name: p.name, m: p.manifest })), ...registry.planned().map((p) => ({ id: p.id, name: p.name, m: p.manifest }))];
  const notYet = CATALOG.filter((e) => e.status === 'research' || e.status === 'unsupported');

  return (
    <div className="page">
      <PageHeader title={t('nav.compat')} lead={t('compat.lead')} />

      <ul className="stat-row" aria-label={t('compat.filter')}>
        {STATUSES.map((s) => {
          const n = CATALOG.filter((e) => e.status === s).length;
          const on = status === s;
          return (
            <li key={s}>
              <button type="button" className={`stat-card cs-border-${s} ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setStatus(on ? 'all' : s)}>
                <span className="stat-num">{n}</span>
                <span className={`pill cs-${s}`}>{t(`compat.status.${s}`)}</span>
                <span className="small muted">{t(`compat.statusMeans.${s}` as MessageKey)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="filter-bar">
        <label className="search grow">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('compat.search')} aria-label={t('compat.search')} />
        </label>
        <div className="chips" role="group" aria-label={t('compat.brand')}>
          {['all', ...brands].map((b) => (
            <button key={b} type="button" className={`chip ${brand === b ? 'on' : ''}`} aria-pressed={brand === b} onClick={() => setBrand(b)}>
              {b === 'all' ? t('compat.all') : b}
            </button>
          ))}
        </div>
      </div>

      <section className="family-callout card" aria-labelledby="any-brand-h">
        <span className="feature-icon">
          <Icon name="keymap" />
        </span>
        <div>
          <h2 id="any-brand-h">{t('compat.anyBrandTitle')}</h2>
          <p className="small">{t('compat.anyBrandBody')}</p>
        </div>
      </section>

      <ModelGuide />

      <h2 className="section-title">{t('compat.byId')}</h2>
      <p className="small muted" role="status">
        {t('compat.caption', { n: rows.length })}
      </p>
      <ul className="device-grid">
        {rows.map((e) => (
          <DeviceCard key={keyOf(e)} e={e} />
        ))}
      </ul>
      {rows.length === 0 && <p className="muted">{t('compat.none')}</p>}

      <section className="card" aria-labelledby="not-yet-h">
        <h2 id="not-yet-h">{t('compat.notYetTitle', { n: notYet.length })}</h2>
        <p className="small muted">{t('compat.notYetLead')}</p>
        <ul className="not-yet">
          {notYet.map((e) => (
            <li key={keyOf(e)}>
              <span className={`pill cs-${e.status}`}>{t(`compat.status.${e.status}`)}</span>{' '}
              <strong>
                {e.brand} {e.model}
              </strong>{' '}
              <code className="muted small">
                {hex4(e.vendorId)}:{hex4(e.productId)}
              </code>
              <div className="small muted">{t(e.status === 'unsupported' ? 'compat.why.unsupported' : 'compat.why.research')}</div>
            </li>
          ))}
        </ul>
        <a className="btn small" href={CONTRIBUTE_KEYBOARD_URL} target="_blank" rel="noopener noreferrer">
          {t('footer.contribute')}
        </a>
      </section>

      <section aria-labelledby="fam-h">
        <h2 id="fam-h" className="section-title">
          {t('compat.families')}
        </h2>
        <ul className="family-grid">
          {families.map((f) => (
            <li key={f.id} className={`family-card cs-border-${f.m.status}`}>
              <span className={`pill cs-${f.m.status}`}>{t(`compat.status.${f.m.status}`)}</span>
              <strong>{f.name}</strong>
              <span className="small muted">{f.m.verification}</span>
              <span className="small muted">{t('compat.familyMeta', { units: f.m.verifiedIdentities.length, license: f.m.license, version: f.m.version })}</span>
              {f.m.limitations.length > 0 && (
                <details className="small">
                  <summary>{t('compat.limitations', { n: f.m.limitations.length })}</summary>
                  <ul>
                    {f.m.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
