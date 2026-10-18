# Avoid redundant command-host DOM writes

Base PR #89, application commit `819a28d567d6285727496589fde512943cda17c1`.

The editor status plugin synchronizes the active Vim command host on each document or selection update. Previously it assigned every host's data-active attribute even when the owner had not changed. Only assign when the next value differs. Mode, cursor position, publishing and owner selection remain unchanged; no throttling, timers or caching were added.

## Acceptance
The existing input-cost keyboard fixtures observe actual data-active mutations after setup/warm-up. Stable-owner typing must make zero such writes and preserve host identity, source, recovery enqueues and the existing bounded App commits. EDITOR_INPUT_COST.json records counts alongside existing timings.
Actual Vim UI checks verify code → notes → code owner identity, visible command input ownership, and removal/fallback when active notes close.

## Limits
This removes one known redundant operation. It is NOT proof that reported typing lag is fixed, and no latency percentage or causality is claimed. Existing baseline showed parser-dominated work for pathological all-comment Java; this patch does not change parsing. Instrumented browser timing is development Chromium with mocked IPC, not native/paint/input-queue/LSP/disk measurement. Source and tests will be verified in GitHub Actions. No merge, package, release or snippet capability changes.
