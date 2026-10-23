# Preserve explicit Save during formatting

## Scope
Base: `1ee0def8450a6a8246a3f84ca12a62619dbf13e9` (PR #87). This is an InkLeet-owned CodeMirror controller correction; no upstream code is copied or new dependencies introduced.

## Failure and mechanism
When Format Document is awaiting its formatter or diff worker, Ctrl+S records a pending save for the current document generation and workspace epoch. Previously the controller's own formatted transaction cleared that pending command, and a format-only operation returned without writing the canonical file.

Merge a same-generation, same-epoch pending Save into the active formatting operation before applying either asynchronous result. The existing current-document, ready, epoch, composition and destruction checks still run with save semantics. A failed format also consumes its matching queued Save and reports failure instead of silently starting another formatting attempt. User edits and undo still invalidate queued intentions; newer-generation requests remain separately queued.

No change to canonical storage CAS, atomic writes, recovery checkpoints, account isolation, snippet gates, or idle formatting policy.

## Reproducible acceptance
1. Start explicit Format Document on unformatted Python source. Hold the formatter response and press Ctrl+S. Release it: exactly one formatter call and one canonical write of the formatted source; dirty marker clears.
2. Repeat with unchanged formatter output and with the real diff worker response held. Same single-format/single-save result.
3. Reject the held formatter: source and canonical contents remain protected, dirty indicator stays, and an error is shown without an implicit retry.
4. Queue Save and switch language before releasing the old formatter: neither the old result nor its Save writes into the new document; the new document can independently save.
5. Repeat Ctrl+S during held formatting and edit + Save during an older held disk write: coalesce the former and retain the newer generation for the latter.
6. Retain existing tests for newer typing, undo invalidation, isolated format undo/redo, disabled format-on-save, disk failures and settings failures.

## Validation
Pending GitHub Actions execution. Browser fixture uses the real CodeMirror/format diff worker and mocked formatter/storage IPC. Existing Linux native regression is separate; the deterministic delayed-result scenarios are not claimed as native OS or live LeetCode verification. No package, main merge or formal release is created.
