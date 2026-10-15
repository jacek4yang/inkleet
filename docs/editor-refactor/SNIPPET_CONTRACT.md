# LSP snippet implementation contract (research, not shipped)

## Fixed inputs

- InkLeet dependency snapshot: aa021a717d08e2437f2e9b7997a2cf91510c5a0f.
- Lithe-IDEA: 6210013d06e1410c7bcbb1949e1ff16ea8deae15, windows/tauri/src/features/editor/engines/monaco/lsp-completion.ts. Classification B: preserve the separation of display text, insertion text, ranges, imports and snippet metadata; do not copy Monaco APIs.
- VS Code parser candidate: c2c46e750ab7afe355bad8bea20a248520adfdb0, src/vs/editor/contrib/snippet/browser/snippetParser.ts. Classification A candidate: pure TypeScript AST/parser, one CharCode import. MIT copyright/license and upstream test provenance must accompany any actual vendoring. No parser code has been copied in this research checkpoint.
- Monaco/Swift editor/session machinery remains classification C, outside the preserved Tauri2/React/CM6/Rust architecture.

## Exact dependency evidence

GitHub inspection run38738023259, artifact11973663967:
- Installed @codemirror/autocomplete6.20.3 and @codemirror/state6.7.6 from existing npm ci lockfile.
- ZIP SHA256:13d5e65a3bea0db48732ffeec0559b57e6e22a565cfe5c054ee2b3f39dd34de6.
- SOURCE_COMMIT and all eight source/types/package/license file hashes verified against IDENTITY.json.
- Inspection did not execute local package code or launch an application.

The installed autocomplete version DOES put ${0} last. Earlier findings from a different public GitHub mirror version must not be applied to this artifact. The installed parser still lacks faithful bare$n, inherited defaults, nested/multiline fields, choices, variables/transforms and persistent mirrors after narrowing selections. Native public declarations do not expose activating arbitrary pre-parsed field ranges. State transaction merging maps selection/effects across original-coordinate specifications.

## Chosen direction

Use a bounded TextMate AST parser and a CM-native session extension built from public StateField/StateEffect/Decoration/transaction APIs. Keep language-service request ownership and apply guards. Do not forward raw LSP strings into the flatter CM template parser or claim that a Monaco snippet flag is an implementation.

A parsing worker alone is not sufficient. The session must implement ordered navigation/final stop, linked fields, parent-child invalidation, choices, variable semantics and transforms. Keep snippetSupport:false until the implemented and tested contract justifies enabling it. No empty command/settings control is added by this research.

## Candidate hardening requirements

Suggested limits require representative language-server calibration:
- source64KiB, source and expanded depth64;
-8192 allocated nodes,512 occurrences,128 distinct field groups,128 choice options;
-64KiB final text,1MiB cumulative string/copy work;
- explicit scanner/parse/backtrack operation budget;
- transforms:4KiB pattern,64 transforms, bounded input/matches/output.

Use a per-request budget throughout parsing/cloning. A post-parse walk cannot stop exponential expansion in parseFragment/fillInIncompletePlaceholder. Charge speculative/discarded nodes, Text construction/merges, clone expansion, replacement copies/reparenting, variable replacement and serialization before work. Use bounded iterative traversal rather than repeated shift/unshift or one offset walk per field.

Review and document these upstream details when vendoring:
- Choice.clone reuses original option Text objects; deep-clone them.
- Transform.clone retains only i/g flags; preserve full inert source/flags descriptors.
- Some clones bypass appendChild; derive exported parent relations via traversal.
- Forgiving parse success can leave malformed syntax as literal text; strict LSP acceptance needs explicit parse diagnostics.
- Variable.resolve may execute a transform. Never invoke it on the UI thread.

Parsing and regex evaluation belong in a worker with a main-thread deadline/termination, bounded active work, canceled obsolete jobs, no unbounded retry, and output checks before joining/postMessage. A timer inside the worker cannot interrupt synchronous regex backtracking. Regex execution must also budget replacement output and match count.

## Application data boundary

Export validated plain data rather than a mutable vendor AST:
- rendered text;
- occurrences/group IDs, UTF16 ranges, parent occurrence IDs, choices, readonly transform targets;
- ascending positive navigation groups and final group last;
- inert transform descriptors and variable-resolution diagnostics;
- parser identity and budget outcome.

Resolve variables only from explicit captured editor/document context. Distinguish known value (including empty), known unavailable, and unknown name. Do not read clipboard, environment secrets, files or network merely because a snippet asks for a variable.

Preserve document/session/version/selection/focus/IME/apply-generation guards across worker and completionItem/resolve waits. Validate complete main and additional edits before one apply transaction. Imports are literal, never snippets. Preserve the existing valid replacement0..5 plus boundary insertion0..0 test; reject true interior overlaps and duplicate zero-width insertions. Keep one undo for initial insertion plus imports.

## Acceptance gates

- Bare/braced/reordered/sparse fields, mirrors, final stop, omitted final stop.
- Defaults, escaping, nested fields and parent overwrite, choices, unknown/unavailable variables.
- Transforms, complete flags, choice clone isolation, huge IDs, cycles, deep/exponential expansion, allocation/operation limits.
- Worker startup failure, timeout/cancellation, ignored late reply, no leaked worker/listener/timer.
- Real keyboard Tab/Shift-Tab/Escape, completion popup interaction, Vim normal/insert, composition.
- Additional edits before/after insertion map fields and decorations; atomic undo/redo and stale resolve rejection.
- Six-language representative server fixtures; exact pinned dependency contracts.
- Native Linux and other platforms recorded independently; browser success is not native acceptance.

This document records a researched implementation boundary. It does not claim that snippet support, runtime workers or the above acceptance suite are implemented.
