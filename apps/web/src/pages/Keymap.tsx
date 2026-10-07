import { useEffect, useState } from 'react';
import { describeAction, keyBySlot, usageName } from '@openkey/core';
import type { KeyAction, KeymapState, LayerId } from '@openkey/core';
import { useKeyboard } from '../state/keyboard.js';
import { KeyboardView } from '../components/KeyboardView.js';
import { ActionPicker } from '../components/ActionPicker.js';
import { Card, MirrorNote } from '../components/ui.js';

const short = (a: KeyAction) => (a.kind === 'default' ? undefined : describeAction(a, usageName));

export function KeymapPage({ layer }: { layer: LayerId }) {
  const { conn, run } = useKeyboard();
  const [state, setState] = useState<KeymapState | null>(null);
  const [draft, setDraft] = useState<Record<number, KeyAction>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const driver = conn?.driver;

  useEffect(() => {
    setSelected(null);
    void run('Read keymap', (d) => d.getKeymap(layer), { quiet: true }).then((s) => {
      if (s) {
        setState(s);
        setDraft({ ...s.slots });
      }
    });
  }, [layer, run]);

  if (!driver || !conn || !state) return <div className="page">Loading…</div>;
  const layout = driver.getLayout();
  const caps = conn.caps[layer === 'fn' ? 'fnLayer' : 'keymap'];
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.slots);
  const key = selected !== null ? keyBySlot(layout, selected) : undefined;
  const current: KeyAction =
    selected !== null ? (draft[selected] ?? { kind: 'default' }) : { kind: 'default' };
  const macroSlots = (() => {
    try {
      return driver.getMacroLimits().slots;
    } catch {
      return 0;
    }
  })();

  const save = async () => {
    const next: KeymapState = { layer, slots: draft, provenance: 'mirror' };
    if (
      (await run(`Write ${layer === 'fn' ? 'Fn layer' : 'keymap'}`, (d) => d.setKeymap(next), {
        write: true,
      })) !== undefined
    ) {
      setState({ ...next });
    }
  };

  return (
    <div className="page">
      <Card
        title={layer === 'fn' ? 'Fn layer' : 'Base layer'}
        actions={
          <>
            <button
              className="ghost"
              disabled={!dirty}
              onClick={() => setDraft({ ...state.slots })}
            >
              Discard
            </button>
            <button
              className="ghost"
              onClick={async () => {
                if (
                  !window.confirm(
                    'Write the firmware defaults for this layer? Every remapped key on this layer is reset.',
                  )
                )
                  return;
                if (
                  (await run(
                    'Restore defaults',
                    (d) => d.restoreDefaults(layer === 'fn' ? 'fnLayer' : 'keymap'),
                    { write: true },
                  )) !== undefined
                ) {
                  setState({ layer, slots: {}, provenance: 'mirror' });
                  setDraft({});
                }
              }}
            >
              Restore defaults
            </button>
            <button
              className="primary"
              disabled={!dirty || !caps.write}
              onClick={() => void save()}
            >
              Save to keyboard
            </button>
          </>
        }
      >
        {state.provenance !== 'device' && <MirrorNote />}
        <KeyboardView
          layout={layout}
          selected={selected}
          legend={(k) => (draft[k.slot] ? short(draft[k.slot]!) : undefined)}
          highlight={(k) => draft[k.slot] !== undefined}
          onKey={(k) => setSelected(k.slot)}
        />
      </Card>
      {key && (
        <Card title={`${key.label} (slot ${key.slot})`}>
          {layer === 'fn' && key.fnLocked ? (
            <p className="note">The vendor marks this key as fixed on the Fn layer.</p>
          ) : (
            <ActionPicker
              value={current}
              macroSlots={macroSlots}
              onChange={(a) =>
                setDraft((d) => {
                  const n = { ...d };
                  if (a.kind === 'default') delete n[key.slot];
                  else n[key.slot] = a;
                  return n;
                })
              }
            />
          )}
        </Card>
      )}
    </div>
  );
}
