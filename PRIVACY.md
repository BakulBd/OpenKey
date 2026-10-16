# Privacy

OpenKey runs entirely in your browser. There is no OpenKey server, no account, no analytics, no
telemetry, no advertising and no tracking. The site is static files; the host (Vercel) serves them and
sees ordinary web-server request data (IP address, user agent) like any website, but OpenKey itself
sends nothing anywhere on its own.

One exception, only when you click it: for a QMK/VIA keyboard without a layout, **Get the layout from
VIA** downloads the keyboard's public definition from `usevia.app`. That request reveals the keyboard's
USB vendor and product ID to usevia.app (and your IP address, as any web request does). Loading a file
or using a matrix grid instead sends nothing.

## What the WebHID permission means

When you click **Connect keyboard** or **Inspect any HID device**, the browser shows its own device
chooser. OpenKey can see a device only after you pick it there, and only on this site. You can revoke
access at any time in your browser's site settings (Chrome: `chrome://settings/content/hid`).

Granting access lets OpenKey read the device's HID descriptors (name, vendor/product ID, report layout)
and exchange reports with its configuration interfaces. Browsers block access to the standard keyboard
input reports, so OpenKey cannot read your typing over WebHID.

## What OpenKey reads from a keyboard

- Descriptors: product and manufacturer name, vendor and product ID, HID collections and report sizes.
- For a keyboard with a verified adapter: the configuration its firmware reports (for example the
  per-key colour table of the AK820 MAX PLUS), after a documented read-only handshake.
- For an unknown keyboard: descriptors only. Nothing is sent to it.
- For a keyboard that resembles a supported family but is not an identity known to accept its
  handshake: nothing, until you click **Allow … identification**, which sends exactly the reports
  listed next to the button. The page then tells you how many reports were sent.

## What stays in your browser

Stored locally in IndexedDB and `localStorage`, never uploaded:

- values OpenKey wrote to keyboards that cannot report them (so they can be shown and backed up),
- profiles, backups, macro and screen projects, research traces,
- preferences (language, theme).

**Settings → Export all / Import / Clear local data** gives you full control. Clearing does not change
your keyboard.

## Typing

- The **keyboard tester** and the **latency lab** record key events only between your Start and Stop,
  only while their page is focused, and keep them in memory on that page. Leaving the tab stops them.
- The **macro recorder** records only while you press Record _and_ its box has focus.
- The **report monitor** (Research lab) captures vendor-collection input reports only while you run
  it, keeps at most 1000 in memory on that page, clears them when the device disconnects, and writes a
  file only when you click **Export capture**. Vendor reports can still contain key or configuration
  data, so review an export before sharing it.
- Nothing typed is stored or sent.

## Diagnostic packages

**Export diagnostic package** creates a JSON file on your computer. It contains the app version, browser
and OS name, whether WebHID is available, the device descriptors, the detected adapter and capabilities,
the connection state and the titles of recent errors.

It excludes typing data, macro contents, keymaps, packet payloads, file names and — unless you opt in —
the serial number.

**Research lab → Offline analysis** opens a diagnostic file _in your browser_ and analyses it with the
same detection code. The file is not uploaded; serial numbers in it are ignored; the analysed device
cannot be contacted. Review the file before attaching it to an issue. Opening an issue happens on
GitHub, under GitHub's privacy terms, and only when you choose to.

## External links

Links to GitHub (source, issues) open only when you click them. The app loads no third-party scripts,
fonts or images; the Content-Security-Policy forbids it.

The contributor avatars in the footer are copies served by OpenKey itself (refreshed by maintainers
with `pnpm contributors`), so showing them sends nothing to GitHub.
