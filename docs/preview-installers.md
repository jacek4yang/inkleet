# Desktop preview packages

The `Preview desktop installers` workflow creates four files for one source
commit: an Intel macOS DMG, Windows x64 NSIS setup EXE and MSI, and Linux x86_64
tar.gz. They are GitHub Actions artifacts, not a formal Release. The workflow runs
on pull requests, pushes to `main`, and manual dispatch. Only successful runs for
the exact final `main` push qualify for the separate verified-release publisher;
PR synthetic merge builds and manual runs do not establish final release provenance.

## Identity and delivery

- Every package uses an explicit Rust target. Names include architecture and a
  12-character source prefix; metadata preserves the full 40-character commit.
- Each platform's delivery artifact name includes the full source SHA. A local
  checksum file is supplied alongside the installer/archive. Checksums establish
  file integrity, not trusted-publisher identity.
- `BUILD_INFO.json` identifies the Actions run and states what was and was not
  checked. The macOS verifier also records the app bundle and Mach-O deployment
  metadata. The Linux archive contains the full source commit and original DEB
  dependency declaration.
- Delivery upload runs only after that job's verification succeeds. Failure
  evidence can still be uploaded; an evidence artifact is not a working installer.
- Requested retention is 30 days for deliveries, subject to repository policy.
  Check the actual artifact expiry and access requirements before sharing links.
- All three builds depend on the complete frontend typecheck/domain/browser
  suite. Native default-feature Rust tests run on each platform. The separate
  full Linux debug/snippet workflow must be checked for the same commit as well;
  packaging success does not replace that qualification.

No signing credentials are requested or generated. Release binaries use default
features without the diagnostic native-snippet features. Existing CSP, origin
checks, capabilities, snippet-release restrictions and account behavior remain
unchanged. The application's identifier/data location is unchanged, so back up
data and do not run different previews against the same notebook concurrently.

## Windows x64

Runner: `windows-2025`; target: `x86_64-pc-windows-msvc`.

Tauri generates NSIS `*-setup.exe` and WiX v3 `.msi` on Windows. The job checks for
Microsoft C++ x64 tools and a working VBScript runtime before the MSI build. It
does not enable disabled Windows features or change security policies. A missing
prerequisite fails explicitly instead. The Tauri CLI and lockfiles determine its
bundler dependencies. The Windows runner's installed tool inventory is recorded
in evidence where applicable.

The verifier checks the application is x64 PE32+, the setup executable is a valid
PE container, and MSI metadata is readable with the expected product/version and
`x64` Template Summary. NSIS's bootstrap stub may be 32-bit even though the app
payload is x64. Those static checks alone do not install or launch either package.
A separate mandatory step performs actual MSI installation, upgrade from the
hash-verified public v0.1.1 MSI, installed WebView2 synthetic-data interaction and
uninstall preservation checks. Publication requires its exact-run PASS report;
see [Windows installed-release acceptance](WINDOWS_ACCEPTANCE.md). The NSIS
installer is not covered by that MSI execution proof.

Choose one installer format for a given installation. The unchanged WebView2
installation default downloads its bootstrapper if WebView2 is absent, requiring
network access in that case. These are not offline installers and do not promise
Windows 7 support. Unsigned preview installers may have unknown-publisher or
SmartScreen warnings. Do not disable OS protections; if normal installation is
blocked, obtain an approved signed build or consult the administrator.

Real-device acceptance remains: install one format on a clean test machine,
launch, verify Chinese text and Settings search/save/reopen, save and reopen a
sample note, restart to check persistence, then check uninstall behavior. Repeat
with the other format in a clean environment. The CI upgrade covers only its
explicit Windows Server 2025 synthetic-data scenario, not every user environment.
Real account/online submission flows need separate authorization and tests.
Windows GUI acceptance is not inferred from Linux browser or native results.

## Linux x86_64

Runner: `ubuntu-24.04`; target: `x86_64-unknown-linux-gnu`.

The workflow builds and installs a DEB staging package, runs the existing native
GUI smoke suite, then uses `scripts/package-linux-portable.sh` to extract the same
executable into tar.gz. It compares the tar executable to the installed one and
runs the native suite again using `start.sh` from a directory containing spaces.
The launcher finds its own directory and passes through arguments without
rewriting the working directory or setting security-related environment flags.

The archive is relocatable, not statically linked or distribution-independent.
It needs a graphical session, compatible glibc, WebKitGTK 4.1, GTK3 and dependent
system libraries. The exact generated DEB `Depends` field is included as
`DEPENDENCIES.txt`; `ldd` evidence is captured on the CI host. An Ubuntu 24.04
build does not establish compatibility with older glibc systems or all other
distributions. Install dependencies through the distribution's trusted package
manager, not by downloading random shared libraries. No ARM build is included.

The headless Linux CI display workaround is limited to the test step and is not
written into the shipped launcher. Full managed-language downloads and debug-only
snippet tracing are qualified separately. The tar README no longer repeats stale
success claims or unrelated old PR/version-specific feature lists. Existing
license collection, source identity and DEB hash provenance are retained.

## Intel macOS

Runner: `macos-15-intel`; target: `x86_64-apple-darwin`.

The workflow validates DMG integrity, mounts it read-only, confirms bundle
identity/version, and checks every packaged Mach-O file is exclusively x86_64.
It records deployment metadata and code-signing inspection. The DMG has no
Developer ID signing or notarization. It may be blocked by normal macOS security;
do not remove quarantine or disable system protections to bypass that block.

DMG builds use the pinned CLI's `--verbose` logging and retain both output streams
in `evidence/macos-intel/DMG_BUILD.log`, including on failure. Tauri 2.12.0's
[subprocess helper](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.0/crates/tauri-bundler/src/utils/mod.rs)
logs the bundle script's output at Debug; its default Info-level error alone does
not identify which disk-image operation failed. The generated `bundle_dmg.sh` is
also retained as evidence, not rerun or modified. The logging pipeline preserves
the build's nonzero exit; it does not retry, change signing/security policy, or
replace the mandatory DMG verification. An orphan disk-image process or elapsed
time alone is not a root-cause diagnosis.

The configured minimum OS is only metadata. It does not prove that the bundled
frontend, system WebKit or downloaded language tools work on that version. No
macOS GUI test or oldest-OS qualification is claimed. Real-Intel-Mac acceptance
should cover first launch, Settings, keyboard shortcuts, Chinese text,
persistence, language tools and the intended oldest supported OS.

## Before calling the packages ready

1. Verify the remote branch and all relevant CI results use the intended full SHA.
2. Check frontend, native regression and all platform packaging jobs individually.
3. Read failing logs and preserve the exact build identity; do not substitute old
   artifacts with a familiar version number.
4. Download the delivery artifacts, inspect expected files and metadata, and
   verify checksums against the actual installer/archive bytes.
5. Confirm each artifact is unexpired and its download link is accessible to the
   intended user. Include unsigned status and the exact acceptance limitations.
6. Treat creation of these workflows as a draft until Actions has actually run.

## Primary references

- [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri build prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri CLI build arguments](https://v2.tauri.app/reference/cli/#build)
- [Tauri Debian dependency and glibc guidance](https://v2.tauri.app/distribute/debian/)
- [Ubuntu 24.04 GTK3 runtime package](https://packages.ubuntu.com/noble/libgtk-3-0t64)
- [Ubuntu 24.04 WebKitGTK 4.1 runtime package](https://packages.ubuntu.com/en/noble/libs/libwebkit2gtk-4.1-0)
- [Microsoft x64 MSI requirements](https://learn.microsoft.com/en-us/windows/desktop/msi/64-bit-windows-installer-packages)
- [Official Windows 2025 runner inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [GitHub-hosted runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)
- [Vite production browser compatibility](https://vite.dev/guide/build#browser-compatibility)
