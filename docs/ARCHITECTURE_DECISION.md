# Architecture decision

Decided 2026-10-11, building on the 2026-10-08 audit ([ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md)).
Competitive evidence: [COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md). Current state:
[PROJECT_AUDIT.md](PROJECT_AUDIT.md).

## Context

OpenKey is already a static, browser-first TypeScript application with a transport boundary
(`@openkey/hid`), a protocol registry with five families, a capability/evidence model and simulators.
The question is not which stack to start from, but which direction to grow in without a rewrite.

## Options

- **A. Browser-first, adapter-driven.** TypeScript, React, WebHID, declarative device data, built-in
  adapters, static registry, client only.
- **B. Multi-transport.** A's core behind a transport interface that can also be served by WebUSB or
  an optional native bridge (Tauri / local helper) for what browsers cannot reach.
- **C. Ecosystem integration.** Speak VIA/QMK and Vial natively next to proprietary adapters.
- **D. Hardware-first focus.** Concentrate on the AK820 MAX PLUS; expand only when evidence exists.

Scores 1 (poor) to 5 (strong); weights reflect the project's goals (safety and extensibility first).

| Criterion (weight)                   | A | B | C | D | Hybrid A+B(boundary only)+D |
| ------------------------------------ | - | - | - | - | --------------------------- |
| Portability (2)                      | 4 | 5 | 4 | 3 | 4 |
| Compatibility potential (3)          | 3 | 5 | 4 | 1 | 4 |
| Implementation effort, inverse (2)   | 4 | 2 | 3 | 5 | 4 |
| Safety (3)                           | 4 | 3 | 4 | 5 | 5 |
| Maintainability (2)                  | 4 | 2 | 3 | 4 | 4 |
| Offline use (1)                      | 4 | 5 | 4 | 4 | 4 |
| Browser restrictions, inverse (1)    | 2 | 5 | 2 | 3 | 3 |
| Licensing simplicity (1)             | 5 | 4 | 2 | 5 | 5 |
| Long-term extensibility (3)          | 4 | 5 | 4 | 2 | 5 |
| **Weighted total (max 90)**          | **68** | **71** | **64** | **60** | **78** |

Notes on the scores:

- **B** scores highest on reach but a native bridge is a second product (installers, signing, update
  channel, OS permissions) with no measured need yet: every device OpenKey can configure today works
  over WebHID. Its value is kept by defining the boundary now, not by building the bridge.
- **C**: VIA/Vial boards are already well served by VIA, Vial and Vialite; their apps are GPL, so
  OpenKey would re-implement from protocol facts. Identification exists (`qmk-via`); full support is a
  candidate for the next family (see Roadmap), not the foundation.
- **D** is the safest and cheapest but does not produce a platform.

## Decision

The **hybrid** the owner proposed, validated by the scores: a static, browser-first application (A)
with a clean transport boundary that a native transport can implement later (B, boundary only), and
the AK820 investigation as the reference family (D). VIA/Vial support is added as an adapter when it
can be tested (C, later).

What makes OpenKey different is not a feature list but the **evidence-driven adapter platform**:

1. Explainable identification with an explicit verdict and next safe step (`verdict.ts`).
2. Consent-gated probes with declared operations (`ProbePlan`).
3. Family identification as a precondition for any driver (`ProbeResult.identified`, `openDriver`).
4. A machine-checked evidence ledger per family.
5. One write policy for every front end (`guardWrites`).
6. An unknown-device lab that works with or without the device (offline analysis of diagnostic files).
7. A conformance kit and a template adapter for contributors.

## Layers

| Concern (brief §4)        | Module |
| ------------------------- | ------ |
| Presentation              | `apps/web` (React), `tools/cli` |
| Normalized device model   | `packages/core/src/model/*`, `KeyboardDriver` |
| Capability engine         | `core/model/capabilities.ts`, `core/safety.ts`, `core/write-guard.ts` |
| Device identity engine    | `protocols/registry.ts` (detect), `fingerprint.ts`, `verdict.ts` |
| Adapter registry          | `ProtocolRegistry`, `createDefaultRegistry()`, planned adapters |
| Protocol adapters         | `protocols/src/families/*` |
| Transport                 | `packages/hid` (WebHID, mock, replay), `packages/hid-node` (Linux hidraw) |
| Diagnostics / RE          | `core/support-bundle.ts`, `protocols/diagnostics.ts`, research lab, `tools/*` |
| Local data                | `apps/web/src/state/db.ts` (IndexedDB), backup v2 |
| Community workflow        | `docs/CONTRIBUTING_KEYBOARDS.md`, `docs/ADAPTER_GUIDE.md`, issue links |
| Testing and evidence      | `tests/*`, `fixtures/*`, conformance kit, ledgers |

These stay in the existing six packages; no new package was needed.

## Extension model

| Model | Power | Risk | Decision |
| ----- | ----- | ---- | -------- |
| Built-in TypeScript adapters | full | reviewed code only | **current release** |
| Reviewed community adapters shipped with releases | full | review + conformance tests + evidence | **the contribution path** |
| Data-only definitions (catalogue, layouts, imported diagnostic files) | naming, layout, offline analysis | none: data cannot select a write path or open a transport | **supported** (diagnostic import implemented) |
| Remote registry (static JSON) | names devices before a release | privacy (fetching may leak device identity), trust | **not now**; if added: static, signed, fetched without device identifiers, data-only |
| User-installed local adapter code | full | arbitrary code with access to the user's HID devices | **not now**; would need an explicit trust prompt, a separate origin or worker sandbox, and the same conformance kit |
| Remote JavaScript / `eval` | full | remote code execution against hardware | **never** |

Executable protocol support (anything that encodes a command) is always code under review. Everything
data-driven is unable to cause I/O by construction (`offlineGroup` cannot open a transport; layouts and
catalogue entries are not consulted for protocol selection).

## Framework and build

The brief mentions Next.js static export. The app is a Vite + React SPA with hash routing and a service
worker; it deploys to Vercel as static files with strict headers. Next.js `output: 'export'` would add
a framework, server-oriented conventions and route-based HTML with no measured benefit for a single-page
WebHID tool; the 2026-10-08 audit reached the same conclusion. **Keep Vite.**

No Rust, WebAssembly, Tauri or backend: protocol code is byte-level TypeScript well under 1 ms per packet,
the heaviest work (128×128 screen frames) runs in milliseconds, and there is no device a browser cannot
reach that the project can test. Revisit WASM for heavy codecs, and a native transport for a device
whose configuration collection browsers block, when such a case is measured.

## Decisions taken in this session

| Decision | Why | Reversible? |
| -------- | --- | ----------- |
| Adapter contract v1 with `apiVersion`, probe plans, verified identities, licence, limitations | stable target for contributors; checkable by tests | yes (bump version) |
| Handshakes need auto-consent or user consent | a signature match is not evidence that a command is harmless for that identity | yes |
| No driver without family identification (CRS becomes identification-only) | descriptor similarity must never create a write path | yes, once a read-only CRS identification is documented |
| AA/55 matcher requires unnumbered reports | every documented AA/55 device uses report ID 0; fixture B (ID 186) would otherwise receive guessed framing | yes |
| `guardWrites` in CLI and web | the CLI had no experimental gate | yes |
| Cross-model restore skips slot-indexed sections | key slots differ between models | yes (explicit opt-in exists) |
| Keep the OpenKey brand already in the code; repository stays OpenAK820 | renaming back would churn the previous session's work; the repository rename remains a deliberate milestone | owner's call |
