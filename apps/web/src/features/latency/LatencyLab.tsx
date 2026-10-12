import { useEffect, useRef, useState } from 'react';
import { cadenceStats } from '@openkey/core';
import type { CadenceStats } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, KV, PageHeader } from '../../components/ui.js';
import { startReportMonitor } from '../../lib/monitor.js';

type Mode = 'taps' | 'repeat' | 'reports';
const MIN_SAMPLES = 10;

function StatsTable({ s, expected }: { s: CadenceStats | null; expected?: number }) {
  const t = useT();
  if (!s) return <p className="muted small">{t('latency.needSamples', { n: MIN_SAMPLES })}</p>;
  const ms = (v: number) => `${v.toFixed(2)} ms`;
  return (
    <KV
      rows={[
        [t('latency.samples'), String(s.samples)],
        [t('latency.mean'), ms(s.meanMs)],
        [t('latency.median'), ms(s.medianMs)],
        ['p95', ms(s.p95Ms)],
        ['p99', ms(s.p99Ms)],
        [t('latency.min'), ms(s.minMs)],
        [t('latency.max'), ms(s.maxMs)],
        [t('latency.jitter'), ms(s.jitterMs)],
        [
          t('latency.missed'),
          s.missed === null
            ? t('latency.noExpected')
            : `${s.missed}${expected ? ` (> ${(expected * 1.5).toFixed(1)} ms)` : ''}`,
        ],
        [
          t('latency.measuredRate'),
          Number.isFinite(s.measuredRateHz) ? `${s.measuredRateHz.toFixed(0)} /s` : '—',
        ],
      ]}
    />
  );
}

/**
 * Measures, never infers. The declared USB interval comes from the device's descriptors; the
 * measured cadence comes from events this browser actually received.
 */
export default function LatencyLab() {
  const t = useT();
  const { device } = useKeyboard();
  const [mode, setMode] = useState<Mode>('taps');
  const [running, setRunning] = useState(false);
  const [stamps, setStamps] = useState<number[]>([]);
  const stop = useRef<(() => void) | null>(null);
  const [reportsAvailable, setReportsAvailable] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    setStamps([]);
    if (mode === 'reports') {
      if (!device || device.demo) return setRunning(false);
      let alive = true;
      void startReportMonitor(
        device.group.identity,
        (r) => alive && setStamps((s) => [...s.slice(-4999), r.at]),
      ).then((m) => {
        setReportsAvailable(m.collections);
        stop.current = m.stop;
      });
      return () => {
        alive = false;
        stop.current?.();
      };
    }
    const on = (e: KeyboardEvent) => {
      if (mode === 'taps' && e.repeat) return;
      if (mode === 'repeat' && !e.repeat) return;
      e.preventDefault();
      setStamps((s) => [...s.slice(-4999), e.timeStamp]);
    };
    const halt = () => setRunning(false);
    addEventListener('keydown', on, true);
    addEventListener('blur', halt);
    return () => {
      removeEventListener('keydown', on, true);
      removeEventListener('blur', halt);
    };
  }, [running, mode, device]);

  const stats = stamps.length >= MIN_SAMPLES ? cadenceStats(stamps) : null;
  const declared = device?.caps.pollingRate;

  return (
    <div className="page">
      <PageHeader title={t('nav.latency')} lead={t('latency.lead')} />
      <div className="grid2">
        <Card title={t('latency.declared')}>
          <p>
            {declared && declared.status !== 'UNKNOWN'
              ? declared.value
              : t('latency.declaredUnknown')}
          </p>
          <p className="small muted">{t('latency.declaredNote')}</p>
          <h3 className="h3">{t('latency.configurable')}</h3>
          <p>{declared?.write ? t('status.CONFIGURABLE') : t('latency.notConfigurable')}</p>
        </Card>
        <Card title={t('latency.measure')}>
          <div className="tabs" role="tablist">
            {(['taps', 'repeat', 'reports'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`tab ${mode === m ? 'on' : ''}`}
                onClick={() => {
                  setRunning(false);
                  setMode(m);
                }}
              >
                {t(`latency.mode.${m}`)}
              </button>
            ))}
          </div>
          <p className="small">{t(`latency.mode.${mode}.help`)}</p>
          {mode === 'reports' && (!device || device.demo) && (
            <p className="callout info small">{t('latency.reportsNeedDevice')}</p>
          )}
          {mode === 'reports' && reportsAvailable === 0 && (
            <p className="callout info small">{t('latency.noVendorInput')}</p>
          )}
          <button
            type="button"
            className={`btn ${running ? 'danger' : 'primary'}`}
            aria-pressed={running}
            disabled={mode === 'reports' && (!device || device.demo)}
            onClick={() => setRunning(!running)}
          >
            {running ? t('latency.stop') : t('latency.start')}
          </button>
        </Card>
      </div>
      <Card title={t('latency.results')}>
        <StatsTable s={stats} />
        <p className="small muted">{t(`latency.caveat.${mode}`)}</p>
      </Card>
    </div>
  );
}
