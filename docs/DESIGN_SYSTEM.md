# Design system

OpenKey's visual language is a precise hardware-engineering workspace: restrained colour, strong
hierarchy, and state that is always explicit. Everything lives in `apps/web/src/styles.css` (tokens at
the top) and a small set of React primitives. No component library is used: the primitives below
cover the app, and adding one would cost bundle size without solving a measured problem.

## Tokens (`:root`)

| Group | Tokens | Notes |
| ----- | ------ | ----- |
| Surfaces | `--bg`, `--bg-raised`, `--bg-sunken`, `--bg-hover`, `--border`, `--border-strong` | light, dark (system or explicit) and high-contrast variants |
| Text | `--text`, `--text-2`, `--text-3` | every pair meets WCAG AA 4.5:1 for small text in both themes (checked 2026-10-11) |
| Semantic | `--accent`, `--ok`, `--warn`, `--danger`, `--info` and their `-soft` backgrounds | status is never colour alone: pills carry text, icons carry labels |
| Keyboard | `--key-case`, `--key-cap`, `--key-top`, `--key-text`, `--staged`, `--tested` | renderer only |
| Spacing | `--sp-1` … `--sp-8` (4 px base) | |
| Type | `--fs-xs` 11.5 · `--fs-sm` 12.5 · `--fs-md` 14 · `--fs-lg` 16 · `--fs-xl` 20 · `--fs-2xl` 24 | nothing functional below 11.5 px |
| Controls | `--control-h` 32 / `--control-h-sm` 28 px; 40 / 36 px on coarse pointers | touch targets grow automatically |
| Shape | `--radius-sm` 7 · `--radius` 10 · `--radius-lg` 14 | |
| Elevation | `--shadow`, `--shadow-lg` | change bar, notices and dialogs only |
| Layers | `--z-sticky` 20 · `--z-nav` 40 · `--z-toast` 50 · `--z-banner` 60 | dialogs use the native top layer |
| Motion | `--dur-fast` 120 ms · `--dur` 180 ms · `--ease` | all animation is disabled under `prefers-reduced-motion` |
| Breakpoints | 600 phone · 860 off-canvas navigation · 1080 editors stack · 1440 wide | documented in the stylesheet; CSS cannot use variables in media queries |

## Primitives

| Primitive | File | Use it for |
| --------- | ---- | ---------- |
| `StatusBar` | `app/StatusBar.tsx` | the one persistent answer to "what is connected, how sure, what is running"; a polite live region |
| `ChangeBar` + `useChangeTracking` | `components/ChangeBar.tsx` | every editor that writes: modified → saving → verifying → verified / saved without verification / mismatch / failed / reverted; registers unsaved edits for the navigation guard |
| `SourceNote` | `components/ui.tsx` | where the values on screen come from: read from the keyboard, OpenKey's last write, or a local preview |
| `WriteGateNote` | `features/shared/WriteGateNote.tsx` | what the safety policy will do with Apply (experimental, blocked) |
| `VerdictCard` | `features/shared/VerdictCard.tsx` | detection outcome, reasons, conflicts, unobserved signals, next safe step, consent for identification |
| `ErrorPanel` / notices | `components/ui.tsx`, `app/Notices.tsx` | errors as *what happened · what it means · next step*, technical detail collapsed |
| `EmptyState` | `components/ui.tsx` | why an area is empty and what to do |
| `FileButton` | `components/ui.tsx` | styled, keyboard-reachable file input |
| `Spinner` | `components/ui.tsx` | only while an operation is actually running |
| `Dialog` | `components/Dialog.tsx` | native `<dialog>` (focus containment, Escape, inert background); reserved for decisions: writes, discarding edits |
| `KeyboardView` | `components/KeyboardView.tsx` | any layout from key-unit geometry; roving tabindex, arrow keys, Enter; legends show assigned actions |
| Disclosure cards | `details.card.disclosure` | secondary detail (capability table, technical data) collapsed by default |
| Pills | `.pill` + `ev-*`, `st-*`, `ui-*`, `vd-*`, `wd-*`, `cs-*` | one vocabulary per concept: evidence, feature status, user-facing state, verdict, write decision, adapter status |

## Rules

- **State before decoration.** Every surface that shows device data says where it came from and whether
  it is local, written or verified.
- **One place for actions.** Editors put Discard / Apply in the change bar; page headers carry titles and
  purpose, not buttons.
- **Modals for decisions only.** Writing to a keyboard and discarding edits are decisions; navigation and
  routine edits are not.
- **Nothing hover-only.** Every tooltip duplicates an accessible name or visible text.
- **No invented geometry.** Knobs and screens are drawn only when a layout declares them; otherwise the
  capability list names them.
- **Simulation is labelled everywhere** and never carries a hardware-verification badge.
