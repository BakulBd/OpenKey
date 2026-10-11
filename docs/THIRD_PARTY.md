# Third-party software, sources and licensing

Detailed provenance and licensing record. The short notice for distributions is
[`/THIRD_PARTY.md`](../THIRD_PARTY.md); the policy summary is [LICENSE_NOTES.md](LICENSE_NOTES.md).
Checked 2026-10-11 against `pnpm-lock.yaml` and the installed packages.

## 1. Dependencies

| Package | Version (installed) | Licence | Shipped in | Use |
| ------- | ------------------- | ------- | ---------- | --- |
| react, react-dom (+ scheduler) | 19.3.0 | MIT | web app | UI |
| gifuct-js | 2.1.2 | MIT | web app (screen studio chunk) | GIF decoding |
| js-binary-schema-parser | 2.0.3 | MIT | web app (via gifuct-js) | GIF parsing |
| node-hid | 3.4.0 | MIT OR X11 | CLI only | Linux hidraw |
| pngjs | 7.0.0 | MIT | CLI only | image input |
| jpeg-js | 0.4.4 | BSD-3-Clause | CLI only | image input (notice required when redistributed) |
| vite, @vitejs/plugin-react, TypeScript, Vitest, ESLint, typescript-eslint, Prettier, tsx, esbuild, playwright-core | lockfile | MIT / Apache-2.0 | development only | build and tests (not distributed) |

No dependency was added in this upgrade.

## 2. Code provenance

All code in this repository was written for OpenKey/OpenAK820 under MIT. **No source code, data table or
documentation text from another keyboard project is included.** Where an implementation follows another
project's findings, the finding is cited as a fact in `manifest.provenance`, the protocol ledger or the
docs, and expressed independently.

| Area | Facts learned from | Their licence | What OpenKey took |
| ---- | ------------------ | ------------- | ----------------- |
| `sonix-feature` | AJAZZ official Windows driver V1.0.0.5 (static analysis) | proprietary | interoperability facts (command codes, layouts, timing); no binary, asset, config file or text |
| `sonix-feature`, `sonix-dongle` cross-check | VitalyArt/Aula-F75-Max-Driver | MIT | facts only (identity, page usage, command sequence); cited in the ledger. MIT would permit code reuse with attribution; none was needed |
| `sonix-aa55` | AJAZZ online driver; wsclx/ak820pro-modder | proprietary; see public-research.md | facts only |
| `crs-aa55cc33` | armoredvortex/ajazz-ak820-max-plus, arafatamim/OpenRGBAK820Plugin | see public-research.md | facts only |
| planned `royuan` | Sharkfin `docs/PROTOCOL.md` | GPL-3.0-or-later | facts only (signature) |
| planned `aula-sinowealth` | cloudglides, not-ayan | **no licence** | facts only (signature) |
| planned `vial`, `qmk-via` | QMK raw HID / VIA documentation | GPL-2.0+ (QMK), GPL-3.0 (VIA app) | facts only |
| design ideas (identification before writes, evidence marks, read-only contribution bundles, read-back verification) | Sharkfin, Micro 2 configurator, Vial | GPL-3.0, none, GPL-2.0 | ideas, independently designed (ideas are not copyrightable) |

## 3. GPL and unlicensed sources

- **GPL-2.0 (Vial, Vialite, QMK) and GPL-3.0-or-later (Sharkfin, VIA, ReConf, W910 WebDriver, cvanelteren/OpenAula):**
  copying or translating their code into OpenKey would make that part a derivative work under the GPL,
  incompatible with distributing OpenKey as MIT-only. Protocol facts (command numbers, report layouts,
  checksums) are not protected expression and are re-implemented from scratch. Do not port functions,
  keycode tables or definition files.
- **No licence (OpenAula by not-ayan, cloudglides, Micro 2 configurator):** all rights reserved by
  default; nothing may be reused except facts.
- **VIA keyboard definitions (GPL-3.0):** importing a user's own definition file at runtime is data the
  user supplies; bundling definitions from that repository in OpenKey would not be acceptable.

If GPL code is ever needed it must live in a separately licensed, separately distributed component,
never inside the MIT packages. None exists.

## 4. Adapter licensing

Every adapter declares the licence of its own code in `manifest.license` (all `MIT` today); the
conformance kit rejects an adapter without one. A community adapter under another licence would have to
be distributed separately; it cannot be merged into the MIT packages. A permissively licensed main
application does not make an adapter's *sources* permissively licensed: their status is recorded per
adapter in `manifest.provenance`.

## 5. Vendor material

Vendor binaries, installers, firmware and bundles are never committed (`vendor/` is git-ignored except
its README, and excluded from deployments). Brand names appear only to identify hardware; no logos or
product artwork are included. The app icons are original.

## 6. Open questions

- Whether the sanitized descriptor summaries for fixtures A and B came from devices owned by the
  project owner (assumed, as stated in the brief); they contain no personal data either way.
- jpeg-js (BSD-3-Clause) notice: the CLI bundle `tools/cli/dist/openkey.mjs` includes it; a release
  that distributes the bundle must carry its copyright notice (add to release notes).
