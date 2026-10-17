# Input cost attribution

The existing beforeinput-to-next-rAF baseline cannot distinguish synchronous input processing from frame scheduling. This test-only checkpoint measures actual EditorView.update wall time for document-changing transactions and nested snapshot cache-miss flattening / onChange callback time, while retaining rAF as a separate metric.

Uses actual App/CodeEditor and keyboard input on 50, 1,000 and 10,000-line authored comment documents. Source setup uses the existing paste pipeline. Every edited character must preserve its recovery enqueue, complete final source and bounded App commits. No production instrumentation, dependency or behavior change. The measured edits are already dirty; this does not benchmark clean-to-dirty transitions.

Phases overlap: snapshot/onChange durations are included in updateMs. Do not add them together. Times are wall-clock and subject to measurement overhead/scheduler noise. IPC is mocked and the language service is absent, so no native serialization, disk contention, LSP cost, input queueing or completed-paint claim is supported. No arbitrary new timing threshold is used. Existing functional/performance assertions are retained.

Run npm run test:ui through the existing frontend CI; evidence/EDITOR_INPUT_COST.json includes all raw samples, P50/P95/max, document sizes and CPU/environment. Compare evidence before selecting a production optimization. This is not native acceptance or a claim that typing lag is fixed.
