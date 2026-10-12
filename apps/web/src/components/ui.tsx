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

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
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
    s.read === 'device'
      ? t('support.readDevice')
      : s.read === 'mirror'
        ? t('support.readMirror')
        : null,
    s.write ? t('support.write') : null,
  ].filter(Boolean);
  return <span className="muted small">{parts.join(' · ') || t('support.none')}</span>;
}

/**
 * Where a value on screen comes from, in one compact line. For write-only firmware the values are
 * OpenKey's own record of its last write, and the details say so; nothing is implied about changes
 * made on the keyboard or with other software.
 */
export function SourceNote({ source }: { source: 'device' | 'mirror' | 'local' }) {
  const t = useT();
  return (
    <details className={`source-note src-${source}`}>
      <summary>
        <span className="source-dot" aria-hidden="true" />
        {t(`source.${source}`)}
      </summary>
      <p className="small">{t(`source.${source}.more`)}</p>
    </details>
  );
}

/** @deprecated kept for pages not yet migrated; renders the compact source note. */
export function MirrorNote() {
  return <SourceNote source="mirror" />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className="spinner"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** A styled file picker: a real <input type=file> inside a label, reachable by keyboard. */
export function FileButton({
  label,
  accept,
  onFile,
  variant = 'default',
}: {
  label: ReactNode;
  accept: string;
  onFile: (file: File) => void;
  variant?: 'default' | 'primary';
}) {
  return (
    <label className={`btn ${variant === 'primary' ? 'primary' : ''} file-btn`}>
      {label}
      <input
        type="file"
        accept={accept}
        className="visually-hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

/** An empty state that says why the area is empty and what to do next. */
export function EmptyState({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

/** What happened, what it means, and the safest next step; technical detail stays collapsed. */
export function ErrorPanel({
  title,
  reason,
  hint,
  detail,
  tone = 'danger',
}: {
  title: ReactNode;
  reason?: ReactNode;
  hint?: ReactNode;
  detail?: string;
  tone?: 'danger' | 'warn';
}) {
  const t = useT();
  return (
    <div className={`error-panel callout ${tone}`} role="alert">
      <strong>{title}</strong>
      {reason && (
        <p>
          <span className="ep-label">{t('error.means')}</span> {reason}
        </p>
      )}
      {hint && (
        <p>
          <span className="ep-label">{t('error.next')}</span> {hint}
        </p>
      )}
      {detail && (
        <details className="small">
          <summary>{t('error.technical')}</summary>
          <code className="wrap-any">{detail}</code>
        </details>
      )}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** An on/off setting as a switch row: label and hint on the left, the switch on the right. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
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
