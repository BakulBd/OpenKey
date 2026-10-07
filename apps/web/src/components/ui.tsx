import type { ReactNode } from 'react';
import type { Confidence, FeatureSupport } from '@openak820/core';

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function ConfidenceBadge({ value }: { value: Confidence }) {
  const label = {
    CONFIRMED: 'Confirmed',
    STRONGLY_SUPPORTED: 'Strongly supported',
    INFERRED: 'Inferred',
    UNVERIFIED: 'Unverified',
  }[value];
  return <span className={`badge conf-${value.toLowerCase()}`}>{label}</span>;
}

export function SupportBadge({ s }: { s: FeatureSupport }) {
  if (!s.write && s.read === 'none') return <span className="badge muted">Not available</span>;
  const parts = [
    s.read === 'device' ? 'read' : s.read === 'mirror' ? 'remembered' : null,
    s.write ? 'write' : null,
  ].filter(Boolean);
  return (
    <span className="badge ok" title={s.note}>
      {parts.join(' · ')}
    </span>
  );
}

export function MirrorNote() {
  return (
    <p className="note">
      This keyboard's firmware cannot report this setting. OpenAK820 shows what it last wrote from
      this browser; settings made with other software or on the keyboard itself are not visible
      here.
    </p>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
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
