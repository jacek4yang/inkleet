# Native wait budgets and transport evidence

## Why
Prior native GUI suites reached their functional assertions, but read-only WebKit transport resets were recorded without attempt durations or outcomes. The old polling loop checked its default 25-second deadline only before calling a predicate and could accept a late truthy result; individual urllib calls used 90 seconds. No historical deadline overrun or app-lag cause has been established.

## Change
An import-safe standard-library helper owns nested wait deadlines, checks before and after predicate/truth conversion, rejects late success, and clips polling sleep/read retry delay/request timeout to remaining budget. WaitTimeout propagates instead of being swallowed by an outer poll; ordinary predicate and truth-conversion exceptions retain polling semantics. Budgets must be finite and positive. Context is restored on every exit.

Transport retry remains at most one extra attempt for RemoteDisconnected on the existing GET/element-lookup allowlist. It does not add retries for actions, clicks, typing, execute/sync, session creation or DELETE. Existing higher-level fixture/UI-close recovery and mutating predicates remain unchanged and are separate review items; this is not a claim that every legacy action is single-shot.

Structured native-timing.jsonl records safe route templates, a maximum six-frame source-line phase chain, wait/command IDs, clipped timeouts, durations, error class and explicit retry outcome. It contains no new selectors, element/session IDs, payloads, source text or response bodies. Its 8 MiB cap emits an explicit truncation marker. A logging failure disables the sink without replacing command results/errors or introducing replay.

## Acceptance
25 deterministic fake-clock tests cover late/truthy results, truth-conversion exceptions, invalid budgets, unchanged budgets through failures, nested ownership/restoration, request/retry budgets, one read-only retry, no mutation retries, error propagation, safe route labels, logging failures and capped output. They run in GitHub Actions PR CI and Native Linux; no application/driver/network is started by these unit tests.
The complete existing native suite and all 123 assertion-containing source lines are retained. Native input behavior and functional call-site body remain unchanged.

## Interpretation
driver_attempt measures client-observed WebDriver round trip and decoding; driver_end includes retry delay/instrumentation. wait_end measures test observation/predicate time, not keyboard-to-paint or isolated app processing. A recovered read means a decoded error-free response returned before budget, not that its UI predicate became true.

urllib timeout cannot forcibly interrupt every arbitrary predicate, subprocess or trickling response. Late returns are rejected, not promised impossible. Global explicit sleeps are not monkeypatched. Outside a wait, the original 90-second request timeout remains.
Native remains debug Linux/Xvfb/WebKitGTK with compositing disabled; live CN and other platforms are not qualified. No product code, main merge, package, release or production snippet gates changed. CI execution pending at commit creation.
