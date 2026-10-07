import { useState } from 'react';
import type { SafetyLevel, WriteDecision } from '@openkey/core';
import { Dialog } from './Dialog.js';
import { useT } from '../i18n/i18n.js';

/** Confirmation before a hardware write; experimental writes require an explicit opt-in first. */
export function SafetyDialog({
  label,
  decision,
  safety,
  experimental,
  onEnableExperimental,
  onClose,
}: {
  label: string;
  decision: WriteDecision;
  safety: SafetyLevel;
  experimental: boolean;
  onEnableExperimental: () => void;
  onClose: (ok: boolean) => void;
}) {
  const t = useT();
  const needsOptIn = decision.kind === 'experimental' && !experimental;
  const [optIn, setOptIn] = useState(false);
  const canProceed = !needsOptIn || optIn;
  const tone = safety === 'HIGH_RISK' || decision.kind === 'experimental' ? 'warn' : 'default';
  return (
    <Dialog
      title={t('safety.title', { label })}
      tone={tone}
      onClose={() => onClose(false)}
      actions={
        <>
          <button type="button" className="btn ghost" onClick={() => onClose(false)} autoFocus>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canProceed}
            onClick={() => {
              if (needsOptIn) onEnableExperimental();
              onClose(true);
            }}
          >
            {t('safety.write')}
          </button>
        </>
      }
    >
      <p>
        <span className={`pill safety-${safety.toLowerCase()}`}>{t(`safety.level.${safety}`)}</span>{' '}
        {t(`safety.explain.${safety}`)}
      </p>
      {decision.kind === 'experimental' && (
        <div className="callout warn">
          <strong>{t('safety.experimentalTitle')}</strong>
          <p>{decision.reason}</p>
          <p>{t('safety.experimentalBody')}</p>
          {needsOptIn && (
            <label className="check">
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
              {t('safety.optIn')}
            </label>
          )}
        </div>
      )}
      <p className="muted small">{t('safety.never')}</p>
    </Dialog>
  );
}
