# Third-party software

OpenKey is MIT-licensed ([LICENSE](LICENSE)). It includes or depends on the following software. Versions
are pinned in `pnpm-lock.yaml`.

## Bundled into the web app

| Package                            | License | Use                                |
| ---------------------------------- | ------- | ---------------------------------- |
| react, react-dom, scheduler        | MIT     | user interface                     |
| gifuct-js, js-binary-schema-parser | MIT     | GIF decoding for the screen studio |

## CLI only (not in the web app)

| Package                                    | License          | Use                            |
| ------------------------------------------ | ---------------- | ------------------------------ |
| node-hid (+ node-addon-api, pkg-prebuilds) | MIT OR X11 / MIT | hidraw access on Linux         |
| pngjs                                      | MIT              | image input for screen uploads |
| jpeg-js                                    | BSD-3-Clause     | image input for screen uploads |

## Development only

TypeScript, Vite, Vitest, ESLint, typescript-eslint, Prettier, tsx, esbuild, playwright-core (browser smoke
test using the system Chrome) — not distributed.

## Not included

No source code from other keyboard projects is included. Protocol facts learned from public projects are
re-implemented independently and credited in [docs/PROTOCOL_SOURCES.md](docs/PROTOCOL_SOURCES.md) and
[docs/RESEARCH_MATRIX.md](docs/RESEARCH_MATRIX.md). See [docs/LICENSE_NOTES.md](docs/LICENSE_NOTES.md).

Vendor software (AJAZZ drivers) was analysed locally for interoperability and is never redistributed.

Full provenance, per-adapter licensing and the GPL analysis: [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md).
The CLI bundle includes jpeg-js (BSD-3-Clause, Copyright (c) 2014, Eugene Ware);
its licence notice must accompany any redistribution of `tools/cli/dist/`.
