import test from "node:test";
import assert from "node:assert/strict";
import { retryDelay, shouldRefresh } from "../src/login-flow.ts";
test("QR only automatically replaces server-expired attempts within a budget", () => {
  for (const state of ["WAITING", "SUCCEED", "FAILED", "UNKNOWN"]) assert.equal(shouldRefresh(state, 0), false);
  assert.equal(shouldRefresh("EXPIRED", 2), true);
  assert.equal(shouldRefresh("INVALID", 0), true);
  assert.equal(shouldRefresh("EXPIRED", 3), false);
});
test("QR retry honors bounded Retry-After and exponential backoff", () => {
  assert.equal(retryDelay("RATE_LIMIT:120", 1), 120_000);
  assert.equal(retryDelay("RATE_LIMIT:99999", 1), null);
  assert.equal(retryDelay("RATE_LIMIT_PAUSE", 1), null);
  assert.equal(retryDelay("offline", 1), 2000);
  assert.equal(retryDelay("offline", 9), 30_000);
});
