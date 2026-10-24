import { useState } from 'react';
import { navigationMode } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { PageHeader } from '../../components/ui.js';
import { readRoute } from '../../app/router.js';
import { RgbStudio } from './RgbStudio.js';
import { PerKeyStudio } from './PerKeyStudio.js';
import { ZonesStudio } from './ZonesStudio.js';

type Tab = 'effects' | 'perkey' | 'zones';

/**
 * Lighting workspace: hardware effects and per-key colour are two modes of the same lighting
 * system (applying per-key colours switches the effect), so they share one page. Only the tabs the
 * device's capabilities support are shown.
 */
export default function Lighting() {
  const t = useT();
  const { device } = useKeyboard();
  const tabs: Tab[] = device
    ? ([
        device.caps.rgb.write || device.caps.rgb.read !== 'none' ? 'effects' : null,
        navigationMode(device.caps.perKeyRgb) === 'show' ? 'perkey' : null,
        navigationMode(device.caps.lightZones) === 'show' ? 'zones' : null,
      ].filter(Boolean) as Tab[])
    : [];
  const [tab, setTab] = useState<Tab>(() =>
    readRoute() === 'perkey' && tabs.includes('perkey') ? 'perkey' : (tabs[0] ?? 'effects'),
  );
  if (!device) return null;
  return (
    <div className="page">
      <PageHeader
        title={t('nav.rgb')}
        lead={t(tab === 'perkey' ? 'perkey.lead' : tab === 'zones' ? 'zones.lead' : 'rgb.lead')}
      />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label={t('nav.rgb')}>
          {tabs.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              id={`tab-${x}`}
              aria-selected={tab === x}
              aria-controls={`panel-${x}`}
              className={`tab ${tab === x ? 'on' : ''}`}
              onClick={() => setTab(x)}
            >
              {t(
                x === 'perkey'
                  ? 'nav.perkey'
                  : x === 'zones'
                    ? 'feature.lightZones'
                    : 'rgb.effects',
              )}
            </button>
          ))}
        </div>
      )}
      {/* Both editors stay mounted so switching tabs never discards a local draft. */}
      {tabs.map((x) => (
        <div
          key={x}
          id={`panel-${x}`}
          role="tabpanel"
          aria-labelledby={`tab-${x}`}
          hidden={tab !== x}
          className="stack-page"
        >
          {x === 'perkey' ? <PerKeyStudio /> : x === 'zones' ? <ZonesStudio /> : <RgbStudio />}
        </div>
      ))}
    </div>
  );
}
