import { useEffect, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import { onUpdateReady, applyUpdate } from '../pwa.js';

/** Shown when a new version was downloaded by the service worker; the user decides when to reload. */
export function UpdateBanner() {
  const t = useT();
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      {t('pwa.updateReady')}
      <button type="button" className="btn small primary" onClick={applyUpdate}>
        {t('pwa.reload')}
      </button>
    </div>
  );
}
