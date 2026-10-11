import { useEffect, useState } from 'react';
import { collectBackup, diffBackups, formatDiffValue, planRestore, restoreBackup, validateBackup } from '@openkey/core';
import type { Backup, BackupChange, BackupSection, RestorePlan, TxResult } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, FileButton, PageHeader, download } from '../../components/ui.js';
import { Dialog } from '../../components/Dialog.js';
import { APP_VERSION } from '../../config.js';
import { deleteRecord, listRecords, newId, saveRecord } from '../../state/db.js';
import type { StoredRecord } from '../../state/db.js';

const SECTION_FEATURE: Record<Exclude<BackupSection, 'tft'>, 'keymap' | 'fnLayer' | 'rgb' | 'perKeyRgb' | 'macros' | 'sleep'> = {
  keymap: 'keymap',
  fnLayers: 'fnLayer',
  rgb: 'rgb',
  perKeyRgb: 'perKeyRgb',
  macros: 'macros',
  settings: 'sleep',
};

/**
 * Backup and restore. Restore always follows: import → validate → compare → diff → confirm → write →
 * read back → verify (per section, through the safety gate).
 */
export default function BackupRestore() {
  const t = useT();
  const { device, read, gate, notify, confirmWrite, writing } = useKeyboard();
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [changes, setChanges] = useState<BackupChange[]>([]);
  const [current, setCurrent] = useState<Backup | null>(null);
  const [messages, setMessages] = useState<{ kind: 'error' | 'warn'; text: string }[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [results, setResults] = useState<{ section: BackupSection; result: TxResult<unknown> }[]>([]);
  const [stored, setStored] = useState<StoredRecord<Backup>[]>([]);

  const refresh = () => void listRecords<Backup>('backup').then(setStored);
  useEffect(refresh, []);
  if (!device) return null;

  const writer = { createdBy: 'OpenKey web', appVersion: APP_VERSION, descriptorSignature: device.fingerprint.descriptorSignature, adapter: { id: device.detection.selected!.protocolId, version: device.manifest.version, family: device.fingerprint.protocolFamily ?? 'unknown' } };

  const create = async (keepLocal: boolean) => {
    const b = await read(t('backup.create'), (d) => collectBackup(d, writer));
    if (!b) return null;
    if (keepLocal) {
      await saveRecord({ id: newId(), kind: 'backup', name: `${b.device.model} — ${new Date(b.createdAt).toLocaleString()}`, data: b });
      refresh();
    }
    return b;
  };

  const load = async (doc: unknown) => {
    setResults([]);
    const v = validateBackup(doc);
    setMessages([...v.errors.map((text) => ({ kind: 'error' as const, text })), ...v.warnings.map((text) => ({ kind: 'warn' as const, text }))]);
    if (!v.backup) {
      setIncoming(null);
      setPlan(null);
      return;
    }
    setIncoming(v.backup);
    setPlan(planRestore(v.backup, device.info, device.caps));
    const cur = await read(t('backup.readCurrent'), (d) => collectBackup(d, writer));
    setCurrent(cur ?? null);
    setChanges(cur ? diffBackups(cur, v.backup) : []);
  };

  const restore = async () => {
    setConfirm(false);
    if (!incoming || !plan) return;
    // Pre-restore backup, kept locally, so a restore can itself be undone.
    await create(true);
    // Every section passes the same safety gate as a manual edit.
    for (const s of plan.sections) {
      if (s === 'tft') continue;
      if (!(await confirmWrite(SECTION_FEATURE[s], t('backup.gate', { section: s })))) return notify({ kind: 'info', title: t('backup.cancelled') });
    }
    const r = await writing(t('backup.restore'), (d) => restoreBackup(d, incoming, plan, current ?? undefined));
    if (r) setResults(r);
  };

  const sectionOk = plan?.sections.filter((s) => s !== 'tft' && gate(SECTION_FEATURE[s]).decision.kind !== 'blocked') ?? [];

  return (
    <div className="page">
      <PageHeader title={t('nav.backup')} lead={t('backup.lead')} />
      <div className="grid2">
        <Card title={t('backup.export')}>
          <p>{t('backup.exportHelp')}</p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => void create(false).then((b) => b && download(`openkey-${b.device.profileId}-${b.createdAt.slice(0, 10)}.json`, b))}>
              {t('backup.download')}
            </button>
            <button type="button" className="btn" onClick={() => void create(true).then((b) => b && notify({ kind: 'ok', title: t('backup.savedLocal') }))}>
              {t('backup.saveLocal')}
            </button>
          </div>
        </Card>
        <Card title={t('backup.import')}>
          <FileButton
            label={t('backup.chooseFile')}
            accept="application/json,.json"
            onFile={async (f) => {
              try {
                await load(JSON.parse(await f.text()));
              } catch {
                setMessages([{ kind: 'error', text: t('backup.notJson') }]);
              }
            }}
          />
          <p className="small muted">{t('backup.importHelp')}</p>
          {stored.length > 0 && (
            <ul className="record-list">
              {stored.map((r) => (
                <li key={r.id}>
                  <span>{r.name}</span>
                  <button type="button" className="btn ghost tiny" onClick={() => void load(r.data)}>
                    {t('backup.use')}
                  </button>
                  <button type="button" className="btn ghost tiny" onClick={() => download(`${r.name}.json`, r.data)}>
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
      </div>

      {messages.length > 0 && (
        <ul className="msgs">
          {messages.map((m) => (
            <li key={m.text} className={m.kind === 'error' ? 'error-text' : 'muted'}>
              {m.text}
            </li>
          ))}
        </ul>
      )}

      {incoming && plan && (
        <Card title={t('backup.compare')}>
          <p>{t('backup.summary', { model: incoming.device.model, date: new Date(incoming.createdAt).toLocaleString(), adapter: incoming.adapter.id })}</p>
          {plan.blocked.map((b) => (
            <p key={b} className="callout danger">
              {b}
            </p>
          ))}
          {plan.warnings.map((w) => (
            <p key={w} className="small muted">
              {w}
            </p>
          ))}
          <p>
            {t('backup.sections')}: <strong>{sectionOk.join(', ') || t('common.none')}</strong>
          </p>
          <div className="table-wrap">
            <table className="tbl diff">
              <caption className="small muted">{t('backup.changes', { n: changes.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('backup.col.path')}</th>
                  <th scope="col">{t('keymap.col.before')}</th>
                  <th scope="col">{t('keymap.col.after')}</th>
                </tr>
              </thead>
              <tbody>
                {changes.slice(0, 200).map((c, i) => (
                  <tr key={i}>
                    <th scope="row" className="mono">
                      {c.path}
                    </th>
                    <td className="del">{formatDiffValue(c.before)}</td>
                    <td className="ins">{formatDiffValue(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn primary" disabled={!plan.compatible || sectionOk.length === 0} onClick={() => setConfirm(true)}>
            {t('backup.restoreBtn')}
          </button>
        </Card>
      )}

      {results.length > 0 && (
        <Card title={t('backup.results')}>
          <ul className="results">
            {results.map((r) => (
              <li key={r.section}>
                <span className={`pill tx-${r.result.outcome.toLowerCase()}`}>{t(`txshort.${r.result.outcome}`)}</span> {r.section} — <span className="small muted">{r.result.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm && (
        <Dialog
          title={t('backup.confirmTitle')}
          tone="warn"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" onClick={() => void restore()}>
                {t('backup.restoreBtn')}
              </button>
            </>
          }
        >
          <p>{t('backup.confirmBody', { n: changes.length, sections: sectionOk.join(', ') })}</p>
          <p className="small muted">{t('backup.preRestore')}</p>
        </Dialog>
      )}
    </div>
  );
}
