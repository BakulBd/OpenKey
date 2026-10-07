import type { ReactNode } from 'react';
import type { Evidence, FeatureStatus, FeatureSupport } from '@openkey/core';
import { STATUS_SYMBOL } from '@openkey/core';
import { useT } from '../i18n/i18n.js';

export function Card({
  title,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} aria-labelledby={id && title ? `${id}-h` : undefined}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 id={id ? `${id}-h` : undefined}>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Evidence status with a text label (never colour alone). */
export function EvidenceBadge({ value }: { value: Evidence }) {
  const t = useT();
  return <span className={`pill ev-${value.toLowerCase()}`}>{t(`evidence.${value}`)}</span>;
}

export function StatusBadge({ status }: { status: FeatureStatus }) {
  const t = useT();
  return (
    <span className={`pill st-${status.toLowerCase()}`}>
      <span aria-hidden="true">{STATUS_SYMBOL[status]}</span> {t(`status.${status}`)}
    </span>
  );
}

export function SupportSummary({ s }: { s: FeatureSupport }) {
  const t = useT();
  const parts = [
    s.read === 'device' ? t('support.readDevice') : s.read === 'mirror' ? t('support.readMirror') : null,
    s.write ? t('support.write') : null,
  ].filter(Boolean);
  return <span className="muted small">{parts.join(' · ') || t('support.none')}</span>;
}

export function MirrorNote() {
  const t = useT();
  return (
    <div className="callout info" role="note">
      {t('mirror.note')}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Loading() {
  const t = useT();
  return (
    <div className="loading" role="status">
      {t('common.loading')}
    </div>
  );
}

export function download(name: string, data: unknown, type = 'application/json'): void {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
