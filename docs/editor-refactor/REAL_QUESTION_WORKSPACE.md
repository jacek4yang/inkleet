# Real question workspace checkpoint

Owner request: remove built-in mock questions and make the logged-in question area behave like a normal LeetCode tool.

## Implemented
- Production no longer contains authored sample problems or their source templates.
- Fresh startup is a true empty workspace, without load/save requests for a fabricated problem identifier.
- Native sidebar reads the real Chinese-site catalogue with keyword search, server-side difficulty/status filters and bounded 25-item pagination.
- Logged-in list requests carry the verified account identifier to the native backend. Credentials stay native and are sent only to the fixed leetcode.cn GraphQL endpoint.
- Account identity and request generations isolate late responses. Logout hides old status-bearing results before effects finish. Backend checks account generation again after the HTTP response.
- Anonymous catalogue never displays account completion status; status filtering is disabled until login.
- Selecting a question loads its actual statement/template, with shared slug/identifier/access validation. Recent public metadata remains available offline.
- Existing source/notes save, conflict/recovery, online-run and submission guards remain unchanged.
- Old sample draft files are not deleted or silently relabelled as real LeetCode solutions. They remain in their original local directories.
- Synthetic data remains only in automated test fixtures under tests/fixtures, not in production initialization.

## Robustness
No polling or background retry is introduced. Search requests are user-submitted; account/filter changes issue one request. Failures are visible and manually retryable. Outdated filters, unmounted sidebar and changed accounts invalidate responses. Opening a question is guarded against duplicate activation; failure never clears the current draft.
Difficulty/status inputs and page offsets are validated natively. Results and response sizes are bounded. Private progress is not written to the public question cache. Existing fixed-origin/no-redirect transport protections remain.
The CN GraphQL interface has no public compatibility promise: exact filter/status behavior requires live checks; parsing/permission/rate-limit failures must remain explicit.

## Tests and reproduction
1. Fresh native installation: no sample-sum/sample-max rows, no synthetic document writes; empty editor until a real question is opened.
2. Browse the real list, search two sum, filter Easy, page forward/back. Every selected statement matches the requested slug.
3. Login through the official window; completion filter becomes available. Logout while a filtered request is pending: no old account result may reappear.
4. Rapidly change search/filter: late older results are ignored; source draft stays unchanged.
5. Open a problem twice/by link; existing local source and shared notes survive. Restart offline and use Recent/cache.
6. Regression fixtures seed only isolated test cache through its real JSON format; all prior editing/export/conflict/restore/debug assertions remain.
7. Real native public query/filter and GUI checks run in GitHub Actions. Authenticated progress needs a real account session and is not claimed by fixture tests.

## Evidence
Pending this commit: TypeScript/Rust/browser/native and screenshots.
Prior minimal-UI frontend checkpoint e3072e6 passed CI 38499526237. Six-language native regression on equivalent app source 3fb6b8e is still running.
Windows/macOS/Android native, real authenticated status filtering and full IME/performance acceptance remain unverified.
No main merge, tag or Release.
