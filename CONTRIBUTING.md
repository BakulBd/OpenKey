# Contributing

Thanks for helping. The most valuable contributions are **evidence**: descriptors, captures and
observations from keyboards we have not seen.

## Report a keyboard

Run `pnpm inspect` (Linux, no permissions needed) or open the web app's Diagnostics page and download the
report. Open an issue with the output, the model name printed on the box and how the keyboard was
connected (cable, receiver, Bluetooth).

## Protocol findings

1. Follow [docs/reverse-engineering/capture-methodology.md](docs/reverse-engineering/capture-methodology.md):
   one change per capture, controlled assets, before/after state.
2. Add the capture (converted to JSON, without unrelated traffic) under `fixtures/`, with device, firmware,
   transport, interface, report ID, raw bytes and expected parsing.
3. Add an entry to [docs/RESEARCH_LOG.md](docs/RESEARCH_LOG.md) with a confidence level. VERIFIED needs a
   hardware observation; official-code findings are OBSERVED.
4. Implement the encoder/decoder with named constants that cite their evidence, plus a test that uses the
   fixture.

## Code

- TypeScript strict; `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass.
- Protocol code talks to `HidTransport` only — never `navigator.hid`, `fs` or `node-hid` (enforced by ESLint).
- No guessed packets. A command with unknown side effects is documented and left unimplemented.
- Keep families separate; move only genuinely shared encodings to `families/common`.

## Legal

Do not commit AJAZZ binaries, installers, bundles or firmware dumps. Describe what the official software
does in your own words and reimplement it.
