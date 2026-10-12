import { useMemo, useState } from 'react';
import { MODEL_GUIDE } from '@openkey/devices/guide';
import type { GuideEntry, GuideLevel } from '@openkey/devices/guide';
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

/** "Is my keyboard supported?" by model name, grouped by market, searchable. */
export function ModelGuide() {
  const t = useT();
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return MODEL_GUIDE.filter((e) => !n || `${e.brand} ${e.model}`.toLowerCase().includes(n));
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
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {hits.length === 0 && <p className="small">{t('guide.none')}</p>}
    </section>
  );
}
