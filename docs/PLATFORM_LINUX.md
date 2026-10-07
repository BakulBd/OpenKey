# Linux

## Permissions

`/dev/hidraw*` nodes belong to root by default, so both Chromium (WebHID) and the CLI need a udev rule:

```sh
sudo cp udev/99-openkey.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then unplug and replug the keyboard. The rule grants access to the logged-in user (`uaccess`) and the
`plugdev` group for the specific VID:PIDs OpenKey has adapters for (AK820-family keyboards and
receivers). It does not change the keyboard; it only allows a program you run to open it.

Inspecting an **unknown** keyboard reads only the descriptors the browser already has, but some
Chromium builds list a device only when its hidraw node is readable. If yours does not appear, add a
temporary line for its VID:PID (shown by `lsusb`) in the same form, and remove it afterwards.

Symptoms without the rule: the browser lists the keyboard but connecting fails with "Permission denied"
(OpenKey shows this error with the fix); the CLI reports `EACCES`.

If you installed the earlier `99-openak820.rules`, it keeps working; remove it if you install the new
file to avoid duplicates.

## Snap / Flatpak browsers

Sandboxed browser packages may not see `/dev/hidraw*` at all. Use a distribution package of Chromium,
Chrome or Edge, or grant the sandbox raw-HID access if your packaging allows it.

## CLI

```sh
pnpm install
pnpm inspect                 # USB + HID topology, no device access needed (sysfs)
pnpm openkey detect --verbose
pnpm openkey info [--read-lighting]
pnpm openkey polling         # measured report cadence while you type
```

The CLI shows what the browser hides: interface numbers, endpoints, bInterval, bcdDevice. It stores
mirrors and automatic pre-write backups in `~/.config/openkey/` (or the earlier `~/.config/openak820/`
when it already exists). Every write asks for confirmation unless `--yes` is given.

## Wayland / X11

The keyboard tester and latency lab use browser key events, which work the same under both.
