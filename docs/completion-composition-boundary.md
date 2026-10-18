# Cancel completion predating composition

## Confirmed lifecycle gap
Baseline application PR #90: `c828ec76f0fa516384faf40c63c5ee50119514ba`.
Test-only baseline `e2f680499e75d76ba87ab1139e760b61c98c9d0d`, run 39097843418.
In one task, explicit completion followed by a synthetic compositionstart before source IPC left a pending query. That old intention subsequently issued an IPC, wrote completion status and displayed a popup. Escape control, setup and fresh recovery checks passed. Four compositionstart-only assertions failed.

## Mechanism
Move existing compositionstart invalidation from a handler to a CodeMirror DOM event observer and synchronously close completion. Keep generation invalidation and application-owned transport cancellation alongside closeCompletion: the latter retires pending library state, but alone is not equivalent to canceling already-issued application requests. Do not preventDefault or stop propagation; native composition bookkeeping still runs. Existing snippet discard remains unchanged.

## Acceptance and limits
Retain the same baseline assertions: no old-intent query/status/popup, source/selection/focus unchanged, and fresh completion after compositionend succeeds. Keep existing issued-request late reply and snippet lifecycle tests.
This is a synthetic lifecycle regression, not real Chinese IME qualification or proof about every Enter/Tab/native composition interaction. New input during composition and rapid end/start admission are separate concerns; this fix targets only intent predating compositionstart. No claim that all IME behavior is complete. No new timers, retries, dependencies or copied code. No package, merge, release or snippet gate changes.
Source-fix CI is pending.
