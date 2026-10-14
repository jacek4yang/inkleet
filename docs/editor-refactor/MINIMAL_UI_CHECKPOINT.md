# Minimal workbench checkpoint

Status: implementation submitted for CI and real Linux WebView verification. Not accepted until screenshots and regression results have been reviewed.

## Scope and source
This checkpoint responds to the owner's screenshot: remove the persistent explanatory LSP sentence, font/environment/recovery/export row and footer slogan; move low-frequency operations into one Settings entry. Keep the problem statement, current save/error/conflict state and online submission safeguards.
Architecture remains Tauri 2 + React + CodeMirror 6 + Rust.

Lithe reference is pinned to **6210013d06e1410c7bcbb1949e1ff16ea8deae15**. See [full source comparison](LITHE_REFERENCE.md).
Specific UI references (all paths at the pinned SHA):
- `windows/tauri/src/features/debugger/components/debugger-view.tsx`: compact ghost controls and session/pause/thread gating. Its additional duplicate text action row is not adopted.
- `windows/tauri/src/ui/icons.tsx`: central SVG/Lucide wrapper and decorative-icon semantics. Button accessible names come primarily from Button and callers. Its mixed JetBrains/Lucide assets are not copied.
- `windows/tauri/src/features/settings/components/settings-dialog.tsx`: categories, requested-category entry and current-item semantics.
- `windows/tauri/src/features/settings/components/settings-section.tsx`: setting-row label/description associations.
- `windows/tauri/src/features/run/components/project-preparation-status.tsx`: project-preparation progressive disclosure, not an LSP component. Compact ready is hidden; busy/failure gets a short label and expandable details/recovery.
- `macos/Sources/Lithe/Views/Debug/DebugToolbarPresentation.swift`: ordered groups, separators, 18px icons and 36px toolbar.
- `macos/Sources/Lithe/Views/Debug/GenericDebugView.swift`: button help/shortcut/accessibility labels, low-frequency menu and pending-request gates.
- `macos/Tests/LitheTests/DebugToolbarPresentationTests.swift`: presentation contracts for ordering, grouping, resource/command presence and state labels; not native end-to-end behavior tests.
- `windows/tauri/src/features/layout/components/sidebar/sidebar-pane-selector.tsx`: icon mode with tooltip, accessible name and current-item semantics.
- `windows/tauri/src/ui/button.tsx`: sizes, focus/disabled styling, tooltip-derived labels and effective command shortcuts.
Swift files are interaction references, not cross-platform components.

Classification **B**: independently reimplemented React/CodeMirror-compatible interaction patterns. No Monaco or Swift code transplanted. All SVG paths in `src/icons.tsx` are newly authored; no JetBrains/Nucleo artwork was imported. Existing Apache-2.0 and third-party notices stay intact.

## Implemented
- One topbar Settings control. Category/search routes only to actual existing operations.
- Font information, managed environments, reconnect, recovery, export and external note editing/refresh moved to Settings.
- Compact LSP status dot/button opens language/environment details; full status retained for title/accessibility and diagnostics.
- Debug start/continue/pause/step/stop/breakpoint/evaluate are consistent inline SVG controls with accessible names and shortcut tooltips. Disabled state still follows original guards.
- Notes toolbar is preview/edit plus Settings.
- Removal of permanently displayed pedagogical copy and account identity panel.
- Current draft, errors, conflicts, unverified breakpoints and stale execution-result warnings remain visible.
- Settings close restores invoking focus. Settings navigation does not remount the editor.

This is a navigational Settings hub, **not** the complete typed, persisted, migrated P2 Settings system. It does not claim configurable fonts/tab/Vim or command presets yet.

## Regression adaptations and risks
Existing assertions for exports, environment installation, file conflict/recovery and external refresh now exercise their Settings routes. They are not removed. Debug pause reason is checked through the control title. Save failures remain visible on mobile after reducing footer to one status span.
The native driver has a bounded single retry for read-only transport resets (GET, element lookup); state-changing debug/online actions are not blindly replayed.
Risks: narrower toolbars, low-frequency action discoverability, WebView dialog focus and mobile overflow. Real screenshots and keyboard checks are required.

## Reproducible acceptance
1. Launch a fresh build. Default workspace shows problem/code, concise navigation and save state; no editor-foot action row or LSP explanatory paragraph.
2. Gear → search “导出”: both source and Markdown export appear; exported bytes equal full documents, including long notes.
3. Gear → 语言与环境 → 开发环境: install a private toolchain. Close and edit; connected indicator is compact. Click it to read details and reconnect.
4. Notes → gear → 刷新文件: adopt an actual externally modified notes.md. Concurrent unsaved text still requires conflict resolution and preserves both versions.
5. Gear → 源码/笔记 → recovery: select and restore a backup; changed-again external file must be refused.
6. Open Settings, search, press Escape: focus returns to the invoking control; draft and undo history survive.
7. Start local debug, set a breakpoint with F9, F5 then F10/F11/Shift+F11; inspect SVG tooltips, disabled state, stack/variables and single-shot evaluate. Stale snapshots keep warnings.
8. At 390px and desktop widths, check no toolbar overlap, clipped completion popup or hidden save failures.

## Evidence status
- Browser/TypeScript: pending this commit.
- Linux native WebView: pending this commit.
- Prior P0 real keyboard test passed; complete six-language P0 rerun failed on WebDriver transport, not accepted as full pass.
- Windows/macOS/Android native, physical Chinese IME, performance and long-run acceptance: unverified for this checkpoint.
- No main merge, tag or official Release.

First CI observation (8924097): TypeScript/build and 18 domain tests passed. Browser run reached local-result checks after Settings, keyboard, notes, LSP and environment UI checks, then failed because the existing local-vs-judge assertion still queried the removed permanent sentence. The distinction is now retained on the result tooltip and in the runtime Settings page, with assertions on both. Screenshot inspection additionally found notes SVGs shrinking under old pane-heading padding; specific padding and minimum rendered-icon-size regression checks added. Neither failure is treated as a complete pass.

## Browser verification update
Source e3072e676d9c5cefec6454ff5f4ac5a8b75f0909, CI [38499526237](https://github.com/jacek4yang/inkleet/actions/runs/38499526237): TypeScript, 18 domain tests, production frontend build and the complete browser regression passed, including Settings routes, SVG dimensions, keyboard, completion, login/online safety fixtures, export, conflicts, recovery and external-note guards.
Screenshots below are Linux Chromium with authored test data, not native or real account evidence.
- [Workbench](evidence/minimal-desktop-code.png)
- [Searchable Settings](evidence/minimal-settings-search.png)
- [SVG debugger](evidence/minimal-debug-svg-toolbar.png)

Performance fixture: AMD EPYC 9V45, 4 logical CPUs; 390×844 viewport; 10,000 lines / 438,889 characters; 32 actual keyboard samples after synthetic editor paste. Input-to-next-animation-frame P50 23.6 ms, P95 26.2 ms; reported longest long-task 0 ms; paste setup 43 ms. This is a browser baseline, not native CPU/memory/IME or long-run acceptance.
