import { useEffect, useRef, useState } from 'react';
import type { TftFrame, TftInfo, Transaction, UploadProgress } from '@openkey/core';
import { decodeGif, fromRgb565le, pattern, prepareAnimation, redBlueAnimation, rotateImage } from '@openkey/tft';
import type { AnimationFrame, FitMode, PatternName } from '@openkey/tft';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, KV, Loading, PageHeader } from '../../components/ui.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';
import { newId, saveRecord } from '../../state/db.js';

const PATTERNS: (PatternName | 'red-blue')[] = ['red', 'green', 'blue', 'white', 'black', 'checkerboard', 'gradient', 'quadrants', 'red-blue'];

async function decodeFile(file: File): Promise<AnimationFrame[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49)) return decodeGif(bytes);
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return [{ image: { width: d.width, height: d.height, data: d.data }, delayMs: 0 }];
}

function Preview({ frame, info, label }: { frame: TftFrame; info: TftInfo; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = fromRgb565le(frame.pixels, info.width, info.height);
    ref.current?.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.data), info.width, info.height), 0, 0);
  }, [frame, info]);
  return <canvas ref={ref} width={info.width} height={info.height} className="tft-canvas" role="img" aria-label={label} />;
}

/**
 * Screen studio. All processing is local; only Upload writes. Uploads replace the keyboard's custom
 * animation, which the firmware cannot export, so a TFT upload is always confirmed as high risk.
 */
export default function TftStudio() {
  const t = useT();
  const { device, read, apply, gate, notify } = useKeyboard();
  const [info, setInfo] = useState<TftInfo | null>(null);
  const [source, setSource] = useState<AnimationFrame[]>([]);
  const [fit, setFit] = useState<FitMode>('cover');
  const [dither, setDither] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [frames, setFrames] = useState<TftFrame[]>([]);
  const [stats, setStats] = useState<{ dropped: number; clamped: number }>({ dropped: 0, clamped: 0 });
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [current, setCurrent] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!device?.caps.tft.write) return;
    void read(t('tft.read'), (d) => d.getTftInfo()).then((i) => i && setInfo(i));
  }, [device, read, t]);
  useEffect(() => {
    if (!info || !source.length) return;
    const rotated = source.map((f) => ({ ...f, image: rotateImage(f.image, rotation) }));
    const r = prepareAnimation(rotated, info, { fit, dither });
    setFrames(r.frames);
    setStats({ dropped: r.dropped, clamped: r.clampedDelays });
    setCurrent(0);
  }, [source, info, fit, dither, rotation]);
  useEffect(() => {
    if (frames.length < 2) return;
    const id = setTimeout(() => setCurrent((c) => (c + 1) % frames.length), Math.max(30, frames[current]?.delayMs ?? 100));
    return () => clearTimeout(id);
  }, [frames, current]);

  if (!device) return null;
  const caps = device.caps;

  const upload = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const tx: Transaction<TftFrame[]> = {
      label: t('tft.upload'),
      acknowledged: true,
      apply: (fs) => (fs.length === 1 ? device.driver.uploadTftImage(fs[0]!, setProgress, { signal }) : device.driver.uploadTftGif(fs, setProgress, { signal })),
    };
    await apply(frames.length === 1 ? 'tft' : 'tftGif', tx, undefined, frames);
    abort.current = null;
  };

  const totalMs = frames.reduce((a, f) => a + f.delayMs, 0);
  const bytes = info ? frames.length * info.width * info.height * 2 : 0;

  return (
    <div className="page">
      <PageHeader title={t('nav.screen')} lead={t('tft.lead')} />
      {caps.tft.write && <WriteGateNote gate={gate('tft')} />}
      {caps.tft.write && !info && <Loading />}
      {info && (
        <div className="grid2">
          <Card title={t('tft.source')}>
            <Field label={t('tft.file')}>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => e.target.files?.[0] && setSource(await decodeFile(e.target.files[0]))} />
            </Field>
            <Field label={t('tft.pattern')}>
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setSource(v === 'red-blue' ? redBlueAnimation(info.width, info.height) : [{ image: pattern(v as PatternName, info.width, info.height), delayMs: 0 }]);
                }}
              >
                <option value="">—</option>
                {PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label={t('tft.fit')}>
                <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
                  <option value="cover">{t('tft.fit.cover')}</option>
                  <option value="contain">{t('tft.fit.contain')}</option>
                  <option value="stretch">{t('tft.fit.stretch')}</option>
                </select>
              </Field>
              <Field label={t('tft.rotate')}>
                <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
                  {[0, 1, 2, 3].map((q) => (
                    <option key={q} value={q}>
                      {q * 90}°
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('tft.dither')}>
                <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} />
              </Field>
            </div>
            <KV
              rows={[
                [t('tft.panel'), `${info.width}×${info.height}, RGB565`],
                [t('tft.frames'), t('tft.framesValue', { n: frames.length, max: info.maxFrames })],
                [t('tft.size'), `${(bytes / 1024).toFixed(1)} KiB`],
                [t('tft.fps'), frames.length > 1 && totalMs > 0 ? (frames.length / (totalMs / 1000)).toFixed(1) : '—'],
                [t('tft.delay'), t('tft.delayValue', { min: info.minDelayMs, max: info.maxDelayMs, unit: info.delayUnitMs })],
              ]}
            />
            {(stats.dropped > 0 || stats.clamped > 0) && <p className="small callout warn">{t('tft.adjusted', { dropped: stats.dropped, clamped: stats.clamped })}</p>}
          </Card>
          <Card title={t('tft.preview')}>
            {frames.length ? (
              <>
                <Preview frame={frames[current]!} info={info} label={t('tft.previewLabel')} />
                {frames.length > 1 && (
                  <div className="timeline" aria-label={t('tft.timeline')}>
                    {frames.map((f, i) => (
                      <label key={i} className={i === current ? 'on' : ''}>
                        #{i + 1}
                        <input
                          type="number"
                          min={info.minDelayMs}
                          max={info.maxDelayMs}
                          step={info.delayUnitMs}
                          value={f.delayMs}
                          onChange={(e) => setFrames(frames.map((x, j) => (j === i ? { ...x, delayMs: Number(e.target.value) } : x)))}
                        />
                        ms
                      </label>
                    ))}
                  </div>
                )}
                <div className="row wrap">
                  <button type="button" className="btn primary" disabled={!!progress && progress.phase !== 'done'} onClick={() => void upload()}>
                    {t('tft.upload')}
                  </button>
                  {abort.current && (
                    <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>
                      {t('common.cancel')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      void saveRecord({ id: newId(), kind: 'tft-project', name: `${info.width}×${info.height} — ${new Date().toLocaleString()}`, data: { frames: frames.map((f) => ({ delayMs: f.delayMs, pixels: Array.from(f.pixels) })) } }).then(() =>
                        notify({ kind: 'ok', title: t('tft.projectSaved') }),
                      )
                    }
                  >
                    {t('tft.saveProject')}
                  </button>
                  {progress && (
                    <progress max={progress.total} value={progress.sent} aria-label={t('tft.progress')}>
                      {progress.sent}/{progress.total}
                    </progress>
                  )}
                </div>
                <p className="small muted">{t('tft.uploadNote')}</p>
              </>
            ) : (
              <p className="muted">{t('tft.empty')}</p>
            )}
          </Card>
        </div>
      )}
      {caps.tftClock.write && (
        <Card title={t('tft.clock')}>
          <WriteGateNote gate={gate('tftClock')} />
          <button
            type="button"
            className="btn"
            onClick={() => void apply('tftClock', { label: t('tft.syncClock'), acknowledged: true, apply: (d: Date) => device.driver.syncClock(d) }, undefined, new Date())}
          >
            {t('tft.syncClock')}
          </button>
        </Card>
      )}
      {caps.tftBuiltIn.status === 'NOT_YET_REVERSE_ENGINEERED' && (
        <Card title={t('tft.builtIn')}>
          <p className="callout info">{t('research.title')} — {caps.tftBuiltIn.note}</p>
        </Card>
      )}
    </div>
  );
}
