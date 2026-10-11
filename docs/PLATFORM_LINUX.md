# Linux

## Permissions (one-time setup)

`/dev/hidraw*` nodes belong to root by default, so both Chromium (WebHID) and the CLI need a udev rule.
The web app detects this: when the browser lists the keyboard but cannot open it, OpenKey shows
**Linux setup required** with these steps.

1. Download the installer from the app (or use `udev/install-openkey-udev.sh` from the repository).
2. Read it, then run it yourself with administrator rights:

   ```sh
   sudo sh ~/Downloads/install-openkey-udev.sh
   ```

   It copies one rule file (`70-openkey.rules`, embedded in the script, identical to the repository
   file) to `/etc/udev/rules.d/`, keeps a `.bak` of a different existing file, and reloads udev for
   hidraw devices. `--dry-run` shows what it would do, `--uninstall` removes the rule. It never talks
   to a keyboard and never runs automatically.
3. Unplug the keyboard (or its receiver) and plug it back in.
4. Press **Retry connecting** in the app.

By hand instead:

```sh
sudo cp udev/70-openkey.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=hidraw
```

The rule grants access to the logged-in user (`uaccess`) and the `plugdev` group, mode `0660`, only
for the VID:PIDs OpenKey has adapters for (AK820-family keyboards and receivers). Nothing becomes
world-writable, and the rule does not change any keyboard.

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
