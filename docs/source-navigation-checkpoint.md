# Read-only source navigation checkpoint

## Scope

Keep Tauri 2, React, CodeMirror 6 and Rust. Extend the existing bounded standard-library reader with recursive definitions, per-view history and keyboard navigation. No Monaco or Swift code is copied.

## Implemented mechanisms

- The backend pins immutable LF-normalized source snapshots to the originating LSP session. A separate cancellable request lane uses the library URI rather than the solution URI.
- A source definition validates the solution version, source handle, UTF-16 position and current session before publishing a result. A retired source handle can be reacquired once, only if the full text is unchanged.
- File access retains the existing approved workspace/toolchain roots and 2 MiB limit. The live primary solution is never reopened from its stale scaffold on disk.
- JDT class-file URIs retain their exact query and skip file-document lifecycle notifications. They must have been returned by the language server.
- File didOpen/didClose admission and registry ownership remain consistent when the bounded transport queue refuses work. Failed closes preserve ownership; failed opens do not publish phantom handles.
- Backend cache: 32 records / 16 MiB, request-pinned entries cannot be evicted, at most two concurrent source reads. Frontend history: 64 visits / 16 MiB of retained UTF-16 text, with shared snapshots.
- One source EditorView remains mounted. Trusted navigation replaces its immutable state. All document-changing dispatch batches are rejected, including filter:false.
- F12, Ctrl/Meta-click and Vim gd share definition handling. Alt-Left/Right and Vim Ctrl-O/I restore full selections and both scroll axes. Source search and folding remain native CodeMirror extensions.
- The primary solution may appear as a readonly history visit so Back/Forward remains continuous. The explicit Return to code action focuses the original editable view without replacing its text or undo stack.
- The compact header uses original SVG icons, a readable wrapping path, source/declaration badge and navigation controls. No explanatory paragraph occupies the code area.

## Reference and licensing

The CodeMirror keymap implementation was consulted to distinguish keymap ordering from DOM handler precedence. The high-priority readonly Vim history handler is independently implemented. Earlier PR78/80 record the pinned VS Code and Zed references for popover/reader design. This checkpoint does not directly transplant code or assets from those projects.

## Reproducible acceptance

1. Open a problem with a connected managed language server. Put the caret on a standard-library symbol and press F12.
2. In the source reader, place the caret on another library type/function and press F12 or Vim gd. Ctrl/Meta-click the symbol as a separate check.
3. Traverse at least three visits, including two locations in one file. Use Back/Forward and verify exact selection direction and horizontal/vertical scroll restoration.
4. Start another definition request, then go Back or close the reader before it resolves. The late result must not replace or reopen the reader.
5. With Vim enabled, use Ctrl-O/I for history. Test search, visual/insert-mode Escape, and normal-mode Escape separately.
6. Try typing, deleting, pasting, Vim dd and an API transaction with filter:false. Neither library text nor the original solution may change.
7. Return to the editable code and check existing undo/save behavior.
8. Repeat after language/session replacement and with a disconnected server. Failures must leave the current source intact.

## Qualification

This is a Draft PR, not a release or completed cross-platform acceptance. CI run identities, failures, artifact hashes and inspected screenshots are recorded in the PR conversation. Browser fixtures do not establish real language-server or native WebView support. Added native cases target Python SupportsIndex, JDT ArrayList → AbstractList, Go Builder → utf8.AppendRune and Rust Vec → Global, with real keyboard input and scroll-history assertions. Their completion must be reported individually. Additional C/C++ candidates use the actual installed headers observed in native screenshots: vector.h line 98 allocator_traits, and generic-glibc/stdio.h line 364 fprintf's FILE parameter. Expected targets are allocator_traits.h and FILE.h, respectively; these remain unqualified until the native assertions pass.
