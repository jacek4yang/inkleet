# Native China-site login

## Scope

The default login surface is an InkLeet-owned QR panel. The existing isolated
LeetCode WebView is available only through the explicit **Official web login**
action. It is a compatibility fallback, not a guarantee against future service
changes. Both paths use the same backend identity verification and session store.

This implementation is not yet a claim of successful real-account acceptance.
Captured traffic established QR creation and WAITING polling; successful session
issuance, expired sessions, and real operating-system credential-store behavior
still need platform-native validation. No captured credentials are test fixtures.

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
  automatic requests instead of shortening the service cooldown.
- Only terminal server expiry can automatically replace a QR, at most three
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
  saved data and offers an explicit retry; it does not erase credentials.
- Canceling an attempt preserves an already established account. Sign-out clears
  local identity and attempts, then deletes the saved credential. Failure to delete
  produces a dedicated retry action and never claims the device was forgotten.
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

Current local evidence is type checking, frontend unit tests/build, and isolated
Rust QR/store codec tests. A missing GLib development package blocks a full local
Tauri compile in the current environment. Isolated Rust tests are not a substitute
for full native CI or real-account validation.
