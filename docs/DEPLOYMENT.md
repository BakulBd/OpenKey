# Deployment

OpenKey is a static web application: HTML, JavaScript, CSS, a service worker and a few downloadable
files. It has no server-side code, database, accounts or telemetry, so it can be hosted anywhere that
serves files over HTTPS, including inside a closed network. The keyboard is reached by the user's
browser (WebHID); the host never sees a device.

## What gets deployed

`pnpm build:web` writes `apps/web/dist/`:

| Path                                                             | Purpose                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.html`, `assets/*`, `sw.js`, `manifest.webmanifest`, icons | the app and its offline shell (installable as a desktop app on Windows, macOS, Linux and ChromeOS)                                                                                                                                                                                   |
| `linux/70-openkey.rules`, `linux/install-openkey-udev.sh`        | the Linux permission rule and its installer, generated from `udev/`                                                                                                                                                                                                                  |
| `_headers`                                                       | security headers for Netlify and Cloudflare Pages, generated from `vercel.json`                                                                                                                                                                                                      |
| `og.png`, `robots.txt`, `sitemap.xml`                            | social preview image and search-engine files; canonical and Open Graph URLs use `OPENKEY_SITE_URL` (build-time environment variable, default `https://openkey-lovat.vercel.app`). Set it when you host OpenKey elsewhere: `OPENKEY_SITE_URL=https://keys.example.org pnpm build:web` |

## Security headers (all hosts)

`vercel.json` is the single source. The build generates `_headers`; `deploy/nginx/security-headers.conf`
is generated from it and kept identical by `tests/platform/deploy.test.ts`.

| Header                                                         | Value (summary)                                                      | Why                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Content-Security-Policy                                        | `default-src 'self'`, no inline or eval scripts, no framing          | no third-party code can run in the page                          |
| Permissions-Policy                                             | `hid=(self)`, `serial=(self)`, everything else off                   | WebHID and Web Serial (ZMK Studio) only for OpenKey's own origin |
| X-Content-Type-Options, Referrer-Policy, X-Frame-Options, COOP | strict                                                               | standard hardening                                               |
| Cache-Control                                                  | `assets/*` immutable for a year; `index.html`, `/`, `sw.js` no-cache | updates reach users on the next visit                            |

WebHID requires a secure context: HTTPS, or `http://localhost` for local use.

## Hosting options

| Host                                            | How                                                                                                                         | Headers                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel**                                      | import the repository; `vercel.json` sets install, build and output                                                         | from `vercel.json`                                                                                                                        |
| **Netlify**                                     | build command `pnpm build:web`, publish directory `apps/web/dist`                                                           | `_headers` (generated)                                                                                                                    |
| **Cloudflare Pages**                            | build command `pnpm build:web`, output `apps/web/dist`                                                                      | `_headers` (generated)                                                                                                                    |
| **Docker / Kubernetes**                         | `docker build -t openkey . && docker run -p 8080:8080 openkey`; unprivileged nginx, health check included; put TLS in front | `deploy/nginx/*`                                                                                                                          |
| **Any nginx**                                   | copy `apps/web/dist` to the web root, use `deploy/nginx/default.conf` and the snippet                                       | `deploy/nginx/*`                                                                                                                          |
| **GitHub Pages, S3 and other plain file hosts** | upload `apps/web/dist`                                                                                                      | these hosts cannot send custom headers: the app works, but without CSP and Permissions-Policy. Put a CDN or proxy in front for production |

Hash routing means no rewrite rules are needed: every route is `/#/…` and survives a refresh.

The container build is exercised in CI (`container` job: build, serve, check headers and the Linux
downloads). It was not run on the development machine, which has no Docker.

## Desktop operating systems

|                      | Windows                                                                                                             | macOS                                     | Linux                                                                                      | ChromeOS  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ | --------- |
| Browsers with WebHID | Chrome, Edge, Opera, Brave                                                                                          | Chrome, Edge, Opera, Brave (not Safari)   | Chrome, Chromium, Edge, Opera, Brave (distribution packages; Snap/Flatpak may not see USB) | Chrome    |
| One-time setup       | none                                                                                                                | none (rarely: Input Monitoring)           | udev rule ([PLATFORM_LINUX.md](PLATFORM_LINUX.md)), guided in the app                      | none      |
| Install as app       | yes (PWA)                                                                                                           | yes (PWA)                                 | yes (PWA)                                                                                  | yes (PWA) |
| CLI (`pnpm openkey`) | yes, node-hid enumeration (report sizes not exposed; the handshake identifies the family) — not yet run on hardware | same as Windows — not yet run on hardware | yes, sysfs + hidraw (full detail)                                                          | no        |

Platform notes: [PLATFORM_WINDOWS.md](PLATFORM_WINDOWS.md), [PLATFORM_MACOS.md](PLATFORM_MACOS.md),
[PLATFORM_LINUX.md](PLATFORM_LINUX.md). Phones and tablets cannot reach USB keyboards from a browser;
the app still works there for the demo, offline analysis of diagnostic files, the tester and the docs.

## Managed fleets (Chrome and Edge policies)

Administrators can pre-approve OpenKey for specific keyboards so users never see the device chooser,
or restrict WebHID to OpenKey only. These are Chromium enterprise policies documented by Microsoft for
Edge ([WebHidAllowDevicesForUrls](https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/webhidallowdevicesforurls),
[WebHidBlockedForUrls](https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/webhidblockedforurls))
and implemented in Chromium (`chrome/browser/hid/hid_policy_allowed_devices.h`). Check your browser
version's policy list before rollout.

| Policy                                     | Effect                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `WebHidAllowDevicesForUrls`                | the listed URLs get permission for the listed vendor/product IDs automatically |
| `WebHidAllowDevicesWithHidUsagesForUrls`   | the same, matched by HID usage page/usage                                      |
| `DefaultWebHidGuardSetting`                | 2 = block WebHID everywhere, 3 = ask (default)                                 |
| `WebHidAskForUrls`, `WebHidBlockedForUrls` | per-site exceptions to the default                                             |

Example: allow the AK820 MAX (USB `0C45:8009` = vendor 3141, product 32777) and its receivers for an
internal deployment, block WebHID elsewhere. IDs are **decimal** in policies.

```json
{
  "DefaultWebHidGuardSetting": 2,
  "WebHidAskForUrls": ["https://openkey.example.internal"],
  "WebHidAllowDevicesForUrls": [
    {
      "devices": [
        { "vendor_id": 3141, "product_id": 32777 },
        { "vendor_id": 3141, "product_id": 65021 },
        { "vendor_id": 1452, "product_id": 591 }
      ],
      "urls": ["https://openkey.example.internal"]
    }
  ]
}
```

| System   | Where the policy goes                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | Group Policy (Chrome/Edge ADMX templates) or the registry under `HKLM\SOFTWARE\Policies\Google\Chrome` / `…\Microsoft\Edge`; list-of-dictionary policies are a JSON string value                                                                                                 |
| macOS    | a configuration profile (MDM) for `com.google.Chrome` / `com.microsoft.Edge` with the same keys                                                                                                                                                                                  |
| Linux    | `/etc/opt/chrome/policies/managed/openkey.json` (Chrome), `/etc/chromium/policies/managed/` (Chromium), `/etc/opt/edge/policies/managed/` (Edge). The udev rule is still required: browser policy grants the _site_ permission, udev grants the _user_ access to the device node |
| ChromeOS | Google Admin console → Devices → Chrome → Settings → user & browser settings → WebHID                                                                                                                                                                                            |

With a pre-approved device, the connect page lists it under "Already allowed for this site and
plugged in" and opens it without the chooser.

## Offline and air-gapped networks

- Host the `dist/` folder internally; nothing in the app calls external services on its own. The only
  outbound requests are user-initiated: GitHub links (issues, source) and, for VIA keyboards, the
  "Get the layout from VIA" button (`https://usevia.app/definitions/…`). Remove `https://usevia.app`
  from `connect-src` in `vercel.json` (and regenerate the nginx snippet) to disable it.
- After the first visit the service worker serves the whole app offline.
- Diagnostic packages, backups and profiles are files the user downloads; nothing is uploaded.

## Operations checklist

- [ ] HTTPS with a valid certificate (WebHID will not work otherwise).
- [ ] Headers present: `curl -sI https://your-host/ | grep -i -e content-security -e permissions-policy`.
- [ ] `index.html` and `sw.js` not cached by any proxy in front.
- [ ] `/linux/install-openkey-udev.sh` downloads as a file (Linux users need it).
- [ ] Browser policy rolled out (managed fleets), tested with one keyboard.
- [ ] Updates: deploy a new `dist/`; users get an "update ready" banner on their next visit.
