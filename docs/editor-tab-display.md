# Tab display width checkpoint

Draft base: `bd9b83f80629cf05b071dc470fe35706df7fe509` (PR #93).

## Scope

The existing editor settings panel gains one working control, **Tab 显示宽度**, for integer column widths 1 through 8. The optional typed `tabSize` setting defaults to 4 when absent. Saving 4 removes that key from a submitted copy, including an already loaded explicit 4. The draft is not mutated on a failed save. Save, revision checks, reload and storage keep the existing protocol.

This controls the visual width of tab characters in the code editor, Markdown notes editor and read-only source viewer. It does not rewrite source, change indentation defaults or configure formatters. Go keeps its tab indentation unit; other code languages keep four spaces and Markdown keeps two. CodeMirror editing commands may use tab columns when calculating mixed indentation; this is not a promise that all Tab-key outcomes are identical. Rendered Markdown preview is outside the editor preference's scope.

## Mechanism

A dedicated CodeMirror compartment owns `EditorState.tabSize`. Saving or reloading a changed value dispatches a display-only reconfiguration to the existing view, without recreating the editor, its document, history or language-service owner. Unchanged values do not dispatch again. New editors and cached editor states receive the current width when mounted.

The source viewer retains its own compartment and current width for later source-navigation states. Back and Forward continue to use the existing source history. The source viewer's document-write rejection remains unchanged.

The existing cursor-status and indentation-guide plugins already react to tab-size reconfiguration. No changes to their status ownership or rendering lifecycle are needed.

## Draft regression coverage

The proposed browser cases cover:
- Legacy default 4, permitted values, save-once while delayed, no pre-save application, default-key omission, explicit reload, closing/reopening Settings and fresh App instances.
- Existing Settings draft/error retention, lazy reads, hidden controls, busy state and duplicate-save checks, now including the actual tab-width select.
- Main and notes editor identity, exact document/selection retention, undo/redo depth and executable undo/redo after a save.
- Current cursor columns, rendered tab geometry, indentation guides and unchanged language indentation units.
- No language-service restart, formatting request or source save caused by changing display width.
- Inherited source-viewer width, in-place width changes, retained source selection/history and read-only rejection.
- Active snippet-state identity and LSP ownership across direct display reconfiguration.

Opening Settings still follows the editor's existing blur behavior, which ends an active snippet. The snippet regression isolates preference reconfiguration and does not claim to change that focus policy.

## Native acceptance and compatibility

The native draft selects 8 through the real settings panel, verifies the persisted settings file and computed editor tab size, preserves editor/content identity and source bytes, then restores the default and verifies omission of the optional field before existing cases continue. It records a dedicated result and screenshot.

Older strict readers reject any tabSize key, including explicit 4. Returning to default through the new UI removes it from the active file; an earlier backup can still contain the field. No load-time rewrite or transparent downgrade is claimed.

## Verification limits

This is an unexecuted draft. No build, typecheck, import, unit test, browser test, native test or workflow has been run for it. Browser IPC models settings persistence and language services; it is not native storage or live-LSP qualification. The schema/backend companion supplies validation and persistence coverage.
