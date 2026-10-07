import { useEffect, useState } from 'react';
import { deepEqual, hexToRgb, rgbToHex } from '@openkey/core';
import type { Direction, RgbConfig, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, MirrorNote, PageHeader } from '../../components/ui.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

/**
 * Hardware lighting effects: they run on the keyboard's own controller. Controls change a local
 * draft only; nothing is written until Apply, because lighting settings live in flash.
 */
export default function RgbStudio() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const [applied, setApplied] = useState<RgbConfig | null>(null);
  const [draft, setDraft] = useState<RgbConfig | null>(null);
  useEffect(() => {
    void read(t('rgb.read'), (d) => d.getRgbConfig()).then((c) => {
      if (!c) return;
      setApplied(c);
      setDraft(c);
    });
  }, [read, t]);
  if (!device) return null;
  if (!draft || !applied) return <Loading />;
  const cat = device.driver.getRgbEffects();
  const effect = cat.effects.find((e) => e.id === draft.effect);
  const ctl = effect?.controls;
  const set = (p: Partial<RgbConfig>) => setDraft({ ...draft, ...p });
  const dirty = !deepEqual(draft, applied);

  const doApply = async () => {
    const tx: Transaction<RgbConfig> = {
      label: t('rgb.apply'),
      acknowledged: true,
      apply: (c) => device.driver.setRgbConfig(c),
      ...(device.caps.rgb.read === 'device' ? { readbackFromDevice: () => device.driver.getRgbConfig() } : {}),
    };
    const r = await apply('rgb', tx, applied, draft);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(draft);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.rgb')}
        lead={t('rgb.lead')}
        actions={
          <>
            <button type="button" className="btn ghost" disabled={!dirty} onClick={() => setDraft(applied)}>
              {t('common.discard')}
            </button>
            <button type="button" className="btn primary" disabled={!dirty || !device.caps.rgb.write} onClick={() => void doApply()}>
              {t('common.apply')}
            </button>
          </>
        }
      />
      <WriteGateNote gate={gate('rgb')} />
      {device.caps.rgb.read === 'mirror' && <MirrorNote />}
      <Card title={t('rgb.effects')}>
        <p className="small muted">{t('rgb.hardwareNative')}</p>
        <div className="chips wrap" role="radiogroup" aria-label={t('rgb.effects')}>
          {cat.effects.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={e.id === draft.effect} className={`chip ${e.id === draft.effect ? 'on' : ''}`} onClick={() => set({ effect: e.id })}>
              {e.name}
            </button>
          ))}
          {cat.customEffect !== undefined && draft.effect === cat.customEffect && <span className="chip on">{t('rgb.perKeyMode')}</span>}
        </div>
      </Card>
      <Card title={t('rgb.parameters')}>
        <div className="form-grid">
          {(ctl?.color ?? true) && (
            <Field label={t('rgb.color')}>
              <input type="color" value={rgbToHex(draft.color)} onChange={(e) => set({ color: hexToRgb(e.target.value) })} />
            </Field>
          )}
          {(ctl?.colorful ?? true) && (
            <Field label={t('rgb.rainbow')}>
              <input type="checkbox" checked={draft.colorful} onChange={(e) => set({ colorful: e.target.checked })} />
            </Field>
          )}
          {(ctl?.brightness ?? true) && (
            <Field label={t('rgb.brightness', { v: draft.brightness })}>
              <input type="range" min={cat.brightness.min} max={cat.brightness.max} value={draft.brightness} onChange={(e) => set({ brightness: Number(e.target.value) })} />
            </Field>
          )}
          {(ctl?.speed ?? true) && (
            <Field label={t('rgb.speed', { v: draft.speed })}>
              <input type="range" min={cat.speed.min} max={cat.speed.max} value={draft.speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
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
        {device.caps.rgb.note && <p className="small muted">{device.caps.rgb.note}</p>}
      </Card>
    </div>
  );
}
