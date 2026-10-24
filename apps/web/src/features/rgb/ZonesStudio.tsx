import { useEffect, useState } from 'react';
import { deepEqual, hexToRgb, rgbToHex } from '@openkey/core';
import type { LightZone, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, SourceNote } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

/**
 * Zones lit with one colour each (a knob ring, side light bars …). Colours change a local draft;
 * Apply writes only the zones whose colour changed, and the keyboard is read again afterwards.
 */
export function ZonesStudio() {
  const t = useT();
  const { device, read, apply, gate, revision } = useKeyboard();
  const [applied, setApplied] = useState<LightZone[] | null>(null);
  const [draft, setDraft] = useState<LightZone[] | null>(null);
  const changedZones =
    draft && applied ? draft.filter((z, i) => !deepEqual(z.color, applied[i]?.color)) : [];
  const track = useChangeTracking('zones', ['lightZones'], changedZones.length);

  useEffect(() => {
    if (changedZones.length) return;
    void read(t('zones.read'), (d) => d.getLightZones()).then((z) => {
      if (!z) return;
      setApplied(z);
      setDraft(z);
    });
  }, [read, t, revision]);

  if (!device) return null;
  if (!draft || !applied) return <Loading />;
  const caps = device.caps.lightZones;
  const g = gate('lightZones');

  const doApply = async () => {
    const changes = changedZones.map(({ id, color }) => ({ id, color }));
    const tx: Transaction<LightZone[]> = {
      label: t('zones.apply'),
      acknowledged: true,
      apply: () => device.driver.setLightZones(changes),
      ...(caps.read === 'device'
        ? { readbackFromDevice: () => device.driver.getLightZones() }
        : {}),
    };
    const r = await apply('lightZones', tx, applied, draft);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(draft);
  };

  return (
    <>
      <div className="row wrap between">
        <SourceNote source={caps.read === 'device' ? 'device' : 'mirror'} />
        <WriteGateNote gate={g} />
      </div>
      <Card title={t('feature.lightZones')}>
        <div className="form-grid">
          {draft.map((z, i) => (
            <Field key={z.id} label={z.name} hint={rgbToHex(z.color).toUpperCase()}>
              <input
                type="color"
                value={rgbToHex(z.color)}
                onChange={(e) =>
                  setDraft(
                    draft.map((x, j) => (j === i ? { ...x, color: hexToRgb(e.target.value) } : x)),
                  )
                }
              />
            </Field>
          ))}
        </div>
        {caps.note && <p className="small muted">{caps.note}</p>}
      </Card>
      <ChangeBar
        status={track.status}
        count={changedZones.length}
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
