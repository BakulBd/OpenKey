import { isWireless, linkSummary } from '@openkey/core';
import type { LinkLimit } from '@openkey/core';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { href } from '../../app/router.js';

/**
 * What this connection allows, said once and the same everywhere: wireless links that carry only
 * part of the configuration (or none), read-only keyboards, and writes that wait for the
 * experimental switch.
 */
export function ConnectionLimits({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { session, device, experimental } = useKeyboard();
  if (!session) return null;
  const link = device ? device.info.transport : session.group.transportHint;
  // Inspection-only sessions: say why the cable matters, without a capability summary.
  if (!device) {
    if (!isWireless(link)) return null;
    return (
      <div className="callout warn limits" role="note">
        <Icon name="warn" /> <strong>{t('limits.unknownWireless.title')}</strong>{' '}
        {t('limits.unknownWireless.body', { link: t(`limits.link.${link}` as MessageKey) })}{' '}
        <a href={href('doctor')}>{t('connect.doctor')}</a>
      </div>
    );
  }
  if (device.demo) return null;
  const s = linkSummary(device.caps, link, { simulated: false, experimentalEnabled: experimental });
  if (!s.limits.length) return null;
  const tone = (l: LinkLimit) => (l === 'experimental-only' ? 'info' : 'warn');
  return (
    <>
      {s.limits.map((l) => (
        <div
          key={l}
          className={`callout ${tone(l)} limits ${compact ? 'compact' : ''}`}
          role="note"
        >
          <Icon name={tone(l) === 'warn' ? 'warn' : 'info'} />{' '}
          <strong>{t(`limits.${l}.title` as MessageKey)}</strong>
          {!compact && (
            <>
              {' '}
              {t(`limits.${l}.body` as MessageKey, {
                link: t(`limits.link.${link}` as MessageKey),
                n: s.experimental,
              })}
            </>
          )}
          {l === 'experimental-only' && (
            <>
              {' '}
              <a href={href('settings')}>{t('limits.openSettings')}</a>
            </>
          )}
          {l !== 'experimental-only' && (
            <>
              {' '}
              <a href={href('doctor')}>{t('connect.doctor')}</a>
            </>
          )}
        </div>
      ))}
    </>
  );
}
