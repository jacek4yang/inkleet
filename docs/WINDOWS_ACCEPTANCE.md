# Windows installed-release acceptance

The `Packaging Windows x64` job includes `scripts/test-windows-installed.ps1` as a mandatory step before it uploads installers. The checked-in test is **not** evidence of success: only that exact run's `MSI_INSTALLED_RESULT.json` and phase UI reports establish what executed.

## What the gate does

On a disposable GitHub-hosted `windows-2025` runner, it refuses pre-existing InkLeet app-data/cache directories, a running InkLeet process or any installed/advertised product with the same upgrade code. It verifies the prior public v0.1.1 MSI's exact byte count and SHA-256 against `releases/v0.1.1.json`, and checks product/version/upgrade-code identity before installing anything.

1. Installs the current MSI into an explicit test-owned directory. Checks Windows Installer registration and compares every installed executable byte to the exact just-built payload with only Tauri's single `__TAURI_BUNDLE_TYPE_VAR_UNK` → `__TAURI_BUNDLE_TYPE_VAR_MSI` substitution. Tauri patches that runtime marker for MSI bundling, then restores the unbundled build output. Missing/duplicate markers or any other byte difference fail; raw, expected and installed SHA-256/size/path diagnostics are retained.
2. Launches that installed executable with the real Windows WebView2 runtime. Saves authored source and notes through visible app controls and real Tauri IPC, opens/closes Settings, takes a screenshot, and requests normal app closure.
3. Uninstalls the current MSI and verifies the executable/registration are gone while the complete synthetic notebook hashes are unchanged.
4. Installs public v0.1.1. Its actual UI writes source, notes and a named solution; then it closes normally.
5. Upgrades to the current MSI without uninstalling the old version first. Checks old registration removal, current registration, exact installed payload and preserved notebook hashes. The new app loads the old source/notes/named solution, archives an unsaved draft, restarts, restores the same solution ID and explicitly saves the restored draft.
6. Uninstalls the upgraded app and again checks unchanged notebook hashes. Evidence and synthetic data stay available for diagnosis until the disposable runner is discarded.

A verified same-user, standard-integrity child creates the fresh synthetic app-data, cache, temporary and WebView2-profile directories; exact user-SID ownership is checked without changing any existing ACL or owner. The app-data and cache directories are the real Windows known-folder locations. No claim is made that changing `APPDATA` can redirect Tauri storage. A test ownership marker is required before the UI probe reads the fixture. All notebook/code/note contents are authored fixtures; no account login, submission, personal files or managed language tools are involved.

The payload rule follows [Tauri's `patch_binary`/restore implementation](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.0/crates/tauri-bundler/src/bundle.rs) and the pinned `tauri-utils` 2.10.1 runtime marker (Cargo.lock). The first real Windows run's bundling log explicitly reported the MSI patch. Expected bytes exist only in memory (`expected_path: null`, explicit `expected_origin`); build output, MSI and installed files are never rewritten by this check. `fresh-payload.json` and `upgraded-payload.json` retain raw/expected/installed sizes and SHA-256, original absolute paths and the unique marker offset/count/length. Failed comparisons retain first differing byte offsets.

## Automation and security boundary

[Playwright's WebView2 guide](https://playwright.dev/docs/webview2) supports attaching CDP to an existing WebView2 process. [Microsoft's WebView2 debugging documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) documents the process environment variable. The probe sets only `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (loopback debug address/port) and a test WebView2 profile on its spawned app process. It does not start a substitute Chromium browser, rewrite app IPC, alter registry policies, disable security protections or add a production debugging feature.

[Windows Installer's documented unattended options](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec) are used for install/uninstall with verbose logs and no restart. Nonzero, restart-required, timeout, absent WebView2/CDP or GUI failures are failures, not skipped passes. Failure cleanup considers only products whose verified-absent install was initiated by this test, never inspected/pre-existing products. An uncertain MSI timeout is not replayed or followed by further installer actions. A failed UI probe may terminate only its recorded child process tree for cleanup; that cannot count as successful normal closure.

Each UI report records the test `harnessCommit` separately from `applicationSourceCommit`: public v0.1.1 uses its frozen manifest source, not the current harness SHA. The running version is read from native Tauri IPC; package hashes tie that version to source.


### Standard-host verification, not a security-policy workaround

[GitHub documents elevated Windows hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges). [Microsoft documents that elevated WebView2 hosts ignore `WEBVIEW2_*` overrides](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security) and recommends standard-integrity hosting. The harness first records the actual parent token. It does not infer elevation from a CDP timeout. If already standard, it keeps that context unchanged; an unexpected token fails closed.

For an observed high/elevated/admin-enabled caller only, the CI helper uses the caller's own [restricted token](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken) (`DISABLE_MAX_PRIVILEGE | LUA_TOKEN`), medium integrity and the same user's token default owner. [CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw) starts only the exact Node test script suspended; user SID, owner SID, session, integrity, elevation, admin group and enabled privileges are verified before resuming it. There is no credential use, account change, token from another process, privilege enablement, `SANDBOX_INERT`, registry/UAC/policy change or filesystem ACL rewrite. This helper is never part of the shipped app.

Fresh native diagnostics verify both Node and the installed app's actual tokens, their parent-child relationship, executable paths and synthetic-directory owners. Only that app's process descendants are reported, including actual WebView2 executable version. CDP must have an owned loopback-only listener. After normal app close, every observed owned PID and the port must be absent; failed process/TCP queries are failures, not empty results. The parent's bounded [job object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) must report zero active processes after Node exits normally, separately from successful handle closure. On failure only, its own job may be terminated; forced cleanup is never a passing normal shutdown.

`*-host.json` and the `hosts` metadata record observed token/mode/outcome; `launch_attempts` retains diagnostics even if CDP never connects. No current Windows GUI PASS is claimed merely because these checks exist in source.

## What it does not establish

- Interactive MSI wizard or NSIS setup behavior, SmartScreen reputation, signing or trusted publisher status.
- A physical Windows 10/11 user's desktop, accessibility stack, OS-pointer fidelity, actual input-method composition or long-session performance. The runner is Windows Server 2025.
- Any LSP completion/latency result: this probe installs no language service and claims none.
- Authenticated account/session, live online judgement, notarization, macOS or Linux acceptance.

Installers remain unsigned. Never weaken device security settings to make installation pass.
