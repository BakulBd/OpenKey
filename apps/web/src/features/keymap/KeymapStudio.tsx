import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Card, Loading, PageHeader, SourceNote } from '../../components/ui.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { KeyPicker } from './KeyPicker.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';
import { KEYCODE_EVENT } from '../../app/CommandPalette.js';
import { href } from '../../app/router.js';

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
  const inspector = useRef<HTMLDivElement>(null);

  const h = histories[layer];
  const setH = useCallback((next: History<Slots>) => setHistories((x) => ({ ...x, [layer]: next })), [layer]);
  const pendingFor = (l: LayerId) => (histories[l] ? keymapChanges(histories[l]!.applied, histories[l]!.present).length : 0);
  const changes = useMemo(() => (h ? keymapChanges(h.applied, h.present) : []), [h]);
  const totalPending = pendingFor('base') + pendingFor('fn');
  const track = useChangeTracking('keymap', ['keymap', 'fnLayer', 'factoryDefaults'], totalPending);

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

  // Undo/redo shortcuts while the editor is open (not while typing in a field).
  useEffect(() => {
    if (!h) return;
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' && selected !== null && !review) setSelected(null);
      if (!(e.ctrlKey || e.metaKey)) return;
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
  }, [h, setH, selected, review]);

  if (!device) return null;
  if (!h) return <Loading />;
  const layout = device.driver.getLayout();
  const caps = device.caps;
  const kinds = device.driver.getKeyActionKinds();
  const layers: LayerId[] = caps.fnLayer.write || caps.fnLayer.read !== 'none' ? ['base', 'fn'] : ['base'];
  const key = selected !== null ? keyBySlot(layout, selected) : undefined;
  const current = selected !== null ? (h.present[selected] ?? DEFAULT) : DEFAULT;
  const appliedAction = selected !== null ? (h.applied[selected] ?? DEFAULT) : DEFAULT;
  const keyChanged = selected !== null && !actionsEqual(current, appliedAction);
  const macroSlots = caps.macros.write && kinds.includes('macro') ? safeMacroSlots(() => device.driver.getMacroLimits().slots) : 0;
  const support = caps[feature(layer)];
  const g = gate(feature(layer));
  const describe = (a: KeyAction) => describeAction(a, usageName);
  const locked = (slot: number) => layer === 'fn' && !!keyBySlot(layout, slot)?.fnLocked;

  const setAction = (a: KeyAction) => {
    if (selected === null || locked(selected)) return;
    const next = { ...h.present };
    if (a.kind === 'default') delete next[selected];
    else next[selected] = a;
    setH(pushHistory(h, next));
  };

  const select = (slot: number) => {
    setSelected(slot);
    // On narrow screens the inspector is below the board: bring it into view.
    if (matchMedia('(max-width: 1080px)').matches) requestAnimationFrame(() => inspector.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const doApply = async () => {
    setReview(false);
    const tx: Transaction<Slots> = {
      label: t(layer === 'fn' ? 'keymap.applyFn' : 'keymap.applyBase'),
      acknowledged: true,
      // Validate the whole layer before anything is sent: only encodable actions (or encodings read
      // from the device and preserved as raw) may be written.
      validate: (slots) => {
        const bad = Object.entries(slots).filter(([, a]) => a.kind !== 'raw' && !kinds.includes(a.kind));
        return bad.map(([slot, a]) => t('keymap.unsupportedAction', { key: keyBySlot(layout, Number(slot))?.label ?? slot, kind: a.kind }));
      },
      apply: (slots) => device.driver.setKeymap({ layer, slots, provenance: 'mirror' }),
      // Only a firmware read counts as verification; a remembered mirror would fake it.
      ...(support.read === 'device' ? { readbackFromDevice: async () => (await device.driver.getKeymap(layer)).slots } : {}),
    };
    const r = await apply(feature(layer), tx, h.applied, h.present);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setH(markApplied(h));
  };

  const restoreDefaults = async () => {
    const tx: Transaction<Slots> = {
      label: t('keymap.restoreDefaults'),
      acknowledged: true,
      apply: () => device.driver.restoreDefaults(layer === 'fn' ? 'fnLayer' : 'keymap'),
    };
    const r = await apply('factoryDefaults', tx, h.applied, {});
    track.record(r);
    if (r && r.outcome !== 'FAILED' && r.outcome !== 'REJECTED') setH(markApplied(pushHistory(h, {}), {}));
  };

  const label = (slot: number) => keyBySlot(layout, slot)?.label ?? `#${slot}`;
  const physical = (['encoder', 'tft'] as const).filter((f) => caps[f].status !== 'UNKNOWN' && caps[f].status !== 'NOT_SUPPORTED');

  return (
    <div className="page">
      <PageHeader title={t('nav.keymap')} lead={t('keymap.lead')} />
      <div className="editor-head">
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
                {pendingFor(l) > 0 && <span className="dot-badge" aria-label={t('keymap.unsaved')} />}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar" role="toolbar" aria-label={t('keymap.tools')}>
          <button type="button" className="btn ghost icon-only" disabled={!canUndo(h)} onClick={() => setH(undo(h))} aria-label={t('common.undo')} title={`${t('common.undo')} (Ctrl+Z)`}>
            <Icon name="undo" />
          </button>
          <button type="button" className="btn ghost icon-only" disabled={!canRedo(h)} onClick={() => setH(redo(h))} aria-label={t('common.redo')} title={`${t('common.redo')} (Ctrl+Shift+Z)`}>
            <Icon name="redo" />
          </button>
          <SourceNote source={provenance === 'device' ? 'device' : 'mirror'} />
        </div>
      </div>
      <WriteGateNote gate={g} />
      <div className="studio">
        <Card className="studio-board">
          <KeyboardView
            scrollHint={t('kb.scrollHint')}
            layout={layout}
            label={t('keymap.boardLabel', { name: layout.name })}
            selected={selected}
            legend={(k) => (h.present[k.slot] ? describe(h.present[k.slot]!) : undefined)}
            highlight={(k) => !actionsEqual(h.present[k.slot] ?? DEFAULT, h.applied[k.slot] ?? DEFAULT)}
            locked={(k) => locked(k.slot)}
            onKey={(k) => select(k.slot)}
          />
          <div className="legend-help small muted">
            <span>
              <span className="swatch staged" /> {t('keymap.stagedLegend')}
            </span>
            <span>
              <span className="swatch mapped" /> {t('keymap.mappedLegend')}
            </span>
            {layer === 'fn' && (
              <span>
                <span className="swatch locked" /> {t('keymap.lockedLegend')}
              </span>
            )}
          </div>
          {physical.length > 0 && (
            <ul className="physical small">
              {physical.map((f) => (
                <li key={f}>
                  <strong>{t(`feature.${f}`)}:</strong> {caps[f].value ?? t(`status.${caps[f].status}`)}
                  {f === 'encoder' && caps[f].write === false && <span className="muted"> — {t('keymap.encoderFixed')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div ref={inspector} className="studio-side">
          <Card title={key ? t('keymap.keyTitle', { key: key.label, slot: key.slot }) : t('keymap.pickKey')}>
            {!key ? (
              <p className="muted">{t('keymap.pickKeyHelp')}</p>
            ) : locked(key.slot) ? (
              <p className="callout info">{t('keymap.fnLocked')}</p>
            ) : (
              <>
                <div className="key-now" aria-live="polite">
                  <div>
                    <span className="muted small">{t('keymap.assigned')}</span>
                    <strong>{describe(current)}</strong>
                  </div>
                  {keyChanged ? (
                    <span className="pill staged-pill">{t('keymap.changedFrom', { was: describe(appliedAction) })}</span>
                  ) : current.kind !== 'default' ? (
                    <span className="pill">{t('keymap.remapped')}</span>
                  ) : (
                    <span className="pill">{t('keymap.isDefault')}</span>
                  )}
                </div>
                <div className="row wrap">
                  <button type="button" className="btn small" disabled={!keyChanged} onClick={() => setAction(appliedAction)}>
                    {t('keymap.revertKey')}
                  </button>
                  <button type="button" className="btn small ghost" disabled={current.kind === 'default'} onClick={() => setAction(DEFAULT)}>
                    {t('keymap.resetKey')}
                  </button>
                </div>
                <KeyPicker value={current} onChange={setAction} kinds={kinds} macroSlots={macroSlots} query={query} onQuery={setQuery} />
              </>
            )}
            {caps.factoryDefaults.write && (
              <details className="small danger-zone">
                <summary>{t('keymap.dangerZone')}</summary>
                <p>{t('keymap.restoreDefaultsHelp')}</p>
                <button type="button" className="btn danger small" disabled={track.busy} onClick={() => void restoreDefaults()}>
                  {t('keymap.restoreDefaults')}
                </button>
              </details>
            )}
          </Card>
        </div>
      </div>

      <ChangeBar
        status={track.status}
        count={changes.length}
        verifies={support.read === 'device'}
        canApply={support.write && g.decision.kind !== 'blocked'}
        busy={track.busy}
        blockedReason={g.decision.kind === 'blocked' ? g.decision.reason : undefined}
        onDiscard={() => {
          setH(pushHistory(h, { ...h.applied }));
          track.discarded();
        }}
        onApply={() => setReview(true)}
        applyLabel={t('keymap.review', { n: changes.length })}
      />

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
                {t('keymap.write', { n: changes.length })}
              </button>
            </>
          }
        >
          <ul className="plan">
            <li>
              <span className="muted">{t('plan.target')}</span> {device.info.model}
              {device.demo ? ` (${t('mode.simulated')})` : ''}
            </li>
            <li>
              <span className="muted">{t('plan.layer')}</span> {t(layer === 'fn' ? 'keymap.layerFn' : 'keymap.layerBase')}
            </li>
            <li>
              <span className="muted">{t('plan.persistence')}</span> {t('plan.onboard')}
            </li>
            <li>
              <span className="muted">{t('plan.verification')}</span> {support.read === 'device' ? t('keymap.willVerify') : t('keymap.cannotVerify')}
            </li>
          </ul>
          {support.read !== 'device' && !device.demo && (
            <p className="callout info small">
              {t('plan.backupAdvice')} <a href={href('backup')}>{t('nav.backup')}</a>
            </p>
          )}
          <div className="table-wrap">
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
                    <td className="del">{describe(c.before)}</td>
                    <td className="ins">{describe(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
