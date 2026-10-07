import { FEATURES, writeDecision } from '@openkey/core';
import { describeCollections } from '@openkey/hid';
import { useKeyboard } from '../../state/keyboard.js';
import type { DeviceSession, UnknownSession } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, EvidenceBadge, KV, PageHeader, StatusBadge, SupportSummary, download, hex4 } from '../../components/ui.js';
import { sessionSupportBundle, supportIssueUrl } from '../../lib/support.js';
import { Icon } from '../../components/Icon.js';
import { CollectionsTable } from '../shared/CollectionsTable.js';

export default function Overview() {
  const { session } = useKeyboard();
  if (!session) return null;
  return session.kind === 'device' ? <DeviceOverview s={session} /> : <UnknownDevice s={session} />;
}

function DetectionCard({ s }: { s: DeviceSession | UnknownSession }) {
  const t = useT();
  const fp = s.fingerprint;
  return (
    <Card title={t('overview.detection')} id="det">
      <p>
        <span className={`pill dc-${fp.confidence.toLowerCase()}`}>{t(`detect.${fp.confidence}`)}</span>
      </p>
      <ul className="explain">
        {fp.explanation.map((line, i) => (
          <li key={i} className={line.startsWith('•') ? 'sub' : ''}>
            {line.replace(/^•\s*/, '')}
          </li>
        ))}
      </ul>
      {s.detection.notes.length > 0 && (
        <ul className="notes small">
          {s.detection.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeviceOverview({ s }: { s: DeviceSession }) {
  const t = useT();
  const { experimental } = useKeyboard();
  const id = s.info.identity;
  const m = s.manifest;
  // Always the real-hardware policy: the demo simulator allows everything, which says nothing about
  // what a physical keyboard would be allowed to do.
  const ctx = { simulated: false, experimentalEnabled: experimental };
  return (
    <div className="page">
      <PageHeader title={s.info.model} lead={s.demo ? t('overview.demoLead') : t('overview.lead')} />
      {s.demo && <div className="callout info">{t('overview.demoNote')}</div>}
      <div className="grid2">
        <Card title={t('overview.device')}>
          <KV
            rows={[
              [t('overview.vidpid'), <code key="v">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</code>],
              [t('overview.product'), id.productName],
              [t('overview.manufacturer'), id.manufacturer ?? t('common.unknown')],
              [t('overview.firmware'), `${s.info.firmware.version ?? t('common.unknown')} (${s.info.firmware.source})`],
              [t('overview.transport'), s.info.transport.toUpperCase()],
              [t('overview.protocol'), s.info.protocol.name],
            ]}
          />
        </Card>
        <Card title={t('overview.adapter')}>
          <KV
            rows={[
              [t('overview.adapterStatus'), <span key="s" className={`pill cs-${m.status}`}>{t(`compat.status.${m.status}`)}</span>],
              [t('overview.adapterVersion'), m.version],
              [t('overview.inputLinks'), m.transports.input.join(', ').toUpperCase()],
              [t('overview.configLinks'), m.transports.configuration.join(', ').toUpperCase() || t('common.none')],
            ]}
          />
          <p className="small">{m.verification}</p>
          <p className="small muted">{m.safety}</p>
        </Card>
      </div>
      <DetectionCard s={s} />
      <Card title={t('overview.capabilities')} id="caps">
        <div className="table-wrap">
          <table className="tbl">
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
              {FEATURES.filter((f) => s.caps[f].status !== 'UNKNOWN').map((f) => {
                const c = s.caps[f];
                const d = writeDecision(c, ctx);
                return (
                  <tr key={f}>
                    <th scope="row">{t(`feature.${f}`)}</th>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      <SupportSummary s={c} />
                    </td>
                    <td>
                      <EvidenceBadge value={c.confidence} />
                    </td>
                    <td>{c.write ? <span className={`pill wd-${d.kind}`}>{t(`write.${d.kind}`)}</span> : '—'}</td>
                    <td className="small muted">{c.value ?? c.note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t('overview.unknownHidden', { n: FEATURES.filter((f) => s.caps[f].status === 'UNKNOWN').length })}</p>
      </Card>
    </div>
  );
}

/** Unknown-device mode: descriptors only. Nothing is ever written to this device. */
function UnknownDevice({ s }: { s: UnknownSession }) {
  const t = useT();
  const { conn, recentErrors } = useKeyboard();
  const id = s.group.identity;
  const bundle = () => sessionSupportBundle(s, conn, recentErrors);
  return (
    <div className="page">
      <PageHeader title={id.productName || t('dev.unnamed')} lead={t('unknown.lead')} />
      <div className="callout warn" role="note">
        <strong>{t('unknown.noWrite')}</strong> {t('unknown.noWriteBody')}
      </div>
      <div className="grid2">
        <Card title={t('overview.device')}>
          <KV
            rows={[
              [t('overview.vidpid'), <code key="v">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</code>],
              [t('overview.product'), id.productName || '—'],
              [t('overview.manufacturer'), id.manufacturer ?? t('unknown.notExposed')],
              [t('overview.firmware'), id.release !== undefined ? hex4(id.release) : t('unknown.notExposed')],
              [t('unknown.interfaces'), String(s.group.interfaces.length)],
            ]}
          />
        </Card>
        <Card title={t('unknown.actions')}>
          <div className="stack">
            <button type="button" className="btn primary" onClick={() => download(`openkey-diagnostics-${hex4(id.vendorId)}-${hex4(id.productId)}.json`, bundle())}>
              <Icon name="backup" /> {t('unknown.export')}
            </button>
            <a className="btn" href={supportIssueUrl(bundle(), 'device-support')} target="_blank" rel="noopener noreferrer">
              <Icon name="github" /> {t('unknown.request')}
            </a>
            <a className="btn ghost" href="#/lab">
              <Icon name="lab" /> {t('unknown.lab')}
            </a>
          </div>
          <p className="small muted">{t('unknown.exportNote')}</p>
        </Card>
      </div>
      <DetectionCard s={s} />
      <Card title={t('unknown.collections')}>
        <CollectionsTable interfaces={s.group.interfaces} />
        <details className="small">
          <summary>{t('unknown.raw')}</summary>
          <pre className="mono">{s.group.interfaces.map((i) => describeCollections(i.collections).join('\n')).join('\n\n')}</pre>
        </details>
      </Card>
    </div>
  );
}
