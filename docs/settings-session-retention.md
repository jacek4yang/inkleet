# Settings dialog draft retention

## Scope
Base PR #91, application `42f55bb04876dee320f16a2517b63856adcd7acc`. This checkpoint changes existing form lifetime and search discoverability, not the settings schema, defaults, formatter policy or storage protocol.

## Baseline reproduction
Test-only head `699a1c59f15b771559236c959d6963b50ec000aa`, run 39099045959: all 11 cases executed; 36 behavior failures, no fixture execution failures, page errors or unexpected IPC. Drafts/errors reset after navigation; Vim searches found no control; downloads reread; all four held-save scenarios issued two saves instead of one. Source fix keeps these checks and adds hidden role/Tab checks.

## Mechanism
Previously category/search filtering unmounted FormatSettings and DownloadSettings. Their local drafts, errors, loading/saving state and duplicate-submit guard were lost. Retain only these panels after their first actual display, within the current Settings dialog lifetime. A native hidden wrapper removes inactive controls from layout, accessibility queries and keyboard navigation. Do not eagerly mount DownloadSettings on editor/unrelated searches. Keep fixed panel positions and the existing editor revision key; explicit reload/success still applies its snapshot-reset semantics. Closing/reopening starts a fresh dialog as before.

Vim is included in the existing editor panel search vocabulary. This does not create a generalized search system or new inactive controls. Manual/license panels retain their explicit-open lifetime.

## Acceptance
Eleven isolated real App browser cases use mocked settings IPC and aggregate evidence before assertions:
- Unsaved Vim/global-format/language override and proxy mode/address survive category/search changes with no save.
- Vim searches are case-insensitive and trimmed and expose the real checkbox.
- Downloads read only at first display; returning or inserting the editor panel before an already-visible download panel does not remount/reread.
- Save failure retains draft/error; navigation does not retry.
- Pending saves remain busy and cannot duplicate; eventual result is retained even while hidden.
- New dialog loads the saved snapshot.
Existing formatter/proxy save/reload, revision conflict, storage and focus tests are retained.

## Limits
Browser IPC is mocked; native regression is separate. No native accessibility, release package, live LeetCode or cross-platform acceptance is inferred. This does not claim complete Settings, shortcut customization or indentation configuration. No main merge, release, package or production snippet gates changed.
