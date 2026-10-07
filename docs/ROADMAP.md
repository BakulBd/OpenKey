# Roadmap

Status as of 2026-10-08. Phases follow the OpenKey plan; each item is marked by what actually exists.

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

## Next, in order of value

1. **Hardware verification of AK820 writes** (owner consent, one operation at a time): per-key write with
   read-back first, then lighting, clock, settings, keymap, macros, TFT. Each pass moves a capability from
   OBSERVED to VERIFIED and out of experimental mode.
2. Run the deployed app with the real AK820 over WebHID on Linux, Windows and macOS.
3. Measure report cadence (latency lab and `openkey polling`).
4. 2.4 GHz receiver: detection and battery.
5. Complete translations (studio strings) with native-speaker review.
6. A second verified device family — whichever family a contributor can test on hardware first
   (ROYUAN has the most public evidence).
7. Layout confirmation flow for new boards (keys stay read-only until each slot is confirmed).

## Out of scope

Firmware flashing, bootloader access, any server component, accounts, telemetry.
