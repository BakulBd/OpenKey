import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@openkey/core';
import type { via } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

type Menu = via.CustomMenu;
type Control = via.MenuControl;
type Values = Record<string, number[]>;

interface MenuHost {
  getMenus(): readonly Menu[];
  readMenuValues(): Promise<Values>;
  writeMenuValues(values: Values): Promise<void>;
}

type Lib = Pick<
  typeof via,
  'evalShowIf' | 'controlNumber' | 'controlBytes' | 'hsToRgb' | 'rgbToHs'
>;

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const same = (a: number[] | undefined, b: number[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * VIA custom menus: the controls the keyboard's definition declares, read from the keyboard and
 * written back with a read-back check. Conditions (showIf) are evaluated by a small parser, never
 * by eval.
 */
export default function CustomMenus() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const host = device?.driver as unknown as MenuHost | undefined;
  const [lib, setLib] = useState<Lib | null>(null);
  const [applied, setApplied] = useState<Values | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const menus = useMemo(() => host?.getMenus?.() ?? [], [host]);

  useEffect(() => {
    void import('@openkey/protocols').then((m) => setLib(m.via));
  }, []);
  useEffect(() => {
    if (!host?.readMenuValues || !menus.length) return;
    void read(t('custom.read'), () => host.readMenuValues()).then((v) => {
      if (!v) return;
      setApplied(v);
      setValues(v);
    });
  }, [host, menus.length, read, t]);

  const changedTokens =
    values && applied ? Object.keys(values).filter((k) => !same(values[k], applied[k])) : [];
  const track = useChangeTracking('custom', ['customMenus'], changedTokens.length);
  if (!device || !host) return null;
  if (!menus.length || !values || !applied || !lib) return <Loading />;

  const numbers: Record<string, number> = {};
  for (const m of menus)
    for (const s of m.sections)
      for (const c of s.controls)
        if (c.token && values[c.token]) numbers[c.token] = lib.controlNumber(c, values[c.token]!);
  const visible = (expr?: string) => lib.evalShowIf(expr, numbers);
  const set = (c: Control, n: number) =>
    setValues({ ...values, [c.token!]: lib.controlBytes(c, n) });

  const write = async (next: Values, label: string) => {
    const tx: Transaction<Values> = {
      label,
      acknowledged: true,
      apply: async (v) => {
        const changed = Object.fromEntries(
          Object.entries(v).filter(([k, b]) => !same(b, applied[k]) || !(k in applied)),
        );
        await host.writeMenuValues(changed);
      },
      readbackFromDevice: async () => ({ ...next, ...(await host.readMenuValues()) }),
    };
    const r = await apply('customMenus', tx, applied, next);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(next);
    return r;
  };

  const press = async (c: Control) => {
    await write({ ...applied, [c.token!]: lib.controlBytes(c, 1) }, c.label);
    setApplied((a) =>
      a ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== c.token)) : a,
    );
  };

  const render = (c: Control) => {
    if (!visible(c.showIf)) return null;
    const key = `${c.token ?? c.label}-${c.label}`;
    if (c.type === 'text')
      return (
        <p key={key} className="small muted">
          {c.label}
        </p>
      );
    if (!c.token || (c.type !== 'button' && !values[c.token]))
      return (
        <p key={key} className="small muted">
          {c.label}: {t('custom.noAnswer')}
        </p>
      );
    const n = c.type === 'button' ? 0 : lib.controlNumber(c, values[c.token]!);
    switch (c.type) {
      case 'range':
        return (
          <Field key={key} label={`${c.label}: ${n}${c.unit ?? ''}`}>
            <input
              type="range"
              min={c.range![0]}
              max={c.range![1]}
              value={n}
              onChange={(e) => set(c, Number(e.target.value))}
            />
          </Field>
        );
      case 'dropdown':
        return (
          <Field key={key} label={c.label}>
            <select value={n} onChange={(e) => set(c, Number(e.target.value))}>
              {c.choices!.map(([label, value]) => (
                <option key={`${value}-${label}`} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        );
      case 'toggle':
        return (
          <Toggle key={key} label={c.label} checked={!!n} onChange={(on) => set(c, on ? 1 : 0)} />
        );
      case 'color': {
        const { r, g, b } = lib.hsToRgb(n >> 8, n & 0xff);
        return (
          <Field key={key} label={c.label}>
            <input
              type="color"
              value={`#${hex2(r)}${hex2(g)}${hex2(b)}`}
              onChange={(e) => {
                const x = e.target.value;
                const [h, s] = lib.rgbToHs({
                  r: parseInt(x.slice(1, 3), 16),
                  g: parseInt(x.slice(3, 5), 16),
                  b: parseInt(x.slice(5, 7), 16),
                });
                set(c, (h << 8) | s);
              }}
            />
          </Field>
        );
      }
      case 'keycode':
        return (
          <Field key={key} label={c.label} hint={t('custom.keycodeHint')}>
            <input
              className="mono"
              defaultValue={`0x${n.toString(16).padStart(4, '0')}`}
              onBlur={(e) => {
                const v = Number(e.target.value.trim());
                if (Number.isInteger(v) && v >= 0 && v <= 0xffff) set(c, v);
              }}
            />
          </Field>
        );
      case 'label':
        return (
          <p key={key} className="small">
            {c.label}: <strong>{n}</strong>
          </p>
        );
      case 'button':
        return (
          <button
            key={key}
            type="button"
            className="btn"
            disabled={track.busy || gate('customMenus').decision.kind === 'blocked'}
            onClick={() => void press(c)}
          >
            {c.label}
          </button>
        );
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.custom')} lead={t('custom.lead')} />
      <div className="row wrap between">
        <SourceNote source="device" />
        <WriteGateNote gate={gate('customMenus')} />
      </div>
      {menus
        .filter((m) => visible(m.showIf))
        .map((m) => (
          <Card key={m.label} title={m.label}>
            {m.sections
              .filter((s) => visible(s.showIf))
              .map((s) => (
                <section key={s.label} className="menu-section">
                  {s.label && <h3 className="h-sub">{s.label}</h3>}
                  <div className="form-grid">{s.controls.map(render)}</div>
                </section>
              ))}
          </Card>
        ))}
      <ChangeBar
        status={track.status}
        count={changedTokens.length}
        verifies
        canApply={gate('customMenus').decision.kind !== 'blocked'}
        busy={track.busy}
        onDiscard={() => {
          setValues(applied);
          track.discarded();
        }}
        onApply={() => void write(values, t('custom.apply'))}
        applyLabel={t('common.apply')}
      />
    </div>
  );
}
