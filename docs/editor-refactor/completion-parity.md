# Completion parity engineering report

> Historical design/implementation snapshot, not the current capability matrix.
> Current supported behavior and evidence boundaries: [Editing support](../EDITING_SUPPORT.md).


Date: 2026-10-14. Application baseline: 7df1072351de74c253d12e588959a16bed358b8d (PR19).
This is an implementation and acceptance plan, not a declaration of IDE parity.

## Fixed references and reuse boundary

- VS Code: e07973c315092f913d34fd450b7d19b1e46b1287.
- VS Code language client: [704f962ea4d956d0b5e42f1270b4b8b0353ae3f2](https://github.com/microsoft/vscode-languageserver-node/tree/704f962ea4d956d0b5e42f1270b4b8b0353ae3f2). Inspect client/src/common/completion.ts and protocolConverter.ts.
- Zed: [c403bc6af644cd0ab60c90045ac6dc3436218809](https://github.com/zed-industries/zed/tree/c403bc6af644cd0ab60c90045ac6dc3436218809). Inspect crates/project/src/lsp_command.rs, lsp_store.rs and crates/editor/src/completions.rs. Editor GPL-3.0 code is behavior reference only; no source copied.
- Lithe: [6210013d06e1410c7bcbb1949e1ff16ea8deae15](https://github.com/1lck/Lithe-IDEA/tree/6210013d06e1410c7bcbb1949e1ff16ea8deae15). Monaco/Swift APIs are not portable CodeMirror extensions.
- Pinned packaged Rust source: [Rust 1.99.0](https://github.com/rust-lang/rust/tree/1.99.0/src/tools/rust-analyzer). config.rs, lsp/capabilities.rs, ide-completion/src/lib.rs and handlers/request.rs explain the capability handshake.

No upstream code is transplanted in PR19. Mechanisms are independently implemented with CodeMirror 6 and the existing Rust bridge. Future direct reuse requires per-file license verification and retained notices.

## Cross-language acceptance matrix

Package versions are from crates/managed-env/packages.json at the application baseline. Research snapshots below are not automatically identical to packaged server source revisions.

| Language | Packaged server | Import mechanism to support | Required real native acceptance |
| --- | --- | --- | --- |
| Rust | rust-analyzer 1.99.0 | Initial primary edit plus resolved additionalTextEdits | Local/member/path, type and trait imports, alias, authored judge nodes; source and one-step undo |
| Python | Pyright 1.1.414 | Initial or lazy additional edits depending on capabilities | Attribute/keyword/TypedDict; module/from/alias import; docstring and future-import ordering |
| Go | gopls 0.23.0 | Initial additional edits; inspected server does not advertise resolve | Fields/methods, unimported package, single/grouped/aliased import, package-less judge source |
| Java | JDT LS 1.61.0 | Opaque proposal identity and lazy additional edits | Constructor/overload/generic, type outside implicit imports, static import, name conflict |
| C | clangd 23.1.0 | Initial edits, resolveProvider:false | Struct dot/arrow, functions/typedef/enum/macro, include path and required header |
| C++ | clangd 23.1.0 | Initial edits; separate compiler context from C | Namespace/template/constructor/overload, missing header, explicit includes and judge nodes |

Research source snapshots:
- [rust-analyzer dd5ed69d4b5b26fe7f91013b1d02608cd37ae199](https://github.com/rust-lang/rust-analyzer/blob/dd5ed69d4b5b26fe7f91013b1d02608cd37ae199/crates/rust-analyzer/src/handlers/request.rs)
- [Pyright d4b91d37b21ac7c79390a91586ac0fbfd12886d3](https://github.com/microsoft/pyright/blob/d4b91d37b21ac7c79390a91586ac0fbfd12886d3/packages/pyright-internal/src/languageService/completionProvider.ts)
- [gopls b8f586f8588e28f0c9fc12bcafd850db114ba049](https://github.com/golang/tools/blob/b8f586f8588e28f0c9fc12bcafd850db114ba049/gopls/internal/server/completion.go)
- [JDT LS b764b984fdf29703ada7a86f680b77787fa70b3b](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/b764b984fdf29703ada7a86f680b77787fa70b3b/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/CompletionResolveHandler.java)
- [clangd dacc1a59a767e8cc5b513c9c3a7d2327cde59f60](https://github.com/llvm/llvm-project/blob/dacc1a59a767e8cc5b513c9c3a7d2327cde59f60/clang-tools-extra/clangd/ClangdLSPServer.cpp)

## Common protocol contract and remaining gaps

1. Negotiate provider triggerCharacters and explicit/trigger/incomplete request contexts. Current punctuation handling is only dot/colon; provider-aware contexts remain open.
2. Preserve original item and opaque data in bounded backend storage. Display normalization must not alter the item sent back to resolve.
3. Normalize itemDefaults before conversion. Explicit item textEdit wins; default editRange uses textEditText or label, not insertText. Do not advertise itemDefaults support before this exists.
4. Implement InsertReplaceEdit policy, shared-start/containment and UTF-16 validation. Keep insertion and replacement intent distinct.
5. Resolve only when negotiated. PR19 enables Rust only. Python/Java need separate native qualification. Go/clangd must not be forced through unsupported resolve.
6. Freeze primary text, ranges, sorting/filtering unless a supported property was explicitly negotiated. Java lazy primary textEdit stays disabled.
7. Validate primary plus additional edits against the same document snapshot and apply as one undoable transaction. Overlap, invalid ranges, stale session/version, cursor movement, composition, blur and Escape must prevent delayed mutation.
8. Full snippets require a parser and bounded execution for tabstops, choices, mirrored placeholders, escaping, transforms, indentation and final selection. snippetSupport remains false. Do not advertise support based on a partial regex converter.
9. Completion commands need reviewed bounded semantics. Server-advertised commands are not blanket permission for arbitrary shell or Tauri actions.
10. Use bounded work and no per-keystroke React global update. Current resolve concurrency is four; acceptance-priority queuing is a remaining UX improvement.

## Virtual document correctness

Rust helper suffixes are not editable source. Python future statements/preludes, synthetic Go package declarations, Java implicit imports, and C/C++ headers/node definitions require language-aware mapping of additional edits. Reject unsupported mappings instead of clamping hidden positions to user line zero. Never copy generated helper code into saved/submitted solutions.

All adapters must test CRLF, Unicode/surrogate boundaries, mid-token edits, duplicate imports, existing aliases, document switches, server restart, delayed resolve, IME, destruction and single-step undo using actual packaged servers. Candidate visibility alone is not acceptance proof.

## PR19 evidence and honest limits

- 204edf5 and 39c4b57 native tests exposed primary-only HashMap insertion without its required import. Those failures remain recorded; no assertion was removed.
- Rust needs two capability aspects: additionalTextEdits allows auto-import candidates, while documentation is a recognized resolve field that enables the pinned server's resolveProvider flag. PR19 now implements actual lazy documentation and shares its resolve promise with acceptance.
- 7df1072 CI run [38553613840](https://github.com/jacek4yang/inkleet/actions/runs/38553613840) passed, including deferred acceptance and Escape cancellation coverage.
- Exact-head native run [38553603553](https://github.com/jacek4yang/inkleet/actions/runs/38553603553) is pending at this report revision. No successful native HashMap-import claim yet.
- Indentation guides use bounded visible-line CodeMirror decorations, subdued strokes and a stronger active indent. They are indentation guides, not semantic scope analysis.
- Windows/macOS/Android native GUI acceptance and long-duration performance qualification remain unverified.
- User's acfc10a Linux preview does not contain PR19. No main merge or formal Release.
