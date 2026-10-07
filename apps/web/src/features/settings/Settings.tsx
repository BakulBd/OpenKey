import { useState } from 'react';
import { useKeyboard } from '../../state/keyboard.js';
import { LOCALES, useI18n } from '../../i18n/i18n.js';
import { Card, Field, KV, PageHeader, download } from '../../components/ui.js';
import { Dialog } from '../../components/Dialog.js';
import { clearAll, exportAll, importAll } from '../../state/db.js';
import { clearPrefs } from '../../state/prefs.js';
import { setTheme, themePref } from '../../state/theme.js';
import type { ThemePref } from '../../state/theme.js';
import { APP_VERSION, REPO_URL } from '../../config.js';

export default function Settings() {
  const { t, locale, setLocale, coverage } = useI18n();
  const { experimental, setExperimental, notify, support } = useKeyboard();
  const [theme, setThemeState] = useState<ThemePref>(themePref());
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="page">
      <PageHeader title={t('nav.settings')} />
      <div className="grid2">
        <Card title={t('settings.appearance')}>
          <Field label={t('settings.language')} hint={locale === 'en' ? undefined : t('settings.coverage', { pct: Math.round(coverage * 100) })}>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.theme')}>
            <select
              value={theme}
              onChange={(e) => {
                const v = e.target.value as ThemePref;
                setThemeState(v);
                setTheme(v);
              }}
            >
              <option value="system">{t('settings.theme.system')}</option>
              <option value="light">{t('settings.theme.light')}</option>
              <option value="dark">{t('settings.theme.dark')}</option>
            </select>
          </Field>
        </Card>
        <Card title={t('settings.safety')}>
          <label className="check">
            <input type="checkbox" checked={experimental} onChange={(e) => setExperimental(e.target.checked)} />
            {t('settings.experimental')}
          </label>
          <p className="small muted">{t('settings.experimentalHelp')}</p>
        </Card>
        <Card title={t('settings.data')}>
          <p className="small">{t('settings.dataHelp')}</p>
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => void exportAll().then((d) => download(`openkey-local-data-${new Date().toISOString().slice(0, 10)}.json`, d))}>
              {t('settings.exportAll')}
            </button>
            <label className="btn ghost file-btn">
              {t('settings.importAll')}
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const r = await importAll(JSON.parse(await f.text()));
                    notify({ kind: 'ok', title: t('settings.imported', { records: r.records, mirror: r.mirror }) });
                  } catch (err) {
                    notify({ kind: 'error', title: t('settings.importFailed'), detail: err instanceof Error ? err.message : String(err) });
                  }
                }}
              />
            </label>
            <button type="button" className="btn danger" onClick={() => setConfirmClear(true)}>
              {t('settings.clear')}
            </button>
          </div>
        </Card>
        <Card title={t('settings.about')}>
          <KV
            rows={[
              [t('settings.version'), APP_VERSION],
              [t('settings.webhid'), support.available ? t('compat.yes') : t('compat.no')],
              [t('settings.telemetry'), t('settings.none')],
              [t('settings.source'), <a key="r" href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL.replace('https://', '')}</a>],
            ]}
          />
        </Card>
      </div>
      {confirmClear && (
        <Dialog
          title={t('settings.clearTitle')}
          tone="danger"
          onClose={() => setConfirmClear(false)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  void clearAll().then(() => {
                    clearPrefs();
                    setConfirmClear(false);
                    notify({ kind: 'ok', title: t('settings.cleared') });
                  })
                }
              >
                {t('settings.clear')}
              </button>
            </>
          }
        >
          <p>{t('settings.clearBody')}</p>
        </Dialog>
      )}
    </div>
  );
}
