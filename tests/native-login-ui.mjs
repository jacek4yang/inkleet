import assert from "node:assert/strict";
export async function runNativeLoginUI(testPage) {
  const page = await testPage({ viewport: { width: 1000, height: 800 } });
  try {
    await page.addInitScript(() => {
      window.isTauri = true;
      const state = window.__nativeLogin = { starts: [], polls: [], canceled: 0, fallback: 0, failForget: false };
      window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
        if (command === "load_recent_questions") return [];
        if (command === "search_questions") return { questions: [], total: 0, hasMore: false };
        if (command === "external_editor_supported") return false;
        if (command === "list_judgements") return [];
        if (command === "stop_language_service") return;
        if (command === "qr_login_start") { state.starts.push(args); return { attempt: state.starts.length, state: "WAITING", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', identity: null }; }
        if (command === "qr_login_poll") return new Promise(resolve => state.polls.push({ args, resolve }));
        if (command === "cancel_login") { state.canceled++; return; }
        if (command === "open_login") { state.fallback++; return; }
        if (command === "verify_login") return { username: "fixture", account: "fixture", persistence: "system-keychain" };
        if (command === "sign_out") { if (state.failForget) throw Error("locked"); return; }
        throw Error("Unexpected native login fixture: " + command);
      }};
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "登录力扣", exact: true }).click();
    await page.getByAltText("力扣 App 登录二维码").waitFor();
    assert.equal(await page.evaluate(() => window.__nativeLogin.fallback), 0, "native login must not open a hidden web fallback");
    const remember = page.getByRole("checkbox", { name: "记住此设备（系统安全存储）" });
    await remember.uncheck();
    await page.waitForFunction(() => window.__nativeLogin.starts.length === 2);
    assert.equal(await page.evaluate(() => window.__nativeLogin.starts[1].remember), false);
    await page.waitForFunction(() => window.__nativeLogin.polls.length === 1);
    await page.evaluate(() => { const pending = window.__nativeLogin.polls[0]; pending.resolve({ attempt: pending.args.attempt, state: "EXPIRED", svg: null, identity: null }); });
    await page.waitForFunction(() => window.__nativeLogin.starts.length === 3);
    await page.waitForFunction(() => window.__nativeLogin.polls.length === 2);
    await page.getByRole("button", { name: "官方网页登录", exact: true }).click();
    await page.getByRole("button", { name: "验证登录", exact: true }).waitFor();
    await page.evaluate(() => { const pending = window.__nativeLogin.polls[1]; pending.resolve({ attempt: pending.args.attempt, state: "SUCCEED", identity: { username: "stale", account: "stale", persistence: "memory-only" } }); });
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole("button", { name: "stale · 退出", exact: true }).count(), 0);
    await page.getByRole("button", { name: "验证登录", exact: true }).click();
    await page.getByRole("button", { name: "fixture · 退出", exact: true }).waitFor();
    await page.evaluate(() => window.__nativeLogin.failForget = true);
    await page.getByRole("button", { name: "fixture · 退出", exact: true }).click();
    await page.getByRole("button", { name: "重试忘记此设备", exact: true }).waitFor();
    await page.evaluate(() => window.__nativeLogin.failForget = false);
    await page.getByRole("button", { name: "重试忘记此设备", exact: true }).click();
    await page.getByRole("button", { name: "重试忘记此设备", exact: true }).waitFor({ state: "hidden" });
  } finally { await page.close(); }
}
