import type { WriteGate } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';

/** Explains, above a studio, what Apply will do under the safety policy. Silent when writes are normal. */
export function WriteGateNote({ gate }: { gate: WriteGate }) {
  const t = useT();
  if (gate.decision.kind === 'allowed') return null;
  if (gate.decision.kind === 'blocked')
    return (
      <div className="callout muted-callout small" role="note">
        <strong>{t('write.blocked')}</strong> {gate.decision.reason}
      </div>
    );
  return (
    <div className="callout warn small" role="note">
      <strong>{t('write.experimental')}</strong> {gate.decision.reason} {gate.allowed ? t('gate.enabled') : t('gate.optIn')}
    </div>
  );
}
