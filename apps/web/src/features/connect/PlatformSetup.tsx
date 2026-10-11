import { useState } from 'react';
import { useKeyboard } from '../../state/keyboard.js';
import type { AccessProblem } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';
import { currentOs } from '../../lib/platform.js';
import type { OsName } from '../../lib/platform.js';

/** Files served by the app itself (emitted from udev/ in the repository at build time). */
export const RULE_URL = './linux/99-openkey.rules';
export const INSTALLER_URL = './linux/install-openkey-udev.sh';
const INSTALL_CMD = 'sudo sh ~/Downloads/install-openkey-udev.sh';
const MANUAL_CMD = 'sudo cp ~/Downloads/99-openkey.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger';

function CopyLine({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button
        type="button"
        className="btn small ghost"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setDone(true),
            () => setDone(false),
          )
        }
      >
        {done ? t('lab.report.copied') : t('setup.copy')}
      </button>
    </div>
  );
}

/** The four Linux steps: download, run the installer yourself, replug, retry. */
function LinuxSteps({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <ol className="setup-steps">
      <li>
        <strong>{t('setup.linux.step1')}</strong>
        <div className="row wrap">
          <a className="btn small primary" href={INSTALLER_URL} download="install-openkey-udev.sh">
            <Icon name="backup" /> {t('setup.linux.installer')}
          </a>
          <a className="btn small" href={RULE_URL} download="99-openkey.rules">
            {t('setup.linux.rule')}
          </a>
        </div>
        <span className="small muted">{t('setup.linux.step1Note')}</span>
      </li>
      <li>
        <strong>{t('setup.linux.step2')}</strong>
        <CopyLine text={INSTALL_CMD} />
        <details className="small">
          <summary>{t('setup.linux.manual')}</summary>
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
              {t('setup.retry')}
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
        <LinuxSteps onRetry={busy ? undefined : () => void retryAccess()} />
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
export function PlatformGuide() {
  const t = useT();
  const detected = currentOs();
  const [os, setOs] = useState<OsName>(TABS.includes(detected) ? detected : 'windows');
  return (
    <details className="platform-guide" open={detected === 'linux'}>
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
