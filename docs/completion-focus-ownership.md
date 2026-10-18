# Completion focus ownership

## Reproduction
Baseline application: `9f04add250b519ceee4d38e60b2cc9219c421dd3` (PR #88).
Test-only baseline: `247373f79dd80e8fa355c47d12cf943e3d4acd8d`.
GitHub Actions run 39094507088 reproduced both cases against the locked CodeMirror dependency:
- Invoke explicit completion, then move focus outside within the same synchronous task, before source IPC issuance.
- Repeat, immediately refocusing the editor in that task.

Both retired intents issued one completion IPC and showed the itemName popup. Setup, focus, unchanged source/selection and fresh explicit-completion recovery checks passed. Full evidence is captured before assertions in COMPLETION_PENDING_FOCUS_RESULT.json.

## Fix
Move the existing provider blur invalidation into a CodeMirror DOM event observer and synchronously close completion there. This retires the pending library source as well as application-owned issued requests before the library's blur handler runs. Refocus alone cannot revive the old intent.

Focus deliberately transferred into this editor's uniquely owned completion popup remains valid; unrelated popup lookalikes are not exempt. Before opening the reader from a focused popup button, restore editor focus so reader dismissal has a live focus target.

No new polling, timers, dependencies, global state, or copied upstream code. This is an adaptation using CodeMirror's existing native APIs. Existing completion admission, snippet capabilities and source/document/version guards remain unchanged.

## Acceptance
The two baseline cases must issue no old-intent completion IPC, display no popup, preserve source and selection and leave focus where the user placed it. A new explicit completion must work once. Existing provider cancellation, mouse selection, documentation expansion, snippets, Escape/Tab/Enter and language-switch regressions must continue to pass.

## Limits
Browser fixture uses real CodeMirror and installed modules but mocked LSP IPC. Native regression is separate; no claim of native IME, other platforms, live LeetCode or all-focus-timing qualification. No main merge, package or release. Validation of the source fix is pending.
