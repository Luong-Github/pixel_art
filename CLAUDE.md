# Pixel Art Studio — repo guide

Browser-based pixel-art editor + animation studio. Angular 17 (standalone, signals).
Free core; Pro (cloud sync / GIF / larger canvas) is "coming soon" — billing not enabled.

> Global rules still apply: explain in Vietnamese, code/comments in English, fix in place,
> match surrounding style, don't commit/push unless asked.

## Build / run
- Build (dev): `node node_modules/@angular/cli/bin/ng.js build --configuration development`
  run from this repo root. (`npx ng` is flaky here — use the node path.)
- Check errors fast: pipe build through `grep -E "Error|error TS|ERROR"`.

## Architecture
- **One big editor component**: `src/app/editor/editor.component.ts` (~9k lines) + `.html` (~1.5k) + `.scss`.
  Edit in place; don't rewrite. Search before adding — most helpers already exist.
- **Dock panel system**: `src/app/editor/dock/` — `DockService` + `dock.types.ts`
  (`PanelId`, `PANEL_IDS`, `PANEL_TITLES`, `defaultDockState()`, `DOCK_STORAGE_KEY`).
  Panels are collected via `@ViewChildren(DockPanelDefDirective)` and rendered generically
  (`templateFor(id)` / `panelTitle(id)`). **New panel** = add id to `dock.types.ts` + a
  `<ng-template dockPanelDef="id">` in the HTML. Bump `DOCK_STORAGE_KEY` when the default
  layout changes (stale saved layouts are discarded).
  - **Gotcha:** `DockService.show()` no-ops when the panel isn't currently `hidden`. To
    force a panel visible from an action, `float()` it or `dock()` it (both detach then
    reattach, so they work from any state) — `show()` alone fails silently for docked
    panels. e.g. `openAdjust()` floats the Adjust panel via `float('adjust', rect)`.
- **Storage**: `editor/projects/project-store.service.ts` — IndexedDB (`meta` + `data` stores),
  local-only until a backend exists. Recent-projects + Save modal live on this.

## Pixel model
- `type Pixel = string | null` — flat `width*height` array, row-major (`index(x,y)`).
- Colors are `#rrggbb` (opaque) or `#rrggbbaa` (only when alpha < 255).
  `hexToRgb` slices the first 6 hex chars; use `colorAlpha(hex)` (0–255) and `withAlpha(hex,a)`.
- Canvas render: `drawPixels` uses `putImageData`; reads per-pixel alpha when `color.length > 7`.
- For anything beyond a few hundred pixels, **never** read/paste raw pixel arrays — use the
  `pixel-art` skill toolkit (`~/.claude/skills/pixel-art/pixel-tools.js`) on the `.pixelart.json`.

## i18n (runtime, no reload)
- Impure `TranslatePipe` (`| t`) + `LocaleService` (`lang` signal, localStorage `pixelart.lang`).
- Dictionary: `src/app/i18n/translations.ts` — **5 languages: en / vi / zh / fr / ru**.
- Text: `{{ 'some.key' | t }}` · attributes: `[title]="'some.key' | t"`.
- Adding any user-facing string → add the key to **all 5** language dicts.

## Adjust panel (Levels/Curves/BC/SH/HSB) — session model
- `openAdjust()` shows the `adjust` dock panel + `beginAdjust(true)` (captures base, resets).
- Slider/curve change → `onAdjustChange()` → `applyAdjustPreview()` (live preview via `previewPixels`).
- **Apply** = `commitAdjust()`: bakes into the layer but KEEPS the session + values (base stays the
  original, so re-previewing never double-applies).
- Drawing / switching layer·frame·workspace → `flushAdjust()` bakes once and ENDS the session.
- `previewPixels` is shared with the move tool / drawing — flush before those paths.

## Conventions
- Standalone components, signals, `FormsModule` (`ngModel`), `CommonModule` pipes.
- Match the dense, comment-light style of the editor. No redundant comments.
- **A green build ≠ it works.** A dead click / silent no-op compiles fine. For interactive
  changes, runtime-test or explicitly flag UNVERIFIED with steps. Read a helper's body before
  calling it (guards/no-ops). Before adding a UI control, check existing entry points + icons.
- Internal planning docs live in `docs/` (gitignored): `PRD.md`, `FLOWS.md`, `UX-REVIEW.md`, `IMPLEMENTATION-PLAN.md`.
- **Product ground-truth:** `docs/PRD.md` (features/screens/rules/pricing/acceptance, IDs FEAT/SCR/BR/AC) and
  `docs/business/` (user-behavior specs in BDD/Gherkin + a reusable template). Read these to learn intended
  behavior before changing a feature; check your change against the relevant `BEH-*` / `AC-*` (triggers, feedback, error paths).

## AI team (cross-project, at d:/Projects/.claude)
- Agents: `product-strategist`, `ux-analyst`, `code-reviewer`, `security-auditor`.
- Workflows: `review-changes` (before merging), `pre-ship-audit` (before release).
