import type { DetectionVerdict, ProbeOperation } from '@openkey/protocols';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Card, EvidenceBadge } from '../../components/ui.js';
import { CONTRIBUTE_KEYBOARD_URL } from '../../config.js';

/**
 * What OpenKey concluded about a device and the one safe thing to do next. Reasons, conflicts and
 * unknowns come from the detection layer verbatim, so the card never says more than the evidence.
 */
export function VerdictCard({
  verdict,
  onIdentify,
  busy = false,
  evidence,
}: {
  verdict: DetectionVerdict;
  /** Detection evidence lines ("Detected because…"), shown collapsed. */
  evidence?: string[];
  /** Offered only for a live device; offline analysis cannot run a handshake. */
  onIdentify?: (adapterId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const k = verdict.kind;
  const next = verdict.next;
  return (
    <Card title={t('verdict.title')} id="verdict">
      <div className="verdict-head">
        <span className={`pill vd-${k.toLowerCase()}`}>{t(`verdict.${k}` as MessageKey)}</span>
        {/* A simulator answers like firmware, so its detection confidence would read as hardware evidence. */}
        {k !== 'SIMULATED' && (
          <span className={`pill dc-${verdict.confidence.toLowerCase()}`}>{t(`detect.${verdict.confidence}` as MessageKey)}</span>
        )}
        <span className={`pill ${verdict.writeEligible ? 'wd-experimental' : 'wd-blocked'}`}>
          {verdict.writeEligible ? t('verdict.configurable') : t('verdict.notConfigurable')}
        </span>
      </div>
      <p>{t(`verdict.${k}.lead` as MessageKey)}</p>
      {/* For a simulator the lead already says everything the reason would. */}
      {k !== 'SIMULATED' && (
        <ul className="verdict-list">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {verdict.conflicts.length > 0 && (
        <>
          <h3 className="h-sub">{t('verdict.conflicts')}</h3>
          <ul className="verdict-list conflicts">
            {verdict.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {evidence && evidence.length > 0 && (
        <details className="small">
          <summary>{t('verdict.evidence')}</summary>
          <ul className="explain">
            {evidence.map((line, i) => (
              <li key={i} className={line.startsWith('•') ? 'sub' : ''}>
                {line.replace(/^•\s*/, '')}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="small">
        <summary>{t('verdict.unknowns', { n: verdict.unknowns.length })}</summary>
        <ul className="verdict-list">
          {verdict.unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </details>
      <h3 className="h-sub">{t('verdict.next')}</h3>
      {next.kind === 'consent-probe' ? (
        <ProbeConsent adapterId={next.adapterId} operations={next.operations} onIdentify={onIdentify} busy={busy} />
      ) : next.kind === 'connect-device' ? (
        <p>{t('verdict.next.connect', { adapter: next.adapterId })}</p>
      ) : next.kind === 'switch-transport' ? (
        <p>{t('verdict.next.transport', { links: next.transports.join(', ').toUpperCase() })}</p>
      ) : next.kind === 'configure' ? (
        <p>{t('verdict.next.configure')}</p>
      ) : (
        <p>
          {t('verdict.next.contribute')}{' '}
          <a href={CONTRIBUTE_KEYBOARD_URL} target="_blank" rel="noopener noreferrer">
            {t('verdict.next.guide')}
          </a>
        </p>
      )}
    </Card>
  );
}

/** Exactly what an identification handshake sends, and an explicit button to allow it. */
function ProbeConsent({
  adapterId,
  operations,
  onIdentify,
  busy,
}: {
  adapterId: string;
  operations: ProbeOperation[];
  onIdentify?: (adapterId: string) => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <div className="callout info">
      <p>{t('consent.body', { adapter: adapterId })}</p>
      <div className="table-wrap">
        <table className="tbl small probe-ops">
          <thead>
            <tr>
              <th scope="col">{t('consent.col.op')}</th>
              <th scope="col">{t('consent.col.collection')}</th>
              <th scope="col">ID</th>
              <th scope="col">{t('consent.col.bytes')}</th>
              <th scope="col">{t('consent.col.effect')}</th>
              <th scope="col">{t('overview.col.evidence')}</th>
              <th scope="col">{t('consent.col.purpose')}</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((o, i) => (
              <tr key={i}>
                <td>{o.op === 'feature-set' || o.op === 'output' ? t('consent.sends', { op: o.op }) : t('consent.reads', { op: o.op })}</td>
                <td>{o.collection}</td>
                <td>{o.reportId}</td>
                <td className="hex">{o.payloadPrefix ? `${o.payloadPrefix} …` : '—'}</td>
                <td>{t(`consent.effect.${o.effect}` as MessageKey)}</td>
                <td>
                  <EvidenceBadge value={o.evidence} />
                </td>
                <td className="small">{o.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">{t('consent.never')}</p>
      {onIdentify && (
        <button type="button" className="btn primary" disabled={busy} onClick={() => onIdentify(adapterId)}>
          {t('consent.allow', { adapter: adapterId })}
        </button>
      )}
    </div>
  );
}
