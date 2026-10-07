import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { BrowserStatus } from '../landing/Landing.js';
import type { RouteDef } from '../../app/routes.js';

/** Shown on device pages when nothing is connected. */
export function ConnectPrompt() {
  const t = useT();
  const { support, connect, connectDemo, inspect, conn } = useKeyboard();
  const busy = conn.status !== 'DISCONNECTED';
  return (
    <div className="page narrow">
      <div className="card connect-card">
        <h1>{t('connect.title')}</h1>
        <p className="lead">{t('connect.lead')}</p>
        <div className="hero-actions">
          <button type="button" className="btn primary" disabled={!support.available || busy} onClick={() => void connect()}>
            <Icon name="plug" /> {t('action.connect')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void connectDemo()}>
            <Icon name="play" /> {t('action.demo')}
          </button>
          <button type="button" className="btn ghost" disabled={!support.available || busy} onClick={() => void inspect()}>
            <Icon name="lab" /> {t('action.inspect')}
          </button>
        </div>
        <BrowserStatus />
        <details className="small">
          <summary>{t('connect.troubleTitle')}</summary>
          <ul>
            <li>{t('connect.trouble.cable')}</li>
            <li>{t('connect.trouble.wired')}</li>
            <li>{t('connect.trouble.linux')}</li>
            <li>{t('connect.trouble.busy')}</li>
          </ul>
        </details>
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
