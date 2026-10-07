import { useEffect, useState } from 'react';
import type { SystemSettings } from '@openkey/core';
import { useKeyboard } from '../state/keyboard.js';
import { Card, Field, MirrorNote } from '../components/ui.js';

export function DevicePage() {
  const { conn, run } = useKeyboard();
  const [s, setS] = useState<SystemSettings | null>(null);
  useEffect(() => {
    void run('Read settings', (d) => d.getSystemSettings(), { quiet: true }).then(
      (x) => x && setS(x),
    );
  }, [run]);
  if (!conn) return null;
  const schema = conn.driver.getSettingsSchema();
  const caps = conn.caps;
  return (
    <div className="page">
      <Card title="Identity">
        <dl className="kv">
          {conn.info.fields.map((f) => (
            <div key={f.key} className="kv-row">
              <dt>{f.label}</dt>
              <dd>
                {String(f.value)} <span className="dim">({f.source})</span>
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      {s && (caps.sleep.write || (caps.winLock.write || caps.altLocks.write) || caps.gameMode.write) && (
        <Card
          title="Keyboard settings"
          actions={
            <button
              className="primary"
              onClick={() =>
                void run('Write settings', (d) => d.setSystemSettings(s), { write: true })
              }
            >
              Apply
            </button>
          }
        >
          {caps.sleep.read === 'mirror' && <MirrorNote />}
          <div className="form-grid">
            {schema.sleepTime && (
              <Field label="Sleep after">
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
              <Field
                label="Key response (debounce)"
                hint="Lower is faster; raise it if keys chatter."
              >
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
            {(caps.winLock.write || caps.altLocks.write) && (
              <>
                <Field label="Disable Windows key">
                  <input
                    type="checkbox"
                    checked={!!s.disableWinKey}
                    onChange={(e) => setS({ ...s, disableWinKey: e.target.checked })}
                  />
                </Field>
                <Field label="Disable Alt+Tab">
                  <input
                    type="checkbox"
                    checked={!!s.disableAltTab}
                    onChange={(e) => setS({ ...s, disableAltTab: e.target.checked })}
                  />
                </Field>
                <Field label="Disable Alt+F4">
                  <input
                    type="checkbox"
                    checked={!!s.disableAltF4}
                    onChange={(e) => setS({ ...s, disableAltF4: e.target.checked })}
                  />
                </Field>
              </>
            )}
            {caps.gameMode.write && (
              <Field label="Game mode">
                <input
                  type="checkbox"
                  checked={!!s.gameMode}
                  onChange={(e) => setS({ ...s, gameMode: e.target.checked })}
                />
              </Field>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
