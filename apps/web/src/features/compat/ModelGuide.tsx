import { useEffect, useMemo, useState } from 'react';
import type { ViaBoard } from '@openkey/devices/via-index';
import { MODEL_GUIDE } from '@openkey/devices/guide';
import type { GuideEntry, GuideLevel, RevisionStatus } from '@openkey/devices/guide';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';

const GROUPS: GuideEntry['group'][] = ['bangladesh', 'asia', 'via', 'gaming', 'enthusiast'];
const LEVEL_CLASS: Record<GuideLevel, string> = {
  verified: 'cs-verified',
  adapter: 'cs-community',
  via: 'cs-experimental',
  depends: 'cs-research',
  'vendor-only': 'cs-unsupported',
  'nothing-to-configure': 'cs-planned',
};
const REV_CLASS: Record<RevisionStatus, string> = {
  verified: 'cs-verified',
  community: 'cs-community',
  'read-only': 'cs-experimental',
  research: 'cs-research',
  none: 'cs-unsupported',
};

/** Search text: name, note, revision names, chips and USB identities (with and without the colon). */
const haystack = (e: GuideEntry) =>
  [
    e.brand,
    e.model,
    ...(e.revisions ?? []).flatMap((r) => [
      r.name,
      r.chip,
      ...r.ids,
      ...r.ids.map((i) => i.replace(':', '')),
    ]),
  ]
    .join(' ')
    .toLowerCase();

/** "Is my keyboard supported?" by model name, grouped by market, searchable. */
export function ModelGuide() {
  const t = useT();
  const [q, setQ] = useState('');
  // The VIA index (~80 KB) loads with this page only, not with the app.
  const [viaBoards, setViaBoards] = useState<readonly ViaBoard[] | null>(null);
  useEffect(() => {
    let live = true;
    void import('@openkey/devices/via-index').then((m) => live && setViaBoards(m.VIA_BOARDS));
    return () => {
      live = false;
    };
  }, []);
  const viaHits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!viaBoards || !words.length || words.join('').length < 2) return [];
    return viaBoards.filter((b) => {
      const text = `${b.vendor} ${b.name} ${b.id} ${b.id.replace(':', '')}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [q, viaBoards]);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return MODEL_GUIDE.filter((e) => !n || n.split(/\s+/).every((w) => haystack(e).includes(w)));
  }, [q]);
  return (
    <section className="card model-guide" aria-labelledby="guide-h">
      <h2 id="guide-h">{t('guide.title')}</h2>
      <p className="small muted">{t('guide.lead')}</p>
      <label className="search">
        <Icon name="search" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('guide.search')}
          aria-label={t('guide.search')}
        />
      </label>
      {GROUPS.map((g) => {
        const list = hits.filter((e) => e.group === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <h3 className="guide-group">{t(`guide.group.${g}` as MessageKey)}</h3>
            <ul className="guide-list">
              {list.map((e) => (
                <li key={`${e.brand}-${e.model}`}>
                  <div className="guide-head">
                    <strong>
                      {e.brand} {e.model}
                    </strong>
                    <span className={`pill ${LEVEL_CLASS[e.level]}`}>
                      {t(`guide.level.${e.level}` as MessageKey)}
                    </span>
                  </div>
                  <p className="small muted">{e.note}</p>
                  {e.revisions && e.revisions.length > 0 && (
                    <details className="revisions">
                      <summary className="small">
                        {t('guide.revisions', { n: e.revisions.length })}
                      </summary>
                      <div className="table-wrap">
                        <table className="tbl small">
                          <thead>
                            <tr>
                              <th>{t('guide.rev.name')}</th>
                              <th>{t('guide.rev.chip')}</th>
                              <th>{t('guide.rev.ids')}</th>
                              <th>{t('guide.rev.status')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.revisions.map((r) => (
                              <tr key={r.name}>
                                <td>
                                  {r.name}
                                  {r.tell && <div className="muted">{r.tell}</div>}
                                </td>
                                <td>{r.chip}</td>
                                <td>
                                  {r.ids.length ? (
                                    r.ids.map((i) => (
                                      <code key={i} className="id-chip">
                                        {i}
                                      </code>
                                    ))
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                                <td>
                                  <span className={`pill tiny ${REV_CLASS[r.status]}`}>
                                    {t(`guide.rev.st.${r.status}` as MessageKey)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="small muted">{t('guide.rev.note')}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {viaHits.length > 0 && (
        <div>
          <h3 className="guide-group">
            {t('guide.viaMatches', { n: viaHits.length, total: viaBoards?.length ?? 0 })}
          </h3>
          <ul className="guide-list">
            {viaHits.slice(0, 24).map((b) => (
              <li key={b.id}>
                <div className="guide-head">
                  <strong>{b.name}</strong>
                  <span className="pill cs-experimental">{t('guide.level.via')}</span>
                </div>
                <p className="small muted">
                  <code className="id-chip">{b.id}</code> {b.vendor} · {t('guide.viaNote')}
                </p>
              </li>
            ))}
          </ul>
          {viaHits.length > 24 && (
            <p className="small muted">{t('guide.viaMore', { n: viaHits.length - 24 })}</p>
          )}
        </div>
      )}
      {hits.length === 0 && viaHits.length === 0 && <p className="small">{t('guide.none')}</p>}
      {viaBoards && (
        <p className="small muted">
          {t('guide.viaCount', { n: viaBoards.length.toLocaleString() })}
        </p>
      )}
    </section>
  );
}
