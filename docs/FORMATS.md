# Data formats

Every file OpenKey writes is JSON with a `format` and an integer `version`. Readers accept older
versions and migrate them; a file from a _newer_ OpenKey is refused instead of being half-understood.
Unknown fields are preserved where a file is round-tripped (backups) and ignored where only a subset is
used (diagnostic import).

## Diagnostic package — `openkey-support-bundle` v2

Written by **Export diagnostic package** (web) and used by issues and offline analysis
(`parseSupportBundle`, `analyzeDiagnostic`, `openkey analyze`). Code: `packages/core/src/support-bundle.ts`.

```jsonc
{
  "format": "openkey-support-bundle",
  "version": 2,
  "createdAt": "2026-10-11T00:00:00.000Z",
  "environment": {
    "appVersion": "0.3.0",
    "userAgent": "…",
    "platform": "Linux",
    "webHid": true,
    "secureContext": true,
  },
  "device": {
    "vendorId": "0x0C45",
    "productId": "0x8009",
    "productName": "AK820 MAX",
    "manufacturer": "SONiX", // optional
    "release": "0x0107", // optional (not exposed by WebHID)
    "transport": "usb", // optional: usb | 2.4ghz | bluetooth | unknown
    "serialRedacted": true, // serialNumber only with explicit opt-in
    "interfaces": [
      {
        "interfaceNumber": 3, // optional (not exposed by WebHID)
        "collections": [
          {
            "usagePage": "0xFF13",
            "usage": "0x0001", // usage may be null when not recorded
            "inputReports": [{ "reportId": 0, "size": 64 }],
            "outputReports": [{ "reportId": 0, "size": 64 }],
            "featureReports": [{ "reportId": 0, "size": 64 }],
          },
        ],
      },
    ],
  },
  "adapter": { "id": "sonix-feature", "family": "sonix-feature", "evidence": "VERIFIED" },
  "detection": {
    "confidence": "VERIFIED",
    "verdict": "VERIFIED_MATCH",
    "reasons": ["…"],
    "candidates": ["…"],
  },
  "capabilities": { "keymap": "WRITE_ONLY" },
  "connectionState": "READY",
  "recentErrors": [{ "at": "…", "kind": "TIMEOUT", "title": "…" }],
  "excluded": [
    "typing data",
    "macro contents",
    "keymaps",
    "packet payloads",
    "file names",
    "serial number",
  ],
}
```

Report sizes are payload bytes, excluding the report-ID byte. v1 stored reports as display strings
(`"id 6: 519 B"`); the importer converts them. Import limits: 512 KiB, 32 interfaces, 64 collections,
256 reports per list, report IDs 0–255, sizes ≤ 65535. Fixture files may add a `fixture` block
(source, what was not recorded, expected outcome); readers ignore it.

## Backup — `openkey-backup` v2

Written by Backup & restore (web) and `openkey backup`. Code: `packages/core/src/backup.ts`. Carries the
device identity and model profile, firmware, protocol and adapter (id, version, family), transport,
and the sections the adapter could read or mirror: `keymap`, `fnLayers`, `rgb`, `perKeyRgb`, `macros`,
`settings`, plus TFT upload metadata (images cannot be read back). `provenance` records per section
whether it came from the device or from OpenKey's mirror of a write-only value.

Restore plans (`planRestore`) refuse a different protocol, skip key-slot and LED-indexed sections for a
different model unless explicitly allowed, warn on firmware differences, and every written section is
verified by read-back where the firmware can report it. OpenAK820 v1 backups (`openak820-backup`) are
migrated without changing their data.

## Evidence record (`openkey verify …`)

Local file written by the CLI's hardware verification commands to the state directory
(`~/.config/openak820/backups/`). Contains the device identity, firmware hint, adapter, outcome
(`VERIFIED`, `MISMATCH` or `FAILED`), differences, and the full packet log of the run, including
configuration values (for per-key: colours). It is personal data: review before sharing. A maintainer
turns a reviewed record into a `fixtures/**/…-hw.json` fixture; nothing is promoted automatically.
