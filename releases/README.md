# Frozen verified publication

`publish-verified.yml` is manual-only and fails closed without a complete frozen
`releases/v<version>.json` and matching `releases/v<version>.md`. This directory deliberately
contains **no publishable placeholder manifest**. Historical records are immutable;
the publisher derives its target from the validated application version.

1. Merge the reviewed publisher code and product changes through protected PRs.
2. Freeze the final **current main commit**, its full Git tree and successful gates.
   Every gate must run on that exact main commit by a main push.
   Manual dispatch is excluded because its native snippet inputs may differ.
   Pull-request runs are not accepted because their checked-out synthetic merge
   commit can differ from the API head SHA. Tree equivalence is not a substitute.
3. Read the package artifacts and freeze their archive SHA-256, exact artifact IDs,
   individual installer filenames, byte counts and SHA-256. Inspect `BUILD_INFO.json`
   and `SOURCE_COMMIT.txt` (Windows/Linux; existing macOS packages only have
   `BUILD_INFO.commit`). Never substitute PR `run.head_sha` for actual build source.
4. Create `release/v<version>` from that main source, adding **only** the two release
   records above. The comparison must contain no code/workflow changes. Freeze the
   UTF-8 notes file digest in the manifest. Main must remain unchanged during publish.
5. Dispatch **Publish frozen verified release** on `release/v<version>` once. It verifies
   inputs, creates a draft, uploads four installers plus `SHA256SUMS` and
   `RELEASE_MANIFEST.json`, downloads every uploaded asset for byte verification,
   then publishes a non-prerelease GitHub Release and verifies it again.

Do not rerun after a failed/uncertain mutation. Inspect the draft, tag and assets
first; the script deliberately refuses an existing draft/release/tag and never
uses `--clobber` or a forced ref update. A failure after public publication is a
verification incident, not proof that nothing was published.

## Manifest fields (schema 1)

- `repository`: `jacek4yang/inkleet`; `tag`: `v<version>`; `version`: the application version;
  `prerelease`: `false`; `source_commit`/`source_tree`: full lowercase 40-hex SHA;
  `notes_sha256`: lowercase 64-hex SHA.
- `gates`: exactly `ci`, `editing`, `harness`, `native`, `dap`, `package`, each containing positive
  integer `run_id`, `attempt`, `event` and full `qualification_commit`. Event is
  `push`; every gate must qualify the exact final main SHA.
  The script fixes workflow paths and mandatory job names rather than trusting
  a manifest-supplied allowlist.
- `artifacts`: exactly `windows`, `linux`, `macos`, each containing `id`, exact
  platform artifact `name`, archive `sha256`, and `assets`. Each asset has `name`,
  `bytes`, `sha256`. Windows has EXE and MSI, Linux tar.gz, macOS Intel DMG. Names
  must include application version, source short SHA and architecture.

Release notes must distinguish real native acceptance from actual-DAP Chromium
replay and user-reported login/submission. Disclose unsigned/unnotarized packages,
Linux distribution dependencies, compatibility limits, and unverified Rust types.
No broad persistence, installer, or all-Rust-support claims without evidence.

The reviewed publisher and transport code must already be on main. New release
branches cannot use the historical v0.1.1 publisher-recovery exception: exactly
two newly added manifest/notes files, with remote blob identities matching the
checkout, are permitted. Actions artifact ZIPs use default API content negotiation;
release assets use octet-stream. The old public tag and assets are never replaced.

The editing and local-harness gates execute the actual pinned adapters and generated
Rust/Python drivers on Linux x64, Windows x64 and macOS Intel. Their success is
required independently of configured branch-protection checks. They do not replace
Native Linux or imply native Windows/macOS GUI/IME acceptance.

Windows BUILD_INFO must also contain a matching `MSI_INSTALLED_RESULT.json` PASS
record: exact-current-source installed WebView2 phases, verified public v0.1.1
upgrade provenance, normal close/restart, installer identity and no uncertain
installer/cleanup state. Merely building an MSI is not this acceptance.
