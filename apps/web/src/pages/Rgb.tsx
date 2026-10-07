import { useEffect, useState } from 'react';
import { hexToRgb, rgbToHex } from '@openkey/core';
import type { Direction, PerKeyRgb, RgbConfig } from '@openkey/core';
import { useKeyboard } from '../state/keyboard.js';
import { Card, Field, MirrorNote } from '../components/ui.js';
import { KeyboardView } from '../components/KeyboardView.js';

export function RgbPage() {
  const { conn, run } = useKeyboard();
  const [cfg, setCfg] = useState<RgbConfig | null>(null);
  useEffect(() => {
    void run('Read lighting', (d) => d.getRgbConfig(), { quiet: true }).then((c) => c && setCfg(c));
  }, [run]);
  if (!conn || !cfg) return <div className="page">Loading…</div>;
  const cat = conn.driver.getRgbEffects();
  const effect = cat.effects.find((e) => e.id === cfg.effect);
  const ctl = effect?.controls;
  const set = (p: Partial<RgbConfig>) => setCfg({ ...cfg, ...p });
  return (
    <div className="page">
      <Card
        title="Lighting effect"
        actions={
          <button
            className="primary"
            onClick={() => void run('Apply lighting', (d) => d.setRgbConfig(cfg), { write: true })}
          >
            Apply
          </button>
        }
      >
        {conn.caps.rgb.read === 'mirror' && <MirrorNote />}
        <div className="effects">
          {cat.effects.map((e) => (
            <button
              key={e.id}
              className={e.id === cfg.effect ? 'chip on' : 'chip'}
              onClick={() => set({ effect: e.id })}
            >
              {e.name}
            </button>
          ))}
          {cat.customEffect !== undefined && cfg.effect === cat.customEffect && (
            <span className="chip on">Per-key (custom)</span>
          )}
        </div>
        <div className="form-grid">
          {(ctl?.color ?? true) && (
            <Field label="Colour">
              <input
                type="color"
                value={rgbToHex(cfg.color)}
                onChange={(e) => set({ color: hexToRgb(e.target.value) })}
              />
            </Field>
          )}
          {(ctl?.colorful ?? true) && (
            <Field label="Rainbow colours">
              <input
                type="checkbox"
                checked={cfg.colorful}
                onChange={(e) => set({ colorful: e.target.checked })}
              />
            </Field>
          )}
          {(ctl?.brightness ?? true) && (
            <Field label={`Brightness ${cfg.brightness}`}>
              <input
                type="range"
                min={cat.brightness.min}
                max={cat.brightness.max}
                value={cfg.brightness}
                onChange={(e) => set({ brightness: Number(e.target.value) })}
              />
            </Field>
          )}
          {(ctl?.speed ?? true) && (
            <Field label={`Speed ${cfg.speed}`}>
              <input
                type="range"
                min={cat.speed.min}
                max={cat.speed.max}
                value={cfg.speed}
                onChange={(e) => set({ speed: Number(e.target.value) })}
              />
            </Field>
          )}
          {ctl && ctl.direction.length > 0 && (
            <Field label="Direction">
              <select
                value={cfg.direction}
                onChange={(e) => set({ direction: e.target.value as Direction })}
              >
                {ctl.direction.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <p className="note">
          Which controls each effect honours is inferred from community testing; the firmware
          ignores fields an effect does not use.
        </p>
      </Card>
    </div>
  );
}

export function PerKeyPage() {
  const { conn, run } = useKeyboard();
  const [colors, setColors] = useState<PerKeyRgb>({});
  const [brush, setBrush] = useState('#4f7cff');
  useEffect(() => {
    if (conn?.caps.perKeyRgb.read !== 'none')
      void run('Read per-key colours', (d) => d.getPerKeyRgb(), { quiet: true }).then(
        (c) => c && setColors(c),
      );
  }, [conn?.caps.perKeyRgb.read, run]);
  if (!conn) return null;
  const layout = conn.driver.getLayout();
  const paint = (light: number | null) => {
    if (light === null) return;
    setColors((c) => ({ ...c, [light]: hexToRgb(brush) }));
  };
  return (
    <div className="page">
      <Card
        title="Per-key colours"
        actions={
          <>
            <button
              className="ghost"
              onClick={() =>
                void run('Read per-key colours', (d) => d.getPerKeyRgb()).then(
                  (c) => c && setColors(c),
                )
              }
            >
              Read from keyboard
            </button>
            <button
              className="ghost"
              onClick={() => {
                const all: PerKeyRgb = {};
                for (const k of layout.keys) if (k.light !== null) all[k.light] = hexToRgb(brush);
                setColors(all);
              }}
            >
              Fill all
            </button>
            <button
              className="primary"
              onClick={() =>
                void run('Write per-key colours', (d) => d.setPerKeyRgb(colors), { write: true })
              }
            >
              Apply
            </button>
          </>
        }
      >
        <div className="row">
          <Field label="Brush">
            <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} />
          </Field>
          <p className="note">
            Click or drag across keys to paint. Applying switches the lighting effect to the per-key
            table.
          </p>
        </div>
        <KeyboardView
          layout={layout}
          fill={(k) =>
            k.light !== null && colors[k.light] ? rgbToHex(colors[k.light]!) : undefined
          }
          onKey={(k) => paint(k.light)}
          onKeyDrag={(k) => paint(k.light)}
        />
      </Card>
    </div>
  );
}
