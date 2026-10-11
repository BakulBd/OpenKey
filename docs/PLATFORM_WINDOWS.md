# Windows

## Web app

Use Chrome, Edge, Opera or Brave (Windows 10 or 11). No driver, installer or administrator rights are
needed: Windows lets the browser open the keyboard's configuration interfaces directly.

1. Quit the keyboard vendor's software. Two programs cannot configure the same keyboard at once, and
   some vendor tools keep the interface open in the background (check the notification area).
2. Connect the keyboard with a USB **data** cable and switch it to wired mode.
3. Open OpenKey and press **Connect keyboard**.

If the keyboard is listed but cannot be opened, OpenKey shows "The keyboard could not be opened" with
these steps and a **Retry** button.

Managed PCs: administrators can pre-approve OpenKey for specific keyboards with Chrome or Edge
policies (Group Policy or registry); see [DEPLOYMENT.md](DEPLOYMENT.md#managed-fleets-chrome-and-edge-policies).

## CLI

```powershell
pnpm install
pnpm openkey list
pnpm openkey detect --verbose
```

On Windows the CLI enumerates through hidapi (node-hid). Windows reports each HID collection's usage
page but not its report sizes, so the flagship adapter identifies the keyboard by its documented
handshake instead of report sizes. USB-level inspection (`pnpm inspect`, endpoints, bInterval) needs
Linux. **Status:** implemented and unit-tested; not yet run against a keyboard on Windows.
