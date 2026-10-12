import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { configStatus } from '@openkey/core';
import type { ConfigStatus, FeatureId, TxOutcome, TxResult } from '@openkey/core';
import { useKeyboard } from '../state/keyboard.js';
import { useT } from '../i18n/i18n.js';
import { Icon } from './Icon.js';
import { Spinner } from './ui.js';

/**
 * Edit-state tracking for one editor: registers unapplied changes with the provider (navigation
 * and unload warn while any exist), follows the provider's operation for this editor's features,
 * and remembers the outcome of the last write until the next write or discard.
 */
export function useChangeTracking(owner: string, features: FeatureId[], dirtyCount: number) {
  const { operation, setUnsaved } = useKeyboard();
  const [last, setLast] = useState<TxOutcome | null>(null);
  const [reverted, setReverted] = useState(false);
  useEffect(() => {
    setUnsaved(owner, dirtyCount);
    if (dirtyCount) setReverted(false);
  }, [owner, dirtyCount, setUnsaved]);
  useEffect(() => () => setUnsaved(owner, 0), [owner, setUnsaved]);
  const mine =
    operation && operation.feature && features.includes(operation.feature) ? operation : null;
  const status: ConfigStatus = configStatus({
    dirty: dirtyCount > 0,
    phase: mine?.phase ?? null,
    lastOutcome: last,
    reverted,
  });
  /** Record a write result; undefined (declined, blocked, busy) leaves the previous state. */
  const record = useCallback((r: TxResult<unknown> | undefined) => {
    if (r && r.outcome !== 'REJECTED' && r.outcome !== 'NO_CHANGES') setLast(r.outcome);
  }, []);
  const discarded = useCallback(() => {
    setLast(null);
    setReverted(true);
  }, []);
  return { status, busy: !!operation, record, discarded };
}

const ICON: Record<ConfigStatus, 'check' | 'warn' | 'info' | 'undo' | null> = {
  clean: null,
  modified: 'info',
  saving: null,
  verifying: null,
  verified: 'check',
  'saved-unverified': 'check',
  mismatch: 'warn',
  failed: 'warn',
  reverted: 'undo',
};

/**
 * The pending-changes bar every editor uses: what state the configuration is in, how many changes
 * are pending, whether the write can be verified, and Discard / Apply in a consistent place.
 */
export function ChangeBar({
  status,
  count,
  verifies,
  onDiscard,
  onApply,
  applyLabel,
  canApply,
  busy,
  blockedReason,
  extra,
}: {
  status: ConfigStatus;
  count: number;
  /** The firmware can report the value, so the write will be checked by reading it back. */
  verifies: boolean;
  onDiscard: () => void;
  onApply: () => void;
  applyLabel: ReactNode;
  canApply: boolean;
  /** Another operation is running. */
  busy: boolean;
  /** Why Apply is unavailable for this feature (policy), shown instead of a silent disabled button. */
  blockedReason?: string | undefined;
  extra?: ReactNode;
}) {
  const t = useT();
  const working = status === 'saving' || status === 'verifying';
  const icon = ICON[status];
  // Nothing pending and nothing to report: a quiet line, not a sticky panel with disabled buttons.
  if (status === 'clean')
    return (
      <p className="cb-idle small muted" role="status">
        <span className="cb-dot" aria-hidden="true" /> {t('config.clean')} ·{' '}
        {verifies ? t('config.willVerify') : t('config.noVerify')}
      </p>
    );
  return (
    <div className={`changebar cb-${status}`} role="region" aria-label={t('config.region')}>
      <div className="cb-state">
        {working ? (
          <Spinner />
        ) : icon ? (
          <Icon name={icon} />
        ) : (
          <span className="cb-dot" aria-hidden="true" />
        )}
        <div>
          <strong>{t(`config.${status}`, { n: count })}</strong>
          <div className="small muted">
            {blockedReason ??
              (status === 'failed'
                ? t('config.failedMore')
                : status === 'mismatch'
                  ? t('config.mismatchMore')
                  : verifies
                    ? t('config.willVerify')
                    : t('config.noVerify'))}
          </div>
        </div>
      </div>
      <div className="cb-actions">
        {extra}
        <button
          type="button"
          className="btn ghost"
          disabled={!count || working}
          onClick={onDiscard}
        >
          {t('common.discard')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!count || !canApply || busy || working}
          onClick={onApply}
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
