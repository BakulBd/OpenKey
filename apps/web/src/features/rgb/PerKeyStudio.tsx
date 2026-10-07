import { useEffect, useRef, useState } from 'react';
import { createHistory, canRedo, canUndo, deepEqual, hexToRgb, markApplied, pushHistory, redo, rgbToHex, undo } from '@openkey/core';
import type { History, PerKeyRgb, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, PageHeader } from '../../components/ui.js';
import { KeyboardView } from '../../components/KeyboardView.js';
import { Icon } from '../../components/Icon.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

/** Minimum time between per-key writes: each one rewrites a table in the keyboard's flash. */
const WRITE_COOLDOWN_MS = 3000;

export default function PerKeyStudio() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const [h, setH] = useState<History<PerKeyRgb> | null>(null);
  const [brush, setBrush] = useState('#4f7cff');
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const readable = device?.caps.perKeyRgb.read !== 'none';

  useEffect(() => {
    if (!readable) return setH(createHistory<PerKeyRgb>({}));
    void read(t('perkey.read'), (d) => d.getPerKeyRgb()).then((c) => setH(createHistory(c ?? {})));
  }, [read, readable, t]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!device) return null;
  if (!h) return <Loading />;
  const layout = device.driver.getLayout();
  const lights = layout.keys.map((k) => k.light).filter((n): n is number => n !== null);
  // Compare only LEDs that exist on this layout: the firmware table has spare entries.
  const onLayout = (c: PerKeyRgb) => Object.fromEntries(lights.map((l) => [l, c[l] ?? { r: 0, g: 0, b: 0 }]));
  const dirty = !deepEqual(onLayout(h.present), onLayout(h.applied));

  const paint = (light: number | null) => {
    if (light === null) return;
    const color = hexToRgb(brush);
    if (deepEqual(h.present[light], color)) return;
    setH(pushHistory(h, { ...h.present, [light]: color }));
  };

  const doApply = async () => {
    const tx: Transaction<PerKeyRgb> = {
      label: t('perkey.apply'),
      acknowledged: true,
      apply: (c) => device.driver.setPerKeyRgb(c),
      normalize: onLayout,
      ...(device.caps.perKeyRgb.read === 'device' ? { readbackFromDevice: () => device.driver.getPerKeyRgb() } : {}),
    };
    const r = await apply('perKeyRgb', tx, h.applied, h.present);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setH(markApplied(h));
    setCooling(true);
    timer.current = setTimeout(() => setCooling(false), WRITE_COOLDOWN_MS);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.perkey')}
        lead={t('perkey.lead')}
        actions={
          <>
            <button type="button" className="btn ghost icon-only" disabled={!canUndo(h)} onClick={() => setH(undo(h))} aria-label={t('common.undo')}>
              <Icon name="undo" />
            </button>
            <button type="button" className="btn ghost icon-only" disabled={!canRedo(h)} onClick={() => setH(redo(h))} aria-label={t('common.redo')}>
              <Icon name="redo" />
            </button>
            {readable && (
              <button type="button" className="btn ghost" onClick={() => void read(t('perkey.read'), (d) => d.getPerKeyRgb()).then((c) => c && setH(markApplied(pushHistory(h, c), c)))}>
                {t('perkey.readNow')}
              </button>
            )}
            <button type="button" className="btn primary" disabled={!dirty || cooling || !device.caps.perKeyRgb.write} onClick={() => void doApply()}>
              {cooling ? t('perkey.cooldown') : t('common.apply')}
            </button>
          </>
        }
      />
      <WriteGateNote gate={gate('perKeyRgb')} />
      <Card>
        <div className="row wrap">
          <Field label={t('perkey.brush')}>
            <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} />
          </Field>
          <button type="button" className="btn small" onClick={() => setH(pushHistory(h, Object.fromEntries(lights.map((l) => [l, hexToRgb(brush)]))))}>
            {t('perkey.fill')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => setH(pushHistory(h, Object.fromEntries(lights.map((l) => [l, { r: 0, g: 0, b: 0 }]))))}>
            {t('perkey.clear')}
          </button>
          <p className="small muted">{t('perkey.help')}</p>
        </div>
        <KeyboardView
          layout={layout}
          label={t('perkey.boardLabel')}
          fill={(k) => (k.light !== null && h.present[k.light] ? rgbToHex(h.present[k.light]!) : undefined)}
          highlight={(k) => k.light !== null && !deepEqual(h.present[k.light], h.applied[k.light])}
          onKey={(k) => paint(k.light)}
          onKeyDrag={(k) => paint(k.light)}
        />
        <p className="small muted">{device.caps.perKeyRgb.read === 'device' ? t('perkey.verifies') : t('keymap.cannotVerify')}</p>
      </Card>
    </div>
  );
}
