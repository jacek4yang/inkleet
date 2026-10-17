# Expanded documentation code highlighting

Base checkpoint: PR84, `881cbd4131f99b214020956e0e01cfc8970c48fa`.

## Scope and compatibility
Only the expanded documentation reader decorates explicitly tagged Markdown fences and legacy LSP language/code parts. Rust, Python, Go, C/C++ and Java use the existing CodeMirror language parsers and Lezer's public highlighter. Unknown and untagged blocks stay plain. Tooltip previews do not start a syntax worker. No editor, LSP, save, submission, account or production snippet gate changes.

No upstream application code is copied. The existing MIT-licensed `@lezer/highlight@1.2.5` dependency is explicitly declared rather than imported transitively. Marked's public Renderer.code supplies its own escaping and newline behavior. Existing license obligations remain.

## Ownership and safety
The original Markdown worker retains its 600ms deadline, two-slot limit and 262144 UTF-16 HTML limit. An optional sidecar identifies only renderer-generated code blocks with random markers absent from the source. Sanitization strips scripts, resources, classes and all unrelated attributes. Marker metadata, unique location and exact code text must agree; all markers are removed before mounting.

A separate optional syntax worker has one slot and a 400ms deadline, including cold imports. It returns only bounded ranges and fixed palette tokens. Invalid output, timeout, errors, saturation and unsupported languages retain the sanitized plain code. Abort/close owns termination; late replies cannot mount content. The maximum is two Markdown workers plus one optional syntax worker.

No syntax parsing runs on the main thread. The detached DOM is decorated once, then mounted and indexed for search. There is no asynchronous recoloring after the search index exists. Search teardown restores the original token/text nodes.

## Bounds
- At most 32 eligible code blocks; 8192 UTF-16 units per block, 32768 aggregate.
- At most 1024 token ranges; oversized blocks remain complete plain code.
- Projected DOM nodes must remain below 28000, reserving space below search's 32768-node budget.
- Marker overhead alone never turns accepted formatted Markdown into raw-text fallback.
- Baseline cache includes sidecar size and separates reader and preview entries; its existing 16-entry/262144-unit total limit remains.
- Optional syntax latency can add up to 400ms before first reader mount. It is not a guarantee that every slow device or cold load produces colors.

## Reproducible acceptance
1. Open completion/hover documentation containing tagged code, expand, and inspect keyword/string/type colors without extra UI chrome.
2. Search a phrase spanning keyword, identifier, punctuation and literal. Escape hides search while retaining identical code and token nodes.
3. Test Rust/Python/Go/C/C++/Java, aliases, legacy parts, unknown tags and untagged code.
4. Compare full code text including Unicode, tabs, HTML-looking strings and trailing newline. Copy must retain exactly the displayed code.
5. Open long blocks and many fences; text and full-tail search remain available even when color budgets are exceeded.
6. Close while the optional worker is held, deliver a late reply, then reopen. No old content or focus takeover.
7. Exercise cache hits, malformed ranges, worker error/timeout, narrow viewport and forced colors.
8. Native Linux uses genuine Rust completion documentation when it contains eligible fences; missing eligible input is recorded as unverified, never a native highlighting pass.

## Verification
Pending GitHub Actions on the submitted commit. Browser results cannot replace native or cross-platform qualification. Windows/macOS/Android, native Chinese IME and live Chinese-site account flows are not covered by this checkpoint. No package, release or merge is authorized by these tests.
