import { useEffect, useState } from 'react';
import { deepEqual } from '@openkey/core';
import type { FeatureId, SystemSettings, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, KV, MirrorNote, PageHeader } from '../../components/ui.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

/** The capability whose policy governs a settings write: the first writable one, in risk order. */
const SETTINGS_FEATURES: FeatureId[] = ['sleep', 'keyResponse', 'winLock', 'altLocks', 'gameMode'];

export default function DeviceSettings() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const [applied, setApplied] = useState<SystemSettings | null>(null);
  const [s, setS] = useState<SystemSettings | null>(null);
  const writable = device ? SETTINGS_FEATURES.filter((f) => device.caps[f].write) : [];
  useEffect(() => {
    if (!writable.length) return;
    void read(t('device.read'), (d) => d.getSystemSettings()).then((x) => {
      if (!x) return;
      setApplied(x);
      setS(x);
    });
  }, [read, t, writable.length]);
  if (!device) return null;
  const schema = device.driver.getSettingsSchema();
  const caps = device.caps;
  const governing = writable[0];

  const doApply = async () => {
    if (!s || !applied || !governing) return;
    const tx: Transaction<SystemSettings> = {
      label: t('device.apply'),
      acknowledged: true,
      apply: (v) => device.driver.setSystemSettings(v),
      ...(caps[governing].read === 'device' ? { readbackFromDevice: () => device.driver.getSystemSettings() } : {}),
    };
    const r = await apply(governing, tx, applied, s);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(s);
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.deviceSettings')} lead={t('device.lead')} />
      <Card title={t('device.identity')}>
        <KV rows={device.info.fields.map((f) => [f.label, <span key={f.key}>{String(f.value)} <span className="muted small">({f.source})</span></span>])} />
      </Card>
      {governing && s && applied && (
        <Card
          title={t('device.settings')}
          actions={
            <>
              <button type="button" className="btn ghost" disabled={deepEqual(s, applied)} onClick={() => setS(applied)}>
                {t('common.discard')}
              </button>
              <button type="button" className="btn primary" disabled={deepEqual(s, applied)} onClick={() => void doApply()}>
                {t('common.apply')}
              </button>
            </>
          }
        >
          <WriteGateNote gate={gate(governing)} />
          {caps[governing].read === 'mirror' && <MirrorNote />}
          <div className="form-grid">
            {schema.sleepTime && caps.sleep.write && (
              <Field label={t('device.sleep')}>
                <select value={s.sleepTime ?? 0} onChange={(e) => setS({ ...s, sleepTime: Number(e.target.value) })}>
                  {schema.sleepTime.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {schema.keyResponseTime && caps.keyResponse.write && (
              <Field label={t('device.keyResponse')} hint={t('device.keyResponseHint')}>
                <select value={s.keyResponseTime ?? 1} onChange={(e) => setS({ ...s, keyResponseTime: Number(e.target.value) })}>
                  {schema.keyResponseTime.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {caps.winLock.write && (
              <Field label={t('device.winLock')}>
                <input type="checkbox" checked={!!s.disableWinKey} onChange={(e) => setS({ ...s, disableWinKey: e.target.checked })} />
              </Field>
            )}
            {caps.altLocks.write && (
              <>
                <Field label={t('device.altTab')}>
                  <input type="checkbox" checked={!!s.disableAltTab} onChange={(e) => setS({ ...s, disableAltTab: e.target.checked })} />
                </Field>
                <Field label={t('device.altF4')}>
                  <input type="checkbox" checked={!!s.disableAltF4} onChange={(e) => setS({ ...s, disableAltF4: e.target.checked })} />
                </Field>
              </>
            )}
            {caps.gameMode.write && (
              <Field label={t('device.gameMode')}>
                <input type="checkbox" checked={!!s.gameMode} onChange={(e) => setS({ ...s, gameMode: e.target.checked })} />
              </Field>
            )}
          </div>
        </Card>
      )}
      <Card title={t('device.fixed')}>
        <KV
          rows={(['pollingRate', 'battery', 'encoder'] as const)
            .filter((f) => caps[f].status !== 'UNKNOWN')
            .map((f) => [t(`feature.${f}`), <span key={f}>{caps[f].value ?? t(`status.${caps[f].status}`)} {caps[f].note && <span className="muted small">— {caps[f].note}</span>}</span>])}
        />
      </Card>
    </div>
  );
}
