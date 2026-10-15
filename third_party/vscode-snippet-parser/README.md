# Bounded snippet grammar preparation

Reference: Microsoft VS Code commit c2c46e750ab7afe355bad8bea20a248520adfdb0, src/vs/editor/contrib/snippet/browser/snippetParser.ts. MIT license retained beside this file and in public/licenses/vscode-snippet-parser.txt.

Classification A: pure TypeScript scanner, grammar and canonical-default propagation reused. No Monaco component, Swift code or VS Code workbench dependency is imported. Lithe reference6210013d06e1410c7bcbb1949e1ff16ea8deae15 provides design guidance (classification B), not code in this checkpoint.

Local changes: request-owned allocation/copy/work/depth budgets; safe numeric identities; bounded iterative walking and parent repair; deep-cloned choice options; inert transform source/flags; evaluation methods refuse execution; strict diagnostics for malformed recognized constructs. Const enum and parameter properties are expressed as erasable TypeScript for the existing Node test runner. Local CharCode values remove the only upstream import.

src/snippet-prepare.ts exports plain UTF16 text/ranges/parents/choices/navigation and explicit pending transform descriptors. It resolves only supplied own-property variable context. Unknown transformed variables are explicitly unsupported pending a validated resolution contract. Rendered output and field/group counts have separate bounds. Transform-bearing preparation is NOT insertion-ready. No production completion capability is enabled by this stage.

Tests are newly authored compatibility/safety cases informed by upstream behavior, not copied upstream test files. They cover forward/backward defaults, nested clones, sparse/final stops, Unicode, escapes, choice ownership, variables, inert flags, malformed syntax, resource exhaustion and representative call forms. Representative forms are synthetic grammar fixtures, not captured live-server acceptance.

Follow-up gates: worker execution/timeout/output validation; CM-native session and nested mirrors; atomic imports/undo; keyboard/Vim/IME ownership; actual server and native packaged worker tests. snippetSupport and gopls usePlaceholders remain false until those gates pass.
