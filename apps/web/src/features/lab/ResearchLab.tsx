import { useEffect, useMemo, useState } from 'react';
import { cadenceStats, toHex } from '@openkey/core';
import type { PacketRecord } from '@openkey/core';
import { formatDetectionReport } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Empty, KV, PageHeader, download, hex4 } from '../../components/ui.js';
import { CollectionsTable } from '../shared/CollectionsTable.js';
import { sessionSupportBundle, supportIssueUrl } from '../../lib/support.js';
import { startReportMonitor } from '../../lib/monitor.js';
import type { MonitoredReport } from '../../lib/monitor.js';
import { newId, saveRecord } from '../../state/db.js';

type Tab = 'inspector' | 'trace' | 'monitor' | 'capabilities' | 'export';
const TABS: Tab[] = ['inspector', 'trace', 'monitor', 'capabilities', 'export'];

/**
 * Developer tools. Everything here is read-only: there is no raw-write console by design. Report
 * monitoring and trace export happen only on an explicit click.
 */
export default function ResearchLab() {
  const t = useT();
  const { session, device } = useKeyboard();
  const [tab, setTab] = useState<Tab>('inspector');
  return (
    <div className="page">
      <PageHeader title={t('nav.lab')} lead={t('lab.lead')} />
      <div className="tabs" role="tablist" aria-label={t('nav.lab')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={`tab ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>
            {t(`lab.tab.${x}`)}
          </button>
        ))}
      </div>
      {!session && tab !== 'export' ? (
        <Empty>{t('lab.connectFirst')}</Empty>
      ) : tab === 'inspector' ? (
        <Inspector />
      ) : tab === 'trace' ? (
        <Trace />
      ) : tab === 'monitor' ? (
        <Monitor />
      ) : tab === 'capabilities' ? (
        <Card title={t('lab.tab.capabilities')}>
          {device ? (
            <>
              <pre className="mono scroll">{JSON.stringify({ adapter: device.detection.selected, manifest: device.manifest, capabilities: device.caps }, null, 2)}</pre>
              <button type="button" className="btn small" onClick={() => download('openkey-capabilities.json', { manifest: device.manifest, capabilities: device.caps })}>
                {t('lab.download')}
              </button>
            </>
          ) : (
            <p className="muted">{t('lab.noAdapter')}</p>
          )}
        </Card>
      ) : (
        <ExportPanel />
      )}
      <p className="small muted">{t('lab.noRawWrites')}</p>
    </div>
  );
}

function Inspector() {
  const t = useT();
  const { session } = useKeyboard();
  if (!session) return null;
  const id = session.group.identity;
  return (
    <>
      <Card title={t('lab.identity')}>
        <KV
          rows={[
            ['VID:PID', <code key="v">{`${hex4(id.vendorId)}:${hex4(id.productId)}`}</code>],
            [t('overview.product'), id.productName],
            [t('lab.backend'), session.group.backend],
            [t('lab.transportHint'), session.group.transportHint],
            [t('lab.fingerprint'), <code key="f" className="wrap-any">{session.fingerprint.key}</code>],
          ]}
        />
      </Card>
      <Card title={t('unknown.collections')}>
        <CollectionsTable interfaces={session.group.interfaces} />
      </Card>
      <Card title={t('lab.detectionReport')}>
        <pre className="mono scroll">{formatDetectionReport(session.detection, true)}</pre>
      </Card>
    </>
  );
}

function Trace() {
  const t = useT();
  const { session, notify } = useKeyboard();
  const [packets, setPackets] = useState<readonly PacketRecord[]>([]);
  useEffect(() => {
    if (!session) return;
    const log = session.log;
    setPackets([...log.all()]);
    return log.subscribe(() => setPackets([...log.all()]));
  }, [session]);
  const timing = useMemo(() => {
    const d = packets.map((p) => p.durationMs).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    return d.length ? { n: d.length, median: d[Math.floor(d.length / 2)]!, max: d[d.length - 1]! } : null;
  }, [packets]);
  if (!session) return null;
  const save = async () => {
    await saveRecord({ id: newId(), kind: 'trace', name: `${session.group.identity.productName} — ${new Date().toLocaleString()}`, data: session.log.toJSON() });
    notify({ kind: 'ok', title: t('lab.traceSaved') });
  };
  return (
    <Card
      title={t('lab.trace', { n: packets.length })}
      actions={
        <>
          <button type="button" className="btn small ghost" onClick={() => session.log.clear()}>
            {t('lab.clear')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => void save()}>
            {t('lab.saveLocal')}
          </button>
          <button type="button" className="btn small" onClick={() => download('openkey-trace.json', session.log.toJSON())}>
            {t('lab.download')}
          </button>
        </>
      }
    >
      <p className="small muted">{t('lab.traceNote')}</p>
      {timing && <p className="small">{t('lab.timing', { n: timing.n, median: timing.median.toFixed(1), max: timing.max.toFixed(1) })}</p>}
      <div className="table-wrap trace">
        <table className="tbl small mono-cells">
          <thead>
            <tr>
              <th scope="col">t (ms)</th>
              <th scope="col">{t('lab.dir')}</th>
              <th scope="col">{t('lab.kind')}</th>
              <th scope="col">{t('lab.interface')}</th>
              <th scope="col">ID</th>
              <th scope="col">{t('lab.len')}</th>
              <th scope="col">{t('lab.decoded')}</th>
              <th scope="col">{t('lab.latency')}</th>
              <th scope="col">{t('lab.bytes')}</th>
            </tr>
          </thead>
          <tbody>
            {packets.slice(-300).map((p, i) => (
              <tr key={i} className={p.error ? 'err' : ''}>
                <td>{p.t}</td>
                <td>{p.direction === 'host->device' ? '→' : '←'}</td>
                <td>{p.kind}</td>
                <td>{p.iface}</td>
                <td>{p.reportId}</td>
                <td>{p.bytes.length}</td>
                <td>{p.error ? `⚠ ${p.error}` : (p.decoded ?? '')}</td>
                <td>{p.durationMs !== undefined ? p.durationMs.toFixed(1) : ''}</td>
                <td className="hex">{toHex(p.bytes.subarray(0, 16))}{p.bytes.length > 16 ? ' …' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Monitor() {
  const t = useT();
  const { device } = useKeyboard();
  const [on, setOn] = useState(false);
  const [reports, setReports] = useState<MonitoredReport[]>([]);
  const [collections, setCollections] = useState<number | null>(null);
  useEffect(() => {
    if (!on || !device || device.demo) return;
    let stop = () => undefined as void;
    let alive = true;
    setReports([]);
    void startReportMonitor(device.group.identity, (r) => alive && setReports((rs) => [...rs.slice(-999), r])).then((m) => {
      setCollections(m.collections);
      stop = m.stop;
    });
    return () => {
      alive = false;
      stop();
    };
  }, [on, device]);
  const stats = reports.length > 2 ? cadenceStats(reports.map((r) => r.at)) : null;
  return (
    <Card
      title={t('lab.tab.monitor')}
      actions={
        <button type="button" className={`btn small ${on ? 'danger' : 'primary'}`} aria-pressed={on} disabled={!device || device.demo} onClick={() => setOn(!on)}>
          {on ? t('lab.monitorStop') : t('lab.monitorStart')}
        </button>
      }
    >
      <p className="small muted">{t('lab.monitorNote')}</p>
      {(!device || device.demo) && <p className="callout info small">{t('latency.reportsNeedDevice')}</p>}
      {collections === 0 && <p className="callout info small">{t('latency.noVendorInput')}</p>}
      {stats && <p className="small">{t('lab.monitorStats', { n: reports.length, median: stats.medianMs.toFixed(2) })}</p>}
      <pre className="mono scroll">{reports.slice(-50).map((r) => `${r.at.toFixed(1).padStart(10)}  ${hex4(r.usagePage)} id=${r.reportId} len=${r.length}  ${toHex(r.bytes.subarray(0, 24))}`).join('\n') || '—'}</pre>
    </Card>
  );
}

function ExportPanel() {
  const t = useT();
  const { session, conn, recentErrors } = useKeyboard();
  const bundle = sessionSupportBundle(session, conn, recentErrors);
  return (
    <Card title={t('lab.tab.export')}>
      <p>{t('lab.exportLead')}</p>
      <ul className="small">
        {bundle.excluded.map((x) => (
          <li key={x}>{t('lab.excluded', { what: x })}</li>
        ))}
      </ul>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={() => download('openkey-diagnostics.json', bundle)}>
          {t('unknown.export')}
        </button>
        <a className="btn" href={supportIssueUrl(bundle, session?.kind === 'unknown' ? 'device-support' : 'bug')} target="_blank" rel="noopener noreferrer">
          {session?.kind === 'unknown' ? t('unknown.request') : t('footer.bug')}
        </a>
      </div>
      <details className="small">
        <summary>{t('lab.preview')}</summary>
        <pre className="mono scroll">{JSON.stringify(bundle, null, 2)}</pre>
      </details>
    </Card>
  );
}
