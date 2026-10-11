import { buildSupportBundle, hexId, supportBundleToIssue } from '@openkey/core';
import type { ResearchNote, SupportBundle, SupportCollection } from '@openkey/core';
import type { HidCollection } from '@openkey/hid';
import type { Session, RecentError } from '../state/keyboard.js';
import type { ConnectionState } from '@openkey/core';
import { APP_VERSION, ISSUES_URL } from '../config.js';

const reports = (list: { reportId: number; size: number }[]) => list.map(({ reportId, size }) => ({ reportId, size }));

export function toSupportCollection(c: HidCollection): SupportCollection {
  return {
    usagePage: hexId(c.usagePage),
    usage: hexId(c.usage),
    inputReports: reports(c.inputReports),
    outputReports: reports(c.outputReports),
    featureReports: reports(c.featureReports),
  };
}

/** Sanitized diagnostic package for the current session (see core/support-bundle.ts for exclusions). */
export function sessionSupportBundle(session: Session | null, conn: ConnectionState, errors: RecentError[]): SupportBundle {
  const id = session?.group.identity;
  const sel = session?.detection.selected;
  return buildSupportBundle({
    environment: {
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent,
      platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
      webHid: 'hid' in navigator,
      secureContext: isSecureContext,
    },
    device: id
      ? {
          vendorId: hexId(id.vendorId),
          productId: hexId(id.productId),
          productName: id.productName,
          ...(id.manufacturer ? { manufacturer: id.manufacturer } : {}),
          ...(id.serialNumber ? { serialNumber: id.serialNumber } : {}),
          ...(id.release !== undefined ? { release: hexId(id.release) } : {}),
          transport: session!.group.transportHint,
          interfaces: session!.group.interfaces.map((i) => ({
            ...(i.interfaceNumber !== undefined ? { interfaceNumber: i.interfaceNumber } : {}),
            collections: i.collections.map(toSupportCollection),
          })),
        }
      : null,
    adapter:
      session?.kind === 'device' && sel
        ? { id: sel.protocolId, family: session.fingerprint.protocolFamily ?? 'none', evidence: sel.confidence }
        : null,
    detection: session
      ? {
          confidence: session.fingerprint.confidence,
          verdict: session.verdict.kind,
          reasons: session.fingerprint.explanation,
          candidates: session.detection.possibleFamilies.map((f) => `${f.id} (${f.status})`),
        }
      : null,
    ...(session?.kind === 'device' ? { capabilities: session.caps } : {}),
    connectionState: conn.status,
    recentErrors: errors,
  });
}

/** GitHub "new issue" URL with a short body; the full package is attached as a file by the user. */
export function supportIssueUrl(bundle: SupportBundle, kind: 'device-support' | 'bug', notes: ResearchNote[] = []): string {
  const d = bundle.device;
  const title = kind === 'device-support' ? `Device support: ${d ? `${d.productName} (${d.vendorId}:${d.productId})` : 'unknown device'}` : 'Bug report';
  // Browsers and GitHub truncate very long URLs: keep the body to the summary, not the full JSON.
  const body = supportBundleToIssue(bundle, notes).split('<details>')[0] + '\n_Attach the exported diagnostic package (JSON) to this issue._\n';
  return `${ISSUES_URL}?labels=${kind}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body.slice(0, 6000))}`;
}
