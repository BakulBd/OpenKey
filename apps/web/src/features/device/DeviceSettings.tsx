import { useEffect, useState } from 'react';
import { deepEqual } from '@openkey/core';
import type { FeatureId, SystemSettings, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, KV, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

const KEYS: (keyof SystemSettings)[] = [
  'sleepTime',
  'keyResponseTime',
  'disableWinKey',
  'disableAltTab',
  'disableAltF4',
  'gameMode',
];

/** The capability whose policy governs a settings write: the first writable one, in risk order. */
const SETTINGS_FEATURES: FeatureId[] = ['sleep', 'keyResponse', 'winLock', 'altLocks', 'gameMode'];

export default function DeviceSettings() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const [applied, setApplied] = useState<SystemSettings | null>(null);
  const [s, setS] = useState<SystemSettings | null>(null);
  const writable = device ? SETTINGS_FEATURES.filter((f) => device.caps[f].write) : [];
  const changed = s && applied ? KEYS.filter((k) => !deepEqual(s[k], applied[k])).length : 0;
  const track = useChangeTracking('settings', writable, changed);
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
      ...(caps[governing].read === 'device'
        ? { readbackFromDevice: () => device.driver.getSystemSettings() }
        : {}),
    };
    const r = await apply(governing, tx, applied, s);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(s);
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.deviceSettings')} lead={t('device.lead')} />
      <Card title={t('device.identity')}>
        <KV rows={device.info.fields.map((f) => [f.label, String(f.value)])} />
        <details className="small sources">
          <summary>{t('device.sources')}</summary>
          <ul>
            {device.info.fields.map((f) => (
              <li key={f.key}>
                <strong>{f.label}:</strong> <span className="muted">{f.source}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
      {governing && s && applied && (
        <Card title={t('device.settings')}>
          <div className="row wrap between">
            <SourceNote source={caps[governing].read === 'device' ? 'device' : 'mirror'} />
            <WriteGateNote gate={gate(governing)} />
          </div>
          <div className="form-grid">
            {schema.sleepTime && caps.sleep.write && (
              <Field label={t('device.sleep')}>
                <select
                  value={s.sleepTime ?? 0}
                  onChange={(e) => setS({ ...s, sleepTime: Number(e.target.value) })}
                >
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
                <select
                  value={s.keyResponseTime ?? 1}
                  onChange={(e) => setS({ ...s, keyResponseTime: Number(e.target.value) })}
                >
                  {schema.keyResponseTime.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {(caps.winLock.write || caps.altLocks.write || caps.gameMode.write) && (
            <div className="toggle-list">
              {caps.winLock.write && (
                <Toggle
                  label={t('device.winLock')}
                  hint={t('device.winLockHint')}
                  checked={!!s.disableWinKey}
                  onChange={(on) => setS({ ...s, disableWinKey: on })}
                />
              )}
              {caps.altLocks.write && (
                <>
                  <Toggle
                    label={t('device.altTab')}
                    checked={!!s.disableAltTab}
                    onChange={(on) => setS({ ...s, disableAltTab: on })}
                  />
                  <Toggle
                    label={t('device.altF4')}
                    checked={!!s.disableAltF4}
                    onChange={(on) => setS({ ...s, disableAltF4: on })}
                  />
                </>
              )}
              {caps.gameMode.write && (
                <Toggle
                  label={t('device.gameMode')}
                  checked={!!s.gameMode}
                  onChange={(on) => setS({ ...s, gameMode: on })}
                />
              )}
            </div>
          )}
        </Card>
      )}
      {governing && s && applied && (
        <ChangeBar
          status={track.status}
          count={changed}
          verifies={caps[governing].read === 'device'}
          canApply={gate(governing).decision.kind !== 'blocked'}
          busy={track.busy}
          onDiscard={() => {
            setS(applied);
            track.discarded();
          }}
          onApply={() => void doApply()}
          applyLabel={t('common.apply')}
        />
      )}
      <Card title={t('device.fixed')}>
        <KV
          rows={(['pollingRate', 'battery', 'encoder'] as const)
            .filter((f) => caps[f].status !== 'UNKNOWN')
            .map((f) => [
              t(`feature.${f}`),
              <span key={f} className="fixed-value">
                {caps[f].value ?? t(`status.${caps[f].status}`)}
                {caps[f].note && <span className="muted small">{caps[f].note}</span>}
              </span>,
            ])}
        />
      </Card>
    </div>
  );
}
