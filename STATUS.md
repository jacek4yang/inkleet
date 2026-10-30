# InkLeet source and release status

Updated: 2026-10-30 UTC. Source version: **0.1.2**. Goal: a reliable everyday practice IDE; no Zed-equivalence claim.

## Source, evidence and public packages are different

- [Releases](https://github.com/jacek4yang/inkleet/releases) is authoritative for public availability. A repository version or green PR is not a public release.
- The published v0.1.1 baseline is `fbacb2041b83232a30a791965c58d93a7556a4ff`. Its [frozen notes](releases/v0.1.1.md) and [historical manifest](releases/v0.1.1.json) preserve exact source, gates and installer hashes. Its tag/assets are immutable.
- A new release is published only from the exact final current `main` after all six source gates pass. The release's `RELEASE_MANIFEST.json` records the final source/tree, run attempts, artifact hashes and publisher identity; `SHA256SUMS` covers all four installers.
- For new versions, the corresponding `release/v<version>` branch adds only frozen manifest/notes; the v0.1.1 transport-recovery exception remains historical only. The maintained publisher verifies every uploaded byte before publication and downloads it again afterward. It never overwrites an existing tag/release or blindly retries an uncertain mutation.

## Changes in the 0.1.2 source line

### Editing
- Preview-first code actions are owned by language-service session, source version and request token. Only bounded edits to the current authored document are accepted; commands, resources, other files, helper regions and stale responses are rejected. Applying is one undoable transaction and does not save.
- Rust remains the primary real-adapter editing target. Actual production-launch probes cover lazy HashMap imports and an extract-variable action. Python import edits are limited to currently referenced modules: settled augmentation of an existing authored import is the native target, not a durable cache after removing imports or native qualification of helper-line-zero relocation. Cold/global library discovery is not claimed; gopls direct import edits are tested without inventing resolve support.
- Official parameter-snippet support is language/platform gated. Linux x86_64 C/C++/Java rollout uses prior real native snippet evidence and is requalified with the final source; Windows/macOS flags are not enabled just because protocol or package checks pass.
- Browser composition/cancellation tests are synthetic lifecycle tests. Native trusted-input timing while an actual language server runs is an observation, not physical input latency, a real IME test, or long-session/Zed parity.
- Current capability and evidence matrix: [Editing support](docs/EDITING_SUPPORT.md). Old editor-refactor reports are historical snapshots.

### Local tests and solutions
- Explicit exact JSON, decimal absolute/relative tolerance, and outer-array multiset comparisons. Duplicates and nested array order are retained; unknown judge policies are never inferred. Incomplete/error/truncated outputs cannot pass.
- Rust/Python support a bounded metadata-described design-class sequence and NestedInteger subset; zero-argument calls use an explicit input convention. Actual generated drivers are exercised rather than accepting generated-source string checks alone. Unsupported interfaces/languages fail clearly.
- Confirmed solution archive/restore keeps immutable IDs, source, recovery drafts and conflict copies; shared notes are unchanged. The default solution remains active. Save/checkpoint ordering, changed disk/drafts, delayed replies and refresh/restore ownership are guarded. No permanent delete is exposed.
- See [Local testing contracts](docs/LOCAL_TEST_POLICIES.md) and [User manual](docs/USER_MANUAL.md).

### Windows installer-only acceptance; GUI/runtime deferred
- The mandatory Windows packaging check exercises unattended MSI fresh install/uninstall, hash-verified public v0.1.1 installation, in-place major upgrade and final uninstall. It requires exact product registration transitions, whole-byte installed executable comparison and complete test-seeded notebook/data preservation at every boundary. It never launches InkLeet.
- `MSI_LIFECYCLE_RESULT.json` and matching `msi_lifecycle_acceptance` metadata must establish PASS for the exact source; source code or mocked control-flow tests are not installation evidence. Pre-existing app data/products are refused; uncertain MSI outcomes stop further actions without replay. No security settings, accounts or ACLs are changed.
- **Windows real GUI and post-upgrade application runtime/migration acceptance remain unverified and are explicitly deferred for this release.** Seeded files are not old-app-authored storage or proof that the new app can load them. The former GUI harness failed before its JavaScript/MSI phase; it is not run by the release packaging gate. All other required tests and exact-main provenance remain mandatory. See [Windows acceptance](docs/WINDOWS_ACCEPTANCE.md).

### Login and debugging
- Native QR and optional secure storage are retained. FAILED is not silently reinterpreted as QR expiry; account/site/session generations guard restored results and cancellation. Pending/failed credential deletion stays latched until confirmed cleanup.
- Synthetic credential-store tests use a separate test service and unique slots, checking separate-process persistence/replacement/deletion on available CI operating systems. They are not real-account acceptance. No plaintext fallback is added.
- Actual Rust Map pairing, nested Linux Map visibility, inline raw-action pointer targets and clipping checks are preserved. New Some/None/nested Option fixtures capture bounded actual adapter trees before any new classifier is qualified. Unknown shapes retain raw/generic access; pretty display never invokes debuggee functions.
- See [Native login](docs/NATIVE_LOGIN.md) and [Rust variable inspection](docs/RUST_VARIABLE_VISUALIZATION.md).

## Required final-source qualification

| Gate | Required evidence | What it does not prove |
| --- | --- | --- |
| CI Frontend Regression | Typecheck, domain/Python tests, build, full Chromium regression | Native IPC or physical IME |
| Editing LSP ×3 | Actual pinned servers and production launch/mapping/edit guards on Linux/Windows/macOS Intel | Native WebView interaction or editor latency |
| Local harness ×3 | Actual generated Rust/Python program execution and contract tests | All design classes, languages or official judge policies |
| Native Linux Full Validation | Actual Linux WebView, owned tools, filesystem/restart, snippet/actions, credential probe | Windows/macOS GUI, physical IME or every Linux distro |
| Rust collection DAP ×3 | Actual pinned debugger data, production-component replay, pointer/bounds checks | Native Windows/macOS WebView or every Rust type |
| Packaging Required | Windows x64 EXE+MSI, macOS Intel DMG, Linux x64 tar; version/architecture/hash checks and configured installer tests | Signing, reputation, physical-device/interactive installer acceptance |

These are requirements, not a blanket PASS declaration. Use the exact release manifest's run IDs and test artifacts to distinguish passed, failed and never-run stages. PR synthetic merge commits are not accepted as final-main package provenance.

## Remaining boundaries

- Windows/macOS physical desktop workflows, interactive install/upgrade/uninstall, native IME, Ventura compatibility and long-session performance are not fully qualified. CI acceptance is limited to its explicit OS, test data and assertions.
- Windows/macOS binaries are unsigned; macOS is unnotarized. Do not disable OS security protections. No signing credentials are assumed.
- Real-account QR/fallback completion, remembered-session restart, personalized catalogue, online Run/Submit and logout races need separately authorized account acceptance. Fake fixtures and public CN access are not that evidence. International-site capabilities are limited as documented; no universal CN/international parity claim.
- Linux packages target Ubuntu 24.04 / Mint 22-style WebKitGTK/GTK dependencies, not every distribution. Managed tools are not a security sandbox; execute trusted code only.
- Full special-interface/design-class support and universal Rust visualization remain out of scope. Android and macOS ARM are not release attachment targets.
- Before upgrading, back up solutions/notes/application data and close the old version. Do not run versions concurrently against the same data. New schema fields may be unreadable by older versions; archiving is reversible in this version, not a downgrade promise.

## Historical evidence

The previous [2026-10-26 status](docs/history/status-2026-10-26.md) preserves older PR/source/package records and known limits. Historical successful runs do not substitute for the final release gates above.
