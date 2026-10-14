# Minimal workbench checkpoint

Status: implementation submitted for CI and real Linux WebView verification. Not accepted until screenshots and regression results have been reviewed.

## Scope and source
This checkpoint responds to the owner's screenshot: remove the persistent explanatory LSP sentence, font/environment/recovery/export row and footer slogan; move low-frequency operations into one Settings entry. Keep the problem statement, current save/error/conflict state and online submission safeguards.
Architecture remains Tauri 2 + React + CodeMirror 6 + Rust.

Lithe reference is pinned to **6210013d06e1410c7bcbb1949e1ff16ea8deae15**. See [full source comparison](LITHE_REFERENCE.md).
Specific UI references:
- Windows `windows/tauri/src/features/editor/components/debugger-view.tsx`: compact icon controls, state-dependent enablement; do not copy its duplicate text toolbar.
- `windows/tauri/src/ui/icons.tsx`: central icon API and accessible names. Its mixed JetBrains/Lucide assets are not copied.
- `settings/components/settings-dialog.tsx` and `settings-section.tsx`: category navigation, direct entry to relevant category, labels.
- `ProjectPreparationStatus.tsx`: short status in the workbench, expanded explanation on demand.
- Native macOS `DebugToolbarPresentation.swift`, `GenericDebugView.swift` and `DebugToolbarPresentationTests`: stable grouped order, compact SVG-sized controls, shortcut/help/accessibility metadata and state gating. These are interaction references, not cross-platform components.
- `sidebar-pane-selector.tsx` and `ui/button.tsx`: icon controls with hover labels and accessible names.

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
