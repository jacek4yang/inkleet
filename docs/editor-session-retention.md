# Bounded inactive editor sessions

## Problem and change
The module-global editor sessions Map retained every visited CodeMirror EditorState indefinitely. Destroying the EditorView stopped its work, but did not release its state, undo history and extension references from this Map.

Retain the 12 most recently deactivated sessions, with an additional 2 Mi UTF-16 current-document admission budget. Restoring a session removes it from the inactive cache; deactivating stores its latest state at the newest position. Replacing a too-large session removes any older entry under that key.

This is an admission/retention policy, **not** a heap-size bound. Undo history and extensions have additional memory costs. No claim is made that this alone fixes immediate typing latency.

## Compatibility
Workspace drafts and onChange remain unchanged and synchronous. Cached states are reused only when their text matches the workspace value, with fresh extensions. LSP destruction, snippet cleanup, save behavior, draft recovery and account isolation remain unchanged.

Returning to an evicted document preserves its workspace draft but starts a fresh undo history and cursor position. Recent retained sessions still restore undo/redo, selection and scroll. This limit affects session-only history, not saved files or recovery drafts.

## Tests
- Pure cache tests cover count and UTF-16 budgets, take ownership, replacement recency/accounting, oversized replacement, empty documents and invalid inputs.
- Real React CodeEditor browser fixture edits via keyboard, switches away/back, verifies undo/redo and scroll/selection, rejects cached state for externally changed text, then opens 13 documents and checks the evicted document's canonical draft remains intact.
- Existing native suite must pass separately; browser fixture does not establish native LSP, native IME, cross-platform or heap/performance results.

No third-party code copied. The implementation is a small native Map cache; no dependency added.
