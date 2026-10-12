import { useKeyboard } from '../state/keyboard.js';
import { useT } from '../i18n/i18n.js';
import type { MessageKey } from '../i18n/i18n.js';
import { Spinner } from '../components/ui.js';

/**
 * Persistent session status: which device, how it is connected, how sure OpenKey is, and what is
 * running right now. Derived from one summary (`status.ts`), so it cannot contradict the overview.
 * Announced politely to screen readers when it changes.
 */
export function StatusBar() {
  const t = useT();
  const { status, session, device, experimental, unsavedCount } = useKeyboard();
  const op = status.operation;
  const name = device?.info.model ?? session?.group.identity.productName ?? null;
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className={`status-dot tone-${status.tone}`} aria-hidden="true" />
      <span className="status-main">
        {name && <strong className="status-name">{name || t('dev.unnamed')}</strong>}
        <span className="status-headline">{t(status.headline)}</span>
      </span>
      {status.mode === 'hardware' && (
        <span className="pill tone-pill-ok">{t('mode.hardware')}</span>
      )}
      {status.mode === 'inspect' && <span className="pill wd-blocked">{t('mode.inspect')}</span>}
      {experimental && device && !device.demo && (
        <span className="pill wd-experimental">{t('mode.experimental')}</span>
      )}
      {unsavedCount > 0 && !op && (
        <span className="pill staged-pill">{t('status.unsaved', { n: unsavedCount })}</span>
      )}
      {op && (
        <span className="status-op">
          <Spinner /> {t(`op.${op.phase}` as MessageKey, { label: op.label })}
        </span>
      )}
    </div>
  );
}
