# InkLeet development status

Updated: 2026-10-20 UTC. Goal: a reliable everyday practice IDE, not package delivery alone.

## Development and public release are separate
- One integration branch: `build/preview-installers`, [Draft PR #94](https://github.com/jacek4yang/inkleet/pull/94).
- [v0.1.0](https://github.com/jacek4yang/inkleet/releases/tag/v0.1.0) is the published first preview, source `6b5bca312a4307bd69e4b00a8e950658e5868674`.
- Current development metadata is **0.1.1**, an unpublished test build. No new Release/tag or main merge is implied.
- Historical 93 PRs are closed as superseded; their branches and evidence remain.

## New development changes
- Completion browser regression synchronizes with CodeMirror's initial interaction guard and checks code/cursor/focus retention.
- Judgement acknowledgement is duplicate-guarded and scoped to its login generation; late replies cannot replace a newer login's result.
- Repeated explicit notes saves retain the last requested snapshot, maintain original file identity and CAS order, and do not save subsequent unrequested edits. Failure blocks queued writes without automatic retry.
- Pending settings writes/editor reloads retain their modal owner; closing actions cannot discard that owner before completion. Independent operations release independent tokens.
- Multi-parameter input editing retains literal drafts and focus separately from serialized input. Structured fields must each be one JSON value before run/debug; explicit raw mode supports multiple calls. Metadata refresh invalidates old field structure without rewriting input.

## Verification
These source changes are not all automatically qualified merely because they are listed here. Use exact-commit Actions results and artifacts linked in PR #94.
- Prior post-release checkpoint `303380ea85d235603b1d516db6627a9051110398`: frontend, all platform build/inspection jobs and complete configured Native Linux suite passed. Native evidence: 63 PASS records; public CN NOT RUN.
- Notes-save checkpoint `9ca7c132466b5389b0f55d23498e70f3fbaeb2fe`: full frontend browser regression passed. Other gates must be checked on their actual run.
- The newer settings/input/0.1.1 changes require fresh exact-source frontend, native and package verification. Do not reuse older installer success as new delivery.

## Remaining acceptance gaps
- Real-account login, full catalogue workflow, online Run/Submit and real native IME are not fully accepted.
- Windows/macOS interactive install, upgrade, uninstall and GUI behavior need separate acceptance. Same application identity does not prove upgrade compatibility.
- Ventura and long-session performance remain unqualified.
- Windows/macOS packages remain unsigned; macOS is unnotarized. Never disable OS security protections.
- Linux packages target Ubuntu 24.04 / Mint 22-style dependencies, not every distribution.
- Managed language tools are not a security sandbox; execute only trusted code.
- Android, macOS ARM and full design-class/special-interface support are not claimed.

[User manual](docs/USER_MANUAL.md) · [First-preview limitations](docs/releases/v0.1.0.md) · [Integration audit](docs/INTEGRATION.md)
