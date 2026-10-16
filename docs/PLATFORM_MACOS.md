# macOS

## Web app

Use Chrome, Edge, Opera or Brave. Safari does not implement WebHID. No driver is needed.

1. Quit the keyboard vendor's software (including menu-bar helpers).
2. Connect the keyboard with a USB **data** cable in wired mode.
3. Open OpenKey and press **Connect keyboard**.

If a keyboard is listed but cannot be opened: some keyboards are configured through their typing
interface, and macOS then requires **Input Monitoring** for the browser (System Settings → Privacy &
Security → Input Monitoring; restart the browser afterwards). The keyboards OpenKey supports today use
separate vendor interfaces and should not need it. OpenKey shows these steps with a **Retry** button.

On Apple silicon Macs, a newly plugged USB accessory must be allowed first: when macOS asks "Allow
accessory to connect?", choose **Allow**, then connect again.

2.4 GHz receivers (AJAZZ, AULA): macOS can let the browser see only a receiver's typing and media
keys, and keep its configuration endpoints back. Allow the browser under System Settings → Privacy &
Security → **Input Monitoring**, quit and reopen it, replug the receiver and connect again. The cable in
wired mode always gives the full configuration.

**Connection doctor** (Tools → Connection doctor) runs these checks for you, opens and closes the
keyboard without sending anything, and names the fix; `pnpm openkey doctor` does the same from the
terminal.

Managed Macs: a configuration profile can pre-approve OpenKey for specific keyboards; see
[DEPLOYMENT.md](DEPLOYMENT.md#managed-fleets-chrome-and-edge-policies).

## CLI

```sh
pnpm install
pnpm openkey list
pnpm openkey detect --verbose
```

The CLI enumerates through hidapi (node-hid); macOS reports usage pages but not report sizes, so the
flagship adapter identifies the keyboard by its documented handshake. USB-level inspection needs Linux.
**Status:** implemented and unit-tested; not yet run against a keyboard on macOS.
