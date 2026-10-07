import { useKeyboard } from '../state/keyboard.js';
import { Card } from '../components/ui.js';

export function ConnectScreen() {
  const { support, status, connect, connectDemo, lastDetections } = useKeyboard();
  return (
    <div className="connect">
      <div className="hero">
        <div className="logo">OpenAK820</div>
        <p className="tagline">
          An open-source, cross-platform WebHID configurator for the AJAZZ AK820 keyboard family.
        </p>
      </div>

      {support.available ? (
        <Card title="Connect your keyboard">
          <ol className="steps">
            <li>
              Plug the keyboard in with a USB data cable and set the mode switch to wired.
              Configuration is not possible over Bluetooth.
            </li>
            <li>Click Connect and choose the keyboard in the browser's device dialog.</li>
            <li>
              OpenAK820 reads the HID descriptors, identifies the protocol and shows what your
              keyboard supports.
            </li>
          </ol>
          <div className="row">
            <button
              className="primary big"
              onClick={() => void connect()}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? 'Detecting…' : 'Connect keyboard'}
            </button>
            <button
              className="ghost"
              onClick={() => void connectDemo()}
              disabled={status === 'connecting'}
            >
              Explore with a simulated keyboard
            </button>
          </div>
          <p className="note">
            Linux: Chrome needs permission to open the keyboard's HID interfaces. Install{' '}
            <code>udev/99-openak820.rules</code> from the repository and replug the keyboard if the
            dialog lists it but connecting fails.
          </p>
        </Card>
      ) : (
        <Card title="WebHID is not available" className="warn">
          <p>{support.reason}</p>
          <p>
            OpenAK820 talks to the keyboard through WebHID, which is available in Chromium-based
            browsers (Chrome, Edge, Opera, Brave, Vivaldi) on a secure page (HTTPS or{' '}
            <code>http://localhost</code>). Firefox and Safari do not implement WebHID.
          </p>
          <p>
            The command-line tool <code>openak820</code> offers the same functions without a
            browser.
          </p>
          <button className="ghost" onClick={() => void connectDemo()}>
            Explore with a simulated keyboard
          </button>
        </Card>
      )}

      {lastDetections.length > 0 && (
        <Card title="Last detection attempt">
          {lastDetections.map((d) => (
            <div key={d.device.key} className="detect-mini">
              <strong>{d.device.productName}</strong>{' '}
              {d.device.vendorId.toString(16).padStart(4, '0')}:
              {d.device.productId.toString(16).padStart(4, '0')}
              <ul>
                {d.candidates.map((c) => (
                  <li key={c.protocol.id}>
                    {c.protocol.name}:{' '}
                    {c.match.applicable
                      ? c.probe
                        ? `${c.probe.status} – ${c.probe.summary}`
                        : 'matched'
                      : `no (${c.match.rejections.join('; ')})`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
