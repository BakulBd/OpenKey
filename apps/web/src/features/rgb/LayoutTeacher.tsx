import { useState } from 'react';
import type { KeyboardDriver } from '@openkey/core';
import type { byTech } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { Spinner } from '../../components/ui.js';

/** The part of the BY Tech driver this panel uses; any driver offering it can be taught. */
interface Learnable {
  readSettingsPage(): Promise<Uint8Array>;
  learnLayout(layout: { effect: number; sleep: number | null; effectTable: number }): Promise<void>;
}

export function isLearnable(d: KeyboardDriver | undefined): d is KeyboardDriver & Learnable {
  return (
    !!d &&
    typeof (d as Partial<Learnable>).readSettingsPage === 'function' &&
    typeof (d as Partial<Learnable>).learnLayout === 'function'
  );
}

type Step = 'start' | 'effect' | 'brightness' | 'done';
type LearnStep = byTech.LearnStep;
type Layout = { effect: number; sleep: number | null; effectTable: number };

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * "Teach OpenKey": finds where this keyboard keeps its lighting settings by watching what changes
 * when the owner presses the keyboard's own shortcuts. Only reads are sent; nothing is written until
 * the owner saves the result and then chooses a lighting change themselves.
 */
export function LayoutTeacher() {
  const t = useT();
  const { device, read, reconnect } = useKeyboard();
  const [step, setStep] = useState<Step>('start');
  const [pages, setPages] = useState<Uint8Array[]>([]);
  const [effectStep, setEffectStep] = useState<LearnStep | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [busy, setBusy] = useState(false);
  const driver = device?.driver;
  if (!isLearnable(driver)) return null;

  const snapshot = async (): Promise<Uint8Array | undefined> => {
    setBusy(true);
    try {
      return await read(t('teach.title'), (d) => (d as unknown as Learnable).readSettingsPage());
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    setProblem(null);
    const p = await snapshot();
    if (!p) return;
    const { byTech } = await import('@openkey/protocols');
    if (!byTech.isValidPage(p)) return setProblem('teach.invalid');
    setPages([p]);
    setStep('effect');
  };

  const observe = async () => {
    const p = await snapshot();
    if (!p) return;
    const { byTech } = await import('@openkey/protocols');
    const prev = pages[pages.length - 1]!;
    const change = byTech.singleChange(prev, p);
    if (!change.ok) {
      setProblem(
        change.reason === 'nothing-changed'
          ? 'teach.nothing'
          : change.reason === 'too-many-changes'
            ? 'teach.tooMany'
            : 'teach.invalid',
      );
      // Keep the latest read as the new baseline, so the next press is compared with it.
      setPages([...pages.slice(0, -1), p]);
      return;
    }
    setProblem(null);
    if (step === 'effect') {
      setEffectStep(change);
      setPages([...pages, p]);
      setStep('brightness');
      return;
    }
    const result = byTech.inferLayout(
      effectStep!,
      change,
      p[(effectStep as { offset: number }).offset]!,
    );
    if (!result.ok) {
      setProblem('teach.inconsistent');
      setPages([p]);
      setEffectStep(null);
      setStep('effect');
      return;
    }
    setLayout(result.layout);
    setStep('done');
  };

  const save = async () => {
    if (!layout) return;
    await read(t('teach.title'), (d) => (d as unknown as Learnable).learnLayout(layout));
    await reconnect();
  };

  const n = step === 'start' ? 0 : step === 'effect' ? 1 : step === 'brightness' ? 2 : 3;
  return (
    <section className="card teach" aria-labelledby="teach-h">
      <h2 id="teach-h">
        <Icon name="lab" /> {t('teach.title')}
      </h2>
      <p>{t('teach.lead')}</p>
      <ol className="setup-steps big" aria-label={t('teach.title')}>
        <li className={n > 0 ? 'done' : ''}>
          <strong>{t('teach.s1')}</strong>
          {step === 'start' && (
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void begin()}
              >
                {busy ? <Spinner /> : <Icon name="play" />} {t('teach.start')}
              </button>
            </div>
          )}
        </li>
        <li className={n > 1 ? 'done' : ''}>
          <strong>{t('teach.s2')}</strong>
          <span className="small muted">{t('teach.s2Note')}</span>
          {step === 'effect' && (
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void observe()}
              >
                {busy ? <Spinner /> : <Icon name="check" />} {t('teach.pressed')}
              </button>
            </div>
          )}
        </li>
        <li className={n > 2 ? 'done' : ''}>
          <strong>{t('teach.s3')}</strong>
          <span className="small muted">{t('teach.s3Note')}</span>
          {step === 'brightness' && (
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void observe()}
              >
                {busy ? <Spinner /> : <Icon name="check" />} {t('teach.pressed')}
              </button>
            </div>
          )}
        </li>
        <li>
          <strong>{t('teach.s4')}</strong>
          {step === 'done' && layout && (
            <div className="stack">
              <p className="small">
                {t('teach.found', { effect: hex2(layout.effect), table: hex2(layout.effectTable) })}
              </p>
              <div className="row wrap">
                <button type="button" className="btn primary" onClick={() => void save()}>
                  <Icon name="check" /> {t('teach.save')}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => (setStep('start'), setPages([]), setLayout(null))}
                >
                  {t('teach.again')}
                </button>
              </div>
            </div>
          )}
        </li>
      </ol>
      {problem && (
        <p className="callout warn small" role="status">
          {t(problem)}
        </p>
      )}
      <p className="small muted">{t('teach.safety')}</p>
    </section>
  );
}
