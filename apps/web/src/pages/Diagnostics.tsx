import { useEffect, useState } from 'react';
import { capabilitySummary, formatPacket } from '@openak820/core';
import type { PacketRecord } from '@openak820/core';
import { describeCollections } from '@openak820/hid';
import { formatDetectionReport } from '@openak820/protocols';
import { useKeyboard } from '../state/keyboard.js';
import { Card } from '../components/ui.js';

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DiagnosticsPage() {
  const { conn, lastDetections } = useKeyboard();
  const [packets, setPackets] = useState<PacketRecord[]>([]);
  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('openak820.debug') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!conn) return;
    setPackets([...conn.log.all()].slice(-200));
    return conn.log.subscribe(() => setPackets([...conn.log.all()].slice(-200)));
  }, [conn]);
  const detection = conn?.detection ?? lastDetections[0];
  return (
    <div className="page">
      <Card
        title="Detection"
        actions={
          <>
            <label className="chk">
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => {
                  setDebug(e.target.checked);
                  try {
                    localStorage.setItem('openak820.debug', e.target.checked ? '1' : '0');
                  } catch {
                    /* ignore */
                  }
                }}
              />
              Log packets to console
            </label>
            {detection && (
              <button
                className="ghost"
                onClick={() =>
                  download('openak820-diagnostics.json', {
                    detection,
                    info: conn?.info,
                    capabilities: conn?.caps,
                    packets: conn?.log.toJSON(),
                  })
                }
              >
                Download report
              </button>
            )}
          </>
        }
      >
        {detection ? (
          <pre className="mono">{formatDetectionReport(detection, true)}</pre>
        ) : (
          <p className="dim">Connect a keyboard to see diagnostics.</p>
        )}
      </Card>
      {detection && (
        <Card title="HID collections">
          <table className="tbl">
            <thead>
              <tr>
                <th>Interface</th>
                <th>Collections</th>
              </tr>
            </thead>
            <tbody>
              {detection.interfaces.map((i, n) => (
                <tr key={n}>
                  <td>{i.interfaceNumber ?? `#${n}`}</td>
                  <td className="mono">{describeCollections(i.collections).join('\n')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {conn && (
        <>
          <Card title="Capabilities">
            <pre className="mono">{JSON.stringify(capabilitySummary(conn.caps), null, 2)}</pre>
          </Card>
          <Card title={`Recent packets (${packets.length})`}>
            <pre className="mono packets">
              {packets.map((p) => formatPacket(p)).join('\n') || 'none'}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}
