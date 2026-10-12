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
        <FileButton
          variant="primary"
          accept=".json,application/json"
          label={
            <>
              <Icon name="backup" /> {t('def.load')}
            </>
          }
          onFile={(f) => void load(f)}
        />
      </div>
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
