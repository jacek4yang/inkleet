# Native China-site login

## Scope

The default login surface is an InkLeet-owned QR panel. The existing isolated
LeetCode WebView is available only through the explicit **Official web login**
action. It is a compatibility fallback, not a guarantee against future service
changes. Both paths use the same backend identity verification and session store.

This implementation is not yet a claim of successful real-account acceptance.
Captured traffic established QR creation and WAITING polling; successful session
issuance, expired sessions, and real-account operating-system credential-store behavior
still need platform-native validation. Synthetic persistence is tested separately. No captured credentials are test fixtures.

## Protocol and UI

- Requests go only to `https://leetcode.cn/graphql/`; redirects are not followed.
- `createSignInQRCode` / `authSignInCreateScanData` supplies a scan identifier
  and a JSON-encoded link. The backend validates the exact app-link destination
  and generates SVG locally. The frontend receives the SVG, never session cookies.
- `checkQRCodeSignInStatus` / `authSignInByScanWithPhone` reports WAITING,
  SUCCEED, EXPIRED, INVALID, or FAILED. No separate scanned/confirming state or
  authoritative expiry timestamp is available. The UI does not invent either.
- The user scans with the LeetCode App, not WeChat.
- Polling is sequential at roughly one-second intervals. Temporary errors back
  off without changing a valid QR. Long or unparseable Retry-After values pause
  automatic requests instead of shortening the service cooldown. FAILED is terminal;
  it is never reinterpreted as WAITING or guessed to mean EXPIRED.
- Only explicit server EXPIRED / INVALID can automatically replace a QR, at most three
  times per opened panel. Ten minutes of inactivity pauses the panel. Background
  windows do not poll. Closing or changing mode invalidates old responses.
- SUCCEED alone is insufficient: the native cookie pair must be present and the
  account identity query must confirm the authenticated account.
- Unknown protocol shapes and verification challenges fail visibly. The app
  never bypasses challenges or silently opens a fallback webpage.

## Credential handling

- macOS Keychain, Windows Credential Manager, and Linux Secret Service are used
  through explicitly selected native keyring backends.
- One active China-site session is stored per operating-system user. The
  international site and multiple-account switching are not implemented here.
- No passwords, raw HARs, QR attempts, or full browser profiles are persisted.
- Session data never crosses IPC, appears in logs, or falls back to localStorage
  or plaintext files. Authentication headers are marked sensitive.
- Remember-device changes explicitly restart the QR attempt. The fallback captures
  the setting when it opens.
- Startup verifies restored credentials. Temporary network/store failure preserves
  saved data and offers an explicit retry; it does not erase credentials. An explicit
  signed-out identity response is distinguished from unknown protocol data and
  reported as an expired session. Neither condition silently removes saved data.
- Canceling an attempt preserves an already established account. Sign-out clears
  local identity and attempts, then deletes the saved credential. Failure to delete
  produces a dedicated retry action and never claims the device was forgotten.
  Pending deletion latches backend recovery-required state before the worker starts,
  including when cancellation supersedes the worker before deletion. A new login cannot conceal a
  failed forget operation. Retry-forget must succeed before another login commits.
- Keychain writes and deletion are serialized with generation-aware auth commits.
  Cancellation invalidates an atomic epoch before waiting for storage. If it arrives
  during a write, a serialized rollback restores the previous saved account (or
  removes the newly saved one). Rollback failure is explicit. OS prompts can still
  delay completion, and native runtime tests remain required.
- If a saved account cannot safely be replaced or removed, login fails visibly
  rather than leaving an undisclosed older account to restore at next launch.

## Required acceptance before production claims

1. Real QR confirmation -> session cookie issuance -> identity verification.
2. Real expiry, INVALID and FAILED behavior, CSRF bootstrap/rotation, and challenges.
3. macOS Intel, Windows x64 and Linux desktop restart restoration; locked/missing
   keychain, denied consent, save/delete errors, and temporary network loss.
4. Cancel/close/fallback/new attempt while requests and keychain operations finish.
5. Account-bound online actions remain protected; no test automatically submits
   code to a user's account.
6. Browser interaction fixtures and full native checks on the exact delivered SHA.

## Version 0.1.2 acceptance additions

- Production credential transactions are exercised with synthetic read/write/delete
  failures, including partial writes, canceled reads, rollback, and accounts replaced
  by a newer generation. Offline or expired restoration must not install an identity.
- Browser fixtures cover late startup restore, QR success after cancel, fallback
  verification after cancel, explicit offline retry, expired-session messaging,
  terminal FAILED, and long rate-limit pauses. These are mocked IPC UI tests, not
  real authentication or native latency measurements.
- The platform workflows explicitly opt into a real OS credential-store probe. It
  creates a unique `top.jacek.inkleet.credential-test` item containing only synthetic
  credentials, reads it from a separate process, replaces it, deletes it, and checks
  absence. The production service/slot is never read or written. Linux uses a
  disposable D-Bus session and private temporary keyring directories. No OS security
  protections are disabled, no login keychain is reset, and errors fail the probe.
- Tests are ignored by ordinary `cargo test`; CI calls only the named probe with
  `INKLEET_TEST_NATIVE_CREDENTIAL_STORE=1`. Workflow evidence is
  `credential-store.txt` in the corresponding native/platform artifact. Test code
  existing or compiling is not proof that this probe passed on a platform; report
  the result for the exact delivered SHA.

Local pure Rust QR/store/credential-transaction tests and TypeScript checks can run
without native GUI dependencies. Full Tauri compilation, actual native storage, and
UI tests must be reported separately. In the cloud implementation workspace, absent
GTK/WebKit development packages block a full native compile and the browser sandbox
blocks Chromium startup. CI provides the corresponding acceptance environment.

Windows/macOS interactive install/upgrade/uninstall, native GUI, real Chinese IME,
long-session editing, and real-account login remain separate acceptance gaps.
There is no connected Windows/macOS user test computer or real-account consent in
this task. Unsigned/unnotarized builds must not be tested by disabling OS protections.
This work does not add international-site login or judging: requests and account
credentials stay scoped to the China site, and international QR destinations fail
validation. Separate-process synthetic persistence is not a successful real account
restored across an actual application upgrade.
