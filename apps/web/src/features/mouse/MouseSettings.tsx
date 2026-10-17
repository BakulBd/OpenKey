import { useEffect, useMemo, useState } from 'react';
import { isMouseDriver } from '@openkey/core';
import type { MouseSettings as Settings, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Card, Field, KV, Loading, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

const KEYS: (keyof Settings)[] = [
  'debounceMs',
  'pollingRate',
  'dpi',
  'dpiCount',
  'dpiIndex',
  'sleep',
  'flags',
  'liftOff',
];

/** Translated labels for the on/off settings mouse adapters declare; others use the adapter's label. */
const FLAG_KEYS: Record<string, MessageKey> = {
  wakeOnClick: 'mouse.wakeClick',
  scrollInverted: 'mouse.scroll',
  wakeOnMove: 'mouse.flag.wakeOnMove',
  lightsOffOnMove: 'mouse.flag.lightsOffOnMove',
  motionSync: 'mouse.flag.motionSync',
  angleSnap: 'mouse.flag.angleSnap',
};

/**
 * Gaming-mouse settings for any mouse adapter: debounce, polling rate, DPI levels, sleep, lift-off
 * and the mouse's own on/off settings, as its schema describes them. Read from the mouse, written
 * with only the changed fields, and read back.
 */
export default function MouseSettings() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const host = isMouseDriver(device?.driver) ? device.driver : undefined;
  const schema = useMemo(() => host?.getMouseSchema(), [host]);
  const [applied, setApplied] = useState<Settings | null>(null);
  const [c, setC] = useState<Settings | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  useEffect(() => {
    if (!host) return;
    void read(t('mouse.read'), () => host.getMouseSettings()).then((v) => {
      if (!v) return;
      setApplied(v);
      setC(v);
    });
    if (device?.caps.battery.read !== 'none')
      void read(t('mouse.battery'), (d) => d.getBattery(), { quiet: true }).then(
        (b) => b && setBattery(b.level),
      );
  }, [host, device, read, t]);
  const changed =
    c && applied ? KEYS.filter((k) => JSON.stringify(c[k]) !== JSON.stringify(applied[k])) : [];
  const track = useChangeTracking('mouse', ['debounce', 'pollingRate'], changed.length);
  if (!device || !host || !schema) return null;
  if (!c || !applied) return <Loading />;
  const set = (patch: Partial<Settings>) => setC({ ...c, ...patch });

  const write = async () => {
    const patch = Object.fromEntries(changed.map((k) => [k, c[k]])) as Partial<Settings>;
    const tx: Transaction<Settings> = {
      label: t('mouse.apply'),
      acknowledged: true,
      apply: () => host.setMouseSettings(patch),
      readbackFromDevice: () => host.getMouseSettings(),
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
              min={schema.debounceMs.min}
              max={schema.debounceMs.max}
              value={c.debounceMs}
              onChange={(e) => set({ debounceMs: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('mouse.rate')}>
            <select
              value={c.pollingRate}
              onChange={(e) => set({ pollingRate: Number(e.target.value) })}
            >
              {schema.pollingRates.map((r) => (
                <option key={r} value={r}>
                  {r} Hz
                </option>
              ))}
            </select>
          </Field>
          {schema.liftOff && (
            <Field label={t('mouse.liftOff')}>
              <select value={c.liftOff} onChange={(e) => set({ liftOff: Number(e.target.value) })}>
                {schema.liftOff.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Card>
        <Card title={t('mouse.power')}>
          <Field label={t('mouse.sleep')}>
            <select value={c.sleep} onChange={(e) => set({ sleep: Number(e.target.value) })}>
              {schema.sleep.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {schema.flags.map((f) => (
            <Toggle
              key={f.id}
              label={FLAG_KEYS[f.id] ? t(FLAG_KEYS[f.id]!) : f.label}
              checked={!!c.flags[f.id]}
              onChange={(on) => set({ flags: { ...c.flags, [f.id]: on } })}
            />
          ))}
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
                min={schema.dpi.min}
                max={schema.dpi.max}
                step={schema.dpi.step}
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
              {Array.from({ length: schema.dpi.levels }, (_, i) => i + 1).map((n) => (
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
        <p className="small muted">{t(schema.perLink ? 'mouse.linkNote' : 'mouse.sharedNote')}</p>
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
