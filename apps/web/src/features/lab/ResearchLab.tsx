import { useEffect, useMemo, useState } from 'react';
import { cadenceStats, compareDiagnostics, hexId, parseSupportBundle, supportBundleToIssue, toHex } from '@openkey/core';
import type { PacketRecord, ResearchNote, SupportBundle } from '@openkey/core';
import { analyzeDiagnostic, createDefaultRegistry, formatDetectionReport } from '@openkey/protocols';
import type { DiagnosticAnalysis } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, EmptyState, FileButton, KV, PageHeader, download, hex4 } from '../../components/ui.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { CollectionsTable } from '../shared/CollectionsTable.js';
import { sessionSupportBundle, supportIssueUrl } from '../../lib/support.js';
import { startReportMonitor } from '../../lib/monitor.js';
import type { MonitoredReport } from '../../lib/monitor.js';
import { deleteRecord, listRecords, newId, saveRecord } from '../../state/db.js';
import { href } from '../../app/router.js';
import { VerdictCard } from '../shared/VerdictCard.js';

type Tab = 'evidence' | 'inspector' | 'trace' | 'monitor' | 'offline' | 'export';
const TABS: Tab[] = ['evidence', 'inspector', 'trace', 'monitor', 'offline', 'export'];
/** Tabs that work without a connected device. */
const OFFLINE_TABS: Tab[] = ['offline', 'export'];

/**
 * Device Lab: a safe investigation workspace. Everything here reads; there is no raw-write console by
 * design. Capture and exports happen only on an explicit click, and offline analysis works without
 * a device or WebHID.
 */
export default function ResearchLab() {
  const t = useT();
  const { session } = useKeyboard();
  const [tab, setTab] = useState<Tab>(session ? 'evidence' : 'offline');
  return (
    <div className="page">
      <PageHeader title={t('nav.lab')} lead={t('lab.lead')} />
      <div className="tabs" role="tablist" aria-label={t('nav.lab')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={`tab ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>
            {t(`lab.tab.${x}` as MessageKey)}
            {!session && !OFFLINE_TABS.includes(x) && <span className="sr-only"> ({t('lab.needsDevice')})</span>}
          </button>
        ))}
      </div>
      {!session && !OFFLINE_TABS.includes(tab) ? (
        <EmptyState
          title={t('lab.connectFirst')}
          actions={
            <button type="button" className="btn" onClick={() => setTab('offline')}>
              {t('lab.tab.offline')}
            </button>
          }
        >
          {t('lab.connectFirstMore')}
        </EmptyState>
      ) : tab === 'offline' ? (
        <OfflineAnalysis />
      ) : tab === 'evidence' ? (
        <Evidence />
      ) : tab === 'inspector' ? (
        <Inspector />
      ) : tab === 'trace' ? (
        <Trace />
      ) : tab === 'monitor' ? (
        <Monitor />
      ) : (
        <ExportPanel />
      )}
      <p className="small muted">{t('lab.noRawWrites')}</p>
    </div>
  );
}

/**
 * Identification evidence: for every adapter, whether the descriptors matched, which consent policy
 * applied, which probe ran at which level, what came back, and whether the family was identified.
 * Descriptor facts and protocol answers are shown separately from conclusions.
 */
function Evidence() {
  const t = useT();
  const { session } = useKeyboard();
  if (!session) return null;
  const d = session.detection;
  const applicable = d.candidates.filter((c) => c.match.applicable);
  const rejected = d.candidates.filter((c) => !c.match.applicable);
  return (
    <>
      <VerdictCard verdict={session.verdict} />
      <Card title={t('lab.evidence.candidates', { n: applicable.length })}>
        {applicable.length === 0 && <p className="muted">{t('lab.evidence.none')}</p>}
        <ul className="evidence-list">
          {applicable.map((c) => (
            <li key={c.protocol.id}>
              <div className="ev-head">
                <strong>{c.protocol.name}</strong> <code className="muted">{c.protocol.id}</code>
                {c.probe?.identified ? <span className="pill ev-verified">{t('lab.evidence.identified')}</span> : <span className="pill">{t('lab.evidence.notIdentified')}</span>}
              </div>
              <dl className="kv">
                <div className="kv-row">
                  <dt>{t('lab.evidence.descriptors')}</dt>
                  <dd>{c.match.reasons.join('; ') || '—'}</dd>
                </div>
                <div className="kv-row">
                  <dt>{t('lab.evidence.consent')}</dt>
                  <dd>
                    {c.consent
                      ? c.consent.required
                        ? c.consent.granted
                          ? t('lab.evidence.consentGranted', { reason: c.consent.reason })
                          : t('lab.evidence.consentMissing', { reason: c.consent.reason })
                        : t('lab.evidence.consentAuto', { reason: c.consent.reason })
                      : t('lab.evidence.consentNone')}
                  </dd>
                </div>
                <div className="kv-row">
                  <dt>{t('lab.evidence.probe')}</dt>
                  <dd>
                    {c.probe ? `${c.probe.status} · ${t('lab.evidence.level', { level: c.probeLevel ?? d.level })} · ${c.probe.summary}` : '—'}
                  </dd>
                </div>
              </dl>
              {c.probe && c.probe.steps.length > 0 && (
                <table className="tbl small mono-cells">
                  <thead>
                    <tr>
                      <th scope="col">{t('lab.evidence.step')}</th>
                      <th scope="col">{t('overview.col.status')}</th>
                      <th scope="col">{t('lab.evidence.answer')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.probe.steps.map((st, i) => (
                      <tr key={i}>
                        <td>{st.name}</td>
                        <td>{st.status}</td>
                        <td className="wrap-any">
                          {st.detail}
                          {st.raw && <div className="muted">{st.raw.slice(0, 48)}{st.raw.length > 48 ? ' …' : ''}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <details className="card disclosure">
        <summary>
          <h2>{t('lab.evidence.rejected', { n: rejected.length })}</h2>
        </summary>
        <ul className="small">
          {rejected.map((c) => (
            <li key={c.protocol.id}>
              <strong>{c.protocol.id}</strong>: {c.match.rejections.join('; ')}
            </li>
          ))}
        </ul>
        {d.possibleFamilies.length > 0 && (
          <>
            <h3 className="h-sub">{t('lab.evidence.families')}</h3>
            <ul className="small">
              {d.possibleFamilies.map((f) => (
                <li key={f.id}>
                  <strong>{f.name}</strong> ({f.status}): {f.reasons.join('; ')}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
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

/** Most reports kept in memory; older ones are dropped. */
const MONITOR_LIMIT = 1000;

/**
 * Opt-in capture of vendor-collection input reports, for reverse engineering. Off by default, started
 * and stopped explicitly, bounded, cleared when the session ends, and exported only by a separate
 * click. Works for unknown devices too; never for the demo simulator.
 */
function Monitor() {
  const t = useT();
  const { session } = useKeyboard();
  const live = session && !(session.kind === 'device' && session.demo) ? session : null;
  const [on, setOn] = useState(false);
  const [reports, setReports] = useState<MonitoredReport[]>([]);
  const [collections, setCollections] = useState<number | null>(null);
  useEffect(() => {
    if (!live) {
      setOn(false);
      setReports([]);
    }
  }, [live]);
  useEffect(() => {
    if (!on || !live) return;
    let stop = () => undefined as void;
    let alive = true;
    void startReportMonitor(live.group.identity, (r) => alive && setReports((rs) => [...rs.slice(-(MONITOR_LIMIT - 1)), r])).then((m) => {
      setCollections(m.collections);
      if (alive) stop = m.stop;
      else m.stop();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [on, live]);
  const stats = reports.length > 2 ? cadenceStats(reports.map((r) => r.at)) : null;
  const exportCapture = () => {
    if (!live) return;
    const id = live.group.identity;
    download(`openkey-capture-${hex4(id.vendorId)}-${hex4(id.productId)}.json`, {
      format: 'openkey-report-capture',
      version: 1,
      device: { vendorId: hexId(id.vendorId), productId: hexId(id.productId), productName: id.productName },
      note: 'Vendor-collection input reports with payloads, as captured. Review before sharing: a vendor collection can carry key or configuration data.',
      reports: reports.map((r) => ({ ms: Math.round(r.at), usagePage: hexId(r.usagePage), reportId: r.reportId, hex: toHex(r.bytes) })),
    });
  };
  return (
    <Card
      title={t('lab.tab.monitor')}
      actions={
        <>
          <button type="button" className={`btn small ${on ? 'danger' : 'primary'}`} aria-pressed={on} disabled={!live} onClick={() => setOn(!on)}>
            {on ? t('lab.monitorStop') : t('lab.monitorStart')}
          </button>
          <button type="button" className="btn small ghost" disabled={on || reports.length === 0} onClick={() => setReports([])}>
            {t('lab.clear')}
          </button>
          <button type="button" className="btn small" disabled={on || reports.length === 0} onClick={exportCapture}>
            {t('lab.monitorExport')}
          </button>
        </>
      }
    >
      <p className="small muted">{t('lab.monitorNote', { n: MONITOR_LIMIT })}</p>
      {!live && <p className="callout info small">{t('latency.reportsNeedDevice')}</p>}
      {collections === 0 && <p className="callout info small">{t('latency.noVendorInput')}</p>}
      {stats && <p className="small">{t('lab.monitorStats', { n: reports.length, median: stats.medianMs.toFixed(2) })}</p>}
      <pre className="mono scroll">{reports.slice(-50).map((r) => `${r.at.toFixed(1).padStart(10)}  ${hex4(r.usagePage)} id=${r.reportId} len=${r.length}  ${toHex(r.bytes.subarray(0, 24))}`).join('\n') || '—'}</pre>
    </Card>
  );
}

const NOTE_KINDS: ResearchNote['evidence'][] = ['hardware', 'vendor-software', 'inferred', 'hypothesis'];

/**
 * Report: the sanitized diagnostic package, research notes kept in this browser, and an issue text.
 * Notes leave the browser only when the user ticks the box, because they are free text.
 */
function ExportPanel() {
  const t = useT();
  const { session, device, conn, recentErrors } = useKeyboard();
  const bundle = sessionSupportBundle(session, conn, recentErrors);
  const key = session?.fingerprint.key ?? 'no-device';
  const [notes, setNotes] = useState<{ id: string; note: ResearchNote }[]>([]);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<ResearchNote['evidence']>('hardware');
  const [include, setInclude] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = () =>
    void listRecords<ResearchNote>('research-note').then((rs) => setNotes(rs.filter((r) => r.name === key).map((r) => ({ id: r.id, note: r.data }))));
  useEffect(refresh, [key]);
  const shared = include ? notes.map((n) => n.note) : [];
  const issue = supportBundleToIssue(bundle, shared).split('<details>')[0]!.trim();
  const add = async () => {
    if (!draft.trim()) return;
    await saveRecord<ResearchNote>({ id: newId(), kind: 'research-note', name: key, data: { text: draft.trim(), evidence: kind, at: new Date().toISOString() } });
    setDraft('');
    refresh();
  };
  return (
    <>
      <Card title={t('lab.report.package')}>
        <p>{t('lab.exportLead')}</p>
        <ul className="small">
          {bundle.excluded.map((x) => (
            <li key={x}>{t('lab.excluded', { what: x })}</li>
          ))}
        </ul>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={() => download('openkey-diagnostics.json', include ? { ...bundle, notes: shared } : bundle)}>
            {t('unknown.export')}
          </button>
          {device && (
            <button type="button" className="btn ghost" onClick={() => download('openkey-capabilities.json', { manifest: device.manifest, capabilities: device.caps })}>
              {t('lab.report.capabilities')}
            </button>
          )}
        </div>
        <details className="small">
          <summary>{t('lab.preview')}</summary>
          <pre className="mono scroll">{JSON.stringify(include ? { ...bundle, notes: shared } : bundle, null, 2)}</pre>
        </details>
      </Card>

      <Card title={t('lab.report.notes')}>
        <p className="small muted">{t('lab.report.notesLead')}</p>
        <div className="note-form">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label={t('lab.report.noteText')} placeholder={t('lab.report.notePlaceholder')} />
          <div className="row wrap">
            <select value={kind} onChange={(e) => setKind(e.target.value as ResearchNote['evidence'])} aria-label={t('lab.report.noteEvidence')}>
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`lab.report.ev.${k}` as MessageKey)}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!draft.trim()} onClick={() => void add()}>
              {t('lab.report.addNote')}
            </button>
          </div>
        </div>
        {notes.length > 0 && (
          <ul className="record-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span>
                  <span className="pill tiny">{t(`lab.report.ev.${n.note.evidence}` as MessageKey)}</span> {n.note.text}
                </span>
                <button type="button" className="btn ghost tiny" aria-label={t('common.remove')} onClick={() => void deleteRecord(n.id).then(refresh)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="check">
          <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
          {t('lab.report.include', { n: notes.length })}
        </label>
      </Card>

      <Card title={t('lab.report.issue')}>
        <p className="small muted">{t('lab.report.issueLead')}</p>
        <pre className="mono scroll small">{issue}</pre>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void navigator.clipboard?.writeText(issue).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? t('lab.report.copied') : t('lab.report.copy')}
          </button>
          <a className="btn" href={supportIssueUrl(bundle, session?.kind === 'unknown' ? 'device-support' : 'bug', shared)} target="_blank" rel="noopener noreferrer">
            {session?.kind === 'unknown' ? t('unknown.request') : t('footer.bug')}
          </a>
        </div>
        <details className="small">
          <summary>{t('lab.report.nextTitle')}</summary>
          <ol>
            <li>{t('lab.report.next1')}</li>
            <li>{t('lab.report.next2')}</li>
            <li>{t('lab.report.next3')}</li>
            <li>{t('lab.report.next4')}</li>
          </ol>
        </details>
      </Card>
    </>
  );
}

/** Sanitized samples from fixtures/diagnostics, loaded only when picked. */
const SAMPLES = [
  { id: 'ak820', label: 'lab.offline.sample.ak820', file: 'ak820-max-plus-descriptors.json', load: () => import('../../../../../fixtures/diagnostics/ak820-max-plus-descriptors.json?raw') },
  { id: 'a', label: 'lab.offline.sample.a', file: 'unknown-a-258a-015e.json', load: () => import('../../../../../fixtures/diagnostics/unknown-a-258a-015e.json?raw') },
  { id: 'b', label: 'lab.offline.sample.b', file: 'unknown-b-3151-6000.json', load: () => import('../../../../../fixtures/diagnostics/unknown-b-3151-6000.json?raw') },
] as const;

interface Loaded {
  name: string;
  bundle: SupportBundle;
  analysis: DiagnosticAnalysis;
  report: string;
}

/**
 * Offline analysis: parse (which already sanitizes and bounds the file), show what was found before
 * analysing it, then run the same detection code a live device gets at the descriptor level. The
 * rebuilt device cannot open a transport, so nothing can be sent. A second file can be loaded for
 * comparison (firmware versions, wired vs receiver).
 */
function OfflineAnalysis() {
  const t = useT();
  const [pending, setPending] = useState<{ name: string; bundle: SupportBundle } | null>(null);
  const [a, setA] = useState<Loaded | null>(null);
  const [b, setB] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parse = (name: string, text: string) => {
    try {
      setError(null);
      setPending({ name, bundle: parseSupportBundle(text) });
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const analyse = async (slot: 'a' | 'b') => {
    if (!pending) return;
    const analysis = await analyzeDiagnostic(pending.bundle, createDefaultRegistry());
    const loaded = { ...pending, analysis, report: formatDetectionReport(analysis.detection, true) };
    if (slot === 'a') {
      setA(loaded);
      setB(null);
    } else setB(loaded);
    setPending(null);
  };
  const dev = pending?.bundle.device;
  const collections = dev ? dev.interfaces.reduce((n, i) => n + i.collections.length, 0) : 0;
  const missing = dev ? dev.interfaces.flatMap((i) => i.collections).filter((c) => c.usage === null).length : 0;
  const cmp = a && b ? compareDiagnostics(a.bundle.device!, b.bundle.device!) : null;

  return (
    <>
      <Card title={t('lab.tab.offline')}>
        <p>{t('lab.offline.lead')}</p>
        <div className="offline-drop">
          <FileButton variant="primary" label={t('lab.offline.choose')} accept="application/json,.json" onFile={(f) => void f.text().then((text) => parse(f.name, text))} />
          <span className="small muted">{t('lab.offline.samples')}</span>
          {SAMPLES.map((x) => (
            <button key={x.id} type="button" className="btn small" onClick={() => void x.load().then((m) => parse(x.file, m.default))}>
              {t(x.label)}
            </button>
          ))}
        </div>
        {error && (
          <p className="callout danger" role="alert">
            {t('lab.offline.error', { error })}
          </p>
        )}
      </Card>

      {pending && dev && (
        <Card title={t('lab.offline.previewTitle', { name: pending.name })}>
          <KV
            rows={[
              ['VID:PID', <code key="v">{`${dev.vendorId}:${dev.productId}`}</code>],
              [t('overview.product'), dev.productName || '—'],
              [t('lab.offline.contents'), t('lab.offline.counts', { i: dev.interfaces.length, c: collections })],
              [t('lab.offline.notRecorded'), missing ? t('lab.offline.missingUsages', { n: missing }) : t('common.none')],
            ]}
          />
          <p className="small muted">{t('lab.offline.sanitized')}</p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => void analyse('a')}>
              {t('lab.offline.analyse')}
            </button>
            {a && (
              <button type="button" className="btn" onClick={() => void analyse('b')}>
                {t('lab.offline.compareWith', { name: a.name })}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      )}

      {!a && !pending && <EmptyState title={t('lab.offline.emptyTitle')}>{t('lab.offline.emptyBody')}</EmptyState>}

      {a && (
        <>
          <div className="row wrap between">
            <p className="small muted">{t('lab.offline.file', { name: a.name })}</p>
            <button type="button" className="btn small ghost" onClick={() => download(`sanitized-${a.name}`, a.bundle)}>
              {t('lab.offline.downloadSanitized')}
            </button>
          </div>
          <VerdictCard verdict={a.analysis.verdict} evidence={a.analysis.fingerprint.explanation} />
          {cmp && b && (
            <Card title={t('lab.offline.compareTitle', { a: a.name, b: b.name })}>
              <p>
                <span className={`pill vd-${a.analysis.verdict.kind.toLowerCase()}`}>{t(`verdict.${a.analysis.verdict.kind}` as MessageKey)}</span> vs{' '}
                <span className={`pill vd-${b.analysis.verdict.kind.toLowerCase()}`}>{t(`verdict.${b.analysis.verdict.kind}` as MessageKey)}</span>{' '}
                {cmp.sameDescriptors ? t('lab.offline.sameDescriptors') : t('lab.offline.differentDescriptors')}
              </p>
              <div className="table-wrap">
                <table className="tbl small">
                  <thead>
                    <tr>
                      <th scope="col">{t('lab.offline.field')}</th>
                      <th scope="col">A</th>
                      <th scope="col">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.identity.map((r) => (
                      <tr key={r.field} className={r.same ? '' : 'diff-row'}>
                        <th scope="row">{r.field}</th>
                        <td>{r.a}</td>
                        <td>{r.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="compare-list small mono">
                {cmp.collections.map((c) => (
                  <li key={c.signature} className={`side-${c.side}`}>
                    <span className="pill tiny">{c.side === 'both' ? 'A+B' : c.side.toUpperCase()}</span> {c.signature}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={t('unknown.collections')}>
            {a.analysis.missingUsages > 0 && <p className="callout info small">{t('lab.offline.missingUsages', { n: a.analysis.missingUsages })}</p>}
            <CollectionsTable interfaces={a.analysis.group.interfaces} />
          </Card>
          <details className="card disclosure">
            <summary>
              <h2>{t('lab.offline.report')}</h2>
            </summary>
            <pre className="mono scroll">{a.report}</pre>
          </details>
          <p className="small muted">
            {t('lab.offline.contribute')} <a href={href('compat')}>{t('nav.compat')}</a>
          </p>
        </>
      )}
    </>
  );
}
