import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  actionsEqual,
  canRedo,
  canUndo,
  createHistory,
  describeAction,
  keyBySlot,
  keycodeCatalog,
  markApplied,
  pushHistory,
  redo,
  undo,
  usageName,
} from '@openkey/core';
import type { FeatureId, History, KeyAction, KeymapState, LayerId, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { KeyboardView } from '../../components/KeyboardView.js';
import { Card, Loading, MirrorNote, PageHeader } from '../../components/ui.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
import { KeyPicker } from './KeyPicker.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';
import { KEYCODE_EVENT } from '../../app/CommandPalette.js';

type Slots = Record<number, KeyAction>;
const DEFAULT: KeyAction = { kind: 'default' };

/** Slot-level changes between two keymaps (missing slots are `default`). */
export function keymapChanges(before: Slots, after: Slots): { slot: number; before: KeyAction; after: KeyAction }[] {
  const slots = new Set([...Object.keys(before), ...Object.keys(after)].map(Number));
  return [...slots]
    .sort((a, b) => a - b)
    .map((slot) => ({ slot, before: before[slot] ?? DEFAULT, after: after[slot] ?? DEFAULT }))
    .filter((c) => !actionsEqual(c.before, c.after));
}

const feature = (layer: LayerId): FeatureId => (layer === 'fn' ? 'fnLayer' : 'keymap');

export default function KeymapStudio() {
  const t = useT();
  const { device, read, apply, gate } = useKeyboard();
  const [layer, setLayer] = useState<LayerId>('base');
  const [histories, setHistories] = useState<Partial<Record<LayerId, History<Slots>>>>({});
  const [provenance, setProvenance] = useState<KeymapState['provenance']>('mirror');
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [review, setReview] = useState(false);

  const h = histories[layer];
  const setH = useCallback((next: History<Slots>) => setHistories((x) => ({ ...x, [layer]: next })), [layer]);

  // Read each layer once; local edits survive switching layers.
  useEffect(() => {
    if (histories[layer]) return;
    void read(t('keymap.read'), (d) => d.getKeymap(layer)).then((s) => {
      if (!s) return;
      setProvenance(s.provenance);
      setHistories((x) => ({ ...x, [layer]: createHistory<Slots>({ ...s.slots }) }));
    });
  }, [layer, histories, read, t]);

  // A keycode picked in the command palette fills the search box.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const entry = keycodeCatalog().find((k) => k.id === id);
      if (entry) setQuery(entry.qmk ?? entry.name);
    };
    addEventListener(KEYCODE_EVENT, on);
    return () => removeEventListener(KEYCODE_EVENT, on);
  }, []);

  // Undo/redo shortcuts while the studio is open (not while typing in the search box).
  useEffect(() => {
    if (!h) return;
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey && canUndo(h)) {
        e.preventDefault();
        setH(undo(h));
      } else if ((k === 'y' || (k === 'z' && e.shiftKey)) && canRedo(h)) {
        e.preventDefault();
        setH(redo(h));
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [h, setH]);

  const changes = useMemo(() => (h ? keymapChanges(h.applied, h.present) : []), [h]);

  if (!device) return null;
  if (!h) return <Loading />;
  const layout = device.driver.getLayout();
  const caps = device.caps;
  const layers: LayerId[] = caps.fnLayer.write || caps.fnLayer.read !== 'none' ? ['base', 'fn'] : ['base'];
  const key = selected !== null ? keyBySlot(layout, selected) : undefined;
  const current = selected !== null ? (h.present[selected] ?? DEFAULT) : DEFAULT;
  const macroSlots = caps.macros.write ? safeMacroSlots(() => device.driver.getMacroLimits().slots) : 0;
  const g = gate(feature(layer));

  const setAction = (a: KeyAction) => {
    if (selected === null) return;
    const next = { ...h.present };
    if (a.kind === 'default') delete next[selected];
    else next[selected] = a;
    setH(pushHistory(h, next));
  };

  const doApply = async () => {
    setReview(false);
    const support = caps[feature(layer)];
    const tx: Transaction<Slots> = {
      label: t(layer === 'fn' ? 'keymap.applyFn' : 'keymap.applyBase'),
      acknowledged: true,
      apply: (slots) => device.driver.setKeymap({ layer, slots, provenance: 'mirror' }),
      // Only a firmware read counts as verification; a remembered mirror would fake it.
      ...(support.read === 'device' ? { readbackFromDevice: async () => (await device.driver.getKeymap(layer)).slots } : {}),
    };
    const r = await apply(feature(layer), tx, h.applied, h.present);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setH(markApplied(h));
  };

  const restoreDefaults = async () => {
    const tx: Transaction<Slots> = {
      label: t('keymap.restoreDefaults'),
      acknowledged: true,
      apply: () => device.driver.restoreDefaults(layer === 'fn' ? 'fnLayer' : 'keymap'),
    };
    const r = await apply('factoryDefaults', tx, h.applied, {});
    if (r && r.outcome !== 'FAILED' && r.outcome !== 'REJECTED') setH(markApplied(pushHistory(h, {}), {}));
  };

  const label = (slot: number) => keyBySlot(layout, slot)?.label ?? `#${slot}`;

  return (
    <div className="page">
      <PageHeader
        title={t('nav.keymap')}
        lead={t('keymap.lead')}
        actions={
          <>
            <button type="button" className="btn ghost icon-only" disabled={!canUndo(h)} onClick={() => setH(undo(h))} aria-label={t('common.undo')} title={`${t('common.undo')} (Ctrl+Z)`}>
              <Icon name="undo" />
            </button>
            <button type="button" className="btn ghost icon-only" disabled={!canRedo(h)} onClick={() => setH(redo(h))} aria-label={t('common.redo')} title={`${t('common.redo')} (Ctrl+Shift+Z)`}>
              <Icon name="redo" />
            </button>
            <button type="button" className="btn ghost" disabled={!changes.length} onClick={() => setH(pushHistory(h, { ...h.applied }))}>
              {t('common.discard')}
            </button>
            <button type="button" className="btn primary" disabled={!changes.length || !caps[feature(layer)].write} onClick={() => setReview(true)}>
              {t('keymap.review', { n: changes.length })}
            </button>
          </>
        }
      />
      <WriteGateNote gate={g} />
      {layers.length > 1 && (
        <div className="tabs" role="tablist" aria-label={t('keymap.layers')}>
          {layers.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={layer === l}
              className={`tab ${layer === l ? 'on' : ''}`}
              onClick={() => {
                setLayer(l);
                setSelected(null);
              }}
            >
              {t(l === 'fn' ? 'keymap.layerFn' : 'keymap.layerBase')}
              {histories[l] && keymapChanges(histories[l]!.applied, histories[l]!.present).length > 0 && <span className="dot-badge" aria-label={t('keymap.unsaved')} />}
            </button>
          ))}
        </div>
      )}
      {provenance !== 'device' && <MirrorNote />}
      <div className="studio">
        <Card className="studio-board">
          <KeyboardView
            layout={layout}
            label={t('keymap.boardLabel', { name: layout.name })}
            selected={selected}
            legend={(k) => (h.present[k.slot] ? describeAction(h.present[k.slot]!, usageName) : undefined)}
            highlight={(k) => !actionsEqual(h.present[k.slot] ?? DEFAULT, h.applied[k.slot] ?? DEFAULT)}
            onKey={(k) => setSelected(k.slot)}
          />
          <p className="small muted legend-help">
            <span className="swatch staged" /> {t('keymap.stagedLegend')}
          </p>
        </Card>
        <Card className="studio-side" title={key ? t('keymap.keyTitle', { key: key.label, slot: key.slot }) : t('keymap.pickKey')}>
          {!key ? (
            <p className="muted">{t('keymap.pickKeyHelp')}</p>
          ) : layer === 'fn' && key.fnLocked ? (
            <p className="callout info">{t('keymap.fnLocked')}</p>
          ) : (
            <KeyPicker value={current} onChange={setAction} macroSlots={macroSlots} query={query} onQuery={setQuery} />
          )}
          {caps.factoryDefaults.write && (
            <details className="small danger-zone">
              <summary>{t('keymap.dangerZone')}</summary>
              <p>{t('keymap.restoreDefaultsHelp')}</p>
              <button type="button" className="btn danger small" onClick={() => void restoreDefaults()}>
                {t('keymap.restoreDefaults')}
              </button>
            </details>
          )}
        </Card>
      </div>

      {review && (
        <Dialog
          title={t('keymap.reviewTitle', { n: changes.length })}
          onClose={() => setReview(false)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setReview(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" onClick={() => void doApply()}>
                {t('common.apply')}
              </button>
            </>
          }
        >
          <table className="tbl diff">
            <thead>
              <tr>
                <th scope="col">{t('keymap.col.key')}</th>
                <th scope="col">{t('keymap.col.before')}</th>
                <th scope="col">{t('keymap.col.after')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.slot}>
                  <th scope="row">{label(c.slot)}</th>
                  <td className="del">{describeAction(c.before, usageName)}</td>
                  <td className="ins">{describeAction(c.after, usageName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{caps[feature(layer)].read === 'device' ? t('keymap.willVerify') : t('keymap.cannotVerify')}</p>
        </Dialog>
      )}
    </div>
  );
}

function safeMacroSlots(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}
