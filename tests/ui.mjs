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
  await page.evaluate(() => document.fonts.ready);
  const fontLoaded = await page.evaluate(() => document.fonts.check('14px "Intel One Mono"'));
  assert.equal(fontLoaded, true, "必须实际加载内置 Intel One Mono");
  assert.ok((await editor.evaluate(el => getComputedStyle(el).fontFamily)).includes("Intel One Mono"));
  await page.getByRole("button", { name: "Intel One Mono", exact: true }).click();
  await page.getByRole("heading", { name: "Intel One Mono", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭字体说明", exact: true }).click();
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
  // 真实 Worker 渲染 + DOMPurify；仅自编测试数据，原文与撤销历史不得因预览丢失。
  const notesEditor = page.getByRole("textbox", { name: "Markdown 笔记", exact: true });
  const readNotes = async () => (await notesEditor.locator(".cm-line").allTextContents()).join("\n");
  const originalNotes = await readNotes();
  await page.getByRole("button", { name: "预览笔记", exact: true }).click();
  await page.locator(".notes-rendered h1").waitFor();
  assert.equal(await page.locator(".notes-rendered h1").innerText(), "推导");
  await page.screenshot({ path: "evidence/desktop-notes-preview.png", fullPage: true });
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  assert.equal(await readNotes(), originalNotes);
  const hostileNotes = "# 安全预览\n\n**粗体** 与 `code`\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>window.__notesXss = true</script>\n<img src=\"https://example.invalid/secret\" onerror=\"window.__notesXss=true\">\n<a href=\"javascript:alert(1)\">保留文字</a><iframe src=\"https://example.invalid/frame\"></iframe><form><input autofocus></form>";
  const unexpectedRequests = [];
  page.on("request", request => { if (request.url().includes("example.invalid")) unexpectedRequests.push(request.url()); });
  await notesEditor.fill(hostileNotes);
  await page.getByRole("button", { name: "预览笔记", exact: true }).click();
  await page.locator(".notes-rendered table").waitFor();
  assert.equal(await page.locator(".notes-rendered strong").innerText(), "粗体");
  assert.equal(await page.locator(".notes-rendered script,.notes-rendered img,.notes-rendered a,.notes-rendered iframe,.notes-rendered input,.notes-rendered form").count(), 0);
  assert.equal(await page.evaluate(() => window.__notesXss), undefined);
  assert.deepEqual(unexpectedRequests, []);
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  assert.equal(await readNotes(), hostileNotes);
  const notesDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
  const notesDownload = await notesDownloadPromise;
  assert.equal(await readFile(await notesDownload.path(), "utf8"), hostileNotes);
  await notesEditor.press("Control+End");
  await page.waitForTimeout(600); // 隔开两次用户编辑的撤销分组。
  await notesEditor.pressSequentially("UNDO-PROBE");
  await page.getByRole("button", { name: "预览笔记", exact: true }).click();
  await page.locator(".notes-rendered table").waitFor();
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await notesEditor.press("Control+z");
  assert.equal(await readNotes(), hostileNotes, "切换预览保留同一笔记的撤销历史");
  // 超限只停预览，不截断草稿。
  const longNotes = "x".repeat(256 * 1024 + 1);
  await notesEditor.fill(longNotes);
  await page.getByRole("button", { name: "预览笔记", exact: true }).click();
  await page.getByText("笔记过长，已暂停预览；原文仍可编辑和导出。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  const longDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
  const longDownload = await longDownloadPromise;
  assert.equal(await readFile(await longDownload.path(), "utf8"), longNotes, "检查完整导出，不把 CodeMirror 可见视口当作完整长文档");
  await notesEditor.fill(originalNotes);

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
    window.__inkAuthTest = { pending: [], cancelled: 0, judgeStarts: [], jobs: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "list_judgements") return window.__inkAuthTest.jobs;
      if (command === "start_judge") {
        window.__inkAuthTest.judgeStarts.push(args.snapshot);
        const job = { snapshot: args.snapshot, created: Date.now(), state: args.snapshot.kind === "submission"
          ? { state: "unknown", message: "测试：发送状态未知，未自动重发" }
          : { state: "waiting", server_id: "fixture-run-123" } };
        window.__inkAuthTest.jobs = [...window.__inkAuthTest.jobs, job];
        return job;
      }
      if (command === "check_judge") {
        const job = window.__inkAuthTest.jobs.find(j => j.snapshot.id === args.id);
        job.state = { state: "finished", server_id: "fixture-run-123", result: { status_code: 10, status_msg: "Accepted", code_output: ["3"], expected_output: ["3"] } };
        return job;
      }
      if (command === "acknowledge_unknown_judge") {
        const job = window.__inkAuthTest.jobs.find(j => j.snapshot.id === args.id);
        job.state = { state: "acknowledged", message: "测试：用户已核查，未重发" };
        return job;
      }
      if (command === "load_recent_questions") return [];
      if (command === "search_questions") return { total: 1, hasMore: false, questions: [{
        frontendQuestionId: "T1", title: "UI Test", titleCn: "题库测试样例", titleSlug: "fixture-test", difficulty: "Easy", paidOnly: false
      }] };
      if (command === "get_question") return { question: {
        questionId: "999909", questionFrontendId: "T1", title: "UI Test", translatedTitle: "题库测试样例", titleSlug: args.slug,
        translatedContent: '<p>仅测试题面</p><img src="x" onerror="window.__unsafeExecuted=true"><script>window.__unsafeExecuted=true</script><a href="javascript:alert(1)">不可执行链接</a><iframe srcdoc="unsafe"></iframe>',
        content: null, isPaidOnly: false, difficulty: "Easy", sampleTestCase: "[]", exampleTestcases: "[]", metaData: "{}",
        codeSnippets: [{ langSlug: "rust", code: "// official-shaped test template" }, { langSlug: "python3", code: "# test template" }]
      }, cacheWarning: null };
      if (command === "load_document") return { code: args.language === "java" ? "// restored Java draft" : null, notes: null };
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
  await authPage.getByRole("combobox", { name: "编程语言" }).selectOption("java");
  await fixtureEditor.waitFor();
  assert.equal(await fixtureEditor.innerText(), "// restored Java draft", "读取完成前不能挂载空模板并忽略恢复内容");
  // 以下仍为纯 UI 协议 fixture，不是真实力扣评测。
  await authPage.getByRole("button", { name: "登录力扣", exact: true }).click();
  await authPage.getByRole("button", { name: "已完成登录，校验会话", exact: true }).click();
  await authPage.waitForFunction(() => window.__inkAuthTest.pending.length === 3);
  await authPage.evaluate(() => window.__inkAuthTest.pending[2].resolve({ username: "fixture-user", account: "fixture-user", persistence: "memory-only" }));
  await authPage.getByRole("button", { name: "fixture-user · 退出", exact: true }).waitFor();
  await authPage.getByRole("button", { name: "运行", exact: true }).click();
  await authPage.getByText("评测编号：fixture-run-123", { exact: true }).waitFor();
  assert.equal(await authPage.getByRole("button", { name: "运行", exact: true }).isEnabled(), false);
  await fixtureEditor.fill("// changed after online snapshot");
  await authPage.getByText(/结果对应发起时的代码和用例快照/).waitFor();
  await authPage.getByText(/Accepted · 编号 fixture-run-123/).waitFor();
  assert.equal(await authPage.evaluate(() => window.__inkAuthTest.judgeStarts.length), 1);
  const sent = await authPage.evaluate(() => window.__inkAuthTest.judgeStarts[0]);
  assert.equal(sent.code, "// restored Java draft");
  await authPage.getByRole("button", { name: "提交", exact: true }).click();
  await authPage.getByRole("dialog", { name: "确认正式提交", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await authPage.getByText("测试：发送状态未知，未自动重发", { exact: true }).waitFor();
  assert.equal(await authPage.getByRole("button", { name: "提交", exact: true }).isEnabled(), false);
  await authPage.getByRole("button", { name: "我已核查官方记录", exact: true }).click();
  await authPage.getByRole("dialog", { name: "解除未知提交保护", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await authPage.getByText("测试：用户已核查，未重发", { exact: true }).waitFor();
  assert.equal(await authPage.evaluate(() => window.__inkAuthTest.judgeStarts.length), 2, "解除保护不能自动重发");
  assert.deepEqual(authErrors, []);
  await authPage.close();
  await writeFile("evidence/AUTH_UI_RESULT.txt", "PASS: mocked IPC only; cancel during verification, ignore stale success, explicit failure and recovery. NOT real login validation.\n");


  // 链接入口协议 fixture：测试竞态与草稿保护，不冒充真实中国站请求。
  const linkPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const linkErrors = [];
  linkPage.on("pageerror", error => linkErrors.push(error.message));
  await linkPage.addInitScript(() => {
    window.isTauri = true;
    window.__linkTest = { pending: [], saves: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "load_recent_questions") return [];
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text") { window.__linkTest.saves.push(args); return; }
      if (command === "get_question") return new Promise((resolve, reject) => {
        const slug = args.slug;
        const question = { questionId: slug === "alpha" ? "991" : "992", questionFrontendId: slug === "alpha" ? "L1" : "L2",
          title: slug, titleSlug: slug, translatedTitle: slug, content: "<p>链接测试样例</p>", translatedContent: null,
          isPaidOnly: false, difficulty: "Easy", sampleTestCase: "", exampleTestcases: "", metaData: "{}",
          codeSnippets: [{ langSlug: "rust", code: "// link fixture template" }] };
        window.__linkTest.pending.push({ slug, question, resolve, reject });
      });
      throw new Error("Unexpected link-test IPC command: " + command);
    }};
  });
  await linkPage.goto("http://127.0.0.1:5173");
  await linkPage.getByRole("button", { name: "链接打开", exact: true }).click();
  const linkField = linkPage.getByRole("textbox", { name: "力扣题目链接", exact: true });
  await linkField.fill("https://leetcode.cn.evil.example/problems/alpha/");
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.getByRole("alert").waitFor();
  assert.equal(await linkPage.evaluate(() => window.__linkTest.pending.length), 0, "错误域名不得发起 IPC 请求");
  await linkField.fill("https://leetcode.cn/problems/alpha/solutions/123/?share=discarded#ignored");
  await linkPage.locator("dialog form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 1);
  assert.equal(await linkPage.evaluate(() => window.__linkTest.pending[0].slug), "alpha");
  await linkField.fill("https://leetcode.cn/problems/beta/submissions/456/");
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 2);
  await linkPage.evaluate(() => { const p = window.__linkTest.pending[1]; p.resolve({ question: p.question, cacheWarning: null }); });
  await linkPage.locator("dialog.catalogue").waitFor({ state: "hidden" });
  await linkPage.getByRole("heading", { name: "beta", exact: true }).waitFor();
  await linkPage.evaluate(() => { const p = window.__linkTest.pending[0]; p.resolve({ question: p.question, cacheWarning: null }); });
  assert.equal(await linkPage.getByRole("heading", { name: "alpha", exact: true }).count(), 0, "迟到的旧请求不得切回旧题");
  await linkPage.getByRole("button", { name: "代码", exact: true }).click();
  const linkEditor = linkPage.getByRole("textbox", { name: "代码编辑器", exact: true });
  await linkEditor.fill("// preserved link draft");
  await linkPage.getByRole("button", { name: "链接打开", exact: true }).click();
  await linkField.fill("leetcode.cn/problems/beta/description/?new=ignored");
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 3);
  await linkPage.evaluate(() => { const p = window.__linkTest.pending[2]; p.resolve({ question: p.question, cacheWarning: null }); });
  await linkPage.locator("dialog.catalogue").waitFor({ state: "hidden" });
  await linkPage.getByRole("heading", { name: "beta", exact: true }).waitFor();
  await linkPage.getByRole("button", { name: "代码", exact: true }).click();
  assert.equal(await linkEditor.innerText(), "// preserved link draft", "重复链接不能用模板覆盖草稿");
  await linkPage.getByRole("button", { name: "链接打开", exact: true }).click();
  await linkField.fill("https://leetcode.cn/problems/alpha/");
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 4);
  await linkPage.evaluate(() => window.__linkTest.pending[3].reject(new Error("链接请求网络失败")));
  await linkPage.getByRole("alert").waitFor();
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 5);
  await linkPage.getByRole("button", { name: "关闭题库", exact: true }).click();
  await linkPage.evaluate(() => { const p = window.__linkTest.pending[4]; p.resolve({ question: p.question, cacheWarning: null }); });
  assert.equal(await linkEditor.innerText(), "// preserved link draft", "关闭后迟到成功不能切题或改动草稿");
  await linkPage.getByRole("button", { name: "链接打开", exact: true }).click();
  await linkField.fill("https://leetcode.cn/problems/alpha/");
  await linkPage.getByRole("button", { name: "打开题目", exact: true }).click();
  await linkPage.waitForFunction(() => window.__linkTest.pending.length === 6);
  await linkPage.evaluate(() => { const p = window.__linkTest.pending[5]; p.resolve({ question: { ...p.question, titleSlug: "wrong" }, cacheWarning: null }); });
  await linkPage.getByText("Error: 返回的题目与链接不一致，未切换题目", { exact: true }).waitFor();
  assert.equal(await linkPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "手机链接入口不能横向溢出");
  await linkPage.screenshot({ path: "evidence/mobile-link-validation.png", fullPage: true });
  await linkPage.getByRole("button", { name: "关闭题库", exact: true }).click();
  assert.equal(await linkEditor.innerText(), "// preserved link draft");
  assert.deepEqual(linkErrors, []);
  await linkPage.close();
  await writeFile("evidence/LINK_UI_RESULT.txt", "PASS: mock IPC only; invalid host no request, duplicate guard, stale request ignored, duplicate question preserves draft, explicit network failure/manual retry, cancel, mismatched response, mobile layout.\n");


  // Environment manager UI uses mocked IPC here; real downloads/LSP run in the separate four-platform probe.
  const envPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await envPage.addInitScript(() => {
    window.isTauri = true;
    window.__envTest = { starts: [], pending: [], tools: [
      { id: "python", version: "3.14.8", size: 30000000, downloaded: 0, phase: "missing", message: "" },
      { id: "node", version: "24.21.0", size: 50000000, downloaded: 50000000, phase: "ready", message: "" },
      { id: "pyright", version: "1.1.414", size: 4000000, downloaded: 4000000, phase: "ready", message: "" },
    ] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "load_recent_questions") return [];
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text") return;
      if (command === "environment_status") return JSON.parse(JSON.stringify({ platform: "linux-x64", supported: true, tools: window.__envTest.tools }));
      if (command === "install_environment") {
        window.__envTest.starts.push(args.id);
        window.__envTest.tools.find(t => t.id === args.id).phase = "downloading";
        return new Promise(resolve => window.__envTest.pending.push(resolve));
      }
      if (command === "cancel_environment_install") { window.__envTest.tools.find(t => t.id === args.id).phase = "canceled"; return; }
      throw new Error("Unexpected environment fixture command: " + command);
    }};
  });
  await envPage.goto("http://127.0.0.1:5173");
  await envPage.getByRole("button", { name: "代码", exact: true }).click();
  await envPage.getByRole("button", { name: "开发环境", exact: true }).click();
  const envDialog = envPage.getByRole("dialog", { name: "开发环境", exact: true });
  await envDialog.getByText("未安装", { exact: true }).waitFor();
  await envDialog.locator('[data-tool="python"] button').evaluate(button => { button.click(); button.click(); });
  await envPage.waitForFunction(() => window.__envTest.starts.length === 1);
  await envPage.evaluate(() => window.__envTest.pending[0]());
  await envDialog.getByText("下载中", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await envPage.getByRole("button", { name: "开发环境", exact: true }).click();
  await envDialog.getByText("下载中", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "取消", exact: true }).click();
  await envDialog.getByText("已取消", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "重试 / 修复", exact: true }).click();
  await envPage.waitForFunction(() => window.__envTest.starts.length === 2);
  await envPage.evaluate(() => { window.__envTest.tools[0].phase = "ready"; window.__envTest.pending[1](); });
  await envPage.waitForFunction(() => [...document.querySelectorAll(".environment-tools [role=status]")].every(e => e.textContent === "已安装"));
  assert.equal(await envPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await envPage.screenshot({ path: "evidence/managed-environment-mobile-ui.png", fullPage: true });
  await envPage.close();
  await writeFile("evidence/ENVIRONMENT_UI_RESULT.txt", "PASS: mocked IPC only; duplicate install guard, close/reopen during background download, cancellation, manual retry, mobile layout. Real installer/protocol verified separately.\n");


  const lspPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const lspErrors = []; lspPage.on("pageerror", error => lspErrors.push(error.message));
  await lspPage.addInitScript(() => {
    window.isTauri = true;
    window.__lspTest = { id: 0, version: 1, text: "", stops: [], requests: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__lspTest;
      if (command === "load_recent_questions") return [];
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text") return;
      if (command === "start_language_service") { state.text = args.text; state.version = 1; return { id: ++state.id, version: 1, server: "fixture", uri: "file:///fixture/solution.py" }; }
      if (command === "stop_language_service") { state.stops.push(args.id); return; }
      if (command === "update_language_document") { state.version = args.version; state.text = args.text; return; }
      if (command === "language_diagnostics") return { version: state.version, diagnostics: [] };
      if (command === "language_request") {
        state.requests.push(args);
        if (args.kind === "completion") return { items: [{ label: "popleft", kind: 2, documentation: "<img src=x onerror=alert(1)>plain documentation" }] };
        if (args.kind === "signatureHelp" && state.deferSignature) return new Promise(resolve => { state.signatureReply = resolve; });
        if (args.kind === "signatureHelp") return { signatures: [{ label: "popleft(index: int) -> int", documentation: "<img src=x onerror=alert(1)>signature docs", parameters: [{ label: "index" }] }], activeSignature: 0, activeParameter: 0 };
        if (args.kind === "hover") return { contents: { kind: "plaintext", value: "deque.popleft() -> int" } };
        if (args.kind === "definition") return [{ uri: "file:///fixture/stdlib/collections.pyi", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }];
      }
      if (command === "read_language_source") return { name: "collections.pyi", text: "class deque:\n    def popleft(self) -> int: ...", declaration: true };
      throw new Error("Unexpected LSP fixture command: " + command);
    }};
  });
  await lspPage.goto("http://127.0.0.1:5173");
  await lspPage.getByRole("combobox", { name: "编程语言", exact: true }).selectOption("python3");
  await lspPage.getByText("Pyright 已连接 · F12 / Ctrl+单击查看定义", { exact: true }).waitFor();
  const lspEditor = lspPage.getByRole("textbox", { name: "代码编辑器", exact: true });
  await lspEditor.fill("items.");
  await lspEditor.press("Control+Space");
  await lspPage.getByRole("option", { name: /popleft/ }).waitFor();
  await lspPage.getByRole("option", { name: /popleft/ }).click();
  assert.equal(await lspEditor.innerText(), "items.popleft");
  assert.equal(await lspPage.locator(".cm-tooltip img").count(), 0);
  await lspEditor.press("Control+Shift+Space");
  await lspPage.locator(".lsp-signature").waitFor();
  assert.match(await lspPage.locator(".lsp-signature").innerText(), /当前参数：1 \/ 1/);
  assert.equal(await lspPage.locator(".lsp-signature img").count(), 0);
  await lspEditor.press("Escape");
  await lspPage.locator(".lsp-signature").waitFor({ state: "hidden" });
  await lspPage.evaluate(() => { window.__lspTest.deferSignature = true; });
  await lspEditor.press("Control+Shift+Space");
  await lspPage.waitForFunction(() => typeof window.__lspTest.signatureReply === "function");
  await lspEditor.press("Escape");
  await lspPage.evaluate(() => window.__lspTest.signatureReply({ signatures: [{ label: "late signature", parameters: [] }] }));
  await lspPage.waitForTimeout(100);
  assert.equal(await lspPage.locator(".lsp-signature").count(), 0, "dismissed signature must not reappear from a late response");
  await lspPage.evaluate(() => { window.__lspTest.deferSignature = false; });

  await lspEditor.press("F12");
  const sourceDialog = lspPage.getByRole("dialog", { name: "collections.pyi", exact: true });
  await sourceDialog.waitFor();
  assert.match(await sourceDialog.innerText(), /不是运行时实现源码/);
  const readOnly = sourceDialog.getByLabel("只读标准库源码", { exact: true });
  const beforeSource = await readOnly.innerText();
  await readOnly.click(); await readOnly.press("x");
  assert.equal(await readOnly.innerText(), beforeSource);
  await sourceDialog.getByRole("button", { name: "返回代码", exact: true }).click();
  assert.equal(await lspEditor.innerText(), "items.popleft");
  await lspPage.getByRole("combobox", { name: "编程语言", exact: true }).selectOption("rust");
  await lspPage.waitForFunction(() => window.__lspTest.stops.length > 0);
  assert.deepEqual(lspErrors, []);
  await lspPage.close();
  await writeFile("evidence/LSP_UI_RESULT.txt", "PASS: mocked IPC integration; completion applied, unsafe completion docs remain text, F12 opens explicit read-only declaration, source draft preserved and session stopped on language switch. Native real-server check is separate.\n");


  const runPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const runErrors = []; runPage.on("pageerror", error => runErrors.push(error.message));
  await runPage.addInitScript(() => {
    window.isTauri = true;
    window.__runTest = { starts: [], result: null, pending: [], debug: null, debugStarts: 0, debugCalls: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__runTest;
      if (command === "load_recent_questions") return [];
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text" || command === "stop_language_service") return;
      if (command === "login_status") return null;
      if (command === "start_language_service") throw new Error("Language service intentionally absent in runner UI fixture");
      if (command === "debug_status") return state.debug ? JSON.parse(JSON.stringify(state.debug)) : null;
      if (command === "start_debug") {
        ++state.debugStarts; state.debugCode=args.snapshot.code;
        state.debug = { id: state.debugStarts, phase: "paused", title: args.snapshot.title, threadId: 1, epoch: 1, output: "", truncated: false, reason: "breakpoint", error: "", breakpoints: args.lines.map(line => ({ line, verified: true })) };
        return state.debug.id;
      }
      if (command === "set_debug_breakpoints") {
        if(args.code!==state.debugCode)throw new Error("Snapshot changed");
        state.debug.breakpoints=args.lines.map(line=>({line,verified:true}));
        state.breakpointUpdates=(state.breakpointUpdates??0)+1;return;
      }
      if (command === "stop_debug") { state.debug.phase = "finished"; state.debug.epoch++; return; }
      if (command === "debug_request") {
        state.debugCalls.push(args.kind);
        if (args.kind === "stackTrace") return { stackFrames: [{ id: 1, name: "solve", line: 1, source: { name: "solution.py", path: "/fixture/solution.py" } }] };
        if (args.kind === "scopes") return { scopes: [{ name: "Locals", variablesReference: 1 }] };
        if (args.kind === "variables") return { variables: [{ name: "values", value: "[3, -1, 8]", variablesReference: 0 }] };
        if (args.kind === "next") { state.debug.epoch++; return {}; }
        if (args.kind === "continue") { state.debug.phase = "finished"; state.debug.epoch++; return {}; }
        return {};
      }
      if (command === "local_run_status") return state.result ? JSON.parse(JSON.stringify(state.result)) : null;
      if (command === "start_local_run") {
        state.starts.push(JSON.parse(JSON.stringify(args.snapshot)));
        state.result = { id: state.starts.length, phase: "running", title: args.snapshot.title, stdout: "", stderr: "", results: [], exitCode: null, timedOut: false, canceled: false, truncated: false, elapsedMs: 0, error: "" };
        return new Promise(resolve => state.pending.push(() => resolve(state.result.id)));
      }
      if (command === "cancel_local_run") { state.result.phase = "finished"; state.result.canceled = true; return; }
      throw new Error("Unexpected local run fixture: " + command);
    }};
  });
  await runPage.goto("http://127.0.0.1:5173");
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("python3");
  await runPage.getByRole("button", { name: "本地", exact: true }).click();
  const runPanel = runPage.getByRole("region", { name: "本地运行", exact: true });
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => window.__runTest.starts.length === 1);
  await runPage.evaluate(() => window.__runTest.pending[0]());
  await runPanel.getByRole("button", { name: "停止", exact: true }).waitFor();
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).fill("def solve(values): return sum(values)");
  await runPanel.getByText("当前代码或用例已改变，下面是上一次快照的结果。", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "收起", exact: true }).click();
  await runPage.getByRole("button", { name: "本地", exact: true }).click();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  assert.equal(await runPage.evaluate(() => window.__runTest.starts.length), 1);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 2);
  await runPage.evaluate(() => window.__runTest.pending[1]());
  await runPage.evaluate(() => Object.assign(window.__runTest.result, { phase: "finished", exitCode: 0, results: ['{"case": 1, "ok": true, "value": 10, "exactInteger": 9007199254740993}'], stdout: "<img src=x onerror=alert(1)>", elapsedMs: 12 }));
  await runPanel.getByText(/"value": 10/).waitFor();
  assert.equal(await runPanel.locator("img").count(), 0);
  assert.match(await runPanel.innerText(), /9007199254740993/);
  assert.match(await runPanel.innerText(), /不代表通过力扣判题/);

  await runPanel.locator('[data-local-tab="debug"]').click();
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).press("F9");
  await runPanel.getByText(/断点：1。/).waitFor();
  await runPanel.getByRole("button", { name: "开始调试", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => window.__runTest.debugStarts === 1);
  await runPanel.getByText("已暂停 · breakpoint", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "values", exact: true }).waitFor();
  await runPage.locator(".cm-debug-stopped").waitFor();
  await runPage.getByRole("textbox", {name:"代码编辑器",exact:true}).press("F9");
  await runPanel.getByRole("button",{name:"应用断点",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.breakpointUpdates===1&&window.__runTest.debug.breakpoints.length===0);
  await runPanel.getByText("断点已更新",{exact:true}).waitFor();
  await runPage.getByRole("textbox", {name:"代码编辑器",exact:true}).press("F10");
  await runPage.waitForFunction(() => window.__runTest.debugCalls.includes("next"));
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).fill("def solve(values): return 0");
  await runPanel.getByText(/调试仍使用启动时快照/).waitFor();
  assert.equal(await runPanel.getByRole("button",{name:"应用断点",exact:true}).isDisabled(),true);
  await runPage.waitForFunction(() => !document.querySelector(".cm-debug-stopped"));
  await runPage.getByRole("textbox",{name:"代码编辑器",exact:true}).press("Shift+F5");
  await runPanel.getByText(/调试结束/).waitFor();
  assert.equal(await runPage.evaluate(() => window.__runTest.debugStarts), 1);
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("golang");
  assert.equal(await runPanel.locator('[data-local-tab="debug"]').isDisabled(), false);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 3);
  await runPage.evaluate(() => { window.__runTest.pending[2](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  assert.equal(await runPanel.getByRole("button", { name: "本地执行", exact: true }).isDisabled(), true);
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  assert.deepEqual(runErrors, []);
  await runPage.close();
  await writeFile("evidence/LOCAL_RUN_UI_RESULT.txt", "PASS: mocked IPC only; duplicate start prevention, immutable snapshot staleness, close/reopen ongoing job, cancellation, explicit manual rerun and plain-text output. Actual Python execution is independently verified.\n");

  await writeFile("evidence/UI_RESULT.txt", "PASS: frontend draft switching, notes editing, responsive layout, no page errors.\nScreenshots: Linux Chromium frontend preview; authored samples; NOT native app or real LeetCode.\n");
} finally { await browser.close(); server.kill(); }
