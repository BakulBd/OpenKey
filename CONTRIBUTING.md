# Contributing

Thanks for helping. The most valuable contributions are **evidence** — descriptors, captures and
hardware results from keyboards OpenKey has not seen — and careful code that keeps the evidence honest.

- Add a keyboard: [docs/CONTRIBUTING_KEYBOARDS.md](docs/CONTRIBUTING_KEYBOARDS.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Protocol research: [docs/PROTOCOL_RESEARCH.md](docs/PROTOCOL_RESEARCH.md)

## Development

```sh
git clone https://github.com/BakulBd/openkey.git && cd openkey
pnpm install
pnpm dev          # web app on http://localhost:5173 (WebHID works on localhost)
pnpm test         # unit, protocol, fixture, mock-HID and integration tests
pnpm lint && pnpm typecheck
pnpm build        # CLI + static web build (apps/web/dist)
pnpm e2e          # browser smoke test of the build with the production headers (needs Chrome)
```

Node 20+ and pnpm 10. No hardware is needed for any of these; the demo and tests use firmware
simulators and `MockHidDevice`.

## Rules

- TypeScript strict. Prefer pure functions, small modules, named constants that cite their evidence.
- Protocol code talks to `HidTransport` only — never `navigator.hid`, `fs` or `node-hid` (ESLint enforces it).
- **No guessed packets.** A command with unknown effects is documented and left unimplemented. A feature
  without evidence is `UNKNOWN` or `NOT_YET_REVERSE_ENGINEERED`, never "supported".
- Never promote evidence without new evidence: OBSERVED → VERIFIED needs a hardware run.
- Every write declares a safety level; firmware, bootloader and erase commands are out of scope.
- User-facing text goes through i18n keys (`apps/web/src/i18n/locales/en.ts`); translations may be partial.
- Keep commits small and logical; describe the evidence behind protocol changes.

## Translations

Add or improve `apps/web/src/i18n/locales/<code>.ts`. Any subset of keys is fine; missing keys fall back
to English. Keep `{placeholders}` unchanged (a test checks them). Keycode names and protocol notes are
data and stay in English.

## Legal

Do not commit vendor binaries, installers, bundles or firmware dumps. Do not copy code from GPL or
unlicensed projects; describe facts in your own words. See [docs/LICENSE_NOTES.md](docs/LICENSE_NOTES.md).
