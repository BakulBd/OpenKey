import { useEffect, useRef, useState } from 'react';
import { deepEqual, domCodeToUsage, usageName, validateMacro } from '@openkey/core';
import type { Macro, MacroEvent, MacroLimits, Transaction } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Empty, Loading, PageHeader, SourceNote } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';
import { listRecords, newId, saveRecord } from '../../state/db.js';

const VISIBLE_SLOTS = 32;

function eventText(e: MacroEvent, t: ReturnType<typeof useT>): string {
  if (e.type === 'delay') return t('macros.wait', { ms: e.ms });
  const verb = e.down ? '↓' : '↑';
  return e.type === 'key' ? `${verb} ${usageName(0x07, e.usage)}` : `${verb} ${t(`macros.mouse.${e.button}`)}`;
}

/** Moves item i by delta within an array (reorder). */
function move<T>(xs: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Slots whose event list differs between the draft and what was last written. */
function countChanged(draft: Macro[], applied: Macro[]): number {
  const eventsOf = (list: Macro[], i: number) => list.find((m) => m.index === i)?.events ?? [];
  return [...new Set([...draft, ...applied].map((m) => m.index))].filter((i) => !deepEqual(eventsOf(draft, i), eventsOf(applied, i))).length;
}

/**
 * Macro editor. Recording happens only while the user has pressed Record *and* the recorder box has
 * focus; nothing is captured silently or outside this box.
 */
export default function MacroStudio() {
  const t = useT();
  const { device, read, apply, gate, notify } = useKeyboard();
  const [applied, setApplied] = useState<Macro[] | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [sel, setSel] = useState(0);
  const [recording, setRecording] = useState(false);
  const last = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const changedSlots = applied ? countChanged(macros, applied) : 0;
  const track = useChangeTracking('macros', ['macros'], changedSlots);

  useEffect(() => {
    void read(t('macros.read'), (d) => d.getMacros()).then((m) => {
      setApplied(m ?? []);
      setMacros(m ?? []);
    });
  }, [read, t]);
  // Stop recording when the page is left or the box loses focus: no background capture.
  useEffect(() => () => setRecording(false), []);

  if (!device) return null;
  if (!applied) return <Loading />;
  let limits: MacroLimits;
  try {
    limits = device.driver.getMacroLimits();
  } catch {
    return <Empty>{t('macros.unavailable')}</Empty>;
  }
  const current = macros.find((m) => m.index === sel) ?? { index: sel, events: [] };
  const update = (m: Macro) => setMacros((xs) => [...xs.filter((x) => x.index !== m.index), m].sort((a, b) => a.index - b.index));
  const setEvents = (events: MacroEvent[]) => update({ ...current, events });
  const problems = validateMacro(current, limits);
  const allProblems = macros.flatMap((m) => validateMacro(m, limits));

  const onKey = (e: React.KeyboardEvent, down: boolean) => {
    if (!recording) return;
    e.preventDefault();
    if (e.repeat) return;
    const usage = domCodeToUsage(e.code);
    if (usage === undefined) return;
    const now = performance.now();
    const events = [...current.events];
    if (events.length) events.push({ type: 'delay', ms: Math.min(limits.maxDelayMs, Math.max(limits.minDelayMs, Math.round(now - last.current))) });
    last.current = now;
    events.push({ type: 'key', usage, down });
    setEvents(events);
  };

  const upload = async () => {
    const next = macros.filter((m) => m.events.length);
    const tx: Transaction<Macro[]> = {
      label: t('macros.upload'),
      acknowledged: true,
      apply: (ms) => device.driver.setMacros(ms),
      validate: () => allProblems,
      ...(device.caps.macros.read === 'device' ? { readbackFromDevice: () => device.driver.getMacros() } : {}),
    };
    const r = await apply('macros', tx, applied.filter((m) => m.events.length), next);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(macros);
  };

  const saveProject = async () => {
    await saveRecord({ id: newId(), kind: 'macro-project', name: `${device.info.model} — ${new Date().toLocaleString()}`, data: macros });
    notify({ kind: 'ok', title: t('macros.projectSaved') });
  };
  const loadProject = async () => {
    const [latest] = await listRecords<Macro[]>('macro-project');
    if (latest) setMacros(latest.data);
    else notify({ kind: 'info', title: t('macros.noProject') });
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.macros')}
        lead={t('macros.lead')}
        actions={
          <>
            <button type="button" className="btn ghost" onClick={() => void loadProject()}>
              {t('macros.loadProject')}
            </button>
            <button type="button" className="btn ghost" onClick={() => void saveProject()}>
              {t('macros.saveProject')}
            </button>
          </>
        }
      />
      {!device.caps.macros.write ? (
        <div className="callout info">{t('macros.uploadUnverified')}</div>
      ) : (
        <WriteGateNote gate={gate('macros')} />
      )}
      <p className="small muted">
        <SourceNote source={device.caps.macros.read === 'device' ? 'device' : 'mirror'} /> {t('macros.localNote')}
      </p>
      <div className="grid-side">
        <Card title={t('macros.slots')}>
          <ul className="slot-list">
            {Array.from({ length: Math.min(limits.slots, VISIBLE_SLOTS) }, (_, i) => {
              const m = macros.find((x) => x.index === i);
              const n = m?.events.filter((e) => e.type !== 'delay').length ?? 0;
              return (
                <li key={i}>
                  <button type="button" className={sel === i ? 'on' : ''} aria-current={sel === i} onClick={() => setSel(i)}>
                    {t('macros.slot', { n: i + 1 })} <span className="muted small">{n ? t('macros.events', { n }) : t('macros.empty')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card
          title={t('macros.slot', { n: sel + 1 })}
          actions={
            <>
              <button
                type="button"
                className={`btn ${recording ? 'danger' : ''}`}
                aria-pressed={recording}
                onClick={() => {
                  setRecording(!recording);
                  last.current = performance.now();
                  box.current?.focus();
                }}
              >
                {recording ? t('macros.stop') : t('macros.record')}
              </button>
              <button type="button" className="btn ghost" onClick={() => setEvents([...current.events, { type: 'delay', ms: Math.max(limits.minDelayMs, 50) }])}>
                {t('macros.addDelay')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setEvents([...current.events, { type: 'mouse', button: 'left', down: true }, { type: 'delay', ms: Math.max(limits.minDelayMs, 20) }, { type: 'mouse', button: 'left', down: false }])}
              >
                {t('macros.addClick')}
              </button>
              <button type="button" className="btn ghost" disabled={!current.events.length} onClick={() => setEvents([])}>
                {t('macros.clear')}
              </button>
            </>
          }
        >
          <div
            ref={box}
            tabIndex={0}
            className={`recorder ${recording ? 'rec' : ''}`}
            onKeyDown={(e) => onKey(e, true)}
            onKeyUp={(e) => onKey(e, false)}
            onBlur={() => setRecording(false)}
            aria-label={t('macros.recorderLabel')}
          >
            {recording ? t('macros.recording') : t('macros.recorderIdle')}
          </div>
          {current.events.length === 0 ? (
            <Empty>{t('macros.noEvents')}</Empty>
          ) : (
            <ol className="events">
              {current.events.map((e, i) => (
                <li key={i}>
                  {e.type === 'delay' ? (
                    <label>
                      {t('macros.waitLabel')}{' '}
                      <input
                        type="number"
                        min={limits.minDelayMs}
                        max={limits.maxDelayMs}
                        value={e.ms}
                        onChange={(ev) => setEvents(current.events.map((x, j) => (j === i ? { type: 'delay', ms: Number(ev.target.value) } : x)))}
                      />{' '}
                      ms
                    </label>
                  ) : (
                    <span>{eventText(e, t)}</span>
                  )}
                  <span className="ev-actions">
                    <button type="button" className="btn ghost tiny" onClick={() => setEvents(move(current.events, i, -1))} aria-label={t('macros.up')}>
                      ↑
                    </button>
                    <button type="button" className="btn ghost tiny" onClick={() => setEvents(move(current.events, i, 1))} aria-label={t('macros.down')}>
                      ↓
                    </button>
                    <button type="button" className="btn ghost tiny" onClick={() => setEvents([...current.events.slice(0, i + 1), e, ...current.events.slice(i + 1)])} aria-label={t('macros.duplicate')}>
                      ⧉
                    </button>
                    <button type="button" className="btn ghost tiny" onClick={() => setEvents(current.events.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {problems.length > 0 && <p className="error-text">{problems.join('; ')}</p>}
          <p className="small muted">{t('macros.bindHelp')}</p>
        </Card>
      </div>
      <ChangeBar
        status={track.status}
        count={changedSlots}
        verifies={device.caps.macros.read === 'device'}
        canApply={device.caps.macros.write && allProblems.length === 0 && gate('macros').decision.kind !== 'blocked'}
        busy={track.busy}
        blockedReason={allProblems.length ? allProblems.join(' · ') : gate('macros').decision.kind === 'blocked' ? (gate('macros').decision as { reason: string }).reason : undefined}
        onDiscard={() => {
          setMacros(applied);
          track.discarded();
        }}
        onApply={() => void upload()}
        applyLabel={t('macros.uploadN', { n: changedSlots })}
      />
    </div>
  );
}
