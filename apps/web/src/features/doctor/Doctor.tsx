import { useCallback, useEffect, useMemo, useState } from 'react';
import { doctorSummary, runDoctor } from '@openkey/core';
import type { DoctorCheck, DoctorDevice, DoctorStatus } from '@openkey/core';
import { WebHidBackend } from '@openkey/hid';
import type { HidDeviceGroup } from '@openkey/hid';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { Card, PageHeader, Spinner, download } from '../../components/ui.js';
import { Icon } from '../../components/Icon.js';
import type { IconName } from '../../components/Icon.js';
import { currentOs } from '../../lib/platform.js';
import { doctorDevice, openDenied } from '../../lib/access.js';
import { sessionSupportBundle, supportIssueUrl } from '../../lib/support.js';
import { href } from '../../app/router.js';

const ICON: Record<DoctorStatus, IconName> = {
  pass: 'check',
  info: 'info',
  warn: 'warn',
  fail: 'warn',
};

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * Connection doctor: runs the shared checks (packages/core/src/doctor.ts) for this browser and for
 * one keyboard. Opening the device to test access sends nothing to it; results stay on this page.
 */
export default function Doctor() {
  const t = useT();
  const { support, session, conn, recentErrors, accessProblem } = useKeyboard();
  const [device, setDevice] = useState<DoctorDevice | null>(null);
  const [granted, setGranted] = useState<HidDeviceGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const os = currentOs();

  const refresh = useCallback(async () => {
    if (!support.available) return;
    setGranted(await new WebHidBackend().granted().catch(() => []));
  }, [support.available]);
  useEffect(() => void refresh(), [refresh]);

  // Start from what is already known: the connected keyboard, or the one that could not be opened.
  useEffect(() => {
    if (device) return;
    if (session && !session.group.backend.startsWith('mock'))
      setDevice(doctorDevice(session.group, null));
    else if (accessProblem) {
      const g = granted.find((x) => x.key === accessProblem.device.key);
      if (g) setDevice(doctorDevice(g, accessProblem.detail));
    }
  }, [accessProblem, device, granted, session]);

  const examine = async (g: HidDeviceGroup) => {
    setBusy(true);
    try {
      const open = session?.group.key === g.key ? null : await openDenied(g);
      setDevice(doctorDevice(g, open));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    setBusy(true);
    try {
      const groups = await new WebHidBackend().request([]);
      await refresh();
      if (groups[0]) await examine(groups[0]);
    } catch {
      // The chooser was closed: nothing to examine.
    } finally {
      setBusy(false);
    }
  };

  // VIA's catalogue (loaded with this page only) names boards OpenKey's own catalogue does not.
  const [viaNames, setViaNames] = useState<string[]>([]);
  useEffect(() => {
    if (!device) return;
    let live = true;
    void import('@openkey/devices/via-index').then(
      (m) =>
        live && setViaNames(m.viaBoardsFor(device.vendorId, device.productId).map((b) => b.name)),
    );
    return () => {
      live = false;
    };
  }, [device]);

  const checks = useMemo(
    () =>
      runDoctor({
        runtime: 'browser',
        os,
        webHid: support.available,
        secureContext: support.secureContext,
        embedded: window.self !== window.top,
        ...(device ? { device: { ...device, viaNames } } : {}),
      }),
    [device, os, support.available, support.secureContext, viaNames],
  );
  const summary = doctorSummary(checks);
  const bundle = () => sessionSupportBundle(session, conn, recentErrors);

  return (
    <div className="page narrow">
      <PageHeader title={t('doctor.title')} lead={t('doctor.lead')} />
      <div
        className={`callout ${summary === 'fail' ? 'danger' : summary === 'warn' ? 'warn' : 'info'}`}
      >
        <strong>{t(`doctor.summary.${summary}` as MessageKey)}</strong>
      </div>

      <Card
        title={t('doctor.keyboard')}
        actions={
          <button
            type="button"
            className="btn primary"
            disabled={!support.available || busy}
            onClick={() => void pick()}
          >
            <Icon name="search" /> {t('doctor.pick')}
          </button>
        }
      >
        {busy && <Spinner label={t('doctor.checking')} />}
        {device ? (
          <p>
            <strong>{device.productName || t('dev.unnamed')}</strong>{' '}
            <code className="muted">{`${hex4(device.vendorId)}:${hex4(device.productId)}`}</code>
          </p>
        ) : (
          <p className="muted">{t('doctor.noDevice')}</p>
        )}
        {granted.length > 0 && (
          <div className="chips" role="group" aria-label={t('connect.authorized')}>
            {granted.map((g) => (
              <button
                key={g.key}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => void examine(g)}
              >
                {g.identity.productName || t('dev.unnamed')}{' '}
                <span className="muted">{hex4(g.identity.productId)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="small muted">{t('doctor.sendsNothing')}</p>
      </Card>

      <ul className="doctor-list" aria-label={t('doctor.results')}>
        {checks.map((c) => (
          <CheckRow key={c.id} c={c} />
        ))}
      </ul>

      <Card title={t('doctor.next')}>
        <div className="row wrap">
          <a className="btn" href={href('home')}>
            <Icon name="plug" /> {t('doctor.retry')}
          </a>
          {session && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const id = session.group.identity;
                  download(
                    `openkey-diagnostics-${hex4(id.vendorId)}-${hex4(id.productId)}.json`,
                    bundle(),
                  );
                }}
              >
                <Icon name="backup" /> {t('unknown.export')}
              </button>
              <a
                className="btn ghost"
                href={supportIssueUrl(bundle(), 'device-support')}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="github" /> {t('unknown.request')}
              </a>
            </>
          )}
          <a className="btn ghost" href={href('compat')}>
            <Icon name="compat" /> {t('doctor.findModel')}
          </a>
        </div>
        <p className="small muted">{t('doctor.privacy')}</p>
      </Card>
    </div>
  );
}

function CheckRow({ c }: { c: DoctorCheck }) {
  const t = useT();
  // Translations are keyed by check and status; the English text comes from the shared checks.
  const tr = (part: 'title' | 'detail' | 'fix', text: string | undefined) =>
    text && (t(`doctor.${c.id}.${c.status}.${part}` as MessageKey, c.params) || text);
  return (
    <li className={`doctor-item st-${c.status}`}>
      <Icon name={ICON[c.status]} size={18} />
      <div>
        <strong>{tr('title', c.title)}</strong>
        {c.detail && <p className="small">{tr('detail', c.detail)}</p>}
        {c.fix && (
          <p className="small fix">
            <span className="pill tiny">{t('doctor.fix')}</span> {tr('fix', c.fix)}
          </p>
        )}
      </div>
    </li>
  );
}
