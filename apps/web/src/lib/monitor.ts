import { isVendorPage } from '@openkey/hid';

export interface MonitoredReport {
  /** performance.now() when the browser delivered the report. */
  at: number;
  reportId: number;
  usagePage: number;
  length: number;
  bytes: Uint8Array;
}

/**
 * Listens to input reports on the *vendor* collections of an already-authorised device. Started
 * only by an explicit user action; standard keyboard collections are never monitored (Chromium
 * blocks them anyway), so ordinary typing is never captured.
 */
export async function startReportMonitor(
  identity: { vendorId: number; productId: number },
  onReport: (r: MonitoredReport) => void,
): Promise<{ stop: () => void; collections: number }> {
  const hid = (navigator as Navigator & { hid?: HID }).hid;
  if (!hid) return { stop: () => undefined, collections: 0 };
  const devices = (await hid.getDevices()).filter(
    (d) =>
      d.vendorId === identity.vendorId &&
      d.productId === identity.productId &&
      (d.collections ?? []).some(
        (c) => isVendorPage(c.usagePage ?? 0) && (c.inputReports?.length ?? 0) > 0,
      ),
  );
  const handlers: [HIDDevice, (e: HIDInputReportEvent) => void][] = [];
  for (const d of devices) {
    if (!d.opened) await d.open().catch(() => undefined);
    const page = d.collections?.find((c) => isVendorPage(c.usagePage ?? 0))?.usagePage ?? 0;
    const h = (e: HIDInputReportEvent) => {
      const bytes = new Uint8Array(
        e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength),
      );
      onReport({
        at: performance.now(),
        reportId: e.reportId,
        usagePage: page,
        length: bytes.length,
        bytes,
      });
    };
    d.addEventListener('inputreport', h);
    handlers.push([d, h]);
  }
  return {
    collections: handlers.length,
    stop: () => {
      for (const [d, h] of handlers) d.removeEventListener('inputreport', h);
    },
  };
}
