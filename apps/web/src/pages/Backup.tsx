import { useState } from 'react';
import {
  applyBackup,
  collectBackup,
  diffBackups,
  planRestore,
  validateBackup,
} from '@openak820/core';
import type { Backup, BackupChange, RestorePlan } from '@openak820/core';
import { useKeyboard } from '../state/keyboard.js';
import { Card } from '../components/ui.js';

export function BackupPage() {
  const { conn, run } = useKeyboard();
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [changes, setChanges] = useState<BackupChange[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  if (!conn) return null;

  const exportBackup = async () => {
    const b = await run('Create backup', (d) => collectBackup(d, 'OpenAK820 web'), { quiet: true });
    if (!b) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `openak820-${b.device.profileId}-${b.createdAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (f: File) => {
    const v = validateBackup(JSON.parse(await f.text()));
    setMessages([...v.errors.map((e) => `error: ${e}`), ...v.warnings.map((w) => `warning: ${w}`)]);
    if (!v.backup) {
      setIncoming(null);
      setPlan(null);
      return;
    }
    setIncoming(v.backup);
    const p = planRestore(v.backup, conn.info, conn.caps);
    setPlan(p);
    const current = await run('Read current state', (d) => collectBackup(d), { quiet: true });
    setChanges(current ? diffBackups(current, v.backup) : []);
  };

  return (
    <div className="page">
      <Card title="Export">
        <p>
          Saves everything the keyboard reports plus what OpenAK820 remembers writing (marked per
          section) to a JSON file.
        </p>
        <button className="primary" onClick={() => void exportBackup()}>
          Export backup
        </button>
      </Card>
      <Card title="Import / restore">
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}
        />
        {messages.length > 0 && (
          <ul className="msgs">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {incoming && plan && (
          <>
            <p>
              Backup of <strong>{incoming.device.model}</strong> from{' '}
              {new Date(incoming.createdAt).toLocaleString()} ({incoming.protocol.id}).
            </p>
            {plan.blocked.map((b) => (
              <p key={b} className="error-text">
                {b}
              </p>
            ))}
            {plan.warnings.map((w) => (
              <p key={w} className="note">
                {w}
              </p>
            ))}
            <p>Sections to restore: {plan.sections.join(', ') || 'none'}</p>
            <details>
              <summary>Preview {changes.length} change(s)</summary>
              <ul className="changes mono">
                {changes.slice(0, 200).map((c, i) => (
                  <li key={i}>
                    {c.path}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                  </li>
                ))}
              </ul>
            </details>
            <button
              className="primary"
              disabled={!plan.compatible || plan.sections.length === 0}
              onClick={async () => {
                const pre = await run(
                  'Pre-restore backup',
                  (d) => collectBackup(d, 'OpenAK820 web (pre-restore)'),
                  { quiet: true },
                );
                if (pre) {
                  try {
                    localStorage.setItem('openak820.lastPreRestoreBackup', JSON.stringify(pre));
                  } catch {
                    /* ignore */
                  }
                }
                await run('Restore backup', (d) => applyBackup(d, incoming, plan), { write: true });
              }}
            >
              Apply backup
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
