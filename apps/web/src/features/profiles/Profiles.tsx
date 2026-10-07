import { useEffect, useState } from 'react';
import { collectBackup, planRestore, restoreBackup, validateBackup } from '@openkey/core';
import type { Backup, BackupSection, TxResult } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Empty, PageHeader, download } from '../../components/ui.js';
import { deleteRecord, listRecords, newId, saveRecord } from '../../state/db.js';
import type { StoredRecord } from '../../state/db.js';
import { APP_VERSION } from '../../config.js';

export const PROFILE_TEMPLATES = ['coding', 'gaming', 'writing', 'streaming', 'mac', 'windows', 'custom'] as const;
export type ProfileTemplate = (typeof PROFILE_TEMPLATES)[number];

export interface ProfileData {
  template: ProfileTemplate;
  model: string;
  profileId: string;
  backup: Backup;
}

const SECTION_FEATURE = { keymap: 'keymap', fnLayers: 'fnLayer', rgb: 'rgb', perKeyRgb: 'perKeyRgb', macros: 'macros', settings: 'sleep' } as const;

/**
 * Profiles are named snapshots of a keyboard's configuration kept in this browser. A template only
 * names the purpose; OpenKey does not invent keymaps for it. Applying a profile is a restore and
 * goes through the same diff, safety gate and verification.
 */
export default function Profiles() {
  const t = useT();
  const { device, read, confirmWrite, writing, notify } = useKeyboard();
  const [records, setRecords] = useState<StoredRecord<ProfileData>[]>([]);
  const [template, setTemplate] = useState<ProfileTemplate>('coding');
  const [name, setName] = useState('');
  const [results, setResults] = useState<{ section: BackupSection; result: TxResult<unknown> }[]>([]);
  const focusId = location.hash.split('?')[1];

  const refresh = () => void listRecords<ProfileData>('profile').then(setRecords);
  useEffect(refresh, []);

  const capture = async () => {
    if (!device) return;
    const b = await read(t('profiles.capture'), (d) => collectBackup(d, { createdBy: 'OpenKey profiles', appVersion: APP_VERSION }));
    if (!b) return;
    await saveRecord<ProfileData>({
      id: newId(),
      kind: 'profile',
      name: name.trim() || t(`profiles.template.${template}`),
      data: { template, model: device.info.model, profileId: device.info.profileId, backup: b },
    });
    setName('');
    refresh();
    notify({ kind: 'ok', title: t('profiles.saved') });
  };

  const activate = async (r: StoredRecord<ProfileData>) => {
    if (!device) return;
    const v = validateBackup(r.data.backup);
    if (!v.backup) return notify({ kind: 'error', title: t('profiles.invalid'), detail: v.errors.join('; ') });
    const plan = planRestore(v.backup, device.info, device.caps);
    if (!plan.compatible) return notify({ kind: 'error', title: t('profiles.incompatible'), detail: plan.blocked.join(' ') });
    for (const s of plan.sections) if (s !== 'tft' && !(await confirmWrite(SECTION_FEATURE[s], t('profiles.activate', { name: r.name })))) return;
    const res = await writing(t('profiles.activate', { name: r.name }), (d) => restoreBackup(d, v.backup!, plan));
    if (res) setResults(res);
  };

  const deviceProfiles = device?.caps.profiles;

  return (
    <div className="page">
      <PageHeader title={t('nav.profiles')} lead={t('profiles.lead')} />
      <div className="callout info small">
        {deviceProfiles && deviceProfiles.status !== 'UNKNOWN' && deviceProfiles.write ? t('profiles.hardware') : t('profiles.localOnly')}
      </div>
      {device ? (
        <Card title={t('profiles.new')}>
          <div className="row wrap">
            <label className="field">
              <span className="field-label">{t('profiles.templateLabel')}</span>
              <select value={template} onChange={(e) => setTemplate(e.target.value as ProfileTemplate)}>
                {PROFILE_TEMPLATES.map((p) => (
                  <option key={p} value={p}>
                    {t(`profiles.template.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('profiles.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`profiles.template.${template}`)} />
            </label>
            <button type="button" className="btn primary" onClick={() => void capture()}>
              {t('profiles.capture')}
            </button>
          </div>
          <p className="small muted">{t('profiles.captureHelp')}</p>
        </Card>
      ) : (
        <p className="muted">{t('profiles.connectToCapture')}</p>
      )}
      <Card title={t('profiles.saved.list')}>
        {records.length === 0 ? (
          <Empty>{t('profiles.none')}</Empty>
        ) : (
          <ul className="record-list">
            {records.map((r) => (
              <li key={r.id} className={r.id === focusId ? 'focus' : ''}>
                <span>
                  <strong>{r.name}</strong> <span className="muted small">{t(`profiles.template.${r.data.template}`)} · {r.data.model} · {new Date(r.updatedAt).toLocaleString()}</span>
                </span>
                <button type="button" className="btn small" disabled={!device || device.info.profileId !== r.data.profileId} onClick={() => void activate(r)} title={device && device.info.profileId !== r.data.profileId ? t('profiles.otherModel') : undefined}>
                  {t('profiles.apply')}
                </button>
                <button type="button" className="btn ghost tiny" onClick={() => download(`openkey-profile-${r.name}.json`, r.data.backup)}>
                  {t('backup.downloadShort')}
                </button>
                <button type="button" className="btn ghost tiny" onClick={() => void deleteRecord(r.id).then(refresh)} aria-label={t('common.remove')}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {results.length > 0 && (
        <Card title={t('backup.results')}>
          <ul className="results">
            {results.map((r) => (
              <li key={r.section}>
                <span className={`pill tx-${r.result.outcome.toLowerCase()}`}>{t(`txshort.${r.result.outcome}`)}</span> {r.section}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
