import { useEffect, useState } from 'react';
import { deepEqual, hexToRgb, rgbToHex } from '@openkey/core';
import type { Direction, RgbConfig, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, SourceNote } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

const FIELDS: (keyof RgbConfig)[] = ['effect', 'color', 'colorful', 'brightness', 'speed', 'direction'];

/**
 * Hardware lighting effects: they run on the keyboard's own controller. Controls change a local
 * draft only; nothing is written until Apply, because lighting settings live in flash. OpenKey does
 * not animate a preview: it cannot reproduce the firmware's timing, so it shows the settings only.
 */
export function RgbStudio() {
  const t = useT();
  const { device, read, apply, gate, revision } = useKeyboard();
  const [applied, setApplied] = useState<RgbConfig | null>(null);
  const [draft, setDraft] = useState<RgbConfig | null>(null);
  const changed = draft && applied ? FIELDS.filter((f) => !deepEqual(draft[f], applied[f])).length : 0;
  const track = useChangeTracking('rgb', ['rgb'], changed);

  // Read on open, and again after another editor wrote (per-key colours switch the effect), unless
  // the user has local edits that a re-read would overwrite.
  useEffect(() => {
    if (changed) return;
    void read(t('rgb.read'), (d) => d.getRgbConfig()).then((c) => {
      if (!c) return;
      setApplied(c);
      setDraft(c);
    });
  }, [read, t, revision]);

  if (!device) return null;
  if (!draft || !applied) return <Loading />;
  const caps = device.caps.rgb;
  const cat = device.driver.getRgbEffects();
  const effect = cat.effects.find((e) => e.id === draft.effect);
  const ctl = effect?.controls;
  const set = (p: Partial<RgbConfig>) => setDraft({ ...draft, ...p });
  const g = gate('rgb');
  const leavingPerKey = cat.customEffect !== undefined && applied.effect === cat.customEffect && draft.effect !== cat.customEffect;

  const doApply = async () => {
    const tx: Transaction<RgbConfig> = {
      label: t('rgb.apply'),
      acknowledged: true,
      apply: (c) => device.driver.setRgbConfig(c),
      ...(caps.read === 'device' ? { readbackFromDevice: () => device.driver.getRgbConfig() } : {}),
    };
    const r = await apply('rgb', tx, applied, draft);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(draft);
  };

  return (
    <>
      <div className="row wrap between">
        <SourceNote source={caps.read === 'device' ? 'device' : 'mirror'} />
        <WriteGateNote gate={g} />
      </div>
      <Card title={t('rgb.effects')}>
        <p className="small muted">{t('rgb.hardwareNative')}</p>
        <div className="chips wrap" role="radiogroup" aria-label={t('rgb.effects')}>
          {cat.effects.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={e.id === draft.effect} className={`chip ${e.id === draft.effect ? 'on' : ''}`} onClick={() => set({ effect: e.id })}>
              {e.name}
            </button>
          ))}
          {cat.customEffect !== undefined && draft.effect === cat.customEffect && (
            <span className="chip on" aria-current="true">
              {t('rgb.perKeyMode')}
            </span>
          )}
        </div>
        {leavingPerKey && <p className="callout warn small">{t('rgb.leavingPerKey')}</p>}
      </Card>
      <Card title={t('rgb.parameters')}>
        <div className="form-grid">
          {(ctl?.color ?? true) && (
            <Field label={t('rgb.color')} hint={rgbToHex(draft.color).toUpperCase()}>
              <input type="color" value={rgbToHex(draft.color)} onChange={(e) => set({ color: hexToRgb(e.target.value) })} />
            </Field>
          )}
          {(ctl?.colorful ?? true) && (
            <label className="check field-check">
              <input type="checkbox" checked={draft.colorful} onChange={(e) => set({ colorful: e.target.checked })} />
              {t('rgb.rainbow')}
            </label>
          )}
          {(ctl?.brightness ?? true) && (
            <Field label={t('rgb.brightness', { v: draft.brightness })}>
              <input type="range" min={cat.brightness.min} max={cat.brightness.max} value={draft.brightness} aria-valuetext={`${draft.brightness} / ${cat.brightness.max}`} onChange={(e) => set({ brightness: Number(e.target.value) })} />
            </Field>
          )}
          {(ctl?.speed ?? true) && (
            <Field label={t('rgb.speed', { v: draft.speed })}>
              <input type="range" min={cat.speed.min} max={cat.speed.max} value={draft.speed} aria-valuetext={`${draft.speed} / ${cat.speed.max}`} onChange={(e) => set({ speed: Number(e.target.value) })} />
            </Field>
          )}
          {ctl && ctl.direction.length > 0 && (
            <Field label={t('rgb.direction')}>
              <select value={draft.direction} onChange={(e) => set({ direction: e.target.value as Direction })}>
                {ctl.direction.map((d) => (
                  <option key={d} value={d}>
                    {t(`rgb.dir.${d}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {caps.note && <p className="small muted">{caps.note}</p>}
      </Card>
      <ChangeBar
        status={track.status}
        count={changed}
        verifies={caps.read === 'device'}
        canApply={caps.write && g.decision.kind !== 'blocked'}
        busy={track.busy}
        blockedReason={g.decision.kind === 'blocked' ? g.decision.reason : undefined}
        onDiscard={() => {
          setDraft(applied);
          track.discarded();
        }}
        onApply={() => void doApply()}
        applyLabel={t('common.apply')}
      />
    </>
  );
}
