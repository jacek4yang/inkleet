# Settings workbench checkpoint

Status: authored, statically reviewed, not executed or published. Base reference: `bd9b83f80629cf05b071dc470fe35706df7fe509`. No passing runtime or visual-acceptance claim is made.

## Implemented draft scope

- A finite typed catalog for actual preferences and runtime-owned actions. No placeholder controls or raw JSON editor.
- Bounded bilingual, row-level AND search; exact IDs and distinct C/C++ matching. Proxy mode is supporting context for address matches and is excluded from direct result counts.
- Explicit inherited/overridden language settings, editor-scoped modified filtering, and immutable per-row draft resets. Proxy resets restore the mode/address bundle together.
- Fixed, lazily visited form owners retain pending writes, drafts and failures across navigation and filtering. Each owner keeps its existing independent Save and revision protocol.
- Awaited Reload clears failures only after successful completion, including same-revision reads. Hidden failures have a compact reveal action; reveal never rereads or resubmits.
- Ctrl/Cmd+F targets the topmost Settings dialog; Escape closes it. Nested dialogs retain ownership. Filter/reset and successful-save focus recovery are covered by authored regressions.
- Compact grouped layout with native controls, bounded narrow/short viewport layout, and explicit hidden-row semantics. The empty debug category becomes a direct run/debug manual entry.

Tab display width is a companion increment documented in `editor-tab-display.md`. The architecture remains React/CodeMirror/Tauri/Rust. Existing atomic saves, conflict checks, recovery copies and account isolation are unchanged.

## References and reuse

- VS Code `dc811b77cd1e0753d306b0c6f819a7311bcf49b5` (MIT): configuration registry metadata, settings tree/search models and focus-stable editing.
- Zed `56934ec0560bce8929025497411de7f5322fb6ca` (settings crates GPL-3.0-or-later): design reference for compact groups and language overrides only.
- Lithe-IDEA `995867c42ae3a440cbf77294c13c58e4bd48b99d` (Apache-2.0): settings search/navigation and retained visited panels.

This increment is independently implemented for InkLeet. No Monaco, GPUI, Swift component, upstream source or asset is copied. Upstream persistence error-handling patterns do not replace InkLeet's explicit errors and revision protections.

## Required acceptance

Run typechecking, all unit/helper tests, the complete existing browser suite, new Settings/Tab suites and Linux native regression in CI. Preserve prior assertions, including PR92 owner retention and delayed Save checks. The new browser suite contains 14 authored scenarios and the pure helper suite 26 authored tests; these are not pass counts.

Inspect screenshots for default editor, Vim-only search, language override, modified filter, proxy, hidden failure/reveal, 390×844 narrow and 1100×480 short-height views. Confirm readable full labels, no overflow, reachable Save/Reload, keyboard focus and exact result counts. Browser mocks do not verify native storage, IME, accessibility, other platforms or live LeetCode.

Record exact commit SHA, test results, failed/unverified cases and image identity before calling this checkpoint complete. No release or installer is produced by this draft.
