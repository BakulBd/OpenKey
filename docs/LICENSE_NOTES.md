# License notes

OpenKey is MIT. Contributions are accepted under MIT.

## Learning from other projects

| Project                                                                 | License          | What OpenKey may take                                                   | What it must not take                                                             |
| ----------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sharkfin                                                                | GPL-3.0-or-later | protocol facts (opcodes, report layout, checksums), architectural ideas | source code, data files (e.g. extracted vendor layout tables), documentation text |
| Vial, vial-qmk, Vialite                                                 | GPL-2.0          | protocol facts                                                          | source code, keycode tables copied verbatim                                       |
| VIA app                                                                 | GPL-3.0          | protocol facts                                                          | source code                                                                       |
| QMK firmware                                                            | GPL-2.0          | documented protocol facts                                               | source code                                                                       |
| OpenRGB                                                                 | GPL-2.0          | abstraction ideas                                                       | source code                                                                       |
| ZMK Studio                                                              | Apache-2.0       | ideas; code only with attribution and a NOTICE                          | —                                                                                 |
| AULA F75 projects (cloudglides, not-ayan, cvsqwe)                       | **no license**   | facts only                                                              | anything else: without a license nothing may be reused                            |
| MemerGamer AK820 Pro webdriver, VitalyArt Aula F75 Max driver, sinowisp | MIT              | code with attribution if ever needed (currently none used)              | —                                                                                 |
| AJAZZ official software                                                 | proprietary      | interoperability facts observed by analysis                             | binaries, assets, configuration files, text                                       |

Facts and protocol behaviour are not copyrightable; expression is. OpenKey therefore writes every encoder,
decoder and document in its own words, cites where each fact came from, and keeps the evidence status
honest (third-party facts are INFERRED until OpenKey verifies them).

If GPL code is ever needed, it must live in a separately licensed component, never inside the MIT
packages. No such component exists today.

## Vendor material

Vendor binaries, installers, firmware dumps and bundles are never committed (`vendor/` is git-ignored
except its README and is excluded from deployments).
