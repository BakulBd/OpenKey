import { useState } from 'react';
import type { via } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, FileButton } from '../../components/ui.js';
import { KeyboardView } from '../../components/KeyboardView.js';
import { Icon } from '../../components/Icon.js';

type Definition = via.ViaDefinition;
interface DefinitionHost {
  setDefinition(def: Definition): Promise<void>;
  readVialDefinition(): Promise<Definition>;
  useGrid(rows: number, cols: number): Promise<void>;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * VIA boards do not report their physical layout. The user loads the keyboard's VIA definition or QMK
 * info.json once (kept in this browser), or picks a plain matrix grid. Files are parsed as data only.
 */
export function DefinitionPanel() {
  const t = useT();
  const { device, reconnect } = useKeyboard();
  const [preview, setPreview] = useState<Definition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(16);
  const [busy, setBusy] = useState(false);
  if (!device) return null;
  const host = device.driver as unknown as DefinitionHost;
  const id = device.info.identity;
  const mismatch =
    preview &&
    preview.vendorId !== undefined &&
    preview.productId !== undefined &&
    (preview.vendorId !== id.vendorId || preview.productId !== id.productId);

  const load = async (file: File) => {
    setError(null);
    setPreview(null);
    try {
      const { via: v } = await import('@openkey/protocols');
      setPreview(v.parseDefinition(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Asks usevia.app for this keyboard's compiled definition. Only on the user's click. */
  const fetchFromVia = async () => {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const { via: v } = await import('@openkey/protocols');
      for (const url of v.viaDefinitionUrls(id.vendorId, id.productId)) {
        const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) continue;
        setPreview(v.parseDefinition(await r.text()));
        return;
      }
      setError(t('def.viaMissing'));
    } catch (e) {
      setError(e instanceof Error ? `${t('def.viaFailed')} ${e.message}` : t('def.viaFailed'));
    } finally {
      setBusy(false);
    }
  };

  /** Layout options (ISO Enter, split Backspace …) change which keys the picture shows. */
  const choose = async (option: number, choice: number) => {
    if (!preview) return;
    const { via: v } = await import('@openkey/protocols');
    const choices = [...(preview.choices ?? [])];
    while (choices.length < option) choices.push(0);
    choices[option] = choice;
    setPreview(v.withLayoutOptions(preview, choices));
  };

  /** Vial firmware keeps its own layout: read it from the keyboard (read-only Vial commands). */
  const fetchFromKeyboard = async () => {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await host.readVialDefinition());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const use = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await reconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('def.title')}>
      <p>{t('def.lead', { id: `${hex4(id.vendorId)}:${hex4(id.productId)}` })}</p>
      <ul className="small">
        <li>
          {t('def.whereVia')}{' '}
          <a
            href="https://github.com/the-via/keyboards/tree/master/v3"
            target="_blank"
            rel="noopener noreferrer"
          >
            the-via/keyboards
          </a>
        </li>
        <li>
          {t('def.whereQmk')}{' '}
          <a
            href="https://github.com/qmk/qmk_firmware/tree/master/keyboards"
            target="_blank"
            rel="noopener noreferrer"
          >
            qmk/qmk_firmware
          </a>
        </li>
      </ul>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void fetchFromVia()}
        >
          <Icon name="search" /> {t('def.fetchVia')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void fetchFromKeyboard()}
        >
          <Icon name="keymap" /> {t('def.fetchVial')}
        </button>
        <FileButton
          accept=".json,application/json"
          label={
            <>
              <Icon name="backup" /> {t('def.load')}
            </>
          }
          onFile={(f) => void load(f)}
        />
      </div>
      <p className="small muted">{t('def.fetchViaNote')}</p>
      <p className="small muted">{t('def.fetchVialNote')}</p>
      {error && (
        <p className="callout danger small" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="stack">
          <p className="small">
            <strong>{preview.name}</strong> ·{' '}
            {t('def.facts', {
              rows: preview.rows,
              cols: preview.cols,
              keys: preview.layout.keys.length,
            })}
          </p>
          {mismatch && (
            <p className="callout warn small">
              {t('def.mismatch', {
                file: `${hex4(preview.vendorId!)}:${hex4(preview.productId!)}`,
              })}
            </p>
          )}
          {preview.options && preview.options.length > 0 && (
            <fieldset className="layout-options">
              <legend className="small">{t('def.options')}</legend>
              {preview.options.map((o, i) => (
                <label key={o.label} className="small">
                  {o.label}{' '}
                  <select
                    value={preview.choices?.[i] ?? 0}
                    onChange={(e) => void choose(i, Number(e.target.value))}
                  >
                    {o.choices.map((c, j) => (
                      <option key={c + j} value={j}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          <KeyboardView
            layout={preview.layout}
            label={preview.name}
            selected={null}
            scrollHint={t('kb.scrollHint')}
          />
          <div>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void use(() => host.setDefinition(preview))}
            >
              <Icon name="check" /> {t('def.use')}
            </button>
          </div>
        </div>
      )}
      <details className="small">
        <summary>{t('def.noFile')}</summary>
        <p>{t('def.gridLead')}</p>
        <div className="row wrap">
          <label>
            {t('def.rows')}{' '}
            <input
              type="number"
              min={1}
              max={32}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </label>
          <label>
            {t('def.cols')}{' '}
            <input
              type="number"
              min={1}
              max={32}
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void use(() => host.useGrid(rows, cols))}
          >
            {t('def.useGrid')}
          </button>
        </div>
      </details>
      <p className="small muted">{t('def.privacy')}</p>
    </Card>
  );
}
