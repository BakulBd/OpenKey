import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { ConnectPanel } from './ConnectPanel.js';
import type { RouteDef } from '../../app/routes.js';

/** Shown on device pages when nothing is connected. */
export function ConnectPrompt() {
  const t = useT();
  return (
    <div className="page narrow">
      <div className="card connect-card">
        <h1>{t('connect.title')}</h1>
        <p className="lead">{t('connect.lead')}</p>
        <ConnectPanel />
      </div>
    </div>
  );
}

/** A device page for hardware that exists but whose protocol is not reverse-engineered yet. */
export function ResearchNeeded({ route }: { route: RouteDef }) {
  const t = useT();
  const { device } = useKeyboard();
  const notes = (route.features ?? []).map((f) => device?.caps[f]).filter((s) => s?.note).map((s) => s!.note!);
  return (
    <div className="page narrow">
      <div className="card">
        <h1>{t(route.label)}</h1>
        <div className="callout info">
          <strong>{t('research.title')}</strong>
          <p>{t('research.body')}</p>
          {notes.map((n) => (
            <p key={n} className="small">
              {n}
            </p>
          ))}
        </div>
        <a className="btn small" href="#/lab">
          {t('research.lab')}
        </a>
      </div>
    </div>
  );
}
