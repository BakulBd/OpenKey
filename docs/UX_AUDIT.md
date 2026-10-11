# UX audit — 2026-10-11

Audit of the rendered web app before the UX phase. Method: production build served locally, the demo
and a stubbed WebHID device driven with Playwright at 390, 768, 1024, 1440 and 1920 px, screenshots of
every route reviewed; source of every page and of the connection provider read. Baseline: lint,
typecheck, 226 tests, build and the browser smoke test all pass; no page overflowed horizontally.

Results after the changes are at the end ([§9](#9-after-the-ux-phase)).

## 1. Strengths to keep

- Capability-gated navigation already exists (`routeVisibility`): pages for features a device lacks are
  hidden, and present-but-unknown hardware is shown as "research needed".
- Staged editing with undo/redo, diff review and read-back verification in the keymap and per-key studios.
- Honest copy: write-only firmware is called out; the demo is labelled; unknown devices are read-only.
- A single connection state machine; a shared write guard; consent-gated identification.
- Hash routing, offline shell, light/dark/high-contrast tokens, roving-tabindex keyboard view, native
  `<dialog>` for modals, skip link, reduced-motion rule.

## 2. Confusing workflows and friction

| # | Finding | Where |
| - | ------- | ----- |
| F1 | The top bar shows only a state word ("Ready"). It never says *which* device, whether it is simulated, read-only or verified, or what operation is running. | every workspace page |
| F2 | Apply buttons give no progress feedback; the only outcome is a toast that disappears after 5 s. "Saved", "sent but unverifiable" and "verified" look alike once the toast is gone. | keymap, lighting, per-key, settings |
| F3 | The same long "this keyboard cannot report this setting" paragraph is repeated as a full-width callout on four pages. | keymap, lighting, macros, device settings |
| F4 | The keymap header reads "Review 0 change(s)"; pending state lives in the header, far from the board. | keymap |
| F5 | The overview is an engineering dump: two cards explain detection twice (verdict and "Detected because"), adapter internals sit above the fold, and a 6-column capability table becomes a long squeezed table at 390 px. Users are not told what they can *do*. | overview |
| F6 | Lighting effects and per-key colour are separate top-level pages although per-key colour *is* a lighting mode (applying it switches the effect). | navigation |
| F7 | Native, unstyled file inputs. | screen, backup |
| F8 | Applying a profile asks for per-section confirmation without showing what will change or why some sections are skipped. | profiles |
| F9 | Every workspace page ends with a community call-to-action footer (Star on GitHub …). | shell |
| F10 | A "Connected" toast duplicates information that belongs in a persistent status area, and covers content on mobile. | shell |
| F11 | The connect prompt explains nothing about browser support beyond one line, lists no previously authorised devices, and shows no progress while identification runs. | connect |
| F12 | The research lab mixes inspector, trace, capture, capability JSON, export and offline analysis as six equal tabs; identification evidence (which probes ran, under which consent, what came back) is buried in a text dump. | lab |
| F13 | Offline import analyses immediately; there is no preview of what a file contains before it is loaded, and no way to compare two files. | lab |

## 3. State and logic defects

| # | Defect | Risk |
| - | ------ | ---- |
| S1 | Page components keep their local state across device changes (React keeps the same component when the session object changes): the keymap studio would show the previous keyboard's keymap after switching devices or from demo to hardware. | stale device-specific data shown for another device |
| S2 | `read()` results are applied even if the session changed while the read was in flight. | a late answer updates the newly selected device's view |
| S3 | `attach()` sets the session even if the user disconnected while detection was running. | a ghost session after Disconnect |
| S4 | Two quick Apply clicks open two confirmation requests; the first promise is overwritten and never resolves, and a second write can be queued behind the first. | hung operation; duplicate writes |
| S5 | There is no operation state: nothing tells the UI a write is in progress, so buttons stay enabled and there is no spinner, and nothing can be cleared after a failure. | duplicate clicks; no progress; no recovery cue |
| S6 | Notices carry a title and a joined detail string; reason and next step are not structured. | errors do not say what to do next |

## 4. Visual hierarchy

- Page headers put every action (undo, redo, discard, apply) in one row with equal weight.
- Cards are the only container; dense pages are a stack of identical cards.
- The keyboard renderer shows only the printed legend; the assigned action is a tiny truncated sub-label.
- The knob and screen of the AK820 (present in the layout data as extras) are not drawn.

## 5. Accessibility

| # | Defect |
| - | ------ |
| A1 | Mobile off-canvas navigation stays in the tab order while hidden (transform only); no backdrop; Escape does not close it. |
| A2 | Asynchronous state changes (operation started/finished, connection changes) are announced only through transient toasts. |
| A3 | Several icon-only controls rely on `title` for their name in addition to `aria-label` (fine) but the per-key colour picker and brush have no visible state description. |
| A4 | Touch targets of 24–28 px (tiny buttons, chips) below the 32 px minimum used elsewhere. |

## 6. Responsive

No horizontal page overflow at 390–1920 px. Problems are density, not overflow: the overview table at
390 px, the keymap header wrapping into two rows, toasts covering content, and the keyboard needing
horizontal scroll inside its card (acceptable, but unexplained).

## 7. Redundancy

Overview duplicates device identity with Device settings; "Detected because" duplicates the verdict;
Lighting/Per-key split; footer links duplicated on every page.

## 8. Ranked improvements

| Rank | Improvement | User benefit | Risk |
| ---- | ----------- | ------------ | ---- |
| 1 | Session epoch + single-flight operation lock + operation state in the provider; pages remount per session (S1–S5) | prevents wrong-device data and duplicate writes | low (provider-local, tested) |
| 2 | Persistent status bar: device, mode (hardware/simulated/unknown/offline), identity, live operation | users always know what they are talking to | low |
| 3 | Shared change bar with precise configuration states (modified → saving → verified / saved without verification / failed) | users see what was actually written | low |
| 4 | Overview as a device home: what you can do (capability-driven task list), verdict, then details | first impression, discoverability | medium |
| 5 | Keymap editor: assigned action legends, knob/screen drawn, per-key reset, change plan before apply, supported-action filtering | flagship workflow | medium |
| 6 | Connect journey: environment checklist, previously authorised devices, identification progress | onboarding | low |
| 7 | Device Lab: identification evidence, import preview, compare files, notes in the report | research workflow | medium |
| 8 | Lighting merges effects and per-key; styled file inputs; profile preview | coherence | low |
| 9 | Accessibility fixes (A1–A4) and design tokens | everyone | low |

## 9. After the UX phase

| Finding | Resolution |
| ------- | ---------- |
| F1 | `StatusBar`: device, mode (hardware / simulated / read-only), identity headline, running operation, unsaved count; derived from one `StatusSummary` (`state/status.ts`) shared with the device chip and overview |
| F2 | `ChangeBar` with precise states (modified, saving, verifying, verified, saved without verification, mismatch, failed, reverted) on keymap, lighting, per-key, macros, device settings; screen upload and clock show a persistent outcome line; successful writes no longer rely on a toast |
| F3 | `SourceNote`: one compact line with a disclosure |
| F4 | Change bar owns Discard / Review; idle editors show one quiet line |
| F5 | Device home: hero, capability-driven "what you can do" list with Ready / Experimental / Read-only badges (real-hardware policy even in the demo), "present but not configurable here", verdict with detection evidence folded in, capability table and technical details collapsed; capability table becomes labelled rows on phones |
| F6 | Lighting workspace with Effects and Per-key tabs; both editors stay mounted so a tab switch never discards a draft; `#/perkey` remains a valid link |
| F7 | `FileButton` with type and size validation (screen) |
| F8 | Profiles: review dialog with target, sections, warnings and the actual differences before any write |
| F9 | Workspace footer reduced to one line; the community call to action stays on the landing page |
| F10 | No "connected" toast; the status bar announces changes politely |
| F11 | `ConnectPanel`: environment checks (WebHID, secure context, mobile limits, Linux permission), devices already allowed and plugged in (opened without the chooser), step-by-step progress, last failure |
| F12 | Device Lab: Identification evidence tab (adapter by adapter: descriptor facts, handshake policy, what ran, what came back, identified or not), Reports & descriptors, Protocol trace, Capture, Offline analysis, Report |
| F13 | Offline import shows a sanitized preview before analysis; a second file can be compared (identity fields, collection signatures A/B/both, verdicts); a sanitized copy can be downloaded |
| S1 | Device pages are keyed by session epoch: another device or a reconnect remounts them |
| S2 | `read()` discards answers for a previous epoch |
| S3 | `attach()` drops results (and closes the driver) when the epoch changed during detection |
| S4/S5 | `OperationLock`: one operation at a time, refusals explained, phases (confirming, writing, verifying) exposed; the lock and any open confirmation are released on disconnect or unplug, so no stale spinner survives |
| S6 | Notices carry *what happened / what it means / next step*, with technical detail collapsed |
| A1 | Closed off-canvas navigation is `inert`; scrim; Escape closes; focus moves in on open and back to the toggle on close |
| A2 | Status bar is a polite live region; change bars and outcome lines use `role=status` |
| A4 | Coarse pointers get 40 px controls, 36 px chips and tabs |
| Contrast | Light `--text-3`, `--accent`, `--ok` darkened: all text/background pairs ≥ 4.5:1 in both themes |

Also fixed while redesigning the keymap editor: the picker offered *system* (power/sleep) actions that
the flagship's encoder cannot store, so they failed at write time. Drivers now declare their key-action
kinds (`getKeyActionKinds()`), the picker offers only those, and the editor validates the whole layer
before anything is sent.

Verification (2026-10-11): `pnpm lint`, `pnpm typecheck`, `pnpm test` (25 files, 247 tests), `pnpm build`
and `pnpm e2e` pass. The browser test now also covers: a physical (stubbed WebHID) keyboard with verified
identity, the experimental opt-in, the write phase in the status bar, an unplug in the middle of a write,
keyboard-only key selection, an accessibility audit of every route, phone-width overflow on every route,
navigation inertness, offline import preview and comparison. Screenshots of every route at 390, 768,
1024, 1440 and 1920 px were reviewed; none overflows.

Remaining: no real keyboard was connected, so the physical WebHID path is tested with a stub only;
automated contrast and accessibility checks are a lightweight DOM audit, not a full axe run; the
renderer scrolls sideways on phones instead of re-flowing the keyboard.
