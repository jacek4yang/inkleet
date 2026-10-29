import assert from "node:assert/strict";
export async function runNativeLoginUI(testPage) {
  await runStartupRecoveryUI(testPage);
  await runLateSessionUI(testPage);
  await runRestoreClassificationUI(testPage);
  await runTerminalQrUI(testPage);
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

async function runStartupRecoveryUI(testPage) {
  const page = await testPage({viewport:{width:1200,height:800}});
  try {
    await page.addInitScript(() => {
      window.isTauri=true;window.__authRestoreTest=true;
      window.__restoreState={fail:true,calls:0,loginStarts:0};
      window.__TAURI_INTERNALS__={invoke:async(command)=>{
        if(command==="open_login"||command==="qr_login_start"){window.__restoreState.loginStarts++;throw Error("No unsolicited login");}
        if(command==="sign_out"){window.__restoreState.fail=false;return;}
        if(command==="login_status"){window.__restoreState.calls++;if(window.__restoreState.fail)throw Error("STORAGE_RECOVERY_REQUIRED");return null;}
        if(command==="load_recent_questions")return [window.__fixtureQuestions[0]];
        if(command==="search_questions")return {questions:[],total:0,hasMore:false};
        if(command==="list_solutions")return {entries:[{id:"default",name:"Default"}],unreadable:0};
        if(command==="load_document")return {code:"// practice while signed out",notes:null};
        if(command==="list_judgements")return [];
        if(command==="external_editor_supported")return false;
        if(["cancel_login","stop_language_service","save_text"].includes(command))return;
        throw Error("Unexpected startup recovery fixture: "+command);
      }};
    });
    await page.goto("http://127.0.0.1:5173");
    const notice=page.getByRole("button",{name:"登录状态",exact:true});await notice.waitFor();
    const panel=page.getByRole("region",{name:"LeetCode 登录",exact:true});
    assert.equal(await panel.count(),0,"startup recovery failure must not open an unsolicited overlay");
    assert.equal(await page.evaluate(()=>window.__restoreState.loginStarts),0,"recovery failure must not start a login automatically");
    const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true});await editor.waitFor();
    await editor.click();await editor.press("End");await editor.pressSequentially(" still editable");
    assert.equal(await editor.evaluate(node=>node===document.activeElement),true,"recovery warning does not capture editor focus");
    await notice.click();await panel.waitFor();
    await panel.getByRole("button",{name:"重试恢复登录",exact:true}).waitFor();
    await panel.getByRole("button",{name:"重试忘记此设备",exact:true}).waitFor();
    await panel.getByRole("button",{name:"收起登录提示",exact:true}).click();assert.equal(await panel.count(),0);
    await notice.click();
    await panel.getByRole("button",{name:"重试恢复登录",exact:true}).click();
    await page.waitForFunction(()=>window.__restoreState.calls===2);
    await panel.getByRole("button",{name:"重试忘记此设备",exact:true}).click();await panel.waitFor({state:"hidden"});
    assert.equal(await notice.count(),0,"explicit forget clears the recovery latch and passive warning");
  } finally {await page.close();}
}


// These are browser UI + mocked IPC fixtures. They do not prove native QR
// issuance, a real account, OS credential access, or an actual IME interaction.
async function sessionFixture(testPage, scenario) {
  const page = await testPage({ viewport: { width: 1000, height: 800 } });
  await page.addInitScript(scenario => {
    window.isTauri = true;
    window.__authRestoreTest = true;
    const state = window.__sessionFixture = { scenario, statusCalls: 0, starts: 0, polls: [], verifies: [], cancels: 0, restores: [] };
    const identity = account => ({ username: account, account, persistence: "system-keychain" });
    window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
      if (command === "login_status") {
        state.statusCalls++;
        if (scenario === "late") return new Promise((resolve, reject) => state.restores.push({ resolve, reject }));
        if (scenario === "offline" && state.statusCalls === 1) throw Error("synthetic network unavailable");
        if (scenario === "expired") throw Error("SESSION_EXPIRED: synthetic expired");
        return scenario === "offline" ? identity("restored-fixture") : null;
      }
      if (command === "qr_login_start") { state.starts++; return { attempt: state.starts, state: "WAITING", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', identity: null }; }
      if (command === "qr_login_poll") return new Promise((resolve, reject) => state.polls.push({ args, resolve, reject }));
      if (command === "verify_login") return new Promise((resolve, reject) => state.verifies.push({ resolve, reject }));
      if (command === "cancel_login") { state.cancels++; return; }
      if (command === "sign_out" || command === "open_login" || command === "stop_language_service") return;
      if (command === "load_recent_questions" || command === "list_judgements") return [];
      if (command === "search_questions") return { questions: [], total: 0, hasMore: false };
      if (command === "external_editor_supported") return false;
      throw Error("Unexpected session fixture command: " + command);
    }};
  }, scenario);
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => window.__sessionFixture.statusCalls === 1);
  return page;
}
async function runLateSessionUI(testPage) {
  const page = await sessionFixture(testPage, "late");
  try {
    await page.getByRole("button", { name: "登录力扣", exact: true }).click();
    await page.getByAltText("力扣 App 登录二维码").waitFor();
    await page.evaluate(() => window.__sessionFixture.restores[0].resolve({ username: "stale-restore", account: "stale-restore", persistence: "system-keychain" }));
    await page.waitForFunction(() => window.__sessionFixture.polls.length === 1);
    assert.equal(await page.getByRole("button", { name: "stale-restore · 退出", exact: true }).count(), 0, "late startup restoration cannot replace a newer explicit login");
    await page.getByRole("button", { name: "取消登录", exact: true }).click();
    await page.getByRole("region", { name: "LeetCode 登录", exact: true }).waitFor({ state: "hidden" });
    await page.evaluate(() => { const pending = window.__sessionFixture.polls[0]; pending.resolve({ attempt: pending.args.attempt, state: "SUCCEED", identity: { username: "stale-poll", account: "stale-poll", persistence: "memory-only" } }); });
    await page.getByRole("button", { name: "登录力扣", exact: true }).click();
    await page.getByRole("button", { name: "官方网页登录", exact: true }).click();
    await page.getByRole("button", { name: "验证登录", exact: true }).click();
    await page.waitForFunction(() => window.__sessionFixture.verifies.length === 1);
    await page.getByRole("button", { name: "取消登录", exact: true }).click();
    await page.getByRole("region", { name: "LeetCode 登录", exact: true }).waitFor({ state: "hidden" });
    await page.evaluate(() => window.__sessionFixture.verifies[0].resolve({ username: "stale-web", account: "stale-web", persistence: "memory-only" }));
    await page.waitForTimeout(100);
    for (const account of ["stale-restore", "stale-poll", "stale-web"]) assert.equal(await page.getByRole("button", { name: account + " · 退出", exact: true }).count(), 0);
    assert.equal(await page.getByRole("region", { name: "LeetCode 登录", exact: true }).count(), 0, "stale completions must not reopen a canceled panel");
    assert.equal(await page.getByRole("button", { name: "登录力扣", exact: true }).isEnabled(), true);
  } finally { await page.close(); }
}
async function runRestoreClassificationUI(testPage) {
  for (const scenario of ["offline", "expired"]) {
    const page = await sessionFixture(testPage, scenario);
    try {
      await page.getByRole("button", { name: "登录状态", exact: true }).click();
      const panel = page.getByRole("region", { name: "LeetCode 登录", exact: true });
      if (scenario === "offline") {
        await panel.getByText("暂时无法恢复登录；已保存的会话未被删除，可以稍后重试。", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__sessionFixture.statusCalls), 1, "offline restore does not create a retry loop");
        await panel.getByRole("button", { name: "重试恢复登录", exact: true }).click();
        await page.getByRole("button", { name: "restored-fixture · 退出", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__sessionFixture.statusCalls), 2);
      } else {
        await panel.getByText("保存的会话已过期，请重新登录；未自动删除系统保存的凭据。", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__sessionFixture.starts), 0, "expired credentials do not trigger an unsolicited login");
      }
    } finally { await page.close(); }
  }
}
async function runTerminalQrUI(testPage) {
  const page = await sessionFixture(testPage, "terminal");
  try {
    await page.getByRole("button", { name: "登录力扣", exact: true }).click();
    await page.waitForFunction(() => window.__sessionFixture.polls.length === 1);
    await page.evaluate(() => { const pending = window.__sessionFixture.polls[0]; pending.resolve({ attempt: pending.args.attempt, state: "WAITING" }); });
    await page.waitForFunction(() => window.__sessionFixture.polls.length === 2);
    await page.evaluate(() => { const pending = window.__sessionFixture.polls[1]; pending.resolve({ attempt: pending.args.attempt, state: "FAILED" }); });
    await page.getByText("扫码登录暂不可用，请重试或使用官方网页登录。", { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__sessionFixture.starts), 1, "FAILED is not EXPIRED and must not auto-refresh");
    assert.equal(await page.evaluate(() => window.__sessionFixture.polls.length), 2, "FAILED is terminal, not a disguised WAITING result");
    assert.equal(await page.getByAltText("力扣 App 登录二维码").count(), 0);
    await page.getByRole("button", { name: "重新扫码", exact: true }).click();
    await page.waitForFunction(() => window.__sessionFixture.starts === 2);
    await page.waitForFunction(() => window.__sessionFixture.polls.length === 3);
    await page.evaluate(() => window.__sessionFixture.polls[2].reject(Error("RATE_LIMIT_PAUSE")));
    await page.getByText("服务要求较长冷却，自动请求已暂停，请稍后再试。", { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__sessionFixture.polls.length), 3, "unbounded cooldown must stop polling");
  } finally { await page.close(); }
}
