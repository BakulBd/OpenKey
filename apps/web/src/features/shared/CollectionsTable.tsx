import type { HidInterfaceInfo } from '@openkey/hid';
import { useT } from '../../i18n/i18n.js';
import { hex4 } from '../../components/ui.js';

const fmt = (list: { reportId: number; size: number }[]): string => list.map((r) => `${r.reportId}:${r.size}B`).join(' ') || '—';

/** HID collections with usage, report IDs, sizes and directions — the core of device inspection. */
export function CollectionsTable({ interfaces }: { interfaces: HidInterfaceInfo[] }) {
  const t = useT();
  return (
    <div className="table-wrap">
      <table className="tbl mono-cells">
        <caption className="small muted">{t('lab.collectionsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('lab.interface')}</th>
            <th scope="col">{t('lab.usage')}</th>
            <th scope="col">{t('lab.input')}</th>
            <th scope="col">{t('lab.output')}</th>
            <th scope="col">{t('lab.feature')}</th>
          </tr>
        </thead>
        <tbody>
          {interfaces.flatMap((i, n) =>
            i.collections.map((c, j) => (
              <tr key={`${n}-${j}`}>
                <td>{i.interfaceNumber ?? `#${n}`}</td>
                <td>
                  {hex4(c.usagePage)}:{hex4(c.usage)} {c.usagePage >= 0xff00 && <span className="pill tiny">{t('lab.vendor')}</span>}
                </td>
                <td>{fmt(c.inputReports)}</td>
                <td>{fmt(c.outputReports)}</td>
                <td>{fmt(c.featureReports)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
