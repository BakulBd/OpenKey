# UX competitive research

Researched 2026-10-11. Workflow descriptions come from each project's own documentation or source;
OpenKey did not run these apps against hardware. Labels: **[DOC]** the project's README or docs,
**[SRC]** its source, **[ART]** a vendor article, **[PRIOR]** OpenKey's 2026-10-08/11 surveys
([COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md)). Nothing was copied; only interaction patterns are
compared. Wootility's site is a JavaScript application whose content could not be retrieved for review,
so no claim is made about it.

## Workflows compared

| Workflow | Keychron Launcher [ART] | VIA [DOC] | Sharkfin [DOC] | Vialite [DOC] | OpenAula (not-ayan) [DOC] | Micro 2 configurator [DOC] |
| -------- | ----------------------- | --------- | -------------- | ------------- | ------------------------- | -------------------------- |
| Connect | Cable only, Chromium; "latest Chrome / Opera / Edge" | definition must exist in VIA's repository for the VID/PID | Chromium or desktop app; says the cable is required for writes; shows a udev command when it finds a keyboard it cannot open | "Click Connect, pick your Vial keyboard" | "Connect HID" in sidebar or overview | Connect; retries a sleeping RPC task automatically ("wake") |
| Board picture | on-screen keyboard | KLE layout from the definition, layout options as toggles/selects | picture matched against the board's own keymap and **read-only until the user confirms it**; otherwise a slot grid; users can draw boards | physical renderer with ISO enter, encoders, layout options | fixed 75% grid | real layout read from `keymap.json` on the device |
| Remap | select key (red box) → click a keycode in Basic/Media/Macro/Special/Lighting/Custom/Layer; success = the on-screen key shows the new function | select key → pick keycode | writes immediately | cascading picker + quick-config panel; dedicated mod-tap editor | edit table → "Apply Remap" → read-back check | edit → "Save to device" rewrites the file; checksum verifies |
| Layers | Mac/Win layer pairs, explained in prose | layer tabs | Base/Fn per profile | per layer | two tables | layer tabs, current layer marked |
| Lighting | effect controls | definition menus | sliders preview while dragging, write on release (flash); effect drawn on the board; paint is manual and rate-limited | RAM until "Save" commits to EEPROM | effects, per-key canvas, software streaming that restores the previous effect when stopped | previews are live and volatile; persisted on Save |
| Feature availability | per product | definition menus decide | per-board facts; Switches page only on boards whose firmware was read; read-only elsewhere | pages greyed out when unsupported; RGB page explains when firmware lacks it | single model | single model |
| Unsupported devices | not covered | not supported without a definition | still works: reads the command set from the board, asks before writing; Contribute tab collects a read-only bundle | not covered | n/a | n/a |
| Failure and recovery | — | — | "If the keyboard stops responding": numbered steps (close app, power-cycle, Fn shortcuts, reset) | — | Backup & Recovery tab: baseline capture, A↔B diff | explains a sleeping RPC and how to wake it |
| Backup | — | layout export | export everything to a file | `.vil` import/export | factory baseline + diff | JSON import/export; the original config as restore point |

## Answers

**1. Effective patterns.** Select-then-assign with immediate visible feedback on the board (Keychron,
VIA). Category-organised keycode pickers with search. Previews that are visibly temporary while
dragging, with a single commit (Sharkfin, Vialite, Micro 2). Read-back or checksum confirmation after a
write (OpenAula, Micro 2). Greying out pages the board cannot use, rather than hiding them silently
(Vialite). A numbered recovery procedure written for non-experts (Sharkfin). Treating the device's own
data as the authority over the app's files (Sharkfin, Micro 2).

**2. Where apps become confusing or intimidating.** Layer semantics explained only in prose (Keychron's
Mac/Win layer numbering). Immediate writes with no indication of whether the change persisted. Support
gated on an external definition repository, so an unrecognised board simply does not appear (VIA).
Engineering consoles exposed as primary UI (packet consoles in single-device tools).

**3. Too many steps.** Macro creation as a press/release sequence entered by clicking (Keychron's
documented 6-step example). Bringing an unsupported board into VIA (firmware merge, userspace merge,
definition PR). Restoring a backup without a diff, then checking each section by hand.

**4. Distinguishing supported, unsupported and experimental.** Sharkfin: per-board counts ("accept
changes", "after the board has said which command set", "read-only") and read-only pages. Vialite:
greyed-out pages. Most others show no distinction. None marks individual controls by evidence.

**5. Connection errors and hardware limits.** Sharkfin and Micro 2 are the most explicit: they say
which link carries settings, which OS permission is missing, and what to do when the firmware stops
answering. Keychron's article states the browser requirement. VIA and Vialite assume a supported board.

**6. How OpenKey can reduce uncertainty.**
- Always show *what* is connected and *how sure* OpenKey is, in a persistent status bar — not a toast.
- Make every control state its source: read from the keyboard, remembered from OpenKey's last write,
  or a local preview.
- Separate three moments that other tools blur: edited locally → written → verified.
- Show a change plan before persistent writes (target, what changes, persistence, verification, backup).
- Present unsupported devices as a workflow (inspect → evidence → contribute), not an error.

**7. Meaningful differentiation (not cosmetic).** Supported by OpenKey's architecture and implemented
in this phase:

| Differentiator | Backed by |
| -------------- | --------- |
| A device home that lists what *this* keyboard can do, derived from evidence-backed capabilities | capability model + verdict |
| Precise write outcomes that survive the toast: modified, saving, saved and verified, saved without verification, failed with device state unknown | transaction outcomes + operation state |
| Consent-gated identification with the exact bytes shown | probe plans |
| Offline analysis and comparison of diagnostic files, usable on mobile | diagnostic import |
| Simulated, unknown, offline and hardware sessions that can never be confused | verdict kinds + status model |

OpenKey does not match VIA's or Sharkfin's board coverage, Vialite's QMK feature depth or the
vendor tools' firmware updates, and does not claim to.
