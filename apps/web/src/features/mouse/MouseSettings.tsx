import { useEffect, useState } from 'react';
import type { Transaction } from '@openkey/core';
import type { yjxMouse } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, KV, Loading, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

type Config = yjxMouse.YjxMouseConfig;

interface MouseHost {
  getMouseConfig(): Promise<Config>;
  setMouseConfig(patch: Partial<Config>): Promise<void>;
  getBattery(): Promise<{ level: number; charging: boolean } | null>;
}

const RATES = [125, 250, 500, 1000, 2000];
const SLEEP = [1, 3, 5, 10, 20, 30, 60];
const KEYS: (keyof Config)[] = [
  'debounceMs',
  'pollingRate',
  'dpi',
  'dpiCount',
  'dpiIndex',
  'sleepMinutes',
  'wakeOnClick',
  'scrollInverted',
];

/**
 * Gaming-mouse settings (AJAZZ AJ139 V2 MC): debounce, polling rate, DPI levels, sleep and wake-up.
 * Read from the mouse, written as one settings block with only the changed fields replaced, and
 * read back.
 */
export default function MouseSettings() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const host = device?.driver as unknown as MouseHost | undefined;
  const [applied, setApplied] = useState<Config | null>(null);
  const [c, setC] = useState<Config | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  useEffect(() => {
    if (!host?.getMouseConfig) return;
    void read(t('mouse.read'), () => host.getMouseConfig()).then((v) => {
      if (!v) return;
      setApplied(v);
      setC(v);
    });
    void read(t('mouse.battery'), () => host.getBattery(), { quiet: true }).then(
      (b) => b && setBattery(b.level),
    );
  }, [host, read, t]);
  const changed =
    c && applied ? KEYS.filter((k) => JSON.stringify(c[k]) !== JSON.stringify(applied[k])) : [];
  const track = useChangeTracking('mouse', ['debounce', 'pollingRate'], changed.length);
  if (!device || !host?.getMouseConfig) return null;
  if (!c || !applied) return <Loading />;
  const set = (patch: Partial<Config>) => setC({ ...c, ...patch });

  const write = async () => {
    const patch = Object.fromEntries(changed.map((k) => [k, c[k]])) as Partial<Config>;
    const tx: Transaction<Config> = {
      label: t('mouse.apply'),
      acknowledged: true,
      apply: () => host.setMouseConfig(patch),
      readbackFromDevice: () => host.getMouseConfig(),
    };
    const r = await apply('debounce', tx, applied, c);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(c);
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.mouse')} lead={t('mouse.lead')} />
      <div className="row wrap between">
        <SourceNote source="device" />
        <WriteGateNote gate={gate('debounce')} />
      </div>
      <div className="grid2">
        <Card title={t('mouse.response')}>
          <Field label={t('mouse.debounce', { v: c.debounceMs })} hint={t('mouse.debounceHint')}>
            <input
              type="range"
              min={1}
              max={20}
              value={c.debounceMs}
              onChange={(e) => set({ debounceMs: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('mouse.rate')}>
            <select
              value={c.pollingRate}
              onChange={(e) => set({ pollingRate: Number(e.target.value) })}
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r} Hz
                </option>
              ))}
            </select>
          </Field>
        </Card>
        <Card title={t('mouse.power')}>
          <Field label={t('mouse.sleep')}>
            <select
              value={c.sleepMinutes}
              onChange={(e) => set({ sleepMinutes: Number(e.target.value) })}
            >
              {SLEEP.map((m) => (
                <option key={m} value={m}>
                  {t('mouse.minutes', { n: m })}
                </option>
              ))}
            </select>
          </Field>
          <Toggle
            label={t('mouse.wakeClick')}
            checked={c.wakeOnClick}
            onChange={(on) => set({ wakeOnClick: on })}
          />
          <Toggle
            label={t('mouse.scroll')}
            checked={c.scrollInverted}
            onChange={(on) => set({ scrollInverted: on })}
          />
          <KV rows={[[t('mouse.batteryLevel'), battery !== null ? `${battery}%` : '—']]} />
        </Card>
      </div>
      <Card title={t('mouse.dpi')}>
        <div className="dpi-levels">
          {c.dpi.map((d, i) => (
            <label
              key={i}
              className={`dpi-level ${i === c.dpiIndex ? 'on' : ''} ${i >= c.dpiCount ? 'off' : ''}`}
            >
              <span className="small">{t('mouse.level', { n: i + 1 })}</span>
              <input
                type="number"
                min={50}
                max={26000}
                step={50}
                value={d}
                onChange={(e) =>
                  set({ dpi: c.dpi.map((x, j) => (j === i ? Number(e.target.value) : x)) })
                }
              />
            </label>
          ))}
        </div>
        <div className="form-grid">
          <Field label={t('mouse.levels')}>
            <select
              value={c.dpiCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                set({ dpiCount: n, dpiIndex: Math.min(c.dpiIndex, n - 1) });
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('mouse.active')}>
            <select value={c.dpiIndex} onChange={(e) => set({ dpiIndex: Number(e.target.value) })}>
              {c.dpi.slice(0, c.dpiCount).map((d, i) => (
                <option key={i} value={i}>
                  {t('mouse.level', { n: i + 1 })} · {d} DPI
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="small muted">{t('mouse.linkNote')}</p>
      </Card>
      <ChangeBar
        status={track.status}
        count={changed.length}
        verifies
        canApply={gate('debounce').decision.kind !== 'blocked'}
        busy={track.busy}
        onDiscard={() => {
          setC(applied);
          track.discarded();
        }}
        onApply={() => void write()}
        applyLabel={t('common.apply')}
      />
    </div>
  );
}
