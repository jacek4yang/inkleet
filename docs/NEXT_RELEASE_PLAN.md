# InkLeet next-release backlog

Status: tracked next-release scope. The Rust inspection display/paging slice is implemented on this development branch; native and browser qualification remain pending. Other items below are acceptance requirements, not completion claims. No GitHub issue creation, release, tag, or release acceptance is implied by this document.

See RUST_VARIABLE_VISUALIZATION.md for the implemented slice and remaining type/platform matrix. Login implementation status must be updated when its separate changes are integrated.

## Release boundaries

- Keep implementation, verified tests, and downloadable packages separate in status reports.
- Required package targets: macOS Intel x86_64 DMG; Windows x64 setup EXE and MSI; Linux x86_64 tar.gz.
- Preserve branch protection. Merge only after required checks pass and review findings are resolved.
- Do not publish a release or tag without separate authorization.
- A passing Linux test does not qualify Windows or macOS behavior.

## P0: Native login and persistent sessions

### Intended experience

- Native InkLeet login is the default, with an unmistakable LeetCode account label.
- Show the QR code and protocol-supported waiting, success, expiry, invalid, failure, cancellation, and retry states in InkLeet UI rather than embedding the whole website. Do not invent a distinct scanned state unless a verified protocol signal supports it.
- Keep the existing official WebView login as a separately and visibly selected fallback for supported flows that require an official browser challenge. Never open it silently, describe it as native, or bypass a CAPTCHA or anti-bot challenge.
- If no fallback is selected and the native flow is unsupported, show an honest actionable error rather than simulating successful login.
- Restore valid saved sessions on startup. Re-authenticate only when the session is demonstrably invalid, not after every restart.

### Current evidence and limits

- Existing auth uses an incognito WebView, a temporary profile, and an in-memory session. No system-keychain persistence is wired in.
- Existing login requires a manual verification action after official-page login.
- The first inspected HAR contains authenticated homepage loading, not a complete QR login transaction.
- The second capture verifies POST /graphql/ with createSignInQRCode returning authSignInCreateScanData fields scanId, ok, and data. The data JSON contains an app deep link for local QR rendering.
- Polling uses checkQRCodeSignInStatus / authSignInByScanWithPhone. Captured JavaScript names WAITING, SUCCEED, EXPIRED, INVALID, and FAILED states; 11 actual responses were WAITING. No distinct SCANNED state or TTL was established.
- The inspected JavaScript polls at one-second intervals and contains success/expiry handling. Those branches were not verified by a live successful transaction. Successful session-cookie exchange and session lifetime remain unverified.
- User-requested automatic QR refresh must follow a verified terminal-expiry response, not an invented timer. This is an InkLeet behavior change: the inspected official implementation uses manual refresh.
- Do not infer an endpoint or token lifetime from static JavaScript strings or a homepage QR image.
- China and international sites are separate capability targets. Do not assume equivalent QR protocols.

### Implementation requirements

- Model each login attempt with an owner/generation and explicit terminal states. Duplicate clicks must not create competing attempts.
- Keep network requests, cookies, CSRF handling, and session validation in Rust. Never expose raw session secrets through frontend IPC.
- Use one shared session store and validation path for both native and official fallback login.
- Store sessions through the platform credential facility: macOS Keychain, Windows Credential Manager, and supported Linux Secret Service. Pin and test the chosen library/version and backend behavior.
- Scope records by application, site, and account. Do not store passwords.
- Offer a clear remember-login choice. Real credential storage or real-account testing requires the applicable user consent; implementation tests use fake credentials only.
- If secure storage is unavailable, locked, or denied, report session-only operation. Never silently fall back to plaintext files or localStorage.
- Distinguish network outage, rate limiting, ambiguous 403, and verified authentication expiry. Do not delete credentials on transient failure.
- Logout clears active state and secure storage, invalidates pending work, and handles deletion failure explicitly. A late login or restore response must not resurrect the account.
- Redact secrets and personal data from errors, telemetry, logs, test fixtures, screenshots, and repository files. Never commit the original capture.
- Bound polling, apply server-directed retry delays, and cancel promptly. Treat the captured one-second polling interval as evidence, not permission for unlimited retries. Automatic refresh after terminal EXPIRED must invalidate the previous scan owner, avoid overlapping requests and refresh loops, and retain a manual retry path. Do not replay captured credentials or login transactions.

### Acceptance

- Native QR state transitions verified from actual protocol evidence and deterministic fixture tests, including automatic refresh on EXPIRED, no speculative expiry while WAITING, and rejection of late success for a replaced scan. INVALID/FAILED require their own explicit handling rather than being silently treated as expiry.
- Restart restore; offline startup; actual expiry; account/site switch; cancelled login; late success; double click; QR timeout; polling 429/backoff.
- Keychain unavailable, locked, and access denied; storage-write failure; logout-delete failure; secure restart behavior on each target platform.
- Fallback is always user-selected and identified as official website login; resulting sessions use the same safe persistence path.
- No raw credentials appear in frontend IPC, source control, logs, or user-facing diagnostics.
- Successful real-account QR and session restore must be separately qualified under explicit account-testing authorization. Fixture success is not live-account acceptance.

## P1: Rust variable presentation infrastructure

### Current evidence

- src-tauri/src/debug_launch.rs configures CodeLLDB with the matching managed Rust compiler's LLDB visualizers and warns on fallback to raw display.
- src/debug-variable-tree.tsx supports recursive expansion, loading/errors, and an explicit synthetic raw-view toggle.
- src/debug-model.ts caps children at 100, values at 4000 characters, and types at 512 characters.
- src-tauri/src/debugger.rs advertises variable paging but requests start=0/count=100; no next-page UI exists.
- tests/native_smoke.py contains real-adapter tests for two HashMap entries, HashSet members, and raw display. This planning audit did not execute them or retrieve new passing artifacts.

### Requirements

- Add bounded variable-page requests with reference, filter, start, and count; represent known/unknown totals and continuation truthfully.
- Preserve named/indexed distinctions and stable ownership for each request.
- Bind every inspection to session, pause epoch, thread, frame, and inspection revision. Resume, stop, restart, frame changes, and explicit evaluation invalidate stale work.
- Deduplicate repeated page loads and reject late responses after collapse or cancellation.
- Separate presentation classification from DAP transport. Prefer adapter-supported logical children; never assume private Rust container memory layouts or classify arbitrary user types from names alone.
- Never automatically call Debug, Display, iter(), len(), or other debuggee functions for rendering. Do not borrow, lock, unlock, or upgrade references to improve display.
- Keep explicit raw display available and distinguish unsupported formatters from empty data.
- Add depth, node, byte, and request budgets. Provide a clear limit message instead of unbounded recursion.
- Expose adapter truncation and limits. An expanded value panel must not claim completeness when the adapter returned only a prefix.

## P1: First-wave Rust types

- HashMap<K, V>: visible key/value columns, K/V types, independently expandable complex keys and values. Label unordered iteration; never use row number as semantic identity.
- HashSet<T>: member-centric view with visible element type. Do not imply stable or sorted order.
- Vec<T>, arrays, and slices: logical index, element value/type, and verified length. Capacity only when reliably available.
- String, str, and char: readable and escaped views; distinguish byte length from character count; cover Unicode, newlines, and NUL.
- Option<T> and Result<T, E>: prominent active variant and only its live payload; clear None/Some/Ok/Err states.
- Structs, tuples, and enums: names or positional fields, generic type information, and active variant; no fabricated inactive variant data.

## P2: Extended Rust types

- BTreeMap/BTreeSet: retain actual ordered traversal.
- VecDeque: logical indexing across wrapped storage.
- Box, Rc, Arc, and references: prioritize the pointed-to logical value; show address/count metadata only when safely and reliably supplied.
- Weak: distinguish expired and available state without automatically upgrading it.
- RefCell, Mutex, and RwLock: show safely readable state; never borrow or acquire a lock for display.
- BinaryHeap, LinkedList, and additional standard types: qualify individually. Until verified, preserve honest generic/raw fallback rather than claiming universal support.
- Detect or bound cycles and repeated references without pretending all identical values are aliases.

## P1: Debug UI acceptance

- Names, types, and summaries are visible without hover; full type details can be opened.
- Collection-oriented table/tree layout supports keyboard navigation, clear focus, accessibility labels, and long generic names.
- Lazy pages explain displayed count, total when known, and unknown totals; no silent 100-item ceiling.
- Explicit full-value/escaped-value view and copy action, with truthful truncation state and bounded loading.
- Raw toggle is reversible and only treats adapter-marked synthetic raw nodes as internals, never similarly named user fields.

## Required test matrix

### Data fixtures

- Empty, 1, 99, 100, 101, and 1000 element collections; zero-sized elements; high capacity with small length.
- Nested Vec<HashMap<String, Option<Result<...>>>>; custom struct keys; different keys with colliding hashes; unordered assertions for hash collections.
- Long and non-ASCII strings; escaping; newline/NUL; byte/character length differences.
- Every Option/Result variant and unit, tuple, and named enum variants.
- VecDeque wrapped storage; BTree ordering; Rc/Arc sharing and cycles; expired Weak; borrowed/locked states.
- Formatter absent, malformed adapter response, unknown child counts, truncated summaries, and unsupported types.

### Lifecycle and performance

- Rapid repeated expansion/page requests; collapse while loading; frame/thread switch; resume then pause; stop then restart; evaluation invalidation; delayed old replies.
- Bounded requests and memory for large/deep structures; no target-side evaluation side effects.
- Record actual timings and limits before setting performance acceptance thresholds; do not invent parity with another IDE.

### Platform qualification

- Run actual compiler/CodeLLDB fixtures on Linux x86_64, Windows x64, and macOS Intel x86_64.
- Record compiler, adapter, formatter, OS, and application commit versions with each result.
- Keep UI fixtures, native adapter tests, and package installation/launch tests separate.
- Attach sanitized screenshots and exact structural assertions for key/value mapping, element types, pagination, and state invalidation.

## Suggested implementation sequence

1. Complete and qualify the prepared reading/diagnostics batch without conflating it with this backlog.
2. Verify native QR protocol evidence; implement secure session lifecycle and unified restore with fake-session tests.
3. Implement bounded DAP pagination and ownership/truncation model.
4. Add first-wave collection and variant presentation, then platform-native fixtures.
5. Add extended Rust types only where actual adapter evidence supports them.
6. Qualify native login and persistence under appropriate account consent; finish package acceptance.
7. Review remaining limitations and obtain release publication authorization separately.
