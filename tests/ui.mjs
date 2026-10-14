import { chromium } from "playwright";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

async function openSettings(page, category) {
  await page.locator('[data-action="open-settings"]').click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: category, exact: true }).click();
  return dialog;
}

const server = spawn("npm", ["run", "dev", "--", "--port", "5173"], { stdio: "inherit" });
const browser = await chromium.launch();
const fixtures = JSON.parse(await readFile(new URL("./fixtures/public-questions.json", import.meta.url), "utf8"));
async function testPage(options) {
  const page = await browser.newPage(options);
  await page.addInitScript(items => { window.__fixtureQuestions = items; }, fixtures);
  return page;
}
await mkdir("evidence", { recursive: true });
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:5173")).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  // Approval artwork is a separate document, never installed as the app identity.
  const iconReview = await browser.newPage({viewport:{width:900,height:380}});
  await iconReview.setContent(await readFile("docs/design/inkleet-icon-candidates.svg","utf8"));
  await iconReview.addStyleTag({content:"html,body{margin:0;padding:0}"});
  await iconReview.screenshot({path:"evidence/inkleet-icon-candidates.png"});
  await iconReview.close();
  for(const file of ["inkleet-icon-candidates.svg","inkleet-a.svg","inkleet-b.svg","inkleet-c.svg"]) await writeFile("evidence/"+file,await readFile("docs/design/"+file));
  // Fresh production startup has no built-in mock problem or hidden draft file.
  const cataloguePage = await testPage({ viewport:{width:1440,height:900} });
  await cataloguePage.addInitScript(() => {
    window.isTauri=true;
    window.__catalogueTest={requests:[],documents:[],saves:[]};
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      const state=window.__catalogueTest;
      if(command==="load_recent_questions") return [];
      if(command==="search_questions") return new Promise(resolve=>state.requests.push({args,resolve}));
      if(command==="get_question") return {question:{...window.__fixtureQuestions[0],titleSlug:args.slug},cacheWarning:null,fromCache:false};
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document"){state.documents.push(args);return {code:null,notes:null};}
      if(command==="save_text"){state.saves.push(args);return;}
      if(command==="external_editor_supported")return false;
      if(command==="open_login"||command==="cancel_login"||command==="stop_language_service")return;
      if(command==="verify_login")return {username:"catalogue-test",account:"account-A",persistence:"memory-only"};
      if(command==="list_judgements")return [];
      throw Error("No service in catalogue test: "+command);
    }};
  });
  await cataloguePage.goto("http://127.0.0.1:5173");
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===1);
  assert.equal(await cataloguePage.locator('[aria-label="代码编辑器"]').count(),0);
  assert.deepEqual(await cataloguePage.evaluate(()=>window.__catalogueTest.documents),[]);
  assert.equal(await cataloguePage.getByText("整数数组求和",{exact:true}).count(),0);
  assert.equal(await cataloguePage.getByRole("combobox",{name:"完成状态",exact:true}).isDisabled(),true);
  await cataloguePage.screenshot({path:"evidence/empty-workspace.png",fullPage:true});
  await cataloguePage.evaluate(()=>{
    const q=window.__fixtureQuestions[0];
    window.__catalogueTest.requests[0].resolve({questions:[{frontendQuestionId:q.questionFrontendId,title:q.title,titleCn:q.translatedTitle,titleSlug:q.titleSlug,difficulty:"Easy",paidOnly:false,status:null}],total:1,hasMore:false});
  });
  await cataloguePage.locator('.question-sidebar [data-slug="inkleet-test-fixture"]').click();
  await cataloguePage.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await cataloguePage.getByRole("textbox",{name:"代码编辑器",exact:true}).fill("// retained while filtering");
  assert.equal(await cataloguePage.getByRole("combobox",{name:"题目难度"}).evaluate(node => getComputedStyle(node).appearance),"none","compact select keeps semantic native control with quiet appearance");
  await cataloguePage.getByRole("combobox",{name:"题目难度"}).selectOption("EASY");
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===2);
  await cataloguePage.getByRole("textbox",{name:"搜索题目",exact:true}).fill("new");
  await cataloguePage.getByRole("button",{name:"搜索题库",exact:true}).click();
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===3);
  await cataloguePage.evaluate(()=>{
    const row={frontendQuestionId:"2",title:"New response",titleCn:null,titleSlug:"new-result",difficulty:"Easy",paidOnly:false,status:null};
    window.__catalogueTest.requests[2].resolve({questions:[row],total:1,hasMore:false});
    window.__catalogueTest.requests[1].resolve({questions:[{...row,title:"Old response",titleSlug:"old-result"}],total:1,hasMore:false});
  });
  await cataloguePage.locator('.question-sidebar [data-slug="new-result"]').waitFor();
  assert.equal(await cataloguePage.locator('.question-sidebar [data-slug="old-result"]').count(),0,"late filter response is discarded");
  assert.equal(await cataloguePage.getByRole("textbox",{name:"代码编辑器",exact:true}).innerText(),"// retained while filtering");
  assert.equal(await cataloguePage.evaluate(()=>window.__catalogueTest.requests[2].args.difficulty),"EASY");
  assert.equal(await cataloguePage.getByRole("button",{name:"登录力扣",exact:true}).locator("svg").count(),1,"login destination uses its SVG logo with accessible name");
  await cataloguePage.getByRole("button",{name:"登录力扣",exact:true}).click();
  assert.deepEqual(await cataloguePage.locator(".login-panel button").allTextContents(),["验证登录","取消登录"],"login panel retains verification and cancellation");
  assert.equal(await cataloguePage.locator(".login-panel p:not(.error)").count(),0,"login help lives in the manual");
  await cataloguePage.getByRole("button",{name:"验证登录",exact:true}).click();
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===4);
  assert.equal(await cataloguePage.evaluate(()=>window.__catalogueTest.requests[3].args.account),"account-A");
  await cataloguePage.getByRole("combobox",{name:"完成状态",exact:true}).selectOption("AC");
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===5);
  assert.equal(await cataloguePage.evaluate(()=>window.__catalogueTest.requests[4].args.status),"AC");
  await cataloguePage.getByRole("button",{name:"catalogue-test · 退出",exact:true}).click();
  await cataloguePage.waitForFunction(()=>window.__catalogueTest.requests.length===6);
  await cataloguePage.evaluate(()=>{
    const row={frontendQuestionId:"3",title:"Prior account private progress",titleCn:null,titleSlug:"prior-account",difficulty:"Easy",paidOnly:false,status:"AC"};
    window.__catalogueTest.requests[4].resolve({questions:[row],total:1,hasMore:false});
    window.__catalogueTest.requests[3].resolve({questions:[row],total:1,hasMore:false});
    window.__catalogueTest.requests[5].resolve({questions:[],total:0,hasMore:false});
  });
  await cataloguePage.getByText("没有匹配题目",{exact:true}).waitFor();
  assert.equal(await cataloguePage.locator('.question-sidebar [data-slug="prior-account"]').count(),0,"logout invalidates all old account responses");
  assert.equal(await cataloguePage.getByRole("combobox",{name:"完成状态",exact:true}).isDisabled(),true);
  assert.equal(await cataloguePage.evaluate(()=>window.__catalogueTest.requests[5].args.status),"");
  await cataloguePage.getByRole("group",{name:"题目列表",exact:true}).getByRole("button",{name:"最近",exact:true}).click();
  assert.equal(await cataloguePage.locator('[data-problem="lc-900000001"]').count(),1,"opened question remains reachable without a fabricated catalogue");
  await cataloguePage.close();
  await writeFile("evidence/REAL_CATALOGUE_UI_RESULT.txt","PASS: fixture IPC only; production empty startup, no synthetic document writes, filtered real-schema list, stale search and account-result isolation, source retained while filtering. Live account authentication is not verified.\n");

  const page = await testPage({ viewport: { width: 1440, height: 960 } });
  // Fixtures live exclusively in tests and enter through the same cache IPC as real metadata.
  await page.addInitScript(() => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "search_questions") return { questions:[],total:0,hasMore:false };
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code:null,notes:null };
      if (command === "save_text" || command === "stop_language_service") return;
      if (command === "external_editor_supported") return false;
      if (command === "login_status") return null;
      throw new Error("No native service in editor-only test fixture: " + command);
    }};
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  const editor = page.getByRole("textbox", { name: "代码编辑器", exact: true });
  await editor.waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button",{name:"测试用例与结果",exact:true}).locator("svg").count(),1,"test panel uses an accessible SVG toggle");
  await page.evaluate(async () => { await document.fonts.load('14px "Intel One Mono"'); await document.fonts.ready; });
  const fontLoaded = await page.evaluate(() => document.fonts.check('14px "Intel One Mono"'));
  assert.equal(fontLoaded, true, "必须实际加载内置 Intel One Mono");
  assert.ok((await editor.evaluate(el => getComputedStyle(el).fontFamily)).includes("Intel One Mono"));
  await openSettings(page, "编辑器");
  await page.getByRole("button", { name: "Intel One Mono", exact: true }).click();
  await page.getByRole("heading", { name: "Intel One Mono", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭字体说明", exact: true }).click();
  assert.equal(await page.locator(".editor-foot").count(), 0, "low-frequency actions are not permanently shown below the editor");
  const beforeSettings = await editor.innerText();
  const settingsDialog = await openSettings(page, "语言与环境");
  await settingsDialog.getByRole("textbox", { name: "搜索设置" }).fill("导出");
  assert.equal(await settingsDialog.getByRole("button", { name: "导出源码", exact: true }).count(), 1);
  assert.equal(await settingsDialog.getByRole("button", { name: "导出 Markdown", exact: true }).count(), 1);
  await page.screenshot({ path: "evidence/settings-search.png", fullPage: true });
  await page.keyboard.press("Escape");
  await settingsDialog.waitFor({ state: "hidden" });
  assert.equal(await page.locator('[data-action="open-settings"]').evaluate(el => el === document.activeElement), true, "closing settings restores its invoking focus");
  assert.equal(await editor.innerText(), beforeSettings, "settings navigation never recreates or replaces the draft");
  assert.equal(await page.locator('[data-action="open-settings"] svg[aria-hidden="true"]').count(), 1);
  await editor.fill("// Rust 独立草稿");
  await page.getByRole("combobox", { name: "编程语言" }).selectOption("python3");
  await editor.fill("def solve(values):");
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("return len(values)");
  assert.equal(await editor.innerText(), "def solve(values):\n    return len(values)", "Python Enter indents by four spaces");
  await editor.press("Home");
  await editor.press("Shift+Tab");
  assert.equal(await editor.innerText(), "def solve(values):\nreturn len(values)", "Shift+Tab dedents the current line");
  await editor.press("Tab");
  assert.equal(await editor.innerText(), "def solve(values):\n    return len(values)", "Tab indents without losing editor focus");
  await editor.press("Control+a"); await editor.press("Tab");
  assert.equal(await editor.innerText(), "    def solve(values):\n        return len(values)", "Tab indents every selected line");
  await editor.press("Shift+Tab");
  assert.equal(await editor.innerText(), "def solve(values):\n    return len(values)", "selected block dedents symmetrically");
  await editor.press("Escape"); await editor.press("Tab");
  assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), false, "Escape then Tab can leave the editor");
  await editor.fill("def solve(values):");
  await editor.press("End"); await editor.press("Enter");
  // This pause separates CodeMirror's documented 500 ms undo groups.
  // It is not a save-completion check; native persistence is asserted separately.
  await page.waitForTimeout(600);
  await editor.press("Backspace");
  assert.equal((await editor.locator(".cm-line").allTextContents()).join("\n"), "def solve(values):\n", "Backspace removes one indentation unit, not a single space");
  await editor.press("Control+z");
  assert.equal((await editor.locator(".cm-line").allTextContents()).join("\n"), "def solve(values):\n    ", "indent deletion is undoable");
  await editor.fill("name = name + 1");
  await editor.press("Control+Home"); await editor.press("Control+d"); await editor.press("Control+d");
  await editor.pressSequentially("value");
  assert.equal(await editor.innerText(), "value = value + 1", "multiple selections edit both occurrences");
  await editor.press("Control+z");
  assert.equal(await editor.innerText(), "name = name + 1", "multi-cursor edits share undo history");
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

  // Real rendered layout, including a narrow desktop code pane. Never clip controls
  // to hide an overflow failure: the solution menu and keyboard focus must remain usable.
  for (const width of [1440, 1100, 800]) {
    await page.setViewportSize({width,height:900});
    const geometry=await page.locator(".code-pane>.pane-heading").evaluate(heading=>{
      const outer=heading.getBoundingClientRect();
      const controls=[...heading.querySelectorAll("select,summary,.actions>button")].map(node=>{
        const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};
      });
      return {left:outer.left,right:outer.right,controls,scroll:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    assert.ok(geometry.controls.every(r=>r.width>15 && r.left>=geometry.left-1 && r.right<=geometry.right+1),"all editor toolbar controls stay inside pane at "+width);

    const ordered=[...geometry.controls].sort((a,b)=>a.left-b.left);
    assert.ok(ordered.every((r,i)=>i===0 || r.left>=ordered[i-1].right-1),"toolbar controls do not overlap at "+width);
    assert.ok(geometry.scroll<=geometry.viewport+1,"no page-level horizontal overflow at "+width);
    await page.locator(".solution-menu>summary").click();
    const menuAction=page.getByRole("button",{name:"复制解答",exact:true});
    await menuAction.click();
    await page.getByRole("dialog",{name:"复制解答",exact:true}).getByRole("button",{name:"取消",exact:true}).click();

  }
  await page.setViewportSize({width:1440,height:960});
  const editorSurface=await page.locator(".code-pane .cm-editor").evaluate(node=>getComputedStyle(node).backgroundColor);
  const gutterSurface=await page.locator(".code-pane .cm-gutters").evaluate(node=>getComputedStyle(node).backgroundColor);
  assert.equal(gutterSurface,editorSurface,"gutter shares editor surface instead of a second colored slab");
  await page.emulateMedia({forcedColors:"active",reducedMotion:"reduce"});
  assert.equal(await page.getByRole("combobox",{name:"编程语言"}).evaluate(node=>getComputedStyle(node).appearance),"auto","high-contrast mode restores native select affordance");
  await page.emulateMedia({forcedColors:"none",reducedMotion:"no-preference"});

  await page.screenshot({ path: "evidence/desktop-code.png", fullPage: true });
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown 笔记" }).fill("# 推导\n\n- 检查空数组\n- 时间复杂度 O(n)\n\n自编样例，非私人笔记。");
  for (const label of ["预览笔记", "笔记设置"]) {
    const iconBounds = await page.getByRole("button", { name: label, exact: true }).locator("svg").boundingBox();
    assert.ok(iconBounds && iconBounds.width >= 16 && iconBounds.height >= 16, "note action icons retain readable dimensions");
  }
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
  await openSettings(page, "笔记");
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
  await openSettings(page, "笔记");
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
  await openSettings(page, "源码");
  await page.getByRole("button", { name: "导出源码", exact: true }).click();
  const exported = await downloadPromise;
  const exportedText = await readFile(await exported.path(), "utf8");
  assert.equal(exportedText, large + " // performance probe 0123456789");
  await writeFile("evidence/PERFORMANCE.json", JSON.stringify(report, null, 2));
  assert.ok(report.inputToRafP95Ms < 100, "受控测试输入响应 P95 不应超过 100ms");
  assert.deepEqual(errors, []);

  // 仅模拟 IPC 的登录 UI 竞态测试；不冒充真实账号或原生登录验收。
  const authPage = await testPage();
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
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "search_questions") return { total: 1, hasMore: false, questions: [{
        frontendQuestionId: "T1", title: "UI Test", titleCn: "题库测试样例", titleSlug: "fixture-test", difficulty: "Easy", paidOnly: false
      }] };
      if (command === "get_question") return { question: {
        questionId: "999909", questionFrontendId: "T1", title: "UI Test", translatedTitle: "题库测试样例", titleSlug: args.slug,
        translatedContent: '<p>仅测试题面</p><img src="x" onerror="window.__unsafeExecuted=true"><script>window.__unsafeExecuted=true</script><a href="javascript:alert(1)">不可执行链接</a><iframe srcdoc="unsafe"></iframe>',
        content: null, isPaidOnly: false, difficulty: "Easy", sampleTestCase: "[]", exampleTestcases: "[]", metaData: "{}",
        codeSnippets: [{ langSlug: "rust", code: "// official-shaped test template" }, { langSlug: "python3", code: "# test template" }]
      }, cacheWarning: null };
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code: args.language === "java" ? "// restored Java draft" : null, notes: null };
      if (command === "open_login" || command === "save_text") return;
      if (command === "cancel_login") { window.__inkAuthTest.cancelled++; return; }
      if (command === "verify_login") return new Promise((resolve, reject) => window.__inkAuthTest.pending.push({ resolve, reject }));
      throw new Error("Unexpected test IPC command: " + command);
    }};
  });
  await authPage.goto("http://127.0.0.1:5173");
  await authPage.getByRole("button", { name: "登录力扣", exact: true }).click();
  await authPage.getByRole("button", { name: "验证登录", exact: true }).click();
  await authPage.waitForFunction(() => window.__inkAuthTest.pending.length === 1);
  const cancel = authPage.getByRole("button", { name: "取消登录", exact: true });
  assert.equal(await cancel.isEnabled(), true, "校验中仍必须可以取消");
  await cancel.click();
  await cancel.waitFor({ state: "hidden" });
  // 新登录开始后，旧校验的成功不能改变当前账号或关闭当前登录。
  await authPage.getByRole("button", { name: "登录力扣", exact: true }).click();
  await authPage.evaluate(() => window.__inkAuthTest.pending[0].resolve({ username: "stale-test-user", account: "stale", persistence: "memory-only" }));
  await authPage.getByRole("button", { name: "验证登录", exact: true }).waitFor();
  assert.equal(await authPage.getByText("stale-test-user", { exact: false }).count(), 0);
  await authPage.getByRole("button", { name: "验证登录", exact: true }).click();
  await authPage.waitForFunction(() => window.__inkAuthTest.pending.length === 2);
  await authPage.evaluate(() => window.__inkAuthTest.pending[1].reject(new Error("测试网络失败")));
  await authPage.getByText("Error: 测试网络失败", { exact: true }).waitFor();
  assert.equal(await cancel.isEnabled(), true);
  await cancel.click();
  await authPage.getByRole("button", { name: "中国站题库", exact: true }).click();
  await authPage.getByRole("textbox", { name: "搜索中国站题目" }).fill("test");
  await authPage.getByRole("button", { name: "搜索", exact: true }).click();
  await authPage.getByRole("dialog", { name: "中国站题库", exact: true }).getByRole("button", { name: /T1 题库测试样例/ }).click();
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
  await authPage.getByRole("button", { name: "验证登录", exact: true }).click();
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
  const linkPage = await testPage({ viewport: { width: 390, height: 844 } });
  const linkErrors = [];
  linkPage.on("pageerror", error => linkErrors.push(error.message));
  await linkPage.addInitScript(() => {
    window.isTauri = true;
    window.__linkTest = { pending: [], saves: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
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
  const envPage = await testPage({ viewport: { width: 390, height: 844 } });
  await envPage.addInitScript(() => {
    window.isTauri = true;
    window.__envTest = { starts: [], pending: [], groups: [], tools: [
      ...["go","gopls","delve"].map(id=>({id,version:"fixture",size:1000,downloaded:0,phase:"missing",message:""})),
      { id: "python", version: "3.14.8", size: 30000000, downloaded: 0, phase: "missing", message: "" },
      { id: "node", version: "24.21.0", size: 50000000, downloaded: 50000000, phase: "ready", message: "" },
      { id: "pyright", version: "1.1.414", size: 4000000, downloaded: 4000000, phase: "ready", message: "" },
    ] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text") return;
      if (command === "environment_status") return JSON.parse(JSON.stringify({ platform: "linux-x64", supported: true, tools: window.__envTest.tools }));
      if (command === "install_environment_group") {
        window.__envTest.groups.push(args.group);
        for(const tool of window.__envTest.tools) if(["go","gopls","delve"].includes(tool.id))tool.phase="queued";
        return;
      }
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
  await openSettings(envPage, "语言与环境");
  await envPage.getByRole("button", { name: "开发环境", exact: true }).click();
  const envDialog = envPage.getByRole("dialog", { name: "开发环境", exact: true });
  await envDialog.getByText("未安装", { exact: true }).waitFor();
  await envDialog.locator('[data-tool="python"] button').evaluate(button => { button.click(); button.click(); });
  await envPage.waitForFunction(() => window.__envTest.starts.length === 1);
  await envPage.evaluate(() => window.__envTest.pending[0]());
  await envDialog.getByText("下载中", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await openSettings(envPage, "语言与环境");
  await envPage.getByRole("button", { name: "开发环境", exact: true }).click();
  await envDialog.getByText("下载中", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "取消", exact: true }).click();
  await envDialog.getByText("已取消", { exact: true }).waitFor();
  await envDialog.getByRole("button", { name: "重试 / 修复", exact: true }).click();
  await envPage.waitForFunction(() => window.__envTest.starts.length === 2);
  await envPage.evaluate(() => { window.__envTest.tools.find(t=>t.id==="python").phase = "ready"; window.__envTest.pending[1](); });
  await envPage.waitForFunction(() => [...document.querySelectorAll(".environment-tools [role=status]")].every(e => e.textContent === "已安装"));
  assert.equal(await envPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await envPage.screenshot({ path: "evidence/managed-environment-mobile-ui.png", fullPage: true });
  await envDialog.getByRole("combobox",{name:"开发环境语言"}).selectOption("golang");
  await envDialog.locator(".environment-summary button").evaluate(button=>{button.click();button.click();});
  await envPage.waitForFunction(()=>window.__envTest.groups.length===1);
  await envDialog.getByRole("button",{name:"关闭",exact:true}).click();
  await envPage.evaluate(()=>{
    window.__envTest.tools.find(t=>t.id==="go").phase="ready";
    window.__envTest.tools.find(t=>t.id==="gopls").phase="building";
  });
  await openSettings(envPage, "语言与环境");
  await envPage.getByRole("button",{name:"开发环境",exact:true}).click();
  await envDialog.getByRole("combobox",{name:"开发环境语言"}).selectOption("golang");
  await envDialog.getByText("编译工具中",{exact:true}).waitFor();
  assert.equal(await envPage.evaluate(()=>window.__envTest.groups.length),1);
  await envPage.evaluate(()=>{for(const tool of window.__envTest.tools)tool.phase="ready";});
  await envPage.waitForFunction(()=>[...document.querySelectorAll(".environment-tools [role=status]")].every(e=>e.textContent==="已安装"));

  await envPage.close();
  await writeFile("evidence/ENVIRONMENT_UI_RESULT.txt", "PASS: mocked IPC only; duplicate install guard, close/reopen during background download, cancellation, manual retry, mobile layout. Real installer/protocol verified separately.\n");


  const lspPage = await testPage({ viewport: { width: 1440, height: 900 } });
  const lspErrors = []; lspPage.on("pageerror", error => lspErrors.push(error.message));
  await lspPage.addInitScript(() => {
    window.isTauri = true;
    window.__lspTest = { id: 0, version: 1, text: "", stops: [], requests: [], events: [], failNextUpdate: false, holdNextUpdate: false };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__lspTest;
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code: null, notes: null };
      if (command === "save_text") return;
      if (command === "start_language_service") { state.text = args.text; state.version = 1; return { id: ++state.id, version: 1, server: "fixture", uri: "file:///fixture/solution.py" }; }
      if (command === "stop_language_service") { state.stops.push(args.id); return; }
      if (command === "update_language_document") {
        if (state.failNextUpdate) { state.failNextUpdate=false; state.events.push({type:"update-failed",...args}); throw Error("controlled sync failure"); }
        if (state.holdNextUpdate) { state.holdNextUpdate=false; state.heldUpdateId=args.id; return new Promise((resolve,reject)=>{state.rejectHeldUpdate=()=>reject(Error("old session sync failure"));state.resolveHeldUpdate=()=>{state.events.push({type:"late-update-ack",...args});resolve();};}); }
        state.version=args.version; state.text=args.text; state.events.push({type:"update",...args}); return;
      }
      if (command === "language_diagnostics") return { version: state.version, diagnostics: [] };
      if (command === "language_request") {
        state.requests.push(args); state.events.push({type:"request",...args});
        if (args.kind === "references") {
          const result = { locations: [0,1].map(line => ({ range: { start: { line, character: 0 }, end: { line, character: 5 } } })), omitted: 1 };
          if (state.deferReferences) return new Promise(resolve => { state.referencesReply = () => resolve(result); });
          return result;
        }
        if (args.kind === "rename") {
          const result = [0,1].map(line => ({ range: { start: { line, character: 0 }, end: { line, character: 5 } }, newText: args.newName }));
          if (state.deferRename) return new Promise(resolve => { state.renameReply = () => resolve(result); });
          return result;
        }
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
  await lspPage.locator('.lsp-status[data-status="Pyright 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
  const lspEditor = lspPage.getByRole("textbox", { name: "代码编辑器", exact: true });
  await lspPage.evaluate(()=>{window.__lspTest.failNextUpdate=true;});
  await lspEditor.fill("failed.");
  await lspPage.waitForFunction(()=>window.__lspTest.events.some(e=>e.type==="update-failed"));
  await lspEditor.fill("items.");
  await lspEditor.press("Control+Space");
  await lspPage.getByRole("option", { name: /popleft/ }).waitFor();
  const completionOption = lspPage.getByRole("option", { name: /popleft/ });
  assert.equal(await completionOption.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + Math.min(15, rect.width / 2), rect.top + rect.height / 2);
    return !!hit && el.contains(hit);
  }), true, "completion is above adjacent panels and receives pointer events");
  assert.equal(await completionOption.evaluate(el => !!el.closest(".editor-host")), false, "completion tooltip lives outside clipping editor panels");
  await lspPage.waitForTimeout(150);
  await lspEditor.press("Tab");
  assert.equal(await lspEditor.innerText(), "items.popleft");
  assert.equal(await lspPage.evaluate(()=>{
    const events=window.__lspTest.events;
    const failed=events.findIndex(e=>e.type==="update-failed");
    const accepted=events.findIndex((e,i)=>i>failed&&e.type==="update"&&e.text==="items.");
    const request=events.findIndex((e,i)=>i>accepted&&e.type==="request"&&e.kind==="completion"&&e.version===events[accepted]?.version);
    return failed>=0&&accepted>failed&&request>accepted&&events[accepted].version>events[failed].version;
  }),true,"a failed sync does not poison later work; newest document is accepted before completion request");

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
  await lspEditor.fill("items = []\nitems.append(1)");
  await lspEditor.press("Control+Home");
  await lspEditor.press("ArrowRight");
  await lspEditor.press("F2");
  const renameForm = lspPage.getByRole("form", { name: "重命名符号", exact: true });
  await renameForm.getByRole("textbox", { name: "新名称", exact: true }).fill("values");
  await renameForm.getByRole("button", { name: "重命名", exact: true }).click();
  await lspPage.waitForFunction(() => document.querySelector('[aria-label="代码编辑器"]').innerText === "values = []\nvalues.append(1)");
  await lspEditor.press("Control+z");
  assert.equal(await lspEditor.innerText(), "items = []\nitems.append(1)", "rename must be one undoable transaction");
  await lspEditor.press("Control+Home"); await lspEditor.press("ArrowRight"); await lspEditor.press("Shift+F12");
  await lspPage.locator(".lsp-reference-list button").first().waitFor();
  assert.equal(await lspPage.locator(".lsp-reference-list button").count(), 2);
  assert.match(await lspPage.locator(".lsp-references").innerText(), /本题 2 处引用（含声明）/);
  assert.match(await lspPage.locator(".lsp-references").innerText(), /已省略 1 处/);
  await lspPage.locator('.lsp-reference-list button[data-reference-line="2"]').click();
  await lspPage.locator(".lsp-references").waitFor({ state: "hidden" });
  assert.equal(await lspEditor.innerText(), "items = []\nitems.append(1)", "reference navigation never edits source");
  assert.equal(await lspPage.evaluate(() => window.getSelection()?.toString()), "items", "reference click selects the original source occurrence");
  await lspPage.evaluate(() => { window.__lspTest.deferReferences = true; });
  await lspEditor.press("Shift+F12");
  await lspPage.waitForFunction(() => typeof window.__lspTest.referencesReply === "function");
  await lspEditor.press("Escape");
  await lspPage.evaluate(() => window.__lspTest.referencesReply());
  await lspPage.waitForTimeout(100);
  assert.equal(await lspPage.locator(".lsp-references").count(), 0, "dismissed references cannot reopen from a late response");
  await lspPage.evaluate(() => { window.__lspTest.deferReferences = false; });
  await lspPage.evaluate(() => { window.__lspTest.deferRename = true; });
  await lspEditor.press("Control+Home"); await lspEditor.press("ArrowRight"); await lspEditor.press("F2");
  await renameForm.getByRole("textbox", { name: "新名称", exact: true }).fill("late");
  await renameForm.getByRole("button", { name: "重命名", exact: true }).click();
  await lspPage.waitForFunction(() => typeof window.__lspTest.renameReply === "function");
  await renameForm.getByRole("button", { name: "取消", exact: true }).click();
  await lspEditor.fill("new draft");
  await lspPage.evaluate(() => window.__lspTest.renameReply());
  await lspPage.waitForTimeout(100);
  assert.equal(await lspEditor.innerText(), "new draft", "canceled/late rename must not overwrite a newer draft");
  await lspPage.evaluate(()=>{window.__lspTest.holdNextUpdate=true;});
  await lspEditor.fill("old session pending document");
  await lspPage.waitForFunction(()=>typeof window.__lspTest.rejectHeldUpdate==="function");
  const oldSession = await lspPage.evaluate(()=>window.__lspTest.id);
  const requestBoundary = await lspPage.evaluate(()=>window.__lspTest.requests.length);
  await lspPage.getByRole("combobox", { name: "编程语言", exact: true }).selectOption("rust");
  await lspPage.waitForFunction(() => window.__lspTest.stops.length > 0);
  await lspPage.waitForFunction(id=>window.__lspTest.id>id,oldSession);
  await lspPage.evaluate(()=>window.__lspTest.rejectHeldUpdate());
  await lspPage.waitForTimeout(200);
  assert.equal(await lspPage.evaluate(({id,from})=>window.__lspTest.requests.slice(from).some(r=>r.id===id),{id:oldSession,from:requestBoundary}),false,"destroyed session cannot issue requests after its late failed sync");

  const heldSuccessSession=await lspPage.evaluate(()=>{window.__lspTest.holdNextUpdate=true;window.__lspTest.heldUpdateId=null;return window.__lspTest.id;});
  await lspEditor.fill("held.");
  await lspPage.waitForFunction(id=>window.__lspTest.heldUpdateId===id,heldSuccessSession);
  await lspEditor.press("Control+Space");
  await lspPage.waitForTimeout(200);
  const heldSuccessBoundary=await lspPage.evaluate(()=>window.__lspTest.requests.length);
  await lspPage.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");
  await lspPage.waitForFunction(id=>window.__lspTest.id>id,heldSuccessSession);
  const replacementText=await lspEditor.innerText();
  await lspPage.evaluate(()=>window.__lspTest.resolveHeldUpdate());
  await lspPage.waitForTimeout(200);
  assert.equal(await lspPage.evaluate(({id,from})=>window.__lspTest.requests.slice(from).some(r=>r.id===id),{id:heldSuccessSession,from:heldSuccessBoundary}),false,"completion queued behind an old successful sync cannot escape after destroy");
  assert.equal(await lspEditor.innerText(),replacementText,"late sync acknowledgement cannot change replacement editor");
  assert.deepEqual(lspErrors, []);
  await lspPage.close();
  await writeFile("evidence/LSP_UI_RESULT.txt", "PASS: mocked IPC integration; completion applied, unsafe completion docs remain text, F12 opens explicit read-only declaration, source draft preserved and session stopped on language switch. Native real-server check is separate.\n");


  const runPage = await testPage({ viewport: { width: 1440, height: 900 } });
  const runErrors = []; runPage.on("pageerror", error => runErrors.push(error.message));
  await runPage.addInitScript(() => {
    window.isTauri = true;
    window.__runTest = { starts: [], result: null, pending: [], debug: null, debugStarts: 0, debugCalls: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__runTest;
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
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
      if (command === "evaluate_debug") {
        state.evaluations = (state.evaluations ?? 0) + 1;
        if (state.deferEvaluation) return new Promise(resolve => { state.evaluationReply = () => resolve({ result: "late result", variablesReference: 0 }); });
        return { result: "3", type: "int", variablesReference: 0 };
      }
      if (command === "debug_request") {
        state.debugCalls.push(args.kind);
        if (args.kind === "threads") return { threads: [{id: 1, name: "MainThread"}, {id: 2, name: "Worker"}] };
        if (args.kind === "stackTrace") return { stackFrames: [{ id: 1, name: "solve", line: 1, source: { name: "solution.py", path: "/fixture/solution.py" } }, { id: 0, name: "caller", line: 1, source: { name: "solution.py" } }] };
        if (args.kind === "scopes") return { scopes: [{ name: "Locals", variablesReference: args.reference === 0 ? 4 : 1 }] };
        if (args.kind === "variables") {
          if (args.reference === 4) return { variables: [{name: "caller_only", value: "42", variablesReference: 0}] };
          if (args.reference === 2 && state.deferVariables) return new Promise(resolve => { state.variablesReply = () => resolve({variables: [{name: "late_child", value: "stale", variablesReference: 0}]}); });
          if (args.reference === 2) return {variables: [{name: "0", value: "3", variablesReference: 0}, {name: "nested", value: "{x: 7}", variablesReference: 3}]};
          if (args.reference === 3) return {variables: [{name: "x", value: "7", variablesReference: 0}]};
          return { variables: [{ name: "values", value: "[3, -1, 8]", variablesReference: 2, indexedVariables: 3 }] };
        }
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
  assert.match(await runPanel.locator(".exit-code").getAttribute("title"), /不代表通过力扣判题/, "local result distinction remains available on hover");
  await runPanel.getByRole("button", { name: "运行与调试设置", exact: true }).click();
  assert.equal(await runPage.getByRole("dialog",{name:"设置",exact:true}).locator(".settings-reference").count(),0);
  await runPage.getByRole("button",{name:"使用手册",exact:true}).click();
  await runPage.getByRole("dialog",{name:"使用手册",exact:true}).getByText(/本地输出不代表力扣判题结论/).waitFor();
  await runPage.getByRole("button",{name:"关闭使用手册",exact:true}).click();
  await runPage.getByRole("button", { name: "关闭设置", exact: true }).click();

  await runPanel.locator('[data-local-tab="debug"]').click();
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).press("F9");
  await runPanel.getByText(/断点：1。/).waitFor();
  assert.equal(await runPanel.getByRole("button", {name:"开始调试",exact:true}).locator("svg[aria-hidden=true]").count(),1,"start uses accessible SVG");
  await runPanel.getByRole("button", { name: "开始调试", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => window.__runTest.debugStarts === 1);
  await runPanel.getByText("已暂停", { exact: true }).waitFor();
  assert.equal(await runPanel.getByText("已暂停", { exact: true }).getAttribute("title"), "breakpoint");
  assert.equal(await runPanel.getByRole("button", {name:"开始调试",exact:true}).count(),0,"active session has one primary execution control");
  for (const label of ["继续", "单步跳过", "单步进入", "单步跳出", "应用断点", "停止调试"]) {
    assert.equal(await runPanel.getByRole("button", { name: label, exact: true }).locator("svg[aria-hidden=true]").count(), 1, label + " has an accessible SVG control");
  }
  await runPage.screenshot({ path: "evidence/debug-svg-toolbar.png", fullPage: true });
  await runPanel.getByRole("button", { name: "values", exact: true }).waitFor();
  await runPage.locator(".cm-debug-stopped").waitFor();
  await runPanel.getByRole("textbox", { name: "调试表达式输入", exact: true }).fill("len(values)");
  await runPanel.getByRole("button", { name: "求值一次", exact: true }).click();
  await runPanel.locator(".debug-evaluation-result pre").filter({ hasText: "3" }).waitFor();
  assert.equal(await runPage.evaluate(() => window.__runTest.evaluations), 1);
  await runPanel.getByRole("button", {name: "values", exact: true}).click();
  await runPanel.getByRole("button", {name: "nested", exact: true}).click();
  await runPanel.getByRole("button", {name: "x", exact: true}).waitFor();
  assert.equal(await runPanel.getByRole("button", {name: "values", exact: true}).count(), 1, "expanding descendants preserves parent variable");
  await runPanel.getByRole("button", {name: "添加监视表达式", exact: true}).click();
  await runPanel.getByRole("button", {name: "刷新监视 len(values)", exact: true}).click();
  await runPage.waitForFunction(() => window.__runTest.evaluations === 2);
  assert.match(await runPanel.locator(".debug-watch").innerText(), /3/);

  assert.equal(await runPanel.getByRole("button",{name:"添加监视表达式",exact:true}).locator("svg[aria-hidden=true]").count(),1,"watch add uses the same accessible SVG control");
  assert.equal(await runPanel.locator(".debug-inspector>div").first().evaluate(node=>getComputedStyle(node).overflowY),"visible","inspector uses a single outer scroll surface");
  await runPage.screenshot({path: "evidence/debugger-variable-tree-watches.png", fullPage:true});
  await runPanel.getByRole("button", {name: "caller · 1", exact: true}).click();
  await runPanel.getByRole("button", {name: "caller_only", exact:true}).waitFor();
  const scalar=runPanel.getByRole("button",{name:"caller_only",exact:true});
  assert.equal(await scalar.isDisabled(),true,"scalar has no expansion action");
  assert.equal(await scalar.evaluate(node=>getComputedStyle(node).opacity),"1","scalar values remain legible despite having no expansion action");
  assert.equal(await runPanel.locator(".debug-frames>button").first().evaluate(node=>getComputedStyle(node).display),"flex","stack name and line occupy separate columns");
  // Pure layout stress fixture: temporarily lengthen the rendered breakpoint label.
  // This does not claim breakpoint protocol coverage; real F9 assertions remain below.
  const breakpointOverflow=await runPanel.locator(".debug-meta").evaluate(meta=>{
    const label=meta.querySelector(".breakpoint-summary"),previous=label.textContent;
    label.textContent="断点："+Array.from({length:100},(_,i)=>i+1).join(", ")+"。";
    const overflow=meta.scrollWidth>meta.clientWidth+1;
    label.textContent=previous;return overflow;
  });
  assert.equal(breakpointOverflow,false,"long breakpoint labels wrap without hiding the adjacent session state");

  assert.equal(await runPanel.getByRole("button", {name: "x", exact: true}).count(),0,"frame switch discards old child references");
  assert.match(await runPanel.locator(".debug-watch").innerText(), /—/, "watch never presents previous frame result as current");
  await runPanel.getByRole("button", {name: "solve · 1", exact:true}).click();
  await runPanel.getByRole("button", {name:"values",exact:true}).waitFor();
  await runPage.evaluate(() => { window.__runTest.deferVariables = true; });
  await runPanel.getByRole("button", {name:"values",exact:true}).click();
  await runPage.waitForFunction(() => typeof window.__runTest.variablesReply === "function");
  await runPanel.getByRole("button", {name:"caller · 1",exact:true}).click();
  await runPanel.getByRole("button", {name:"caller_only",exact:true}).waitFor();
  await runPage.evaluate(() => window.__runTest.variablesReply());
  assert.equal(await runPanel.getByRole("button", {name:"late_child",exact:true}).count(),0,"late child response discarded after frame switch");
  await runPage.evaluate(() => { window.__runTest.deferVariables = false; });
  await runPanel.getByRole("button", {name:"solve · 1",exact:true}).click();
  await runPanel.getByRole("button", {name:"values",exact:true}).waitFor();
  await runPage.evaluate(() => { window.__runTest.deferEvaluation = true; });
  await runPanel.getByRole("button", { name: "求值一次", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => typeof window.__runTest.evaluationReply === "function");
  assert.equal(await runPage.evaluate(() => window.__runTest.evaluations), 3, "duplicate expression evaluation must be blocked");
  assert.equal(await runPanel.getByRole("button", { name: "停止调试", exact: true }).isDisabled(), false, "stop remains available during evaluation");
  await runPage.evaluate(() => { window.__runTest.debug.epoch++; });
  await runPage.waitForTimeout(350);
  await runPage.evaluate(() => window.__runTest.evaluationReply());
  await runPage.waitForTimeout(100);
  assert.equal(await runPanel.locator(".debug-evaluation-result").count(), 0, "old pause evaluation cannot appear in a new pause");
  await runPage.evaluate(() => { window.__runTest.deferEvaluation = false; });

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
  await runPanel.locator('[data-local-tab="run"]').click();
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 3);
  await runPage.evaluate(() => { window.__runTest.pending[2](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  assert.equal(await runPanel.getByRole("button", { name: "本地执行", exact: true }).isDisabled(), true);
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("cpp");
  assert.equal(await runPanel.locator('[data-local-tab="debug"]').isDisabled(), false);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 4);
  await runPage.evaluate(() => { window.__runTest.pending[3](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("c");
  assert.equal(await runPanel.locator('[data-local-tab="debug"]').isDisabled(), false);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 5);
  await runPage.evaluate(() => { window.__runTest.pending[4](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("rust");
  assert.equal(await runPanel.locator('[data-local-tab="debug"]').isDisabled(), false);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 6);
  await runPage.evaluate(() => { window.__runTest.pending[5](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("java");
  assert.equal(await runPanel.locator('[data-local-tab="debug"]').isDisabled(), false);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 7);
  await runPage.evaluate(() => { window.__runTest.pending[6](); window.__runTest.result.phase = "compiling"; });
  await runPanel.getByText("编译中…", { exact: true }).waitFor();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  assert.deepEqual(runErrors, []);
  await runPage.close();
  await writeFile("evidence/LOCAL_RUN_UI_RESULT.txt", "PASS: mocked IPC only; duplicate start prevention, immutable snapshot staleness, close/reopen ongoing job, cancellation, explicit manual rerun and plain-text output. Actual Python execution is independently verified.\n");


  const conflictPage = await testPage({ viewport: { width: 1400, height: 900 } });
  const conflictErrors = []; conflictPage.on("pageerror", e => conflictErrors.push(e.message));
  await conflictPage.addInitScript(() => {
    window.isTauri = true; window.__conflictTest = { file: "initial", backups: [] };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__conflictTest;
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code: state.file, notes: "" };
      if (command === "login_status") return null;
      if (command === "start_language_service") throw Error("LSP omitted from conflict fixture");
      if (command === "stop_language_service") return;
      if (command === "save_text") {
        if (args.expected !== state.file) throw Error("外部文件已变化，保留两份内容后再处理");
        state.file = args.text; return;
      }
      if (command === "list_recovery") return { entries: state.backups.map((_, i) => ({ id: "conflict-" + i + ".json", modified: 1, bytes: 200 })), unreadable: 0 };
      if (command === "read_recovery") return { format: "inkleet-conflict-v1", file: "solution.rs", choice: "local", ...state.backups[Number(args.id.match(/conflict-([0-9]+)/)[1])] };
      if (command === "restore_recovery") {
        if (args.expected !== state.file) throw Error("外部文件再次变化，请刷新对比后重试");
        const selected = state.backups[Number(args.id.match(/conflict-([0-9]+)/)[1])][args.side];
        if (selected !== args.reviewed) throw Error("恢复副本已变化");
        state.backups.push({ local: args.local, external: state.file });
        state.file = selected ?? "";
        return { text: state.file, backup: "new-backup.json" };
      }
      if (command === "resolve_file_conflict") {
        if (args.expected !== state.file) throw Error("外部文件再次变化，请刷新对比后重试");
        state.backups.push({ local: args.local, external: state.file });
        if (args.choice === "local") state.file = args.local;
        return { text: state.file, backup: "fixture.json" };
      }
      throw Error("Unexpected conflict fixture: " + command);
    }};
  });
  await conflictPage.goto("http://127.0.0.1:5173");
  const conflictEditor = conflictPage.getByRole("textbox", { name: "代码编辑器", exact: true });
  await conflictPage.locator('.statusbar[data-storage-state="已读取本机文件"]').waitFor();
  assert.equal(await conflictPage.locator(".statusbar").innerText(),"","successful file loading adds no persistent sentence");
  assert.equal(await conflictPage.getByText("在线评测需要登录中国站",{exact:true}).count(),0,"login explanation is not permanent workbench clutter");
  await conflictPage.evaluate(() => { window.__conflictTest.file = "external"; });
  await conflictEditor.fill("local draft");
  await conflictPage.locator('[data-action="review-code-conflict"]').waitFor();
  await conflictPage.locator('[data-action="review-code-conflict"]').click();
  const conflictDialog = conflictPage.getByRole("dialog", { name: "源码文件冲突", exact: true });
  assert.equal(await conflictDialog.getByLabel("冲突编辑器版本").inputValue(), "local draft");
  assert.equal(await conflictDialog.getByLabel("冲突文件版本").inputValue(), "external");
  await conflictPage.evaluate(() => { window.__conflictTest.file = "changed again"; });
  await conflictDialog.getByRole("button", { name: "使用编辑器版本", exact: true }).click();
  await conflictDialog.getByRole("alert").filter({ hasText: "外部文件再次变化" }).waitFor();
  assert.equal(await conflictPage.evaluate(() => window.__conflictTest.file), "changed again");
  await conflictDialog.getByRole("button", { name: "刷新对比", exact: true }).click();
  await conflictPage.waitForFunction(() => document.querySelector('[aria-label="冲突文件版本"]').value === "changed again");
  await conflictDialog.getByRole("button", { name: "使用编辑器版本", exact: true }).click();
  await conflictDialog.waitFor({ state: "hidden" });
  assert.equal(await conflictEditor.innerText(), "local draft");
  assert.deepEqual(await conflictPage.evaluate(() => window.__conflictTest.backups), [{ local: "local draft", external: "changed again" }]);
  await conflictPage.evaluate(() => { window.__conflictTest.file = null; });
  await conflictEditor.fill("new local draft");
  await conflictPage.locator('[data-action="review-code-conflict"]').waitFor();
  await conflictPage.locator('[data-action="review-code-conflict"]').click();
  await conflictDialog.getByText("文件版本（已删除）", { exact: true }).waitFor();
  await conflictDialog.getByRole("button", { name: "使用文件版本", exact: true }).click();
  await conflictDialog.waitFor({ state: "hidden" });
  assert.equal(await conflictEditor.textContent(), "", "empty CodeMirror line must contain no source characters");
  assert.equal(await conflictPage.evaluate(() => window.__conflictTest.file), null);
  await conflictEditor.fill("after recovery");
  await conflictPage.waitForFunction(() => window.__conflictTest.file === "after recovery");
  await openSettings(conflictPage, "源码");
  await conflictPage.locator('[data-action="code-recovery"]').click();
  const recoveryDialog = conflictPage.getByRole("dialog", { name: "源码恢复副本", exact: true });
  await recoveryDialog.locator('[data-recovery-id="conflict-0.json"]').click();
  assert.equal(await recoveryDialog.getByLabel("恢复编辑器副本").inputValue(), "local draft");
  assert.equal(await recoveryDialog.getByLabel("恢复文件副本").inputValue(), "changed again");
  await conflictPage.evaluate(() => { window.__conflictTest.file = "new outside edit"; });
  await recoveryDialog.locator('[data-recovery="local"]').click();
  await recoveryDialog.getByRole("alert").filter({ hasText: "外部文件再次变化" }).waitFor();
  assert.equal(await conflictEditor.innerText(), "after recovery");
  await recoveryDialog.locator('[data-recovery="refresh"]').click();
  await recoveryDialog.locator('[data-recovery-id="conflict-0.json"]').click();
  await recoveryDialog.locator('[data-recovery="local"]').click();
  await recoveryDialog.waitFor({ state: "hidden" });
  assert.equal(await conflictEditor.innerText(), "local draft");
  assert.equal(await conflictPage.evaluate(() => window.__conflictTest.file), "local draft");
  assert.deepEqual(await conflictPage.evaluate(() => window.__conflictTest.backups.at(-1)), { local: "after recovery", external: "new outside edit" });
  assert.deepEqual(conflictErrors, []);
  await conflictPage.close();
  await writeFile("evidence/CONFLICT_UI_RESULT.txt", "PASS: mocked IPC conflict comparison, stale external refusal, explicit resolution with both-version backup, deleted-file choice, editor reload and resumed saving. Native storage checked separately.\n");


  const externalPage = await testPage({ viewport: { width: 1400, height: 900 } });
  await externalPage.addInitScript(() => {
    window.isTauri = true; window.__externalTest = { notes: "# Before", opened: [], fail: false };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__externalTest;
      if (command === "external_editor_supported") return true;
      if (command === "search_questions") return {questions:[],total:0,hasMore:false};
      if (command === "load_recent_questions") return window.__fixtureQuestions;
      if (command === "list_solutions") return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if (command === "load_document") return { code: "original code", notes: state.notes };
      if (command === "login_status") return null;
      if (command === "start_language_service") throw Error("No LSP in external editor fixture");
      if (command === "stop_language_service") return;
      if (command === "save_text") {
        if (args.kind === "notes") {
          if (state.fail || args.expected !== state.notes) throw Error("保存测试失败");
          state.notes = args.text;
        } return;
      }
      if (command === "open_note_external") { state.opened.push({ editor: args.editor, saved: state.notes }); return; }
      throw Error("Unexpected external editor command: " + command);
    }};
  });
  await externalPage.goto("http://127.0.0.1:5173");
  await externalPage.locator('.statusbar[data-storage-state="已读取本机文件"]').waitFor();
  await externalPage.getByRole("button", { name: "笔记", exact: true }).click();
  const externalNote = externalPage.getByRole("textbox", { name: "Markdown 笔记", exact: true });
  await externalNote.fill("# Saved");
  await openSettings(externalPage, "笔记");
  await externalPage.getByRole("button", { name: "Typora 编辑", exact: true }).click();
  await externalPage.waitForFunction(() => window.__externalTest.opened.length === 1);
  assert.deepEqual(await externalPage.evaluate(() => window.__externalTest.opened), [{ editor: "typora", saved: "# Saved" }]);
  await externalPage.evaluate(() => { window.__externalTest.notes = "# From Typora"; });
  await openSettings(externalPage, "笔记");
  await externalPage.getByRole("button", { name: "刷新文件", exact: true }).click();
  await externalPage.waitForFunction(() => document.querySelector('[aria-label="Markdown 笔记"]').innerText === "# From Typora");
  assert.equal(await externalPage.getByRole("textbox", { name: "代码编辑器", exact: true }).innerText(), "original code");
  await externalPage.evaluate(() => { window.__externalTest.notes = "# Focus refresh"; window.dispatchEvent(new Event("focus")); });
  await externalPage.waitForFunction(() => document.querySelector('[aria-label="Markdown 笔记"]').innerText === "# Focus refresh");
  await externalPage.evaluate(() => { window.__externalTest.fail = true; });
  await externalNote.fill("# Unsaved");
  await externalPage.locator('[data-action="review-notes-conflict"]').waitFor();
  await externalPage.evaluate(() => { window.__externalTest.notes = "# Concurrent external"; });
  await openSettings(externalPage, "笔记");
  await externalPage.getByRole("button", { name: "刷新文件", exact: true }).click();
  await externalPage.locator(".statusbar").filter({ hasText: "外部笔记已变化 · 请对比两份内容后处理" }).waitFor();
  assert.equal(await externalNote.innerText(), "# Unsaved");
  await openSettings(externalPage, "笔记");
  await externalPage.getByRole("button", { name: "Typora 编辑", exact: true }).click();
  await externalPage.locator(".statusbar").filter({ hasText: "请先处理笔记保存失败或文件冲突" }).waitFor();
  assert.equal(await externalPage.evaluate(() => window.__externalTest.opened.length), 1);
  await externalPage.close();
  await writeFile("evidence/EXTERNAL_EDITOR_UI_RESULT.txt", "PASS: mocked IPC save-before-open, explicit Typora selection, focused/manual note refresh, source preservation and dirty-conflict refusal. Real Typora launching is not verified by this fixture.\n");

  const proxyPage=await testPage({viewport:{width:1100,height:800}});
  await proxyPage.addInitScript(()=>{
    window.isTauri=true;
    window.__proxyTest={settings:{version:1,proxy:{mode:"system",url:""}},revision:null,writes:[],fail:false};
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      const state=window.__proxyTest;
      if(command==="load_recent_questions")return [];
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="external_editor_supported")return false;
      if(command==="get_download_settings")return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));
      if(command==="save_download_settings"){
        state.writes.push(args);
        if(state.fail)throw Error("测试：磁盘写入失败");
        if(args.expected!==state.revision)throw Error("配置已变化");
        state.settings={version:1,proxy:{mode:args.proxy.mode,url:args.proxy.mode==="custom"?args.proxy.url:""}};
        state.revision=JSON.stringify(state.settings);
        return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));
      }
      throw Error("Unexpected proxy test IPC: "+command);
    }};
  });
  await proxyPage.goto("http://127.0.0.1:5173");
  await openSettings(proxyPage,"下载");
  const proxyMode=proxyPage.getByLabel("连接方式",{exact:true});
  await proxyMode.selectOption("custom");
  const proxyUrl=proxyPage.getByLabel("HTTP / HTTPS 地址",{exact:true});
  await proxyUrl.fill("http://127.0.0.1:7890");
  await proxyPage.screenshot({path:"evidence/download-proxy-settings.png",fullPage:true});
  await proxyPage.getByRole("button",{name:"保存下载设置",exact:true}).evaluate(button=>{button.click();button.click();});
  await proxyPage.getByText("已保存，下次下载生效",{exact:true}).waitFor();
  assert.equal(await proxyPage.evaluate(()=>window.__proxyTest.writes.length),1,"duplicate save guarded");
  await proxyPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await openSettings(proxyPage,"下载");
  assert.equal(await proxyUrl.inputValue(),"http://127.0.0.1:7890");
  await proxyPage.evaluate(()=>{window.__proxyTest.fail=true;});
  await proxyUrl.fill("http://127.0.0.1:7891");
  await proxyPage.getByRole("button",{name:"保存下载设置",exact:true}).click();
  await proxyPage.getByRole("alert").filter({hasText:"磁盘写入失败"}).waitFor();
  assert.equal(await proxyUrl.inputValue(),"http://127.0.0.1:7891","failed save retains typed input");
  assert.equal(await proxyPage.evaluate(()=>window.__proxyTest.settings.proxy.url),"http://127.0.0.1:7890","failed save keeps prior settings");
  await proxyPage.evaluate(()=>{window.__proxyTest.fail=false;});
  await proxyPage.getByRole("button",{name:"重新读取",exact:true}).click();
  await proxyPage.waitForFunction(()=>document.querySelector("#download-proxy-url").value==="http://127.0.0.1:7890");
  await proxyMode.selectOption("direct");
  await proxyPage.getByRole("button",{name:"保存下载设置",exact:true}).click();
  await proxyPage.getByText("已保存，下次下载生效",{exact:true}).waitFor();
  assert.deepEqual(await proxyPage.evaluate(()=>window.__proxyTest.settings.proxy),{mode:"direct",url:""});
  await proxyPage.close();
  await writeFile("evidence/DOWNLOAD_SETTINGS_UI_RESULT.txt","PASS: mocked IPC; save/reopen, duplicate-save guard, visible failure retaining prior settings and draft, reload and direct mode. Native proxy routing/persistence tested separately.\n");


  const solutionsPage=await testPage({viewport:{width:1440,height:900}});
  await solutionsPage.addInitScript(()=>{
    window.isTauri=true;
    const state=window.__solutionsTest={entries:{},docs:{},notes:null,writes:[],creates:0,fail:false};
    const group=args=>JSON.stringify([args.problem,args.language]);
    const key=args=>JSON.stringify([args.problem,args.language,args.solution??"default"]);
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="external_editor_supported")return false;
      if(command==="login_status")return null;
      if(command==="stop_language_service")return;
      if(command==="start_language_service")throw Error("No language server in named-solution fixture");
      if(command==="list_solutions")return {entries:state.entries[group(args)]??[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return {code:state.docs[key(args)]??null,notes:state.notes};
      if(command==="save_text"){
        state.writes.push({...args});
        if(args.kind==="notes"){state.notes=args.text;return;}
        if((state.docs[key(args)]??null)!==args.expected)throw Error("External source conflict");
        state.docs[key(args)]=args.text;return;
      }
      if(command==="create_solution"){
        ++state.creates;if(state.fail)throw Error("磁盘写入失败");
        const entry={id:args.id,name:args.name};
        state.entries[group(args)]=[...(state.entries[group(args)]??[{id:"default",name:"默认解答"}]),entry];
        state.docs[JSON.stringify([args.problem,args.language,args.id])]=args.code;return entry;
      }
      if(command==="rename_solution"){
        const list=state.entries[group(args)]??[{id:"default",name:"默认解答"}];
        const current=list.find(item=>item.id===args.id);if(current.name!==args.expected)throw Error("名称已变化");
        current.name=args.name;state.entries[group(args)]=list;return current;
      }
      throw Error("Unexpected named-solution command "+command);
    }};
  });
  await solutionsPage.goto("http://127.0.0.1:5173");
  const solutionCode=solutionsPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await solutionCode.fill("// default source");
  await solutionsPage.waitForFunction(()=>window.__solutionsTest.writes.some(w=>w.text==="// default source"));
  async function namedAction(action,name){
    await solutionsPage.locator(".solution-menu>summary").click();
    await solutionsPage.getByRole("button",{name:action,exact:true}).click();
    const dialog=solutionsPage.getByRole("dialog",{name:action,exact:true});
    await dialog.getByRole("textbox",{name:"解答名称",exact:true}).fill(name);
    await dialog.getByRole("button",{name:"保存",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
  }
  await namedAction("复制解答","双指针");
  const first=await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).inputValue();
  assert.match(first,/^[a-f0-9]{32}$/);
  assert.equal(await solutionCode.innerText(),"// default source","copy is the captured draft");
  await solutionCode.fill("// named source");
  await solutionsPage.waitForFunction(()=>window.__solutionsTest.writes.some(w=>w.text==="// named source"));
  await namedAction("重命名","优化版");
  assert.equal(await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).inputValue(),first,"rename preserves immutable ID");
  await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).selectOption("default");
  assert.equal(await solutionCode.innerText(),"// default source");
  await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).selectOption(first);
  assert.equal(await solutionCode.innerText(),"// named source");
  await solutionsPage.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");
  assert.equal(await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).inputValue(),"default");
  await solutionsPage.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("rust");
  await solutionsPage.waitForFunction(()=>document.querySelector('select[aria-label="解答"]').selectedOptions[0]?.text==="优化版");
  assert.equal(await solutionCode.innerText(),"// named source");
  await solutionsPage.screenshot({path:"evidence/named-solutions-browser.png",fullPage:true});
  await solutionsPage.locator(".solution-menu>summary").click();
  await solutionsPage.getByRole("button",{name:"复制解答",exact:true}).click();
  const duplicate=solutionsPage.getByRole("dialog",{name:"复制解答",exact:true});
  await duplicate.getByRole("textbox",{name:"解答名称",exact:true}).fill("优化版");
  await duplicate.getByRole("button",{name:"保存",exact:true}).click();
  await duplicate.getByRole("alert").filter({hasText:"同名"}).waitFor();
  assert.equal(await solutionsPage.evaluate(()=>window.__solutionsTest.creates),1,"duplicate name does not invoke creation");
  await duplicate.getByRole("textbox",{name:"解答名称",exact:true}).fill("磁盘失败");
  await solutionsPage.evaluate(()=>{window.__solutionsTest.fail=true;});
  await duplicate.getByRole("button",{name:"保存",exact:true}).click();
  await duplicate.getByRole("alert").filter({hasText:"磁盘写入失败"}).waitFor();
  assert.equal(await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).inputValue(),first);
  await duplicate.getByRole("button",{name:"取消",exact:true}).click();
  assert.equal(await solutionCode.innerText(),"// named source","failed creation preserves selected draft");
  await solutionsPage.close();
  await writeFile("evidence/NAMED_SOLUTIONS_UI_RESULT.txt","PASS: mocked IPC copy snapshot, rename identity, independent source, language switching, duplicate-name rejection and disk failure preserving draft; native disk/restart tested separately.\n");

  await writeFile("evidence/UI_RESULT.txt", "PASS: frontend draft switching, notes editing, responsive layout, no page errors.\nScreenshots: Linux Chromium frontend preview; authored samples; NOT native app or real LeetCode.\n");
} finally { await browser.close(); server.kill(); }
