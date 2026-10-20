# InkLeet release status

Updated: 2026-10-20 UTC. Current goal: **v0.1.0 Preview**, not mature IDE parity.

## One development line
- Branch: `build/preview-installers`
- Review: [PR #94](https://github.com/jacek4yang/inkleet/pull/94)
- Previous 93 PRs are closed as superseded. Their branches and evidence remain available.
- [Integration audit](docs/INTEGRATION.md)
- No main merge, release tag or published Release is claimed by this document.

## Candidate and evidence
Version 0.1.0 is unified across npm, Cargo and Tauri metadata. A build-time guard checks the manifests and lockfiles.
The first-release candidate includes searchable settings, explicit-save protection, named solutions, source navigation, rename preview/preparation and Rust collection views.
Latest candidate acceptance is tracked in PR #94 and its exact-commit Actions runs. A pending or superseded run is not a pass.

### Verified earlier integrated preview
At application checkpoint `5753647b082381e59419aa99383ec2193adad6d2`:
- Full frontend typechecking, domain tests, build and browser regression passed.
- Settings workbench: 14 cases, zero failures, including short/narrow viewport and keyboard Save accessibility.
- Linux release installed and extracted-tar startup, native IPC, save/restart, named solutions, recovery and conflict checks passed.
- Full diagnostic native run confirmed real Pyright prepareRename/preview/application/undo and Rust logical collections, but **failed later** because the test attempted a coordinate click on an offscreen Settings Save button. Do not call that whole run green.
- The candidate corrects that test using actual wheel scrolling, without removing assertions or replaying a save.

At test/packaging checkpoint `7bac16c2396559df9ad87057c00f93b87e1f83cc` (same application behavior, version 0.0.1):
- Linux tar, Windows EXE/MSI and macOS Intel DMG artifacts were generated and inspected.
- macOS fixture roots were canonicalized; production symlink protection was not relaxed. Added linked-root/config/backup rejection tests passed.
- Windows MSI property-output handling was corrected and tested; x64 package identity/hash checks passed.
These earlier artifacts are **not** the version 0.1.0 release assets. The release must use one newly verified candidate commit.

## Required release gate
- Consistent 0.1.0 metadata and unchanged dependency lock selection.
- Exact-source frontend typecheck, tests, build and full browser regression.
- Required complete native Linux regression, including the corrected Settings Save path.
- Windows x64 EXE/MSI, macOS Intel DMG and Linux tar build/inspection; recorded commit and SHA-256 for every file.
- Review release notes and publish only after the requested publication approval.

## Explicit limitations
- Real-account login and online Run/Submit are not fully accepted. Public browsing and mocked IPC are not proof of authenticated use.
- Windows/macOS interactive installation, upgrade, uninstall and GUI acceptance remain separate from build/metadata tests.
- Real native IME, long-session performance and Ventura compatibility are not fully qualified.
- macOS/Windows packages are unsigned; macOS is unnotarized.
- Diagnostic snippet features are excluded from distributable builds.
- Managed language tools do not form a security sandbox; execute only trusted code.
- Android and macOS ARM are out of this first-release scope.
- Design-class problems and special interfaces are not claimed complete.

[Release notes](docs/releases/v0.1.0.md) · [User manual](docs/USER_MANUAL.md) · [Historical October 14 status](docs/history/status-2026-10-14.md)
