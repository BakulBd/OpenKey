import { useState } from 'react';
import { useKeyboard } from '../../state/keyboard.js';
import type { AccessProblem } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { currentOs } from '../../lib/platform.js';
import { installCommand, ruleCovers, usbId } from '../../lib/udev.js';
import type { OsName } from '../../lib/platform.js';

/** Files served by the app itself (emitted from udev/ in the repository at build time). */
export const RULE_URL = './linux/70-openkey.rules';
export const INSTALLER_URL = './linux/install-openkey-udev.sh';
const MANUAL_CMD = 'sudo cp ~/Downloads/70-openkey.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger';

function CopyLine({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="copy-line">
      <code aria-label={label}>{text}</code>
      <button
        type="button"
        className={`btn small ${done ? 'ghost' : 'primary'}`}
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setDone(true),
            () => setDone(false),
          )
        }
      >
        <Icon name={done ? 'check' : 'copy'} size={14} /> {done ? t('lab.report.copied') : t('setup.copy')}
      </button>
    </div>
  );
}

type SetupDevice = AccessProblem['device'];

/**
 * The Linux setup in three steps: paste one command, replug, retry. The command downloads the
 * installer from this site and runs it with sudo; for a keyboard the shipped rule does not list, it
 * adds that keyboard's USB ID. Downloading the files by hand stays available.
 */
function LinuxSteps({ device, onRetry }: { device?: SetupDevice; onRetry?: () => void }) {
  const t = useT();
  const installer = new URL(INSTALLER_URL, document.baseURI).href;
  const listed = !device || ruleCovers(device.vendorId, device.productId);
  const extra = device && !listed ? ` --device ${usbId(device.vendorId, device.productId)}` : '';
  return (
    <ol className="setup-steps big">
      <li>
        <strong>{t('setup.linux.paste')}</strong>
        <CopyLine text={installCommand(installer, device)} label={t('setup.linux.paste')} />
        <span className="small muted">{t('setup.linux.pasteNote')}</span>
        {!listed && device && <span className="small">{t('setup.linux.addsDevice', { id: usbId(device.vendorId, device.productId).toUpperCase() })}</span>}
        <details className="small">
          <summary>{t('setup.linux.manual')}</summary>
          <div className="row wrap">
            <a className="btn small" href={INSTALLER_URL} download="install-openkey-udev.sh">
              <Icon name="backup" /> {t('setup.linux.installer')}
            </a>
            <a className="btn small ghost" href={RULE_URL} download="70-openkey.rules">
              {t('setup.linux.rule')}
            </a>
          </div>
          <p>{t('setup.linux.step1Note')}</p>
          <CopyLine text={`sudo sh ~/Downloads/install-openkey-udev.sh${extra}`} />
          <p>{t('setup.linux.byHand')}</p>
          <CopyLine text={MANUAL_CMD} />
        </details>
      </li>
      <li>
        <strong>{t('setup.linux.step3')}</strong>
      </li>
      <li>
        <strong>{t('setup.linux.step4')}</strong>
        {onRetry && (
          <div>
            <button type="button" className="btn primary" onClick={onRetry}>
              <Icon name="plug" /> {t('setup.retry')}
            </button>
          </div>
        )}
      </li>
    </ol>
  );
}

/** Shown after the browser listed a device but could not open it. */
export function AccessHelp({ problem }: { problem: AccessProblem }) {
  const t = useT();
  const { retryAccess, conn } = useKeyboard();
  const busy = conn.status !== 'DISCONNECTED';
  if (problem.os === 'linux')
    return (
      <section className="access-help callout warn" role="alert" aria-labelledby="access-h">
        <h2 id="access-h">{t('setup.linux.title')}</h2>
        <p>{t('setup.linux.lead', { name: problem.device.name || t('dev.unnamed') })}</p>
        <LinuxSteps device={problem.device} onRetry={busy ? undefined : () => void retryAccess()} />
        <details className="small">
          <summary>{t('setup.linux.what')}</summary>
          <p>{t('setup.linux.whatBody')}</p>
          <p>
            {t('setup.otherCauses')} <code className="wrap-any">{problem.detail}</code>
          </p>
        </details>
      </section>
    );
  return (
    <section className="access-help callout warn" role="alert" aria-labelledby="access-h">
      <h2 id="access-h">{t('setup.busy.title')}</h2>
      <p>{t('setup.busy.lead', { name: problem.device.name || t('dev.unnamed') })}</p>
      <ol className="setup-steps">
        <li>{t('setup.busy.step1')}</li>
        <li>{t(problem.os === 'macos' ? 'setup.busy.step2mac' : 'setup.busy.step2')}</li>
        <li>{t('setup.busy.step3')}</li>
      </ol>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void retryAccess()}>
        {t('setup.retry')}
      </button>
      <details className="small">
        <summary>{t('error.technical')}</summary>
        <code className="wrap-any">{problem.detail}</code>
      </details>
    </section>
  );
}

const TABS: OsName[] = ['windows', 'macos', 'linux', 'chromeos'];

/** One-time setup per operating system, opened on the detected system. */
export function PlatformGuide({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const t = useT();
  const detected = currentOs();
  const [os, setOs] = useState<OsName>(TABS.includes(detected) ? detected : 'windows');
  return (
    <details className="platform-guide" open={defaultOpen && detected === 'linux'}>
      <summary>{t('setup.guide', { os: t(`os.${detected}` as MessageKey) })}</summary>
      <div className="tabs" role="tablist" aria-label={t('setup.guideTabs')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={os === x} className={`tab ${os === x ? 'on' : ''}`} onClick={() => setOs(x)}>
            {t(`os.${x}` as MessageKey)}
            {x === detected && <span className="muted small"> · {t('setup.thisDevice')}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="guide-body small">
        {os === 'linux' ? (
          <>
            <p>{t('setup.linux.guideLead')}</p>
            <LinuxSteps />
          </>
        ) : (
          <ul>
            {(['1', '2', '3'] as const).map((n) => (
              <li key={n}>{t(`setup.${os}.${n}` as MessageKey)}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
