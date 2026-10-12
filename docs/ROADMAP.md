# Roadmap

Status as of 2026-10-11. Phases follow the OpenKey plan; each item is marked by what actually exists.

| Phase             | Scope                                                                                                                                                                                        | State                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0 Audit           | architecture audit, research matrix, evidence inventory, deployment audit                                                                                                                    | done ([ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md), [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md)) |
| 1 Foundation      | transport, fingerprint, adapter registry + manifests, capability engine, safety, transactions, history, state machine, mock HID with fault injection                                         | done, tested                                                                                    |
| 2 AK820 migration | flagship on the new model; safety levels; honest polling claim; ack-echo fix; regression tests                                                                                               | done; **writes await hardware verification**                                                    |
| 3 Product UX      | landing, demo, keymap/RGB/per-key/macro/screen studios, backup/restore, profiles, diagnostics, unknown-device mode, tester, latency lab, research lab, compatibility center, command palette | done                                                                                            |
| 4 AULA            | planned adapter (descriptor signature only)                                                                                                                                                  | research: no hardware; sources disagree on the frame header                                     |
| 5 ROYUAN          | planned adapter (descriptor signature only)                                                                                                                                                  | research: no hardware; independent implementation from facts needs a board                      |
| 6 VIA / Vial      | VIA identification exists; Vial planned                                                                                                                                                      | research: needs a Vial board                                                                    |
| 7 Platform        | PWA, i18n (11 languages, ~30% translated beyond English), accessibility, security headers, lazy loading, docs                                                                                | done                                                                                            |
| 8 Vercel          | static deployment, live header verification, browser smoke test against the deployment                                                                                                       | done for the app; **real keyboard in the deployed app not yet tested**                          |

## Upgrade checklist (2026-10-11)

Evidence-platform upgrade ([PROJECT_AUDIT.md](PROJECT_AUDIT.md), [ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md)).

- [x] Phase 0 — audit, baseline, competitive research, architecture decision
- [x] Phase 1 — adapter contract v1, probe plans and consent, identification before drivers,
      verdict engine, write guard for every front end, safety invariant tests
- [x] Phase 2 — unknown-device lab: verdict card, consent-gated identification, diagnostic package
      v2, offline analysis (web + CLI), fixtures A/B regression guards
- [~] Phase 3 — AK820 vertical slice: identification and per-key read verified on hardware (earlier);
  evidence ledger and `openkey verify per-key` ready; **writes still unverified** (no hardware attached)
- [x] Phase 4 — backup/restore: cross-model guard; formats documented
- [x] Phase 5 — contributor platform: conformance kit, template adapter, adapter guide, ledger rules
- [x] Phase 6 — e2e extended (consent flow, offline analysis), docs, deployment ignore list
- [ ] Hardware: per-key write round trip, then the rest of the safe-experiment list

Results on 2026-10-11: `pnpm lint` pass · `pnpm typecheck` pass · `pnpm test` 21 files / 226 tests
pass (baseline 16 / 147) · `pnpm build` pass · `pnpm e2e` pass (headless Chrome: demo, unknown device,
consent-gated identification, offline analysis, offline reload). No hardware was attached.

## UX phase checklist (2026-10-11)

See [UX_AUDIT.md](UX_AUDIT.md), [UX_COMPETITIVE_RESEARCH.md](UX_COMPETITIVE_RESEARCH.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

- [x] A — audit of the rendered app at five widths, competitor workflows
- [x] B — session epoch, operation lock, status summary, status bar, connection journey
- [x] C — tokens, primitives (change bar, source note, error panel, file button, empty state), accessible navigation
- [x] D — keymap editor, change plan, supported action kinds, lighting workspace
- [x] E — Device Lab: evidence, preview, comparison, notes, issue text
- [x] F — macros, screen, profiles, backup, device settings on the shared patterns
- [x] G — accessibility audit, phone-width checks, physical-session and unplug browser tests, contrast

## Next, in order of value

1. **Hardware verification of AK820 writes** (owner consent, one operation at a time): start with
   `pnpm openkey verify per-key --experimental` (read-back proves the write), then clock, lighting,
   settings, keymap (resolves the `04 27` conflict), macros, TFT. Each pass moves a ledger entry and a
   capability from OBSERVED to VERIFIED and out of experimental mode.
2. Run the deployed app with the real AK820 over WebHID on Linux, Windows and macOS.
3. Measure report cadence (latency lab and `openkey polling`).
4. 2.4 GHz receiver: detection and battery.
5. Complete translations (studio strings) with native-speaker review.
6. A second verified device family — whichever family a contributor can test on hardware first.
   Candidates: the Epomaker × AULA F75 Max (`0C45:800A`, same `sonix-feature` family: needs its product
   string, layout and a hardware run), VIA/Vial (public protocol with keymap read-back; needs a board),
   ROYUAN (most public evidence).
7. Layout confirmation flow for new boards (keys stay read-only until each slot is confirmed).

## Out of scope

Firmware flashing, bootloader access, any server component, accounts, telemetry.
