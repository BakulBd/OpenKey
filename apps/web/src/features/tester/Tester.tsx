import { useEffect, useRef, useState } from 'react';
import { domCodeToUsage, usageName } from '@openkey/core';
import type { KeyboardLayout } from '@openkey/core';
import { LAYOUTS } from '@openkey/devices';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, KV, PageHeader } from '../../components/ui.js';
import { KeyboardView } from '../../components/KeyboardView.js';

interface Row {
  code: string;
  key: string;
  usage?: number;
  downAt: number;
  upAt?: number;
  repeats: number;
  mods: string;
}

const MAX_ROWS = 50;
const DOUBLE_ESC_MS = 600;

/**
 * Keyboard tester. Captures key events only between an explicit Start and Stop, only while this tab
 * is focused, and keeps them in memory on this page. Nothing is stored or sent.
 */
export default function Tester() {
  const t = useT();
  const { device } = useKeyboard();
  const [active, setActive] = useState(false);
  const [held, setHeld] = useState<Set<number>>(new Set());
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState<Row[]>([]);
  const [layoutId, setLayoutId] = useState(Object.keys(LAYOUTS)[0]!);
  const lastEsc = useRef(0);
  const layout: KeyboardLayout = device?.driver.getLayout() ?? LAYOUTS[layoutId]!;

  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape' && !e.repeat) {
        if (e.timeStamp - lastEsc.current < DOUBLE_ESC_MS) return setActive(false);
        lastEsc.current = e.timeStamp;
      }
      const usage = domCodeToUsage(e.code);
      if (e.repeat) {
        setRows((rs) => rs.map((r, i) => (i === 0 && r.code === e.code && r.upAt === undefined ? { ...r, repeats: r.repeats + 1 } : r)));
        return;
      }
      if (usage !== undefined) {
        setHeld((h) => new Set(h).add(usage));
        setSeen((s) => new Set(s).add(usage));
      }
      const mods = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean).join('+');
      setRows((rs) => [{ code: e.code, key: e.key, ...(usage !== undefined ? { usage } : {}), downAt: e.timeStamp, repeats: 0, mods }, ...rs].slice(0, MAX_ROWS));
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      const usage = domCodeToUsage(e.code);
      if (usage !== undefined)
        setHeld((h) => {
          const n = new Set(h);
          n.delete(usage);
          return n;
        });
      setRows((rs) => {
        const i = rs.findIndex((r) => r.code === e.code && r.upAt === undefined);
        return i < 0 ? rs : rs.map((r, j) => (j === i ? { ...r, upAt: e.timeStamp } : r));
      });
    };
    // Leaving the tab stops the test: nothing is captured in the background.
    const stop = () => setActive(false);
    const vis = () => document.hidden && stop();
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    addEventListener('blur', stop);
    document.addEventListener('visibilitychange', vis);
    return () => {
      removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
      removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', vis);
      setHeld(new Set());
    };
  }, [active]);

  const durations = rows.filter((r) => r.upAt !== undefined).map((r) => r.upAt! - r.downAt);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;
  const coverage = layout.keys.filter((k) => k.usage != null && seen.has(k.usage)).length;
  const testable = layout.keys.filter((k) => k.usage != null).length;

  return (
    <div className="page">
      <PageHeader
        title={t('nav.tester')}
        lead={t('tester.lead')}
        actions={
          <>
            <button type="button" className={`btn ${active ? 'danger' : 'primary'}`} aria-pressed={active} onClick={() => setActive(!active)}>
              {active ? t('tester.stop') : t('tester.start')}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setRows([]);
                setSeen(new Set());
              }}
            >
              {t('tester.reset')}
            </button>
          </>
        }
      />
      <div className={`callout ${active ? 'warn' : 'info'} small`} role="status">
        {active ? t('tester.active') : t('tester.idle')}
      </div>
      {!device && (
        <label className="field inline">
          <span className="field-label">{t('tester.layout')}</span>
          <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
            {Object.entries(LAYOUTS).map(([id, l]) => (
              <option key={id} value={id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Card>
        <KeyboardView
            scrollHint={t('kb.scrollHint')}
          layout={layout}
          label={t('tester.boardLabel')}
          pressed={(k) => k.usage != null && held.has(k.usage)}
          fill={(k) => (k.usage != null && seen.has(k.usage) ? 'var(--tested)' : undefined)}
        />
        <p className="small muted">{t('tester.coverage', { n: coverage, total: testable })}</p>
      </Card>
      <div className="grid2">
        <Card title={t('tester.events')}>
          <div className="table-wrap">
            <table className="tbl small">
              <thead>
                <tr>
                  <th scope="col">{t('tester.col.key')}</th>
                  <th scope="col">{t('tester.col.usage')}</th>
                  <th scope="col">{t('tester.col.mods')}</th>
                  <th scope="col">{t('tester.col.held')}</th>
                  <th scope="col">{t('tester.col.repeats')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.downAt}-${i}`}>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td>{r.usage !== undefined ? `0x${r.usage.toString(16).padStart(2, '0')} ${usageName(0x07, r.usage)}` : '—'}</td>
                    <td>{r.mods || '—'}</td>
                    <td>{r.upAt !== undefined ? `${(r.upAt - r.downAt).toFixed(1)} ms` : t('tester.down')}</td>
                    <td>{r.repeats || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={t('tester.summary')}>
          <KV
            rows={[
              [t('tester.presses'), String(rows.length)],
              [t('tester.avgHeld'), Number.isNaN(avg) ? '—' : `${avg.toFixed(1)} ms`],
              [t('tester.analog'), device?.caps.analog.read === 'device' ? t('status.SUPPORTED') : t('tester.noAnalog')],
            ]}
          />
          <p className="small muted">{t('tester.note')}</p>
        </Card>
      </div>
    </div>
  );
}
