import { FEATURES, hex16, isAvailable } from '@openkey/core';
import { getProfile } from '@openkey/devices';
import { useKeyboard } from '../state/keyboard.js';
import { Card, EvidenceBadge, SupportBadge } from '../components/ui.js';
import { KeyboardView } from '../components/KeyboardView.js';

const LABELS: Record<string, string> = {
  deviceInfo: 'Device info',
  keymap: 'Keymap',
  fnLayer: 'Fn layer',
  macros: 'Macros',
  rgb: 'RGB effects',
  perKeyRgb: 'Per-key RGB',
  realtimeRgb: 'Real-time RGB',
  tft: 'TFT image',
  tftGif: 'TFT animation',
  tftClock: 'TFT clock',
  battery: 'Battery',
  knob: 'Knob',
  pollingRate: 'Polling rate',
  gameMode: 'Game mode',
  sleep: 'Sleep timer',
  keyResponse: 'Key response',
  winLock: 'Windows key lock',
  altLocks: 'Alt+Tab / Alt+F4 locks',
  factoryDefaults: 'Restore defaults',
};

export function Dashboard() {
  const { conn } = useKeyboard();
  if (!conn) return null;
  const { info, caps, detection, driver } = conn;
  const profile = getProfile(info.profileId);
  const transportConfig =
    profile?.transportModes[info.transport === 'unknown' ? 'usb' : info.transport];
  return (
    <div className="page">
      <div className="grid2">
        <Card title={info.model}>
          <dl className="kv">
            <dt>Firmware</dt>
            <dd>
              {info.firmware.version ?? 'unknown'}{' '}
              <span className="dim">({info.firmware.source})</span>
            </dd>
            <dt>Transport</dt>
            <dd>
              {
                { usb: 'USB', '2.4ghz': '2.4 GHz', bluetooth: 'Bluetooth', unknown: 'Unknown' }[
                  info.transport
                ]
              }
            </dd>
            <dt>Configuration</dt>
            <dd>
              {transportConfig
                ? {
                    supported: 'Supported',
                    partial: 'Partially supported',
                    unsupported: 'Not supported',
                    unknown: 'Unknown',
                  }[transportConfig.configuration]
                : '—'}
            </dd>
            <dt>Protocol</dt>
            <dd>{info.protocol.name}</dd>
            <dt>Detection</dt>
            <dd>
              {detection.selected && <EvidenceBadge value={detection.selected.confidence} />}
            </dd>
            <dt>Battery</dt>
            <dd>
              {info.battery
                ? `${info.battery.level}%${info.battery.charging ? ' (charging)' : ''}`
                : 'not reported'}
            </dd>
            <dt>USB ID</dt>
            <dd>
              {hex16(info.identity.vendorId)}:{hex16(info.identity.productId)} “
              {info.identity.productName}”
            </dd>
          </dl>
          {conn.demo && (
            <p className="note">Simulated keyboard: nothing is sent to real hardware.</p>
          )}
        </Card>
        <Card title="Capabilities">
          <ul className="caps">
            {FEATURES.map((f) => (
              <li key={f} className={isAvailable(caps[f]) ? '' : 'off'}>
                <span>{LABELS[f]}</span>
                <SupportBadge s={caps[f]} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Layout">
        <KeyboardView layout={driver.getLayout()} />
      </Card>
    </div>
  );
}
