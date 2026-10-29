# Editing support and qualification

Updated 2026-10-29 for the next release candidate. This is a capability boundary,
not a claim of editing parity with Zed or another mature IDE.

## Completion profile

| Language | Linux x86_64 parameter snippets | Windows x64 / macOS Intel parameter snippets | Lazy completion resolve | Import boundary |
|---|---|---|---|---|
| Rust | Enabled | Not enabled | Enabled when rust-analyzer advertises it | Exact owned source only; real HashMap import probe |
| Go | Enabled | Not enabled | Not forced: pinned gopls does not advertise resolve | Initial server edits; real fmt.Println import probe, including virtual package mapping |
| C / C++ | Enabled | Not enabled | Not enabled | Existing explicit/compiler header context; missing-header autoimport is not claimed |
| Java | Enabled | Not enabled | Not enabled | Local method parameter snippets qualified; lazy primary edits and imports remain unqualified |
| Python | Not enabled | Not enabled | Enabled when Pyright advertises it | Real PurePath lazy import; narrowly validated mapping described below |

Basic member completion, hover, signatures and source navigation remain available
for all six languages through their installed servers. The table is about advanced
completion, not whether a language has any completion.

Linux C/C++/Java snippets are promoted from the actual native experiment validated
on main `fbacb204` ([Native Linux run 40685304234](https://github.com/jacek4yang/inkleet/actions/runs/40685304234)).
The fixture checks actual pinned-server format-2 payloads, virtual source ranges,
worker application, exact selected arguments, Tab/Shift-Tab, final caret and
single-step undo/redo. Validation features now control evidence tracing only;
they do not enable a capability missing from the same platform's release build.
The final candidate must still pass its own native and release-package gates.
Default-feature unit tests establish the same capability flag in the release
build. Installed/tar smoke checks launch/storage separately; they do not
independently repeat the managed-tool snippet GUI suite.

### Python autoimport safety

Pyright may place a lazy import at virtual line zero, before InkLeet's implicit
public imports. Such an edit is **not generally clamped** to user line zero.
Only an exact zero-width insertion containing simple `import` / `from … import`
statements is relocated. The authored module must begin unambiguously with a
class, function or simple assignment. Leading comments, shebang, coding comments
and blank lines are preserved. Module docstrings, future imports, decorators,
unknown preambles, helper replacements and unknown edit forms are refused rather
than guessed. Missing resolved import edits also refuse the entire completion.
A supported symbol plus its import is one undo transaction.

## Preview-first code actions

`Ctrl+.` (`Cmd+.` on macOS), or **代码操作** in the command palette, requests the
selected range's quick fixes/refactorings from the current server. Selecting an
operation resolves it if required, shows all changed text and requires **应用**.
The actual private rust-analyzer **Extract into variable** operation is covered by
the real protocol probe; Linux native selection/preview/apply/undo/redo is a final
candidate gate. Other providers may expose safe actions through the same protocol,
but equivalent per-language GUI coverage is not claimed.

- Only server-issued tokens for the exact active session/document version work.
- Edits are confined to the authored source, bounded, Unicode-valid and nonoverlapping.
- Commands, file create/delete/rename, other files, helper code and unreviewed change
  annotations are refused. No workspace command is executed and no file is saved.
- Every proposal is previewed without ellipsis. Oversized previews are refused,
  not truncated. Apply is one undo transaction.
- Source/selection changes, switching/destroying the editor, Escape and composition
  invalidate pending UI intent. A dirty parameter-snippet session must be settled
  before requesting an operation.

## What the tests actually establish

- `cargo test --locked --manifest-path crates/managed-env/Cargo.toml --example editing_lsp_probe`
  runs the application's edit/cache/mapping guards without needing Tauri libraries.
- `cargo run --locked --manifest-path crates/managed-env/Cargo.toml --example editing_lsp_probe`
  launches the pinned, application-owned Rust/Go/Python tools using production
  launch configuration and normalizers. Linux local evidence is recorded in
  [the focused report](evidence/editing-lsp-linux-2026-10-29.json).
- [Real editing language services](../.github/workflows/editing-lsp.yml) runs the
  same probe on Linux x64, Windows x64 and macOS Intel, records exact source SHA,
  and is required on final main before publishing. A protocol pass is **not** a GUI pass.
- `tests/code-actions-ui.mjs` exercises real CodeMirror with **mocked IPC**: full
  preview, apply/undo/redo, cancel/back, invalid ranges, empty results, delayed
  list/resolve cancellation and synthetic composition. It is not real IME evidence.
- Native Linux tests use actual private rust-analyzer and Pyright, OS keyboard and
  pointer events. The input observation records trusted `beforeinput` to next-frame
  scheduling while real Rust LSP is active, plus exact typed source. It does not
  measure physical input-to-photon latency or compare against Zed.

Composition now postpones document synchronization/diagnostic painting until the
committed document is available. Real OS IME sessions across Linux/macOS/Windows,
Windows/macOS interactive install/upgrade, and long-session performance remain
separate unqualified acceptance items. Browser fixtures and protocol probes do not
turn these into PASS.
