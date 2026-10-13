import { chromium } from "playwright";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const server = spawn("npm", ["run", "dev", "--", "--port", "5173"], { stdio: "inherit" });
const browser = await chromium.launch();
await mkdir("evidence", { recursive: true });
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:5173")).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  const editor = page.getByRole("textbox", { name: "代码编辑器", exact: true });
  await editor.fill("// Rust 独立草稿");
  await page.getByRole("combobox", { name: "编程语言" }).selectOption("python3");
  await editor.fill("# Python 独立草稿");
  await page.getByRole("combobox", { name: "编程语言" }).selectOption("rust");
  await editor.waitFor({ state: "visible" });
  assert.equal(await editor.innerText(), "// Rust 独立草稿");
  // 跨语言切换后撤销只改变当前草稿；另一个语言不受影响。
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("// second");
  await editor.press("Control+z");
  assert.ok(!(await editor.innerText()).includes("second"));
  for (const language of ["python3", "golang", "c", "cpp", "java", "rust"]) {
    await page.getByRole("combobox", { name: "编程语言" }).selectOption(language);
    await editor.waitFor({ state: "visible" });
  }
  assert.ok((await editor.innerText()).startsWith("// Rust 独立草稿"));
  await page.screenshot({ path: "evidence/desktop-code.png", fullPage: true });
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown 笔记" }).fill("# 推导\n\n- 检查空数组\n- 时间复杂度 O(n)\n\n自编样例，非私人笔记。");
  await page.screenshot({ path: "evidence/desktop-notes.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "代码", exact: true }).click();
  await page.screenshot({ path: "evidence/mobile-code.png", fullPage: true });
  assert.equal(await editor.isVisible(), true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, "手机页面不能横向溢出");
  // 大文件仅作为测试数据，不调用运行/提交，不代表真机 IME 验证。
  const large = Array.from({ length: 10000 }, (_, i) => "// line " + i + ": bounded editor responsiveness").join("\n");
  // 用编辑器粘贴管线装载大文档；不能用 fill 构造一万个原生 DOM 行再测重绘。
  await editor.click();
  await editor.press("Control+a");
  const pasteStarted = Date.now();
  await editor.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, large);
  const pasteSetupMs = Date.now() - pasteStarted;
  await editor.press("Control+End");
  await page.evaluate(() => {
    window.__inkPerf = { frames: [], tasks: [] };
    document.addEventListener("beforeinput", () => {
      const start = performance.now();
      requestAnimationFrame(() => window.__inkPerf.frames.push(performance.now() - start));
    }, { capture: true });
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__inkPerf.tasks.push(e.duration);
    });
    observer.observe({ type: "longtask" });
  });
  await editor.pressSequentially(" // performance probe 0123456789", { delay: 20 });
  await page.waitForFunction(() => window.__inkPerf.frames.length >= 20);
  const measured = await page.evaluate(() => window.__inkPerf);
  const sorted = [...measured.frames].sort((a, b) => a - b);
  const report = {
    environment: "GitHub Actions Linux Chromium headless; not native WebView or IME",
    platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
    viewport: "390x844", lines: 10000, initialCharacters: large.length,
    setup: "Synthetic paste event through CodeMirror; input samples use Playwright keyboard", pasteSetupMs,
    samples: sorted.length, inputToRafP50Ms: sorted[Math.floor(sorted.length * .5)],
    inputToRafP95Ms: sorted[Math.floor(sorted.length * .95)],
    longestTaskMs: Math.max(0, ...measured.tasks),
  };
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出源码", exact: true }).click();
  const exported = await downloadPromise;
  const exportedText = await readFile(await exported.path(), "utf8");
  assert.equal(exportedText, large + " // performance probe 0123456789");
  await writeFile("evidence/PERFORMANCE.json", JSON.stringify(report, null, 2));
  assert.ok(report.inputToRafP95Ms < 100, "受控测试输入响应 P95 不应超过 100ms");
  assert.deepEqual(errors, []);

  // 仅模拟 IPC 的登录 UI 竞态测试；不冒充真实账号或原生登录验收。
  const authPage = await browser.newPage();
  const authErrors = [];
  authPage.on("pageerror", error => authErrors.push(error.message));
  await authPage.addInitScript(() => {
    window.isTauri = true;
    window.__inkAuthTest = { pending: [], cancelled: 0 };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "search_questions") return { total: 1, hasMore: false, questions: [{
        frontendQuestionId: "T1", title: "UI Test", titleCn: "题库测试样例", titleSlug: "fixture-test", difficulty: "Easy", paidOnly: false
      }] };
      if (command === "get_question") return {
        questionId: "999909", questionFrontendId: "T1", title: "UI Test", translatedTitle: "题库测试样例", titleSlug: args.slug,
        translatedContent: '<p>仅测试题面</p><img src="x" onerror="window.__unsafeExecuted=true"><script>window.__unsafeExecuted=true</script><a href="javascript:alert(1)">不可执行链接</a><iframe srcdoc="unsafe"></iframe>',
        content: null, isPaidOnly: false, difficulty: "Easy", sampleTestCase: "[]", exampleTestcases: "[]", metaData: "{}",
        codeSnippets: [{ langSlug: "rust", code: "// official-shaped test template" }, { langSlug: "python3", code: "# test template" }]
      };
      if (command === "load_document") return { code: null, notes: null };
      if (command === "open_login" || command === "save_text") return;
      if (command === "cancel_login") { window.__inkAuthTest.cancelled++; return; }
      if (command === "verify_login") return new Promise((resolve, reject) => window.__inkAuthTest.pending.push({ resolve, reject }));
      throw new Error("Unexpected test IPC command: " + command);
    }};
  });
  await authPage.goto("http://127.0.0.1:5173");
  await authPage.getByRole("button", { name: "登录力扣", exact: true }).click();
  await authPage.getByRole("button", { name: "已完成登录，校验会话", exact: true }).click();
  await authPage.waitForFunction(() => window.__inkAuthTest.pending.length === 1);
  const cancel = authPage.getByRole("button", { name: "取消登录", exact: true });
  assert.equal(await cancel.isEnabled(), true, "校验中仍必须可以取消");
  await cancel.click();
  await cancel.waitFor({ state: "hidden" });
  // 新登录开始后，旧校验的成功不能改变当前账号或关闭当前登录。
  await authPage.getByRole("button", { name: "登录力扣", exact: true }).click();
  await authPage.evaluate(() => window.__inkAuthTest.pending[0].resolve({ username: "stale-test-user", account: "stale", persistence: "memory-only" }));
  await authPage.getByRole("button", { name: "已完成登录，校验会话", exact: true }).waitFor();
  assert.equal(await authPage.getByText("stale-test-user", { exact: false }).count(), 0);
  await authPage.getByRole("button", { name: "已完成登录，校验会话", exact: true }).click();
  await authPage.waitForFunction(() => window.__inkAuthTest.pending.length === 2);
  await authPage.evaluate(() => window.__inkAuthTest.pending[1].reject(new Error("测试网络失败")));
  await authPage.getByText("Error: 测试网络失败", { exact: true }).waitFor();
  assert.equal(await cancel.isEnabled(), true);
  await cancel.click();
  await authPage.getByRole("button", { name: "中国站题库", exact: true }).click();
  await authPage.getByRole("textbox", { name: "搜索中国站题目" }).fill("test");
  await authPage.getByRole("button", { name: "搜索", exact: true }).click();
  await authPage.getByRole("button", { name: /T1 题库测试样例/ }).click();
  await authPage.getByRole("heading", { name: "题库测试样例", exact: true }).waitFor();
  assert.equal(await authPage.locator(".question-content script, .question-content img, .question-content iframe, .question-content a").count(), 0);
  assert.equal(await authPage.evaluate(() => !!window.__unsafeExecuted), false);
  const fixtureEditor = authPage.getByRole("textbox", { name: "代码编辑器", exact: true });
  await fixtureEditor.waitFor();
  assert.equal(await fixtureEditor.innerText(), "// official-shaped test template");
  await fixtureEditor.fill("// preserved fixture draft");
  await authPage.getByRole("combobox", { name: "编程语言" }).selectOption("python3");
  await fixtureEditor.waitFor();
  assert.equal(await fixtureEditor.innerText(), "# test template");
  await authPage.getByRole("combobox", { name: "编程语言" }).selectOption("rust");
  await fixtureEditor.waitFor();
  assert.equal(await fixtureEditor.innerText(), "// preserved fixture draft");
  await authPage.getByRole("button", { name: "笔记", exact: true }).click();
  const sharedNote = authPage.getByRole("textbox", { name: "Markdown 笔记" });
  await sharedNote.fill("# shared pending note");
  // mock load_document 返回 null，模拟新语言还没有源码；不得清空已有共享笔记。
  await authPage.getByRole("combobox", { name: "编程语言" }).selectOption("golang");
  await sharedNote.waitFor();
  assert.equal(await sharedNote.innerText(), "# shared pending note");
  assert.deepEqual(authErrors, []);
  await authPage.close();
  await writeFile("evidence/AUTH_UI_RESULT.txt", "PASS: mocked IPC only; cancel during verification, ignore stale success, explicit failure and recovery. NOT real login validation.\n");

  await writeFile("evidence/UI_RESULT.txt", "PASS: frontend draft switching, notes editing, responsive layout, no page errors.\nScreenshots: Linux Chromium frontend preview; authored samples; NOT native app or real LeetCode.\n");
} finally { await browser.close(); server.kill(); }
