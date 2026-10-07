import { useEffect, useRef, useState } from 'react';
import { domCodeToUsage, macroToText, usageName, validateMacro } from '@openak820/core';
import type { Macro, MacroEvent } from '@openak820/core';
import { useKeyboard } from '../state/keyboard.js';
import { Card, Empty, MirrorNote } from '../components/ui.js';

function eventLabel(e: MacroEvent): string {
  if (e.type === 'delay') return `wait ${e.ms} ms`;
  if (e.type === 'key') return `${e.down ? '↓' : '↑'} ${usageName(0x07, e.usage)}`;
  return `${e.down ? '↓' : '↑'} mouse ${e.button}`;
}

export function MacrosPage() {
  const { conn, run } = useKeyboard();
  const [macros, setMacros] = useState<Macro[]>([]);
  const [sel, setSel] = useState(0);
  const [recording, setRecording] = useState(false);
  const last = useRef<number>(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void run('Read macros', (d) => d.getMacros(), { quiet: true }).then((m) => m && setMacros(m));
  }, [run]);
  if (!conn) return null;
  const limits = conn.driver.getMacroLimits();
  const current = macros.find((m) => m.index === sel) ?? { index: sel, events: [] };
  const update = (m: Macro) =>
    setMacros((xs) =>
      [...xs.filter((x) => x.index !== m.index), m].sort((a, b) => a.index - b.index),
    );
  const problems = validateMacro(current, limits);

  const onKey = (e: React.KeyboardEvent, down: boolean) => {
    if (!recording) return;
    e.preventDefault();
    if (e.repeat) return;
    const usage = domCodeToUsage(e.code);
    if (usage === undefined) return;
    const now = performance.now();
    const events = [...current.events];
    if (events.length)
      events.push({
        type: 'delay',
        ms: Math.max(limits.minDelayMs, Math.round(now - last.current)),
      });
    last.current = now;
    events.push({ type: 'key', usage, down });
    update({ ...current, events });
  };

  return (
    <div className="page">
      {conn.caps.macros.read === 'mirror' && <MirrorNote />}
      <div className="grid-side">
        <Card title="Slots">
          <ul className="slots">
            {Array.from({ length: Math.min(limits.slots, 24) }, (_, i) => {
              const m = macros.find((x) => x.index === i);
              return (
                <li key={i}>
                  <button className={sel === i ? 'on' : ''} onClick={() => setSel(i)}>
                    Macro {i + 1}{' '}
                    <span className="dim">
                      {m?.events.length
                        ? `${m.events.filter((e) => e.type !== 'delay').length} events`
                        : 'empty'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card
          title={`Macro ${sel + 1}`}
          actions={
            <>
              <button
                className={recording ? 'danger' : 'ghost'}
                onClick={() => {
                  setRecording(!recording);
                  last.current = performance.now();
                  box.current?.focus();
                }}
              >
                {recording ? 'Stop recording' : 'Record'}
              </button>
              <button className="ghost" onClick={() => update({ ...current, events: [] })}>
                Clear
              </button>
              <button
                className="primary"
                disabled={problems.length > 0}
                onClick={() =>
                  void run(
                    'Write macros',
                    (d) => d.setMacros(macros.filter((m) => m.events.length)),
                    { write: true },
                  )
                }
              >
                Save all to keyboard
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
          >
            {recording
              ? 'Recording – type the sequence here, then stop.'
              : 'Press Record, then type the key sequence while this box has focus.'}
          </div>
          {current.events.length === 0 ? (
            <Empty>No events.</Empty>
          ) : (
            <ol className="events">
              {current.events.map((e, i) => (
                <li key={i}>
                  {e.type === 'delay' ? (
                    <label>
                      wait{' '}
                      <input
                        type="number"
                        min={limits.minDelayMs}
                        max={limits.maxDelayMs}
                        value={e.ms}
                        onChange={(ev) =>
                          update({
                            ...current,
                            events: current.events.map((x, j) =>
                              j === i ? { type: 'delay', ms: Number(ev.target.value) } : x,
                            ),
                          })
                        }
                      />{' '}
                      ms
                    </label>
                  ) : (
                    eventLabel(e)
                  )}
                  <button
                    className="x"
                    onClick={() =>
                      update({ ...current, events: current.events.filter((_, j) => j !== i) })
                    }
                    aria-label="remove"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          {problems.length > 0 && <p className="error-text">{problems.join('; ')}</p>}
          <p className="note">{macroToText(current) || '—'}</p>
          <p className="note">
            Assign a macro to a key on the Keymap page (action type “Macro”). Macro names are stored
            only in this browser.
          </p>
        </Card>
      </div>
    </div>
  );
}
