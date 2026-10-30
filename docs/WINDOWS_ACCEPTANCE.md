# Windows release acceptance: installer-only, GUI/runtime deferred

For this release, **Windows real GUI and post-upgrade application runtime/migration acceptance are explicitly deferred and remain unverified**. The mandatory `Packaging Windows x64` step runs `scripts/test-windows-msi-lifecycle.ps1`, never the installed app or the old standard-host launcher. The release publisher requires an exact-source successful installer-only report; it does not accept a skipped or failed installer test.

## Required evidence

On disposable GitHub-hosted `windows-2025`, the harness refuses pre-existing InkLeet app-data/cache directories, a running InkLeet process, and any installed or advertised related product. It checks the current package identity and the immutable public v0.1.1 MSI against its frozen source, byte count and SHA-256 before installation. It uses real Windows known-folder locations, not an assumed APPDATA redirection.

It seeds explicitly synthetic source, named solutions, Unicode notes, metadata, settings, dirty drafts, recovery copies and cache data. Unique test markers identify the newly created directories; actual owners are recorded without changing ACLs or ownership. Complete file sets, byte sizes and SHA-256 are compared, including hidden files. Reparse points are refused.

The five required stages are:

1. Current MSI fresh install: current product registered, legacy absent, exact related-product list, exact installed executable and seeded files unchanged.
2. Current uninstall: both products and executable absent; seeded files unchanged.
3. Public v0.1.1 install: only legacy registered; seeded files unchanged.
4. Current major upgrade without uninstalling v0.1.1 first: legacy removed, only current registered, exact installed executable and seeded files unchanged.
5. Upgraded uninstall: both products and executable absent; seeded files unchanged.

Installed means Windows Installer state `5`; removed means exactly `-1`, not merely “not installed.” The script checks for unexpected running InkLeet processes at each boundary. No application launch, mocked IPC, substitute browser or GUI interaction is part of this proof. Seeded bytes are **not** data authored, opened, migrated or saved by either application version.

`MSI_LIFECYCLE_RESULT.json` contains the actual source commit/tree, package hashes and identities, five operations and registration snapshots, seeded-data snapshots, fresh/upgraded payload comparison, uncertainty/cleanup status and explicit limitations. Successful delivery includes the identical report in `BUILD_INFO.json` under `msi_lifecycle_acceptance`. The old `installed_msi_acceptance` GUI report cannot substitute for it. Checked-in tests are not PASS evidence: the exact release build must execute successfully.

## Exact payload and safety

The payload comparison permits only Tauri's unique 27-byte `__TAURI_BUNDLE_TYPE_VAR_UNK` to `__TAURI_BUNDLE_TYPE_VAR_MSI` patch, then requires whole-byte equality. Missing/duplicate markers or unrelated byte changes fail. Expected bytes exist only in memory; the verifier never rewrites the executable or package. This follows the pinned [Tauri bundler patch/restore implementation](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.0/crates/tauri-bundler/src/bundle.rs), not arbitrary PE normalization.

The harness uses documented [msiexec unattended install/uninstall, no-restart and verbose logging options](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec). A start/wait exception, timeout or restart-required result is uncertain and stops further installer actions without retry. Other failures are not PASS. Failure cleanup can target only a product whose verified-absent install this test initiated; it never removes pre-existing products or synthetic notebook files. Logs and fixtures remain on the disposable runner. No security, registry policy, ACL, UAC, account or credential changes are made by the test.

## Why GUI acceptance remains open

The earlier hosted-runner GUI attempt on PR source `bf1a0bbb` ([run 40862655706](https://github.com/jacek4yang/inkleet/actions/runs/40862655706), Windows job 123411445088) verified the same-user medium-integrity child process but it exited with `0xC0000142` before JavaScript or MSI actions. This was not an installed-app PASS; the underlying DLL/desktop-access cause was not established. The release no longer runs that launcher, and does not alter machine security to force it to work.

Completing the deferred acceptance requires an authorized ordinary-user Windows test machine or compatible interactive runner: launch the installed app, verify native WebView2/IPC, create data with v0.1.1, upgrade and verify reload, save, restart, archive and restore in the new app. Linux native results and three-platform protocol probes cannot establish this Windows result.

## Other exclusions

- Application startup, WebView2, GUI, post-upgrade runtime or migration, and compatibility of old-app-authored data.
- Interactive MSI/NSIS installers, NSIS execution, physical Windows 10/11 desktop/IME, accessibility or long-session performance.
- Signing, trusted publisher/SmartScreen reputation, real accounts or online judgement.
- A Windows language-service latency or native editor acceptance claim from this installer-only test.

Installers remain unsigned. Back up application data and close the old app before upgrading; do not run versions concurrently. Never disable OS protections to install a preview. All other final-main source gates, package architecture/hash checks and protected merge requirements remain in force.
