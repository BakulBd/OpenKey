import { useEffect, useState } from 'react';
import type { KeyboardLayout, Transaction } from '@openkey/core';
import type { hmk } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { KeyboardView } from '../../components/KeyboardView.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

type Actuation = hmk.HmkActuation;

interface ActuationHost {
  getActuations(): Promise<Actuation[]>;
  setActuations(changes: Record<number, Actuation>): Promise<void>;
  getLayout(): KeyboardLayout;
}

/** 0–255 of the key travel as a percentage, which is how libhmk stores it. */
const pct = (v: number) => Math.round((v / 255) * 100);
const same = (a?: Actuation, b?: Actuation) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Hall-effect keys: where each key actuates and how Rapid Trigger behaves. Pick keys, set the
 * values, apply; every write is read back.
 */
export default function ActuationStudio() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const host = device?.driver as unknown as ActuationHost | undefined;
  const [applied, setApplied] = useState<Actuation[] | null>(null);
  const [values, setValues] = useState<Actuation[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!host?.getActuations) return;
    void read(t('act.read'), () => host.getActuations()).then((v) => {
      if (!v) return;
      setApplied(v);
      setValues(v);
    });
  }, [host, read, t]);
  const changed = values && applied ? values.filter((v, i) => !same(v, applied[i])).length : 0;
  const track = useChangeTracking('actuation', ['actuation', 'rapidTrigger'], changed);
  if (!device || !host?.getActuations) return null;
  if (!values || !applied) return <Loading />;
  const layout = host.getLayout();
  const picked = [...selected];
  const first = values[picked[0] ?? -1];

  const update = (patch: Partial<Actuation>) =>
    setValues(values.map((v, i) => (selected.has(i) ? { ...v, ...patch } : v)));

  const write = async () => {
    const tx: Transaction<Actuation[]> = {
      label: t('act.apply'),
      acknowledged: true,
      apply: (next) =>
        host.setActuations(
          Object.fromEntries(
            next
              .map((v, i) => [i, v])
              .filter(([i]) => !same(next[i as number], applied[i as number])),
          ),
        ),
      readbackFromDevice: () => host.getActuations(),
    };
    const r = await apply('actuation', tx, applied, values);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(values);
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.actuation')} lead={t('act.lead')} />
      <div className="row wrap between">
        <SourceNote source="device" />
        <WriteGateNote gate={gate('actuation')} />
      </div>
      <Card
        title={t('act.keys')}
        actions={
          <div className="row">
            <button
              type="button"
              className="btn small"
              onClick={() => setSelected(new Set(layout.keys.map((k) => k.slot)))}
            >
              {t('act.all')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setSelected(new Set())}
            >
              {t('act.none')}
            </button>
          </div>
        }
      >
        <KeyboardView
          layout={layout}
          label={t('act.keys')}
          selected={null}
          highlight={(k) => selected.has(k.slot)}
          legend={(k) => {
            const v = values[k.slot];
            return v ? `${pct(v.actuationPoint)}%${v.rtDown ? ' RT' : ''}` : undefined;
          }}
          fill={(k) => {
            const v = values[k.slot];
            // Shallow (light) to deep (dark) actuation, as a quick visual map.
            return v ? `hsl(200 70% ${85 - pct(v.actuationPoint) * 0.5}%)` : undefined;
          }}
          onKey={(k) =>
            setSelected((s) => {
              const n = new Set(s);
              if (!n.delete(k.slot)) n.add(k.slot);
              return n;
            })
          }
          scrollHint={t('kb.scrollHint')}
        />
        <p className="small muted">{t('act.pickHint', { n: selected.size })}</p>
      </Card>
      {first && (
        <Card title={t('act.settings', { n: selected.size })}>
          <div className="form-grid">
            <Field
              label={t('act.point', { v: pct(first.actuationPoint) })}
              hint={t('act.pointHint')}
            >
              <input
                type="range"
                min={1}
                max={255}
                value={first.actuationPoint}
                onChange={(e) => update({ actuationPoint: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Toggle
            label={t('act.rt')}
            hint={t('act.rtHint')}
            checked={first.rtDown > 0}
            onChange={(on) =>
              update(on ? { rtDown: first.rtDown || 20, rtUp: first.rtUp } : { rtDown: 0, rtUp: 0 })
            }
          />
          {first.rtDown > 0 && (
            <div className="form-grid">
              <Field label={t('act.rtDown', { v: pct(first.rtDown) })}>
                <input
                  type="range"
                  min={1}
                  max={128}
                  value={first.rtDown}
                  onChange={(e) => update({ rtDown: Number(e.target.value) })}
                />
              </Field>
              <Field
                label={t('act.rtUp', { v: first.rtUp ? `${pct(first.rtUp)}%` : t('act.same') })}
              >
                <input
                  type="range"
                  min={0}
                  max={128}
                  value={first.rtUp}
                  onChange={(e) => update({ rtUp: Number(e.target.value) })}
                />
              </Field>
              <Toggle
                label={t('act.continuous')}
                hint={t('act.continuousHint')}
                checked={first.continuous}
                onChange={(on) => update({ continuous: on })}
              />
            </div>
          )}
        </Card>
      )}
      <ChangeBar
        status={track.status}
        count={changed}
        verifies
        canApply={gate('actuation').decision.kind !== 'blocked'}
        busy={track.busy}
        onDiscard={() => {
          setValues(applied);
          track.discarded();
        }}
        onApply={() => void write()}
        applyLabel={t('common.apply')}
      />
    </div>
  );
}
