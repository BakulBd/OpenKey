import { PROFILES } from '@openak820/profiles';
import { createDefaultRegistry } from '@openak820/protocols';
import { useKeyboard } from '../state/keyboard.js';
import { Card } from '../components/ui.js';

export function ProfilesPage() {
  const { conn, experimental, setExperimental } = useKeyboard();
  const protocols = createDefaultRegistry().list();
  return (
    <div className="page">
      <Card title="Known models">
        <table className="tbl">
          <thead>
            <tr>
              <th>Model</th>
              <th>USB identity</th>
              <th>Protocol</th>
              <th>USB</th>
              <th>2.4 GHz</th>
              <th>Bluetooth</th>
            </tr>
          </thead>
          <tbody>
            {PROFILES.map((p) => (
              <tr key={p.id} className={conn?.info.profileId === p.id ? 'current' : ''}>
                <td>
                  {p.model}
                  {conn?.info.profileId === p.id && <span className="badge ok">connected</span>}
                </td>
                <td className="mono">
                  {p.vendorIds.join('/')}:{p.productIds.join('/')}{' '}
                  {p.productNames.map((n) => `“${n}”`).join(' ')}
                </td>
                <td>{p.protocolFamily}</td>
                <td>{p.transportModes.usb.configuration}</td>
                <td>{p.transportModes['2.4ghz'].configuration}</td>
                <td>{p.transportModes.bluetooth.configuration}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Profiles only rank candidates. The connected keyboard's HID descriptors and its answers to
          read-only probes decide which protocol is used.
        </p>
      </Card>
      <Card title="Protocol families">
        <ul className="plist">
          {protocols.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong>
              <div className="dim">{p.supportedDevices}</div>
              <div className="dim">Evidence: {p.evidence.join('; ')}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Experimental features">
        <label className="chk">
          <input
            type="checkbox"
            checked={experimental}
            onChange={(e) => setExperimental(e.target.checked)}
          />
          Allow writes that are not yet verified on hardware (reconnect to apply)
        </label>
      </Card>
    </div>
  );
}
