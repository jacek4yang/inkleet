# InkLeet development status

Updated: 2026-10-26 UTC. Goal: a reliable everyday practice IDE, not package delivery alone.

## Development and public release are separate
- Protected `main` baseline is `ac7bd446` after PR #97. [PR #94](https://github.com/jacek4yang/inkleet/pull/94) is merged history, not the current review entry.
- [PR #97](https://github.com/jacek4yang/inkleet/pull/97), head `b272df54`, merged on 2026-10-26 after its required checks passed.
- [v0.1.0](https://github.com/jacek4yang/inkleet/releases/tag/v0.1.0) is the published first preview, source `6b5bca312a4307bd69e4b00a8e950658e5868674`.
- Current development metadata is **0.1.1**, an unpublished test build. No new Release/tag or main merge is implied.
- Historical 93 PRs are closed as superseded; their branches and evidence remain.

## Current PR #97 test checkpoint
- CI, configured Native Linux checks and three-platform packaging passed for the candidate at `b272df54`.
- [Packaging run 40017518859](https://github.com/jacek4yang/inkleet/actions/runs/40017518859) built synthetic merge commit `d99b3965`, not the PR head or protected main itself. Windows/macOS passed in the first attempt; Linux passed in attempt 2.
- [Linux x86_64 test package](https://github.com/jacek4yang/inkleet/actions/runs/40017518859/artifacts/12622051138).
- [Windows x64 test packages](https://github.com/jacek4yang/inkleet/actions/runs/40017518859/artifacts/12529054271).
- [macOS Intel test package](https://github.com/jacek4yang/inkleet/actions/runs/40017518859/artifacts/12529896743).
- These are unpublished 0.1.1 test artifacts. Passing automation does not establish Windows/macOS interactive GUI acceptance, real-account online judgement, or release approval.
- The reading-layout and compiler-diagnostics changes in this branch are based on merged PR #97. Their browser and native acceptance remain pending; they are not included in the test artifacts linked above.

## Earlier integrated changes
- Completion browser regression synchronizes with CodeMirror's initial interaction guard and checks code/cursor/focus retention.
- Judgement acknowledgement is duplicate-guarded and scoped to its login generation; late replies cannot replace a newer login's result.
- Repeated explicit notes saves retain the last requested snapshot, maintain original file identity and CAS order, and do not save subsequent unrequested edits. Failure blocks queued writes without automatic retry.
- Pending settings writes/editor reloads retain their modal owner; closing actions cannot discard that owner before completion. Independent operations release independent tokens.
- Multi-parameter input editing retains literal drafts and focus separately from serialized input. Structured fields must each be one JSON value before run/debug; explicit raw mode supports multiple calls. Metadata refresh invalidates old field structure without rewriting input.

- CRLF/lone-CR editor snapshots are normalized while raw on-disk conflict baselines remain intact.
- Stale references and initial definition results no longer reclaim unrelated focus; owned target-picker and recursive-reader navigation remain functional.

## Historical verified delivery checkpoint
Application source: `8cb5c18d642e085de02e3c755c88ca5f2e708f0e`. Later workflow/documentation commits do not imply a new application build.
- [CI](https://github.com/jacek4yang/inkleet/actions/runs/39544655171) and [frontend + three-platform packaging](https://github.com/jacek4yang/inkleet/actions/runs/39544650848) passed on this exact source.
- [Frontend evidence](https://github.com/jacek4yang/inkleet/actions/runs/39544650848/artifacts/12321740248) was downloaded and source/hash checked. The 22 new initial-definition focus cases passed, including delayed replies/source loads, Notes/settings focus, Escape, caret movement, blur/refocus, synthetic composition, newer-request isolation, target-picker handoff and Ctrl-click. These use mocked LSP IPC, not real IME acceptance.
- [Full configured Native Linux](https://github.com/jacek4yang/inkleet/actions/runs/39544133055) passed on `4fa569f4854ee9cdb14dc2bd9f784654eacbca70`: 63 PASS files ending RESULT.txt and public CN NOT RUN. Application code is identical to 8cb5c18; the latter changes only the browser test and packaging trigger. The source difference is intentional and not an exact-commit claim.
- First 4fa frontend runs failed because the new test expected one Escape to close a reader with a selected target. Corrected assertions require first Escape to collapse selection, then second Escape to close; no focus-safety assertion was removed.

### Historical test packages
All four package files and their archive/source metadata were downloaded and hash-verified:
- [Windows x64 setup EXE and MSI](https://github.com/jacek4yang/inkleet/actions/runs/39544650848/artifacts/12321038359).
- [macOS Intel x86_64 DMG](https://github.com/jacek4yang/inkleet/actions/runs/39544650848/artifacts/12321297894).
- [Linux x86_64 tar.gz](https://github.com/jacek4yang/inkleet/actions/runs/39544650848/artifacts/12320893350).
These are 0.1.1 development artifacts, not a new public Release. Build/architecture/package checks do not establish Windows/macOS GUI or upgrade acceptance.

### Historical real public-site acceptance
[Installed-client run](https://github.com/jacek4yang/inkleet/actions/runs/39579570256) reused the delivered Linux tar unchanged, with no application rebuild or managed-toolchain reinstall. Application commit is 8cb5c18; harness commit is `ad38c98e1dda62513856688aabf86a633d7b9493`.
- PASS: real CN sidebar, public search, question and official Rust template loading, source save, normalized question-link opening, duplicate draft preservation, and offline restart/link/cache recovery.
- The native process completed successfully. Sidebar evidence and local/live result records were separately required; UNVERIFIED is not accepted as PASS.
- Anonymous official login UI: UNVERIFIED (automation WaitTimeout). A screenshot visibly contains login controls, but the automated check did not complete.
- Authenticated login, personalized catalogue status, online Run and Submit: NOT RUN.
- [Downloaded evidence](https://github.com/jacek4yang/inkleet/actions/runs/39579570256/artifacts/12336092461), SHA-256 `76333106335d965bd8ebfa94c5975c67a4c49f397ed8512e72882f6187f9d8cb`, records application and harness identity separately.

## Login and debugger source changes awaiting acceptance
- Native QR login, optional OS credential-store restoration, transaction-aware cancellation and explicit sign-out are implemented in this branch. This does not establish successful authentication on a real account. See [native login](docs/NATIVE_LOGIN.md).
- Variable paging and conservative Rust inspection are implemented, with raw fallback for unsupported shapes. This does not establish full Rust-type or real-debugger acceptance. See [debugger visualization](docs/RUST_VARIABLE_VISUALIZATION.md).
- Combined local frontend checks: typecheck, 316 domain tests, build and JavaScript syntax passed. Browser and full native acceptance for this batch remain pending; isolated authentication tests are not full application validation.

## Remaining acceptance gaps
- Real-account login, personalized catalogue/pagination, online Run/Submit and real native IME are not fully accepted. Public CN success above is not account acceptance.
- This development branch adds native QR login and opt-in OS credential-store persistence. Real-account completion, restart restoration and platform store behavior remain NOT RUN; unavailable or uncertain storage fails closed without plaintext fallback. Existing test packages do not contain this new batch. Never retry an uncertain submission automatically.
- Windows/macOS interactive install, upgrade, uninstall and GUI behavior need separate acceptance. Same application identity does not prove upgrade compatibility.
- Ventura and long-session performance remain unqualified.
- Windows/macOS packages remain unsigned; macOS is unnotarized. Never disable OS security protections.
- Linux packages target Ubuntu 24.04 / Mint 22-style dependencies, not every distribution.
- Managed language tools are not a security sandbox; execute only trusted code.
- Android, macOS ARM and full design-class/special-interface support are not claimed.

[User manual](docs/USER_MANUAL.md) · [First-preview limitations](docs/releases/v0.1.0.md) · [Integration audit](docs/INTEGRATION.md)
