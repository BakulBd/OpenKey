import { useEffect, useRef, useState } from 'react';
import type { TftFrame, TftInfo, UploadProgress } from '@openkey/core';
import {
  decodeGif,
  fromRgb565le,
  pattern,
  prepareAnimation,
  redBlueAnimation,
} from '@openkey/tft';
import type { AnimationFrame, FitMode, PatternName } from '@openkey/tft';
import { useKeyboard } from '../state/keyboard.js';
import { Card, Field } from '../components/ui.js';

async function decodeFile(file: File): Promise<AnimationFrame[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49))
    return decodeGif(bytes);
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return [{ image: { width: d.width, height: d.height, data: d.data }, delayMs: 0 }];
}

function Preview({ frame, info }: { frame: TftFrame; info: TftInfo }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = fromRgb565le(frame.pixels, info.width, info.height);
    const ctx = ref.current?.getContext('2d');
    if (ctx)
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(img.data), info.width, info.height),
        0,
        0,
      );
  }, [frame, info]);
  return <canvas ref={ref} width={info.width} height={info.height} className="tft-canvas" />;
}

export function TftPage() {
  const { conn, run } = useKeyboard();
  const [info, setInfo] = useState<TftInfo | null>(null);
  const [source, setSource] = useState<AnimationFrame[]>([]);
  const [fit, setFit] = useState<FitMode>('cover');
  const [dither, setDither] = useState(true);
  const [frames, setFrames] = useState<TftFrame[]>([]);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    void run('Read screen info', (d) => d.getTftInfo(), { quiet: true }).then(
      (i) => i && setInfo(i),
    );
  }, [run]);
  useEffect(() => {
    if (!info || !source.length) return;
    const r = prepareAnimation(source, info, { fit, dither });
    setFrames(r.frames);
    setNote(
      `${r.frames.length} frame(s)${r.dropped ? `, ${r.dropped} dropped to fit the ${info.maxFrames}-frame limit` : ''}${r.clampedDelays ? `, ${r.clampedDelays} delay(s) clamped to ${info.minDelayMs}–${info.maxDelayMs} ms` : ''}`,
    );
    setCurrent(0);
  }, [source, info, fit, dither]);
  useEffect(() => {
    if (frames.length < 2) return;
    const t = setTimeout(
      () => setCurrent((c) => (c + 1) % frames.length),
      Math.max(30, frames[current]?.delayMs ?? 100),
    );
    return () => clearTimeout(t);
  }, [frames, current]);

  if (!conn) return null;
  if (!info)
    return (
      <div className="page">
        This keyboard has no configurable screen on the current connection.
      </div>
    );

  return (
    <div className="page">
      <div className="grid2">
        <Card title="Screen content">
          <Field label="Image or GIF">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={async (e) =>
                e.target.files?.[0] && setSource(await decodeFile(e.target.files[0]))
              }
            />
          </Field>
          <Field label="Test pattern">
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setSource(
                  v === 'red-blue'
                    ? redBlueAnimation(info.width, info.height)
                    : [{ image: pattern(v as PatternName, info.width, info.height), delayMs: 0 }],
                );
              }}
            >
              <option value="">—</option>
              {[
                'red',
                'green',
                'blue',
                'white',
                'black',
                'checkerboard',
                'gradient',
                'quadrants',
                'red-blue',
              ].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Field label="Fit">
              <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
                <option value="cover">Fill (crop)</option>
                <option value="contain">Fit (letterbox)</option>
                <option value="stretch">Stretch</option>
              </select>
            </Field>
            <Field label="Dither">
              <input
                type="checkbox"
                checked={dither}
                onChange={(e) => setDither(e.target.checked)}
              />
            </Field>
          </div>
          <p className="note">{note}</p>
          <dl className="kv">
            <dt>Panel</dt>
            <dd>
              {info.width}×{info.height}, RGB565
            </dd>
            <dt>Frames</dt>
            <dd>up to {info.maxFrames}</dd>
            <dt>Frame delay</dt>
            <dd>
              {info.minDelayMs}–{info.maxDelayMs} ms in {info.delayUnitMs} ms steps
            </dd>
          </dl>
        </Card>
        <Card title="Preview (as the panel will show it)">
          {frames.length ? (
            <>
              <Preview frame={frames[current]!} info={info} />
              {frames.length > 1 && (
                <div className="frames">
                  {frames.map((f, i) => (
                    <label key={i} className={i === current ? 'on' : ''}>
                      #{i + 1}
                      <input
                        type="number"
                        min={info.minDelayMs}
                        max={info.maxDelayMs}
                        step={info.delayUnitMs}
                        value={f.delayMs}
                        onChange={(e) =>
                          setFrames(
                            frames.map((x, j) =>
                              j === i ? { ...x, delayMs: Number(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                      ms
                    </label>
                  ))}
                </div>
              )}
              <div className="row">
                <button
                  className="primary"
                  disabled={!!progress && progress.phase !== 'done'}
                  onClick={() =>
                    void run(
                      'Upload to screen',
                      (d) =>
                        frames.length === 1
                          ? d.uploadTftImage(frames[0]!, setProgress)
                          : d.uploadTftGif(frames, setProgress),
                      { write: true },
                    )
                  }
                >
                  Upload to keyboard
                </button>
                {progress && (
                  <progress max={progress.total} value={progress.sent}>
                    {progress.sent}/{progress.total}
                  </progress>
                )}
              </div>
              <p className="note">
                Uploading replaces the screen's custom animation; it cannot be read back from the
                keyboard first.
              </p>
            </>
          ) : (
            <p className="dim">Choose an image, GIF or test pattern.</p>
          )}
        </Card>
      </div>
      {conn.caps.tftClock.write && (
        <Card title="Clock">
          <button
            onClick={() => void run('Sync clock', (d) => d.syncClock(new Date()), { write: true })}
          >
            Set screen clock to this computer's time
          </button>
        </Card>
      )}
    </div>
  );
}
