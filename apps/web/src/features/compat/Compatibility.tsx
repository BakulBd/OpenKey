import { useMemo, useState } from 'react';
import { CATALOG, getProfile } from '@openkey/devices';
import type { CatalogEntry, CatalogStatus } from '@openkey/devices';
import { createDefaultRegistry } from '@openkey/protocols';
import { useT } from '../../i18n/i18n.js';
import { Card, PageHeader, hex4 } from '../../components/ui.js';
import { Icon } from '../../components/Icon.js';
import { CONTRIBUTE_KEYBOARD_URL } from '../../config.js';

const STATUSES: CatalogStatus[] = ['verified', 'experimental', 'community', 'research', 'unsupported'];

/** Configuration support on a link, from the device definition when one exists. */
function linkConfig(e: CatalogEntry, link: 'usb' | '2.4ghz' | 'bluetooth'): string {
  if (!e.definition) return '—';
  return getProfile(e.definition)?.transportModes[link]?.configuration ?? '—';
}

function Has({ v }: { v: boolean | undefined }) {
  const t = useT();
  if (v === undefined) return <span className="muted" title={t('compat.unknownHw')}>?</span>;
  return v ? <Icon name="check" label={t('compat.yes')} /> : <span aria-label={t('compat.no')}>—</span>;
}

/**
 * Searchable compatibility matrix. Every row states OpenKey's own verification state; device counts
 * are shown per state and never added up into a single "supported" number.
 */
export default function Compatibility() {
  const t = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CatalogStatus | 'all'>('all');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOG.filter((e) => status === 'all' || e.status === status).filter(
      (e) => !needle || `${e.brand} ${e.model} ${e.family} ${e.mcu} ${hex4(e.vendorId)}:${hex4(e.productId)}`.toLowerCase().includes(needle),
    );
  }, [q, status]);
  const registry = useMemo(() => createDefaultRegistry(), []);
  const families = [...registry.list().map((p) => ({ id: p.id, name: p.name, m: p.manifest })), ...registry.planned().map((p) => ({ id: p.id, name: p.name, m: p.manifest }))];

  return (
    <div className="page">
      <PageHeader title={t('nav.compat')} lead={t('compat.lead')} />
      <div className="row wrap">
        <label className="search grow">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('compat.search')} aria-label={t('compat.search')} />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value as CatalogStatus | 'all')} aria-label={t('compat.filter')}>
          <option value="all">{t('compat.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`compat.status.${s}`)} ({CATALOG.filter((e) => e.status === s).length})
            </option>
          ))}
        </select>
      </div>
      <Card>
        <div className="table-wrap">
          <table className="tbl compat small">
            <caption className="small muted">{t('compat.caption', { n: rows.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('compat.col.device')}</th>
                <th scope="col">{t('compat.col.status')}</th>
                <th scope="col">{t('compat.col.family')}</th>
                <th scope="col">USB</th>
                <th scope="col">2.4 GHz</th>
                <th scope="col">BT</th>
                <th scope="col">RGB</th>
                <th scope="col">{t('compat.col.perKey')}</th>
                <th scope="col">TFT</th>
                <th scope="col">{t('compat.col.encoder')}</th>
                <th scope="col">HE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.vendorId}-${e.productId}-${e.model}`}>
                  <th scope="row">
                    <strong>{e.brand}</strong> {e.model}
                    <div className="muted mono">
                      {hex4(e.vendorId)}:{hex4(e.productId)} · {e.link} · {e.mcu}
                    </div>
                    <div className="muted">{e.evidence}</div>
                  </th>
                  <td>
                    <span className={`pill cs-${e.status}`}>{t(`compat.status.${e.status}`)}</span>
                  </td>
                  <td className="mono">{e.family}</td>
                  <td>{linkConfig(e, 'usb')}</td>
                  <td>{linkConfig(e, '2.4ghz')}</td>
                  <td>{linkConfig(e, 'bluetooth')}</td>
                  <td><Has v={e.hardware.rgb} /></td>
                  <td><Has v={e.hardware.perKeyRgb} /></td>
                  <td><Has v={e.hardware.tft} /></td>
                  <td><Has v={e.hardware.encoder} /></td>
                  <td><Has v={e.hardware.hallEffect} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t('compat.legend')}</p>
      </Card>
      <Card title={t('compat.families')}>
        <ul className="family-list">
          {families.map((f) => (
            <li key={f.id}>
              <span className={`pill cs-${f.m.status}`}>{t(`compat.status.${f.m.status}`)}</span> <strong>{f.name}</strong>
              <div className="small muted">{f.m.verification}</div>
              <div className="small muted">
                {t('compat.familyMeta', { units: f.m.verifiedIdentities.length, license: f.m.license, version: f.m.version })}
              </div>
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
        <a className="btn small" href={CONTRIBUTE_KEYBOARD_URL} target="_blank" rel="noopener noreferrer">
          {t('footer.contribute')}
        </a>
      </Card>
    </div>
  );
}
