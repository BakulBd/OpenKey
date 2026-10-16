import { ConnectionLimits } from '../shared/ConnectionLimits.js';
import { FEATURES, writeDecision } from '@openkey/core';
import type { FeatureId } from '@openkey/core';
import { describeCollections } from '@openkey/hid';
import { useKeyboard } from '../../state/keyboard.js';
import type { DeviceSession, UnknownSession } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import {
  Card,
  EvidenceBadge,
  KV,
  PageHeader,
  StatusBadge,
  SupportSummary,
  download,
  hex4,
} from '../../components/ui.js';
import { sessionSupportBundle, supportIssueUrl } from '../../lib/support.js';
import { Icon } from '../../components/Icon.js';
import { CollectionsTable } from '../shared/CollectionsTable.js';
import { VerdictCard } from '../shared/VerdictCard.js';
import { ROUTES } from '../../app/routes.js';
import { href } from '../../app/router.js';
import { bestUiState, isActionable } from '../../state/capability-ui.js';
import type { UiState } from '../../state/capability-ui.js';

export default function Overview() {
  const { session } = useKeyboard();
  if (!session) return null;
  return session.kind === 'device' ? <DeviceOverview s={session} /> : <UnknownDevice s={session} />;
}

/** Features behind each task; device settings has no route-level features because its page is always shown. */
const TASK_FEATURES: Record<string, FeatureId[]> = {
  'settings-device': ['sleep', 'keyResponse', 'winLock', 'altLocks', 'gameMode'],
};

function UiBadge({ state }: { state: UiState }) {
  const t = useT();
  return <span className={`pill ui-${state}`}>{t(`ui.${state}` as MessageKey)}</span>;
}

/**
 * Device home: what this keyboard is, what can be done with it (derived from its capabilities, never
 * from a fixed feature list), how sure OpenKey is, then the technical detail for those who want it.
 */
function DeviceOverview({ s }: { s: DeviceSession }) {
  const t = useT();
  const { experimental, status } = useKeyboard();
  const id = s.info.identity;
  const m = s.manifest;
  // Always the real-hardware policy: the demo simulator allows everything, which says nothing about
  // what a physical keyboard would be allowed to do.
  const ctx = { simulated: false, experimentalEnabled: experimental };
  const tasks = ROUTES.filter(
    (r) => r.section === 'device' && !r.hidden && (r.features ?? TASK_FEATURES[r.id]),
  ).map((r) => ({ r, state: bestUiState(s.caps, (r.features ?? TASK_FEATURES[r.id])!, ctx) }));
  const doable = tasks.filter((x) => isActionable(x.state));
  const notHere = tasks.filter(
    (x) => !isActionable(x.state) && x.state !== 'unknown' && x.state !== 'unsupported',
  );
  const shown = FEATURES.filter((f) => s.caps[f].status !== 'UNKNOWN');

  return (
    <div className="page">
      <header className="device-hero">
        <div>
          <p className="eyebrow">
            {s.demo
              ? t('mode.simulated')
              : `${id.manufacturer ?? t('common.unknown')} · ${s.info.transport.toUpperCase()}`}
          </p>
          <h1>{s.info.model}</h1>
          <p className="lead">{t(status.headline)}</p>
        </div>
        <div className="hero-facts">
          <span className="pill">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</span>
          {s.info.firmware.version && (
            <span className="pill">{t('dev.fw', { v: s.info.firmware.version })}</span>
          )}
          <span className={`pill cs-${m.status}`}>
            {t('overview.adapterIs', { status: t(`compat.status.${m.status}`) })}
          </span>
        </div>
      </header>
      {s.demo && <div className="callout info">{t('overview.demoNote')}</div>}
      <ConnectionLimits />

      <section aria-labelledby="tasks-h" className="tasks-section">
        <h2 id="tasks-h">{t('overview.canDo')}</h2>
        <ul className="tasks">
          {doable.map(({ r, state }) => (
            <li key={r.id}>
              <a className="task" href={href(r.id)}>
                <Icon name={r.icon} size={22} />
                <span className="task-body">
                  <span className="task-title">
                    <strong>{t(r.label)}</strong> <UiBadge state={state} />
                  </span>
                  <span className="small muted">{t(`task.${r.id}` as MessageKey)}</span>
                </span>
              </a>
            </li>
          ))}
          <li>
            <a className="task" href={href('backup')}>
              <Icon name="backup" size={22} />
              <span className="task-body">
                <strong>{t('nav.backup')}</strong>
                <span className="small muted">{t('task.backup')}</span>
              </span>
            </a>
          </li>
        </ul>
        {doable.some((x) => x.state === 'experimental') && (
          <p className="small muted">{t('overview.experimentalExplain')}</p>
        )}
        {notHere.length > 0 && (
          <div className="not-here">
            <h3 className="h-sub">{t('overview.notHere')}</h3>
            <ul className="small">
              {notHere.map(({ r, state }) => (
                <li key={r.id}>
                  <strong>{t(r.label)}</strong> <UiBadge state={state} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <VerdictCard
        verdict={s.verdict}
        evidence={[...s.fingerprint.explanation, ...s.detection.notes]}
      />

      <details className="card disclosure">
        <summary>
          <h2>{t('overview.capabilities')}</h2>
          <span className="muted small">{t('overview.capCount', { n: shown.length })}</span>
        </summary>
        <div className="table-wrap">
          <table className="tbl caps-table">
            <thead>
              <tr>
                <th scope="col">{t('overview.col.feature')}</th>
                <th scope="col">{t('overview.col.status')}</th>
                <th scope="col">{t('overview.col.access')}</th>
                <th scope="col">{t('overview.col.evidence')}</th>
                <th scope="col">{t('overview.col.writeReal')}</th>
                <th scope="col">{t('overview.col.note')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const c = s.caps[f];
                const d = writeDecision(c, ctx);
                return (
                  <tr key={f}>
                    <th scope="row">{t(`feature.${f}`)}</th>
                    <td data-label={t('overview.col.status')}>
                      <StatusBadge status={c.status} />
                    </td>
                    <td data-label={t('overview.col.access')}>
                      <SupportSummary s={c} />
                    </td>
                    <td data-label={t('overview.col.evidence')}>
                      <EvidenceBadge value={c.confidence} />
                    </td>
                    <td data-label={t('overview.col.writeReal')}>
                      {c.write ? (
                        <span className={`pill wd-${d.kind}`}>{t(`write.${d.kind}`)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="small muted" data-label={t('overview.col.note')}>
                      {c.value ?? c.note ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {t('overview.unknownHidden', { n: FEATURES.length - shown.length })}
        </p>
      </details>

      <details className="card disclosure">
        <summary>
          <h2>{t('overview.technical')}</h2>
        </summary>
        <div className="grid2">
          <KV
            rows={[
              [
                t('overview.vidpid'),
                <code key="v">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</code>,
              ],
              [t('overview.product'), id.productName],
              [t('overview.manufacturer'), id.manufacturer ?? t('common.unknown')],
              [
                t('overview.firmware'),
                `${s.info.firmware.version ?? t('common.unknown')} (${s.info.firmware.source})`,
              ],
              [t('overview.transport'), s.info.transport.toUpperCase()],
              [t('overview.protocol'), s.info.protocol.name],
            ]}
          />
          <div>
            <KV
              rows={[
                [
                  t('overview.adapterStatus'),
                  <span key="s" className={`pill cs-${m.status}`}>
                    {t(`compat.status.${m.status}`)}
                  </span>,
                ],
                [t('overview.adapterVersion'), m.version],
                [t('overview.inputLinks'), m.transports.input.join(', ').toUpperCase()],
                [
                  t('overview.configLinks'),
                  m.transports.configuration.join(', ').toUpperCase() || t('common.none'),
                ],
              ]}
            />
            <p className="small">{m.verification}</p>
            <p className="small muted">{m.safety}</p>
          </div>
        </div>
      </details>
    </div>
  );
}

/** Unknown-device mode: inspection first; the verdict says why and what the safe next step is. */
function UnknownDevice({ s }: { s: UnknownSession }) {
  const t = useT();
  const { conn, recentErrors, identify, status } = useKeyboard();
  const id = s.group.identity;
  const bundle = () => sessionSupportBundle(s, conn, recentErrors);
  return (
    <div className="page">
      <PageHeader title={id.productName || t('dev.unnamed')} lead={t(status.headline)} />
      <div className="callout warn" role="note">
        <strong>{t('unknown.noWrite')}</strong>{' '}
        {s.sentReports > 0 ? t('unknown.sentSome', { n: s.sentReports }) : t('unknown.noWriteBody')}
      </div>
      <ConnectionLimits />
      <VerdictCard
        verdict={s.verdict}
        onIdentify={(a) => void identify(a)}
        busy={status.mode === 'connecting'}
        evidence={[...s.fingerprint.explanation, ...s.detection.notes]}
      />
      <div className="grid2">
        <Card title={t('unknown.actions')}>
          <ol className="steps-list">
            <li>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  download(
                    `openkey-diagnostics-${hex4(id.vendorId)}-${hex4(id.productId)}.json`,
                    bundle(),
                  )
                }
              >
                <Icon name="backup" /> {t('unknown.export')}
              </button>
              <span className="small muted">{t('unknown.exportNote')}</span>
            </li>
            <li>
              <a
                className="btn"
                href={supportIssueUrl(bundle(), 'device-support')}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="github" /> {t('unknown.request')}
              </a>
              <span className="small muted">{t('unknown.requestNote')}</span>
            </li>
            <li>
              <a className="btn ghost" href={href('doctor')}>
                <Icon name="doctor" /> {t('connect.doctor')}
              </a>
            </li>
            <li>
              <a className="btn ghost" href={href('lab')}>
                <Icon name="lab" /> {t('unknown.lab')}
              </a>
              <span className="small muted">{t('unknown.labNote')}</span>
            </li>
          </ol>
        </Card>
        <Card title={t('overview.device')}>
          <KV
            rows={[
              [
                t('overview.vidpid'),
                <code key="v">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</code>,
              ],
              [t('overview.product'), id.productName || '—'],
              [t('overview.manufacturer'), id.manufacturer ?? t('unknown.notExposed')],
              [
                t('overview.firmware'),
                id.release !== undefined ? hex4(id.release) : t('unknown.notExposed'),
              ],
              [t('unknown.interfaces'), String(s.group.interfaces.length)],
            ]}
          />
        </Card>
      </div>
      <details className="card disclosure" open>
        <summary>
          <h2>{t('unknown.collections')}</h2>
        </summary>
        <CollectionsTable interfaces={s.group.interfaces} />
        <details className="small">
          <summary>{t('unknown.raw')}</summary>
          <pre className="mono scroll">
            {s.group.interfaces
              .map((i) => describeCollections(i.collections).join('\n'))
              .join('\n\n')}
          </pre>
        </details>
      </details>
    </div>
  );
}
