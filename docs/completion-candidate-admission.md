# Completion candidate admission

Base: PR85, a4f848cec29dea9f247ffb7b8531cee61af4d43d.

## Defect
The client previously truncated the sorted matching list to 300 entries before validating completion edits, resolve tokens and snippet capability. A response with 300 rejected entries followed by a usable entry therefore produced an empty menu, even though that valid item was inside the 5000-entry input bound. Explicit completion could retry the unchanged response until its eight-second readiness deadline.

This source-derived case is not proof of the cause of any particular user's missing completion or typing latency.

## Change
Keep input bound, match predicate and sort order. Examine ranked entries with the existing shape/budget admission checks. Retain at most 300 accepted entries and stop immediately at that count. Rejected entries do not consume display capacity.

No server restart, new retry, resolve call, snippet preparation or source parsing is added to admission. Existing document/session/cancellation ownership, snippet capability gates and atomic edit application remain intact.

Worst-case validation now examines up to 5000 entries instead of 300, each with existing edit/text budgets. This is a correctness fix, not a measured general input-latency optimization.

## Reproducible regression
In the existing actual CodeEditor keyboard harness with mocked LSP transport:
1. Return 300 matching high-ranked malformed-format, invalid-range or missing-token candidates, then a valid plaintext candidate.
2. Trigger Ctrl+Space. The valid candidate appears after one completion request with no readiness backoff.
3. Enter applies the valid primary edit and resolved import atomically; Ctrl+Z restores prior source and undo depth.
4. Repeat disabled-snippet prefixes under false, omitted and malformed session capability. No snippet preparation occurs.
5. Return 4999 invalid items followed by valid item 5000 and a sentinel item 5001. The valid item is admitted and the sentinel is never inspected.
6. Return 301 valid items. Exactly the first 300 ranked accepted entries remain.
7. Existing retry, cancellation, capability-refusal and stale-result assertions remain enabled.

Native Linux full regression is required separately; its real servers do not fabricate this malformed-list workload. No production gate, account, submission, save, package, Release or merge change.

## Verification
Pending GitHub Actions on the checkpoint commit. Test details and final evidence belong in the Draft PR report.
