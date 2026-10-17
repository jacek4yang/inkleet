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
  await page.addInitScript(items => {
    window.__fixtureQuestions = items;
    // Unrelated fixtures explicitly disable formatting; its dedicated fixture below
    // exercises the real default-on path, timer, worker, settings and failures.
    let internals;
    Object.defineProperty(window,"__TAURI_INTERNALS__",{
      configurable:true,get:()=>internals,set:value=>{
        const invoke=value.invoke;
        internals={...value,invoke:(command,args)=>{
          if(command==="login_status"&&!window.__authRestoreTest)return Promise.resolve(null);
          if(command==="begin_draft_session"&&!window.__recoveryTest)return Promise.resolve(1);
          if(command==="checkpoint_draft"&&!window.__recoveryTest)return Promise.resolve();
          if(command==="get_editor_settings"&&!window.__formatTest&&!window.__vimTest)return Promise.resolve({settings:{version:1,formatOnSave:false,overrides:{}},revision:null});
          return invoke(command,args);
        }};
      }
    });
  }, fixtures);
  return page;
}
await mkdir("evidence", { recursive: true });
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:5173")).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  // Preserve the original approval sheet as history; only owner-approved C is adopted.
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
      if(command==="get_question") return {question:{...window.__fixtureQuestions[0],titleSlug:args.slug,...(state.updatedStatement?{translatedContent:state.updatedStatement}:{})},cacheWarning:null,fromCache:false};
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
  await cataloguePage.evaluate(()=>{window.__catalogueTest.updatedStatement="<p>Refreshed same-question statement</p>";});
  await cataloguePage.locator('.question-sidebar [data-slug="inkleet-test-fixture"]').click();
  await cataloguePage.getByText("Refreshed same-question statement",{exact:true}).waitFor();
  assert.equal(await cataloguePage.getByRole("textbox",{name:"代码编辑器",exact:true}).innerText(),"// retained while filtering","same question refresh updates memoized statement without replacing draft");
  assert.equal(await cataloguePage.locator('.question-sidebar [data-slug="inkleet-test-fixture"]').getAttribute("aria-current"),"page");
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
  assert.equal(await page.getByRole("img",{name:"墨题 InkLeet",exact:true}).locator("svg").count(),1,"owner-approved C replaces the visible wordmark");
  assert.ok((await editor.evaluate(el => getComputedStyle(el).fontFamily)).includes("Intel One Mono"));
  await openSettings(page, "编辑器");
  await page.getByRole("button", { name: "Intel One Mono", exact: true }).click();
  await page.getByRole("heading", { name: "Intel One Mono", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭字体说明", exact: true }).click();
  assert.equal(await page.locator(".editor-foot").count(), 0, "low-frequency actions are not permanently shown below the editor");
  assert.equal(await page.locator(".code-pane > .lsp-status").count(),0,"LSP never overlays save toolbar");
  assert.equal(await page.locator(".statusbar > .lsp-status").count(),1,"LSP belongs to global status");
  const saveBounds=await page.getByRole("button",{name:"保存源码",exact:true}).boundingBox();
  const lspBounds=await page.locator(".statusbar > .lsp-status").boundingBox();
  assert.ok(lspBounds.y>=saveBounds.y+saveBounds.height,"LSP and save hit targets are separate");
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
        job.state = { state: "finished", server_id: "fixture-run-123", result: { status_code: 10, status_msg: "Accepted", code_answer: ["3"], expected_code_answer: ["3"], code_output: ["debug text"] } };
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
  await authPage.getByText("运行完成",{exact:true}).waitFor();
  assert.equal(await authPage.locator(".verdict.accepted").count(),0,"run status never claims submission accepted");
  assert.equal(await authPage.locator(".judge-raw pre").isVisible(),false);
  assert.equal(await authPage.evaluate(() => window.__inkAuthTest.judgeStarts.length), 1);
  const sent = await authPage.evaluate(() => window.__inkAuthTest.judgeStarts[0]);
  assert.equal(sent.code, "// restored Java draft");
  await fixtureEditor.press("Control+End");
  await fixtureEditor.pressSequentially(" // newest request",{delay:10});
  const approvedSource=await fixtureEditor.innerText();
  await authPage.getByRole("button", { name: "提交", exact: true }).click();
  // Simulate a concurrent editor/model update while the modal owns user focus.
  await authPage.evaluate(async()=>{
    const {EditorView}=await import("/tests/input-harness.ts");
    const view=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
    if(!view)throw Error("missing real editor view");
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:"// changed after submit confirmation opened"}});
  });
  await authPage.getByRole("dialog", { name: "确认正式提交", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await authPage.waitForFunction(()=>window.__inkAuthTest.judgeStarts.length===2);
  assert.equal(await authPage.evaluate(()=>window.__inkAuthTest.judgeStarts[1].code),approvedSource,"confirmation sends the source captured when the explicit request began");

  await authPage.getByText("测试：发送状态未知，未自动重发", { exact: true }).waitFor();
  assert.equal(await authPage.getByRole("button", { name: "提交", exact: true }).isEnabled(), false);
  await authPage.getByRole("button", { name: "我已核查官方记录", exact: true }).click();
  await authPage.getByRole("dialog", { name: "解除未知提交保护", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await authPage.getByText("测试：用户已核查，未重发", { exact: true }).waitFor();
  assert.equal(await authPage.evaluate(() => window.__inkAuthTest.judgeStarts.length), 2, "解除保护不能自动重发");
  await authPage.evaluate(()=>{const job=window.__inkAuthTest.jobs.at(-1);job.state={state:"finished",server_id:"fixture-wa",result:{status_msg:"Wrong Answer",code_output:"[7,0]",expected_output:"[0,1]",last_testcase:"[2,7,11,15]\n9",compare_result:"0000011000",display_runtime:0,total_correct:2,total_testcases:64}};});
  await authPage.getByRole("button",{name:"fixture-user · 退出",exact:true}).click();
  await authPage.getByRole("button",{name:"登录力扣",exact:true}).click();
  await authPage.getByRole("button",{name:"验证登录",exact:true}).click();
  await authPage.waitForFunction(()=>window.__inkAuthTest.pending.length===4);
  await authPage.evaluate(()=>window.__inkAuthTest.pending[3].resolve({username:"fixture-user",account:"fixture-user",persistence:"memory-only"}));
  await authPage.getByText("答案错误",{exact:true}).waitFor();
  assert.equal(await authPage.locator(".judge-field").filter({has:authPage.getByRole("heading",{name:"实际输出",exact:true})}).locator("pre").innerText(),"[7,0]");
  assert.equal(await authPage.locator(".judge-field").filter({has:authPage.getByRole("heading",{name:"预期输出",exact:true})}).locator("pre").innerText(),"[0,1]");
  assert.equal(await authPage.locator(".judge-field").filter({has:authPage.getByRole("heading",{name:"失败输入",exact:true})}).locator("pre").innerText(),"[2,7,11,15]\n9");
  await authPage.getByText("0 ms",{exact:true}).waitFor();
  assert.equal(await authPage.locator(".judge-raw pre").isVisible(),false);
  await authPage.getByRole("separator",{name:"调整测试结果高度",exact:true}).press("End");
  await authPage.screenshot({path:"evidence/online-verdict-readable.png",fullPage:true});
  await authPage.evaluate(()=>{const old=window.__inkAuthTest.jobs.at(-1);window.__inkAuthTest.jobs.push({...old,snapshot:{...old.snapshot,id:"other-pending",language:"rust",solution:"alternate"},state:{state:"waiting",server_id:"other-server"}});});
  await authPage.getByRole("button",{name:"fixture-user · 退出",exact:true}).click();
  await authPage.getByRole("button",{name:"登录力扣",exact:true}).click();
  await authPage.getByRole("button",{name:"验证登录",exact:true}).click();
  await authPage.waitForFunction(()=>window.__inkAuthTest.pending.length===5);
  await authPage.evaluate(()=>window.__inkAuthTest.pending[4].resolve({username:"fixture-user",account:"fixture-user",persistence:"memory-only"}));
  await authPage.getByLabel("待处理评测",{exact:true}).waitFor();
  assert.equal(await authPage.getByRole("button",{name:"提交",exact:true}).isDisabled(),true);
  await authPage.getByLabel("待处理评测",{exact:true}).getByRole("button",{name:"继续查询",exact:true}).click();
  await authPage.waitForFunction(()=>window.__inkAuthTest.jobs.find(job=>job.snapshot.id==="other-pending").state.state==="finished");
  assert.equal(await authPage.evaluate(()=>window.__inkAuthTest.judgeStarts.length),2,"resuming another solution never re-sends code");
  assert.deepEqual(authErrors, []);
  await authPage.close();
  await writeFile("evidence/AUTH_UI_RESULT.txt", "PASS: mocked IPC only; cancel during verification, ignore stale success, explicit failure and recovery. NOT real login validation.\n");


  const restorePage=await testPage();
  await restorePage.addInitScript(()=>{
    window.isTauri=true;
    const state=window.__authRestoreTest={defer:sessionStorage.getItem("deferRestore")==="1",cancelled:0};
    const identity={username:"restored-user",account:"restored-account",persistence:"memory-only"};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="login_status")return state.defer?new Promise(resolve=>state.reply=resolve):identity;
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="list_judgements")return [];
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return {code:"// restored",notes:null};
      if(command==="external_editor_supported")return false;
      if(command==="open_login"||command==="stop_language_service")return;
      if(command==="cancel_login"){state.cancelled++;return;}
      throw Error("Unexpected restore IPC "+command);
    }};
  });
  await restorePage.goto("http://127.0.0.1:5173");
  await restorePage.getByRole("button",{name:"restored-user · 退出",exact:true}).waitFor();
  await restorePage.reload();
  await restorePage.getByRole("button",{name:"restored-user · 退出",exact:true}).waitFor();
  await restorePage.evaluate(()=>sessionStorage.setItem("deferRestore","1"));
  await restorePage.reload();
  await restorePage.waitForFunction(()=>typeof window.__authRestoreTest.reply==="function");
  await restorePage.getByRole("button",{name:"登录力扣",exact:true}).click();
  await restorePage.getByRole("button",{name:"取消登录",exact:true}).click();
  await restorePage.evaluate(()=>window.__authRestoreTest.reply({username:"stale-restored",account:"stale",persistence:"memory-only"}));
  await restorePage.waitForTimeout(100);
  assert.equal(await restorePage.getByRole("button",{name:"stale-restored · 退出",exact:true}).count(),0,"late status cannot revive canceled account");
  await restorePage.getByRole("button",{name:"登录力扣",exact:true}).waitFor();
  await restorePage.close();

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
    window.__lspTest = { settings:{version:1,formatOnSave:false,vim:false,overrides:{}},revision:null,id: 0, version: 1, text: "", stops: [], requests: [], events: [], failNextUpdate: false, holdNextUpdate: false };
    window.__vimTest=window.__lspTest;
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      const state = window.__lspTest;
      if(command==="get_editor_settings")return {settings:state.settings,revision:state.revision};
      if(command==="save_editor_settings"){state.settings=args.settings;state.revision=JSON.stringify(args.settings);return {settings:state.settings,revision:state.revision};}
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
        if (args.kind === "definition") return [{ uri: state.primaryDefinition?"file:///fixture/solution.py":"file:///fixture/stdlib/collections.pyi", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }];
      }
      if(command==="language_cancel_source_navigation"){state.sourceCancels??=[];state.sourceCancels.push(args);return;}
      if(command==="acquire_language_source"){
        const source=args.uri.endsWith("collections.pyi")?{sourceId:1,name:"collections.pyi",text:"class deque:\n    def popleft(self) -> int: ...",declaration:true}:{sourceId:2,name:"_collections_abc.py",text:"class Iterable:\n    def __iter__(self):\n        return iter(())",declaration:false};
        return {...source,uri:args.uri,language:"python3"};
      }
      if(command==="language_source_definition"){
        state.sourceRequests??=[];state.sourceRequests.push(args);
        const result={locations:[{uri:args.sourceId===1?"file:///fixture/stdlib/_collections_abc.py":"file:///fixture/stdlib/collections.pyi",range:{start:{line:0,character:6},end:{line:0,character:args.sourceId===1?14:11}}}],omitted:0};
        if(state.multiSource)result.locations.push({uri:"file:///fixture/stdlib/collections.pyi",range:{start:{line:0,character:6},end:{line:0,character:11}}});
        if(state.holdSource)return new Promise(resolve=>{state.sourceReply=()=>resolve(result);});
        if(state.failSource)throw Error("controlled source failure");
        return result;
      }
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
  assert.equal(await lspPage.locator(".lsp-signature").getAttribute("aria-label"),"参数 1 / 1");
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
  assert.match(await sourceDialog.locator(".source-kind").getAttribute("title"), /不是运行时实现源码/);
  assert.match(await sourceDialog.locator(".source-kind").innerText(), /声明.*只读/);
  const readOnly = sourceDialog.getByLabel("只读标准库源码", { exact: true });
  const beforeSource = await readOnly.innerText();
  await readOnly.click(); await readOnly.press("x");
  assert.equal(await readOnly.innerText(), beforeSource);

  const sourceShell=lspPage.locator(".source-viewer");
  await readOnly.press("F12");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  assert.equal(await lspPage.evaluate(()=>window.__lspTest.sourceRequests.at(-1).sourceId),1,"second hop addresses library snapshot, not editable solution");
  const sourceCode=lspPage.getByLabel("只读标准库源码",{exact:true});
  await sourceCode.press("F12");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  assert.equal(await lspPage.evaluate(()=>window.__lspTest.sourceRequests.at(-1).sourceId),2);
  await sourceCode.press("Alt+ArrowLeft");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  await sourceCode.press("Alt+ArrowRight");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  await lspPage.evaluate(()=>{window.__lspTest.failSource=true;});
  await sourceCode.press("F12");
  await sourceShell.getByRole("status").filter({hasText:"controlled source failure"}).waitFor();
  assert.equal(await sourceShell.locator("#source-title").innerText(),"collections.pyi","failed navigation leaves the current document");
  await lspPage.evaluate(()=>{window.__lspTest.failSource=false;window.__lspTest.holdSource=true;});
  await sourceCode.press("F12");
  await lspPage.waitForFunction(()=>typeof window.__lspTest.sourceReply==="function");
  await sourceCode.press("Alt+ArrowLeft");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  await lspPage.evaluate(()=>window.__lspTest.sourceReply());
  await lspPage.waitForTimeout(80);
  assert.equal(await sourceShell.locator("#source-title").innerText(),"_collections_abc.py","late result cannot replace Back destination");
  await sourceCode.press("Alt+ArrowRight");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  await lspPage.evaluate(()=>{window.__lspTest.holdSource=false;});

  const lineBox=await sourceCode.locator(".cm-line").first().boundingBox();
  await lspPage.keyboard.down("Control");
  await lspPage.mouse.click(lineBox.x+35,lineBox.y+lineBox.height/2);
  await lspPage.keyboard.up("Control");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  assert.equal(await lspPage.evaluate(async()=>{
    const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
    const view=EditorView.findFromDOM(document.querySelector(".source-viewer .cm-editor")),before=view.state.doc.toString();
    view.dispatch({changes:{from:0,insert:"MUTATE"},filter:false});
    return view.state.doc.toString()===before;
  }),true,"readonly dispatch boundary rejects filter:false edits");
  await sourceCode.press("Alt+ArrowLeft");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  const cancelCount=await lspPage.evaluate(()=>window.__lspTest.sourceCancels?.length??0);
  for(let n=0;n<5;n++)await sourceCode.press("ArrowRight");
  assert.ok((await lspPage.evaluate(()=>window.__lspTest.sourceCancels?.length??0))-cancelCount<=1,"cursor movement does not repeatedly issue cancellation IPC");

  await lspPage.evaluate(()=>{window.__lspTest.multiSource=true;});
  await sourceCode.press("F12");
  const targetPicker=lspPage.getByRole("dialog",{name:"选择定义",exact:true});
  await targetPicker.waitFor();
  assert.equal(await targetPicker.getByRole("button").count(),2,"all distinct definitions are offered");
  await lspPage.keyboard.press("ArrowDown");await lspPage.keyboard.press("Enter");
  await targetPicker.waitFor({state:"detached"});
  assert.equal(await sourceShell.locator("#source-title").innerText(),"collections.pyi","picker can choose a same-file target");
  await lspPage.evaluate(()=>{window.__lspTest.multiSource=false;});
  await lspPage.screenshot({path:"evidence/recursive-source-navigation.png"});
  await sourceDialog.getByRole("button", { name: "返回代码", exact: true }).click();
  assert.equal(await lspEditor.innerText(), "items.popleft");
  await lspPage.evaluate(()=>{window.__lspTest.holdSource=true;delete window.__lspTest.sourceReply;});
  await lspEditor.press("F12");await sourceShell.waitFor();
  await sourceCode.press("F12");
  await lspPage.waitForFunction(()=>typeof window.__lspTest.sourceReply==="function");
  await sourceShell.getByRole("button",{name:"关闭源码",exact:true}).click();
  await sourceShell.waitFor({state:"detached"});
  await lspPage.evaluate(()=>{window.__lspTest.sourceReply();window.__lspTest.holdSource=false;});
  await lspPage.waitForTimeout(80);
  assert.equal(await sourceShell.count(),0,"late source response cannot reopen a dismissed reader");
  await openSettings(lspPage,"编辑器");
  await lspPage.getByRole("checkbox",{name:"Vim",exact:true}).check();
  await lspPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await lspPage.waitForFunction(()=>window.__lspTest.settings.vim===true);
  await lspPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await lspEditor.click();await lspEditor.press("Escape");
  await lspPage.evaluate(()=>{window.__lspTest.primaryDefinition=true;});
  await lspEditor.press("F12");
  await lspPage.waitForFunction(()=>window.__lspTest.requests.at(-1)?.kind==="definition");
  assert.equal(await lspPage.evaluate(async()=>{
    const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
    return EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor")).state.selection.main.empty;
  }),true,"same-document F12 in Vim uses a normal-mode caret");
  await lspPage.evaluate(()=>{window.__lspTest.primaryDefinition=false;});
  await lspPage.keyboard.type("gd");
  await sourceShell.waitFor();
  await sourceCode.press("Escape");
  await sourceShell.waitFor({state:"detached"});
  await lspEditor.press("F12");await sourceShell.waitFor();
  await sourceCode.focus();
  await lspPage.keyboard.type("gd");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  await sourceCode.press("Control+o");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  await sourceCode.press("Control+i");
  try{await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");}
  catch(error){await writeFile("evidence/source-navigation-failure.json",JSON.stringify(await lspPage.evaluate(()=>({title:document.querySelector("#source-title")?.textContent,message:document.querySelector(".source-message")?.textContent,requests:window.__lspTest.sourceRequests,cancels:window.__lspTest.sourceCancels,active:document.activeElement?.outerHTML,source:document.querySelector(".source-viewer")?.innerText})),null,2));await lspPage.screenshot({path:"evidence/source-navigation-failure.png"});throw error;}
  await lspPage.keyboard.type("vl");await sourceCode.press("Escape");
  assert.equal(await sourceShell.count(),1,"visual Escape exits selection before closing the reader");
  await lspPage.keyboard.type("gd");
  await lspPage.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
  const immutable=await sourceCode.innerText();
  await lspPage.keyboard.type("dd");assert.equal(await sourceCode.innerText(),immutable,"Vim delete cannot mutate library source");
  await lspPage.keyboard.type("iXYZ");
  assert.equal(await sourceCode.innerText(),immutable,"Vim insert cannot mutate library source");
  await sourceCode.press("Escape");
  if(await sourceShell.count())await sourceShell.getByRole("button",{name:"返回代码",exact:true}).click();
  assert.equal(await lspEditor.innerText(),"items.popleft","source Vim cannot mutate solution");
  await openSettings(lspPage,"编辑器");
  await lspPage.getByRole("checkbox",{name:"Vim",exact:true}).uncheck();
  await lspPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await lspPage.waitForFunction(()=>window.__lspTest.settings.vim===false);
  await lspPage.getByRole("button",{name:"关闭设置",exact:true}).click();
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

  await runPage.route("**/src/snapshot-text.ts",async route=>{
    const response=await route.fetch();let body=await response.text();
    const marker="const text = doc.toString();";
    assert.equal(body.split(marker).length,2,"instrument one snapshot cache miss");
    body=body.replace(marker,'const text = window.__inputCostMeasure ? window.__inputCostMeasure("snapshot", () => doc.toString()) : doc.toString();');
    await route.fulfill({response,body});
  });
  await runPage.route("**/src/editor.tsx",async route=>{
    const response=await route.fetch();let body=await response.text();
    const marker=/if\s*\(update\.docChanged\)\s*callback\.current\(snapshotText\(update\.state\.doc\)\);/g;
    assert.equal([...body.matchAll(marker)].length,1,"instrument one actual editor onChange callback");
    body=body.replace(marker,'if (update.docChanged) { const text = snapshotText(update.state.doc); if (window.__inputCostMeasure) window.__inputCostMeasure("onChange", () => callback.current(text)); else callback.current(text); }');
    await route.fulfill({response,body});
  });

  // Test-only instrumentation of the served module; production has no counters.
  await runPage.route("**/src/main.tsx",async route=>{
    const response=await route.fetch();let body=await response.text();
    assert.equal(body.split("function App() {").length,2,"instrument actual App once");
    body=body.replace("function App() {","function App() { useEffect(() => { window.__appCommits=(window.__appCommits??0)+1; });");
    assert.match(body,/function checkpoint\([^)]*\) \{/);
    body=body.replace(/function checkpoint\(([^)]*)\) \{/,"function checkpoint($1) { window.__checkpointEnqueues=(window.__checkpointEnqueues??0)+1;");
    await route.fulfill({response,body});
  });

  await runPage.addInitScript(() => {
    window.isTauri = true;
    window.__runTest = { starts: [], result: null, pending: [], debug: null, debugStarts: 0, debugCalls: [], column:27, endColumn:30 };
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
        ++state.debugStarts; state.debugCode=args.snapshot.code;state.debugInput=args.snapshot.input;
        state.debug = { id: state.debugStarts, phase: "paused", title: args.snapshot.title, threadId: 1, epoch: 1, capabilities:{supportsStepInTargetsRequest:true}, output: "", truncated: false, reason: "breakpoint", error: "", breakpoints: args.lines.map(line => ({ line, verified: true })) };
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
        if(args.kind==="stepInTargets"){if(state.deferTargets)return new Promise(resolve=>state.targetsReply=()=>resolve({targets:[{id:9,label:"stale"}]}));return {targets:[{id:7,label:"sum(values)"}]};}
        if(args.kind==="stepInTarget"){state.selectedTarget=args.reference;state.debug.epoch++;return {};}
        if (args.kind === "threads") return { threads: [{id: 1, name: "MainThread"}, {id: 2, name: "Worker"}] };
        if (args.kind === "stackTrace") return { stackFrames: [{ id: 1, name: "solve", line: 1, column:state.column,endColumn:state.endColumn,inkleetSource:true, source: { name: "solution.py", path: "/fixture/solution.py" } }, { id: 0, name: "caller", line: 1, inkleetSource:true, source: { name: "solution.py" } }] };
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
      if(command==="local_run_record")return state.records?.[args.id]&&state.result?.id===args.id?JSON.parse(JSON.stringify(state.records[args.id])):null;
      if (command === "start_local_run") {
        state.starts.push(JSON.parse(JSON.stringify(args.snapshot)));
        const plan=args.snapshot,casePlans=plan.cases??[{id:"selected",name:"用例",input:plan.input,expectation:null}];
        const invocations=[];const parameterCount=JSON.parse(plan.metadata).params.length;
        casePlans.forEach((c,caseIndex)=>{const groups=Math.max(1,Math.floor(c.input.split("\n").filter(x=>x.trim()).length/parameterCount));for(let groupIndex=0;groupIndex<groups;groupIndex++)invocations.push({caseIndex,groupIndex,caseNumber:invocations.length+1});});
        state.records??={};state.records[state.starts.length]={mode:plan.mode??"selected",documentKey:plan.documentKey,clientRequestId:plan.clientRequestId,snapshot:{code:plan.code,input:casePlans.map(c=>c.input).join("\n"),metadata:plan.metadata,title:plan.title,language:plan.language},cases:casePlans,invocations};

        state.result = { id: state.starts.length, documentKey:args.snapshot.documentKey,clientRequestId:args.snapshot.clientRequestId,phase: "running", title: args.snapshot.title, stdout: "", stderr: "", results: [], exitCode: null, timedOut: false, canceled: false, truncated: false, elapsedMs: 0, error: "" };
        return new Promise(resolve => state.pending.push(() => resolve(state.result.id)));
      }
      if (command === "cancel_local_run") { state.result.phase = "finished"; state.result.canceled = true; return; }
      throw new Error("Unexpected local run fixture: " + command);
    }};
  });
  await runPage.goto("http://127.0.0.1:5173");
  await runPage.getByRole("combobox", { name: "编程语言" }).selectOption("python3");
  await runPage.evaluate(()=>document.fonts.ready);
  const fontProbe=()=>runPage.locator(".code-pane .cm-content").evaluate(node=>{
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    return {fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,fontStyle:style.fontStyle,letterSpacing:style.letterSpacing,textShadow:style.textShadow,transform:style.transform,x:rect.x,y:rect.y,width:rect.width};
  });
  const fontBefore=await fontProbe();
  await runPage.getByRole("button", { name: "本地", exact: true }).click();
  const fontOpen=await fontProbe();
  for(const key of ["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","textShadow","transform"])assert.equal(fontOpen[key],fontBefore[key],"dock must not change "+key);
  await writeFile("evidence/editor-font-dock.json",JSON.stringify({before:fontBefore,open:fontOpen},null,2));
  const runPanel = runPage.getByRole("region", { name: "本地运行", exact: true });
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => window.__runTest.starts.length === 1);
  await runPage.evaluate(() => window.__runTest.pending[0]());
  await runPanel.getByRole("button", { name: "停止", exact: true }).waitFor();
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).fill("def solve(values): return sum(values)");
  await runPanel.getByText("代码已修改 · 重新运行以更新结果",{exact:true}).waitFor();
  await runPanel.getByRole("button", { name: "收起", exact: true }).click();
  await runPage.getByRole("button", { name: "本地", exact: true }).click();
  await runPanel.getByRole("button", { name: "停止", exact: true }).click();
  await runPanel.getByText("已停止", { exact: true }).waitFor();
  assert.equal(await runPage.evaluate(() => window.__runTest.starts.length), 1);
  await runPanel.getByRole("button", { name: "本地执行", exact: true }).click();
  await runPage.waitForFunction(() => window.__runTest.starts.length === 2);
  await runPage.evaluate(() => window.__runTest.pending[1]());
  await runPage.evaluate(() => Object.assign(window.__runTest.result, { phase: "finished", exitCode: 0, results: ['{"case": 1, "ok": true, "value": 10, "exactInteger": 9007199254740993}'], stdout: "<img src=x onerror=alert(1)>", elapsedMs: 12 }));
  await runPanel.locator(".local-result").getByText("10",{exact:true}).waitFor();
  await runPanel.getByLabel("查看原始结果",{exact:true}).click();
  assert.equal(await runPanel.locator("img").count(), 0);
  assert.match(await runPanel.innerText(), /9007199254740993/);
  assert.match(await runPanel.locator(".case-result").getAttribute("title"), /不代表通过力扣判题/, "local result distinction remains available on hover");
  await runPanel.getByLabel("查看原始结果",{exact:true}).click();
  assert.equal(await runPanel.locator(".exit-code").count(),0,"successful exit code is not permanent clutter");
  await runPanel.getByRole("button", { name: "运行与调试设置", exact: true }).click();
  assert.equal(await runPage.getByRole("dialog",{name:"设置",exact:true}).locator(".settings-reference").count(),0);
  await runPage.getByRole("button",{name:"使用手册",exact:true}).click();
  await runPage.getByRole("dialog",{name:"使用手册",exact:true}).getByText(/本地输出不代表力扣判题结论/).waitFor();
  await runPage.getByRole("button",{name:"关闭使用手册",exact:true}).click();
  await runPage.getByRole("button", { name: "关闭设置", exact: true }).click();

  const separator=runPage.getByRole("separator",{name:"调整本地面板高度",exact:true});
  const initialHeight=(await runPanel.boundingBox()).height;
  await separator.focus();await separator.press("ArrowUp");
  assert.ok((await runPanel.boundingBox()).height>initialHeight,"keyboard resizes dock");
  const dragBox=await separator.boundingBox();
  await runPage.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+3);await runPage.mouse.down();await runPage.mouse.move(dragBox.x+dragBox.width/2,dragBox.y-40,{steps:5});await runPage.mouse.up();
  const resizedHeight=(await runPanel.boundingBox()).height;
  assert.ok(resizedHeight>initialHeight+30,"pointer resizes dock");
  await runPage.evaluate(()=>{window.__retainedDock=document.querySelector(".local-runner");});
  await runPanel.getByRole("button",{name:"收起",exact:true}).click();
  await runPanel.waitFor({state:"hidden"});
  await runPage.getByRole("button",{name:"本地",exact:true}).click();
  assert.equal(await runPage.evaluate(()=>window.__retainedDock===document.querySelector(".local-runner")),true,"collapse retains mounted panel");
  assert.ok(Math.abs((await runPanel.boundingBox()).height-resizedHeight)<2,"collapse restores last height");
  await runPage.getByRole("button",{name:"测试用例与结果",exact:true}).click();
  await runPage.getByRole("separator",{name:"调整测试结果高度",exact:true}).waitFor();
  assert.ok((await runPage.locator(".editor-host").first().boundingBox()).height>=130,"two panels reserve editor space");
  await runPage.getByRole("button",{name:"收起测试与结果",exact:true}).click();
  const originalInput=await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).inputValue();
  await runPanel.getByRole("button",{name:"添加用例",exact:true}).click();
  await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).fill("[9,8]");
  await runPanel.getByRole("tab",{name:"用例 1",exact:true}).click();
  assert.equal(await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).inputValue(),originalInput,"switching cases preserves separate inputs");
  await runPanel.getByRole("tab",{name:"用例 2",exact:true}).click();
  await runPage.screenshot({path:"evidence/visual-test-results.png",fullPage:true});
  await runPanel.locator('[data-local-tab="debug"]').click();
  await runPage.getByRole("textbox", { name: "代码编辑器", exact: true }).press("F9");
  await runPanel.getByText(/断点：1。/).waitFor();
  assert.equal(await runPanel.getByRole("button", {name:"开始调试",exact:true}).locator("svg[aria-hidden=true]").count(),1,"start uses accessible SVG");
  await runPanel.getByRole("button", { name: "开始调试", exact: true }).evaluate(button => { button.click(); button.click(); });
  await runPage.waitForFunction(() => window.__runTest.debugStarts === 1);
  assert.equal(await runPage.evaluate(()=>window.__runTest.debugInput),"[9,8]","debug starts exactly the selected case");
  await runPanel.getByText("已暂停", { exact: true }).waitFor();
  assert.equal(await runPanel.getByText("已暂停", { exact: true }).getAttribute("title"), "breakpoint");
  assert.equal(await runPanel.getByRole("button", {name:"开始调试",exact:true}).count(),0,"active session has one primary execution control");
  for (const label of ["继续", "单步跳过", "单步进入", "单步跳出", "应用断点", "停止调试"]) {
    assert.equal(await runPanel.getByRole("button", { name: label, exact: true }).locator("svg[aria-hidden=true]").count(), 1, label + " has an accessible SVG control");
  }
  await runPage.screenshot({ path: "evidence/debug-svg-toolbar.png", fullPage: true });
  await runPanel.getByRole("button", { name: "values", exact: true }).waitFor();
  await runPage.locator(".cm-debug-stopped").waitFor();
  await runPage.locator(".cm-debug-range").filter({hasText:"sum"}).waitFor();
  await runPage.locator(".cm-execution-pointer svg").waitFor();
  const firstPointerX=await runPage.locator(".cm-debug-column").evaluate(node=>node.getBoundingClientRect().x);
  assert.equal(await runPage.locator(".cm-debug-column").getAttribute("data-debug-column"),"27");

  await runPage.evaluate(()=>{window.__runTest.column=11;window.__runTest.endColumn=17;window.__runTest.debug.epoch++;});
  await runPage.locator(".cm-debug-range").filter({hasText:"values"}).waitFor();
  assert.equal(await runPage.locator(".cm-debug-column").getAttribute("data-debug-column"),"11");
  assert.ok(await runPage.locator(".cm-debug-column").evaluate(node=>node.getBoundingClientRect().x)<firstPointerX,"inline pointer moves with real reported column");

  await runPage.evaluate(()=>{window.__runTest.column=27;window.__runTest.endColumn=30;window.__runTest.debug.epoch++;});
  await runPage.locator(".cm-debug-range").filter({hasText:"sum"}).waitFor();
  await runPanel.getByRole("button",{name:"选择函数步入",exact:true}).click();
  await runPanel.getByRole("button",{name:"sum(values)",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.selectedTarget===7);
  await runPage.locator(".cm-debug-stopped").waitFor();
  await runPage.evaluate(()=>{window.__runTest.deferTargets=true;});
  await runPanel.getByRole("button",{name:"选择函数步入",exact:true}).click();
  await runPage.waitForFunction(()=>typeof window.__runTest.targetsReply==="function");
  await runPage.evaluate(()=>{window.__runTest.debug.epoch++;});
  await runPage.waitForTimeout(350);
  await runPage.evaluate(()=>{window.__runTest.targetsReply();window.__runTest.deferTargets=false;});
  assert.equal(await runPanel.getByRole("button",{name:"stale",exact:true}).count(),0,"expired target list is discarded");
  await runPage.evaluate(()=>{window.__runTest.debug.capabilities.supportsStepInTargetsRequest=false;});
  await runPanel.getByRole("button",{name:"选择函数步入",exact:true}).waitFor({state:"hidden"});

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
  await runPage.locator(".cm-debug-frame").waitFor();
  await runPage.locator(".cm-inspection-pointer").waitFor();
  assert.equal(await runPage.locator(".cm-execution-pointer").count(),0,"caller marker is not execution arrow");
  assert.equal(await runPage.locator(".cm-debug-stopped").count(),0,"inspected caller is not marked as execution PC");
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

  // Performance baseline: actual App/LocalRunner, mocked IPC and no real LSP/disk.
  // Count only parsing of exact authored result envelopes, not all JSON operations.
  const runnerPerf = [];
  await runPage.evaluate(() => {
    const s=window.__runTest;
    s.perfRaw=Array.from({length:3},(_,i)=>JSON.stringify({case:i+1,ok:true,value:Array.from({length:16384},(_,n)=>n+i)}));
    Object.assign(s.result,{phase:"finished",canceled:false,exitCode:0,results:s.perfRaw,stdout:"",elapsedMs:1});
    s.perfPolls=0;
    const invoke=window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke=(command,args)=>{if(command==="local_run_status")s.perfPolls++;return invoke(command,args);};
  });
  await runPanel.locator(".case-result").nth(2).waitFor();
  await runPage.evaluate(() => {
    const s=window.__runTest, original=JSON.parse;
    s.perf={parses:0,parseMs:0,frames:[]};
    JSON.parse=function(...args){if(s.perfRaw.includes(args[0])){const start=performance.now();try{return Reflect.apply(original,JSON,args);}finally{s.perf.parses++;s.perf.parseMs+=performance.now()-start;}}return Reflect.apply(original,JSON,args);};
    const input=event=>{if(event.inputType!=="insertText"||!event.target.closest('[aria-label="代码编辑器"]'))return;const start=performance.now();requestAnimationFrame(()=>s.perf.frames.push(performance.now()-start));};
    document.addEventListener("beforeinput",input,true);
    s.perfCleanup=()=>{JSON.parse=original;document.removeEventListener("beforeinput",input,true);};
  });
  try {
    for(const hidden of [false,true]){
      if(hidden){await runPanel.getByRole("button",{name:"收起",exact:true}).click();await runPanel.waitFor({state:"hidden"});}
      const edit=runPage.getByRole("textbox",{name:"代码编辑器",exact:true});
      await edit.click();await edit.press("Control+End");
      await runPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await runPage.evaluate(()=>{const s=window.__runTest;s.perf={parses:0,parseMs:0,frames:[]};s.perfPollStart=s.perfPolls;window.__appCommits=0;window.__checkpointEnqueues=0;});
      await edit.pressSequentially(" // runner performance 01234567890123456789",{delay:20});
      await runPage.waitForFunction(()=>window.__runTest.perfPolls-window.__runTest.perfPollStart>=4&&window.__runTest.perf.frames.length>=30);
      const sample=await runPage.evaluate(()=>{const s=window.__runTest;return {...s.perf,appCommits:window.__appCommits,checkpointEnqueues:window.__checkpointEnqueues,polls:s.perfPolls-s.perfPollStart,rawBytes:s.perfRaw.reduce((n,v)=>n+new TextEncoder().encode(v).length,0)};});
      await writeFile("evidence/RUNNER_PERFORMANCE_PENDING.json",JSON.stringify({hidden,...sample},null,2));
      assert.equal(sample.parses,0,"unchanged result envelopes must not be reparsed during source edits or fresh-array polls");
      assert.ok(sample.appCommits<=3,"already-dirty code typing must not rerender App per character");
      assert.equal(sample.checkpointEnqueues," // runner performance 01234567890123456789".length,"every code edit retains its recovery checkpoint enqueue");
      const sorted=[...sample.frames].sort((a,b)=>a-b);
      assert.ok(sorted.length>=30,"record real keyboard beforeinput samples");
      runnerPerf.push({hidden,...sample,inputToRafP50Ms:sorted[Math.floor(sorted.length*.5)],inputToRafP95Ms:sorted[Math.floor(sorted.length*.95)]});
    }
  } finally {await runPage.evaluate(()=>window.__runTest.perfCleanup());}
  await writeFile("evidence/RUNNER_PERFORMANCE.json",JSON.stringify({environment:"GitHub Actions headless Chromium; actual App with mocked IPC, no native LSP or disk; development React build",cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,viewport:"1440x900",meaning:"input-to-next-rAF is not completed paint; parseMs counts JSON.parse only, not subsequent exact-value scanning",samples:runnerPerf},null,2));
  // Retain current source snapshots despite any rendering optimization.
  await runPage.getByRole("button",{name:"本地",exact:true}).click();
  // Changed bytes and display context must still refresh after row memoization.
  const oldLabel=await runPanel.locator(".case-result header span").first().innerText();
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":99,"ok":true,"value":9007199254740993}'];});
  await runPanel.locator(".local-result").getByText("9007199254740993",{exact:true}).waitFor();
  assert.equal(await runPanel.locator(".case-result").count(),1);
  assert.equal(await runPanel.locator(".case-result header span").first().innerText(),oldLabel.replace(/ · \d+$/,""),"single result removes ordinal suffix without dropping snapshot name");
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":99,"ok":false,"error":"changed error result"}'];});
  await runPanel.locator(".case-result [role=alert]").getByText("changed error result",{exact:true}).waitFor();
  // Void arguments are first-class output, with exact bytes and owned metadata labels.
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":1,"ok":true,"value":null,"argumentsAfterCall":[[9007199254740993],null],"argumentsUnavailable":[1]}'];});
  await runPanel.locator(".case-argument .local-result").getByText("[9007199254740993]",{exact:true}).waitFor();
  await runPanel.getByText("不可读取（值已移交）",{exact:true}).waitFor();
  assert.equal(await runPanel.locator(".case-argument").count(),2);
  assert.equal(await runPanel.locator(".case-result header span").last().innerText(),"调用后参数");
  const capturedName=await runPage.evaluate(()=>JSON.parse(window.__runTest.starts.at(-1).metadata).params[0].name);
  await runPanel.locator("pre[aria-label="+JSON.stringify("调用后 "+capturedName)+"]").getByText("[9007199254740993]",{exact:true}).waitFor();
  await runPage.evaluate(()=>{const s=window.__runTest;s.savedResultId=s.result.id;s.result.id+=1000;});
  await runPanel.locator('pre[aria-label="调用后 参数 1"]').getByText("[9007199254740993]",{exact:true}).waitFor();
  assert.equal(await runPanel.locator("pre[aria-label="+JSON.stringify("调用后 "+capturedName)+"]").count(),0,"foreign result cannot inherit captured names");
  await runPage.evaluate(()=>{window.__runTest.result.id=window.__runTest.savedResultId;});
  await runPanel.locator("pre[aria-label="+JSON.stringify("调用后 "+capturedName)+"]").getByText("[9007199254740993]",{exact:true}).waitFor();
  await runPage.screenshot({path:"evidence/in-place-result.png"});
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":1,"ok":true,"value":null,"argumentsAfterCall":[[3,2,1],null]}'];});
  await runPanel.locator(".case-argument .local-result").getByText("[3,2,1]",{exact:true}).waitFor();
  await runPanel.locator(".case-argument .local-result").getByText("null",{exact:true}).waitFor();
  assert.equal(await runPanel.getByText("不可读取（值已移交）",{exact:true}).count(),0);
  const newestCode="class Solution { /* latest performance snapshot */ }";
  await runPage.getByRole("textbox",{name:"代码编辑器",exact:true}).fill(newestCode);
  await runPanel.getByRole("button",{name:"本地执行",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===8);
  assert.equal(await runPage.evaluate(()=>window.__runTest.starts[7].code),newestCode);
  await runPage.evaluate(()=>window.__runTest.pending[7]());
  await runPanel.getByRole("button",{name:"停止",exact:true}).click();
  await runPanel.getByText("已停止",{exact:true}).waitFor();

  // Exact expected-result comparison freezes the selected policy with the run.
  await runPage.setViewportSize({width:1200,height:800});
  await runPanel.locator(".case-expectation summary").click();
  await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill("9007199254740992");
  assert.equal(await runPanel.evaluate(panel=>{
    const field=panel.querySelector('[aria-label="预期结果"]'),r=field.getBoundingClientRect(),p=field.closest(".case-editor").getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;
    return x>=p.left&&x<=p.right&&y>=p.top&&y<=p.bottom&&document.elementFromPoint(x,y)===field;
  }),true,"compact expected field center is inside its native-sized scrollport");

  assert.equal(await runPanel.evaluate(panel=>{
    const button=panel.querySelector('[data-action="local-execute"]'),b=button.getBoundingClientRect(),p=panel.getBoundingClientRect();
    return b.top>=p.top&&b.bottom<=p.bottom&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest("button")===button;
  }),true,"run control stays visible and clickable with expanded expected input");

  await runPanel.getByRole("button",{name:"本地执行",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===9);
  await runPage.evaluate(()=>window.__runTest.pending[8]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,results:['{"case":1,"ok":true,"value":9007199254740993}']}));
  await runPanel.getByText("与预期不符",{exact:true}).waitFor();
  await runPanel.locator(".case-expected pre").getByText("9007199254740992",{exact:true}).waitFor();
  assert.equal(await runPanel.evaluate(panel=>{
    const input=panel.querySelector(".case-editor").getBoundingClientRect(),output=panel.querySelector(".case-output").getBoundingClientRect();
    return output.left>=input.right-1&&input.height>0&&output.height>0&&output.width>100;
  }),true,"desktop inputs and results have independent visible columns");
  await runPage.screenshot({path:"evidence/expected-result-mismatch.png"});
  await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill("9007199254740993");
  await runPanel.getByText("预期结果已修改 · 重新运行以更新结果",{exact:true}).waitFor();
  await runPanel.getByText("与预期不符",{exact:true}).waitFor();
  await runPanel.getByRole("button",{name:"本地执行",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===10);
  await runPage.evaluate(()=>window.__runTest.pending[9]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,results:['{"case":1,"ok":true,"value":9007199254740993}']}));
  await runPanel.getByText("符合预期",{exact:true}).waitFor();
  for(const patch of [{timedOut:true},{canceled:true},{truncated:true},{exitCode:1},{phase:"running"},{error:"failed after output"}]){
    await runPage.evaluate(patch=>Object.assign(window.__runTest.result,patch),patch);
    await runPanel.getByText("运行未完成，未比较",{exact:true}).waitFor();
    assert.equal(await runPanel.getByText("符合预期",{exact:true}).count(),0);
    await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,timedOut:false,canceled:false,truncated:false,error:""}));
    await runPanel.getByText("符合预期",{exact:true}).waitFor();
  }
  await runPage.evaluate(()=>{window.__runTest.result.id+=1000;});
  await runPanel.locator(".case-result header").getByText("返回值",{exact:true}).waitFor();
  assert.equal(await runPanel.getByText("符合预期",{exact:true}).count(),0,"foreign run cannot inherit expectation");
  await runPage.evaluate(()=>{window.__runTest.result.id-=1000;});
  await runPanel.getByText("符合预期",{exact:true}).waitFor();
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":1,"ok":true,"value":9007199254740992,"value":9007199254740993}'];});
  await runPanel.getByText("结果无法比较",{exact:true}).waitFor();
  await runPanel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).selectOption("argument:0");
  await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill("[3,2,1]");
  await runPanel.getByRole("button",{name:"本地执行",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===11);
  await runPage.evaluate(()=>window.__runTest.pending[10]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,results:['{"case":1,"ok":true,"value":null,"argumentsAfterCall":[[3,2,1]]}']}));
  await runPanel.getByText("符合预期",{exact:true}).waitFor();
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":1,"ok":true,"value":null,"argumentsAfterCall":[null],"argumentsUnavailable":[0]}'];});
  await runPanel.getByText("参数无法比较",{exact:true}).waitFor();
  const persistedExpectation=await runPage.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("inkleet.test-cases.v1:")).map(k=>JSON.parse(localStorage.getItem(k))).some(r=>r.version===2&&r.cases.some(c=>c.expectation?.target.kind==="argument"&&c.expectation.value==="[3,2,1]")));
  assert.equal(persistedExpectation,true,"versioned case data persists explicit comparison policy");
  await runPanel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).selectOption("return");
  await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill("1");
  await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).fill("[1]\n[2]");
  await runPanel.getByRole("button",{name:"本地执行",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===12);
  await runPage.evaluate(()=>window.__runTest.pending[11]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:1,timedOut:true,results:['{"case":1,"ok":true,"value":1}']}));
  await runPanel.getByText("运行未完成，未比较",{exact:true}).waitFor();
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{timedOut:false,exitCode:0}));
  await runPanel.getByText("多组输入未比较",{exact:true}).waitFor();
  // A remounted panel restores backend-owned provenance rather than relabeling global output.
  const captureLanguage=await runPage.getByRole("combobox",{name:"编程语言"}).inputValue();
  const foreignLanguage=captureLanguage==="python3"?"java":"python3";
  await runPage.getByRole("combobox",{name:"编程语言"}).selectOption(foreignLanguage);
  if(await runPanel.count()===0)await runPage.getByRole("button",{name:"本地",exact:true}).click();
  await runPanel.getByText("其他解答的运行结果",{exact:true}).waitFor();
  assert.equal(await runPanel.getByText("符合预期",{exact:true}).count(),0);
  await runPage.getByRole("combobox",{name:"编程语言"}).selectOption(captureLanguage);
  if(await runPanel.count()===0)await runPage.getByRole("button",{name:"本地",exact:true}).click();
  await runPanel.getByText("多组输入未比较",{exact:true}).waitFor();
  assert.equal(await runPage.evaluate(()=>window.__runTest.starts.length),12,"remount must never replay start");
  // Named batch execution is one backend admission, with captured cases and explicit retries.
  const tabs=runPanel.getByRole("tablist",{name:"测试用例"}).getByRole("tab");
  while(await tabs.count()>1){
    if(await runPanel.locator(".case-menu").getAttribute("open")===null)await runPanel.getByLabel("用例操作",{exact:true}).click();
    await runPanel.getByRole("button",{name:"删除用例",exact:true}).click();
  }
  async function renameBatchCase(name){
    if(await runPanel.locator(".case-menu").getAttribute("open")===null)await runPanel.getByLabel("用例操作",{exact:true}).click();
    await runPanel.getByRole("button",{name:"重命名",exact:true}).click();
    await runPanel.getByRole("textbox",{name:"用例名称",exact:true}).fill(name);
    await runPanel.locator(".case-rename").getByRole("button",{name:"确定",exact:true}).click();
    if(await runPanel.locator(".case-menu").getAttribute("open")!==null)await runPanel.getByLabel("用例操作",{exact:true}).click();
  }
  if(await runPanel.locator(".case-expectation").getAttribute("open")===null)await runPanel.locator(".case-expectation summary").click();
  await runPanel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).selectOption("return");
  for(let i=1;i<=3;i++){
    if(i>1)await runPanel.getByRole("button",{name:"添加用例",exact:true}).click();
    await renameBatchCase(["A","B","C"][i-1]);
    await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).fill("["+i+"]");
    await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill(String(i));
  }
  await runPanel.getByRole("button",{name:"运行全部用例",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===13);
  assert.equal(await runPage.evaluate(()=>window.__runTest.starts[12].cases.length),3);
  assert.equal(await runPage.evaluate(()=>window.__runTest.starts[12].mode),"all");
  await runPanel.getByRole("textbox",{name:"本地测试输入",exact:true}).fill("[30]");
  await runPanel.getByRole("textbox",{name:"预期结果",exact:true}).fill("30");
  await runPage.evaluate(()=>window.__runTest.pending[12]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,results:['{"case":1,"ok":true,"value":1}','{"case":2,"ok":true,"value":99}','{"case":3,"ok":false,"error":"case C failed"}']}));
  const summary=runPanel.getByLabel("批量运行汇总",{exact:true});
  await summary.getByText("符合 1",{exact:true}).waitFor();
  await summary.getByText("不符 1",{exact:true}).waitFor();
  await summary.getByText("错误 1",{exact:true}).waitFor();
  await runPanel.getByText("输入、预期结果已修改 · 重新运行以更新结果",{exact:true}).waitFor();
  assert.deepEqual(await runPage.evaluate(()=>window.__runTest.starts[12].cases.map(c=>c.input)),["[1]","[2]","[3]"]);
  await runPage.screenshot({path:"evidence/named-batch-results.png"});
  await runPanel.getByRole("button",{name:"重跑失败用例",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===14);
  assert.deepEqual(await runPage.evaluate(()=>window.__runTest.starts[13].cases.map(c=>c.name)),["B","C"]);
  assert.deepEqual(await runPage.evaluate(()=>window.__runTest.starts[13].cases.map(c=>c.input)),["[2]","[30]"]);
  await runPage.evaluate(()=>window.__runTest.pending[13]());
  await runPage.evaluate(()=>Object.assign(window.__runTest.result,{phase:"finished",exitCode:0,results:['{"case":1,"ok":true,"value":2}','{"case":2,"ok":true,"value":30}']}));
  await summary.getByText("符合 2",{exact:true}).waitFor();
  assert.equal(await runPanel.getByRole("button",{name:"重跑失败用例",exact:true}).count(),0);
  await runPanel.getByRole("button",{name:"运行全部用例",exact:true}).click();
  await runPage.waitForFunction(()=>window.__runTest.starts.length===15);
  await runPage.evaluate(()=>window.__runTest.pending[14]());
  await runPage.evaluate(()=>{window.__runTest.result.results=['{"case":1,"ok":true,"value":1}'];});
  await runPanel.getByRole("button",{name:"停止",exact:true}).click();
  await summary.getByText("未返回 2",{exact:true}).waitFor();
  assert.equal(await runPanel.getByText("符合预期",{exact:true}).count(),0);
  assert.equal(await runPage.evaluate(()=>window.__runTest.starts.length),15);
  assert.deepEqual(runErrors, []);

  // Attribute synchronous input work separately from display-frame scheduling.
  // These are authored test documents and mocked IPC, never live user code.
  const inputCosts=[],inputProbeText=" // phase probe 01234567890123456789";
  assert.equal(await runPage.getByRole("combobox",{name:"编程语言"}).inputValue(),"java");
  for(const {lines,warm,kind} of [{lines:50,warm:false,kind:"comments"},{lines:1000,warm:false,kind:"comments"},{lines:10000,warm:false,kind:"comments"},{lines:10000,warm:true,kind:"comments"},{lines:1000,warm:true,kind:"java"},{lines:10000,warm:true,kind:"java"}]){
    const source=kind==="comments"?Array.from({length:lines},(_,i)=>"// input cost row "+i+": authored fixture").join("\n"):["class InputCostFixture {","  static int calculate(int x) {",...Array.from({length:lines-5},(_,i)=>"    int value_"+i+" = x + "+i+";"),"    return x;","  }","}"].join("\n");
    const insertion=kind==="comments"?source.length:source.lastIndexOf("return x;")+"return x;".length;
    const inputEditor=runPage.getByRole("textbox",{name:"代码编辑器",exact:true});
    await inputEditor.click();await inputEditor.press("Control+a");
    await inputEditor.evaluate((el,value)=>{
      const data=new DataTransfer();data.setData("text/plain",value);
      el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
    },source);
    await inputEditor.press("Control+End");
    if(kind==="java"){await inputEditor.press("ArrowUp");await inputEditor.press("ArrowUp");await inputEditor.press("End");}
    await runPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await runPage.evaluate(async()=>{
      const {inputCostProbe}=await import("/tests/input-cost-probe.ts");
      window.__inputCostProbe=inputCostProbe(document.querySelector(".code-pane .cm-editor"));
      window.__appCommits=0;window.__checkpointEnqueues=0;
    });
    let sample;
    try{
      if(warm)await runPage.waitForFunction(()=>window.__inputCostProbe.ready(),{},{timeout:30000});
      await inputEditor.pressSequentially(inputProbeText,{delay:20});
      await runPage.waitForFunction(count=>window.__inputCostProbe.read().length===count,inputProbeText.length);
      sample=await runPage.evaluate(async()=>{
        const {EditorView}=await import("/tests/input-harness.ts");
        return {phases:window.__inputCostProbe.read(),appCommits:window.__appCommits,checkpointEnqueues:window.__checkpointEnqueues,text:EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor")).state.doc.toString()};
      });
    }finally{await runPage.evaluate(()=>window.__inputCostProbe?.dispose());}
    assert.equal(sample.text,source.slice(0,insertion)+inputProbeText+source.slice(insertion),"phase instrumentation preserves all typed source");
    assert.equal(sample.checkpointEnqueues,inputProbeText.length,"instrumented edits retain every recovery enqueue");
    assert.ok(sample.phases.every(item=>item.updates>0),"each input has a real document update");
    assert.ok(sample.appCommits<=3,"large already-dirty source must not rerender App per character");
    const stats=field=>{
      const values=sample.phases.map(item=>item[field]).sort((a,b)=>a-b);
      return {p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)};
    };
    inputCosts.push({lines,warm,kind,initialCharacters:source.length,inputCount:sample.phases.length,appCommits:sample.appCommits,checkpointEnqueues:sample.checkpointEnqueues,updateMs:stats("updateMs"),snapshotMs:stats("snapshotMs"),onChangeMs:stats("onChangeMs"),inputToRafMs:stats("inputToRafMs"),samples:sample.phases});
  }
  await writeFile("evidence/EDITOR_INPUT_COST.json",JSON.stringify({
    environment:"GitHub Actions headless Chromium development React; actual App; mocked IPC; language service intentionally absent",
    cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,viewport:"1440x900",
    meaning:"EditorView.update synchronous wall time includes nested snapshot cache-miss flattening and onChange callback. Do not sum overlapping phases. Does not measure input queueing, completed paint, native IPC serialization, disk or LSP. All measured edits are already dirty.",
    samples:inputCosts
  },null,2));


  // Separate sampled CPU pass: keep profiler overhead out of phase timings.
  const profiler=await runPage.context().newCDPSession(runPage);
  const cpuEditor=runPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  const cpuProbe=" // CPU attribution 0123456789012345678901234567890123456789";
  await cpuEditor.focus();await cpuEditor.press("Control+End");await cpuEditor.press("ArrowUp");await cpuEditor.press("ArrowUp");await cpuEditor.press("End");
  const cpuBefore=await runPage.evaluate(async()=>{
    const {EditorView}=await import("/tests/input-harness.ts");
    const state=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor")).state;
    return {text:state.doc.toString(),position:state.selection.main.head};
  });
  await profiler.send("Profiler.enable");
  await profiler.send("Profiler.setSamplingInterval",{interval:1000});
  await profiler.send("Profiler.start");
  let cpuProfile;
  try{await cpuEditor.pressSequentially(cpuProbe,{delay:20});}
  finally{
    cpuProfile=(await profiler.send("Profiler.stop")).profile;
    await profiler.detach();
  }
  const cpuAfter=await runPage.evaluate(async()=>{
    const {EditorView}=await import("/tests/input-harness.ts");
    return EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor")).state.doc.toString();
  });
  assert.equal(cpuAfter,cpuBefore.text.slice(0,cpuBefore.position)+cpuProbe+cpuBefore.text.slice(cpuBefore.position),"CPU profiling preserves complete input");
  await writeFile("evidence/EDITOR_INPUT_CPU.cpuprofile",JSON.stringify(cpuProfile));
  await writeFile("evidence/EDITOR_INPUT_CPU_CONTEXT.json",JSON.stringify({
    environment:"Headless Chromium development App; mocked IPC; no LSP/native disk; 10000 authored Java lines, editing inside method",
    samplingIntervalUs:1000,inputCharacters:cpuProbe.length,initialCharacters:cpuBefore.text.length,
    meaning:"Separate CPU sampling pass after phase measurements; not a native performance trace. Includes typing gaps and background tasks. Analyze stacks, not total duration as per-key cost."
  },null,2));

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
  assert.equal(await conflictPage.locator(".storage-status").innerText(),"","successful file loading adds no persistent sentence");
  assert.equal(await conflictPage.getByText("在线评测需要登录中国站",{exact:true}).count(),0,"login explanation is not permanent workbench clutter");
  await conflictPage.evaluate(() => { window.__conflictTest.file = "external"; });
  await conflictEditor.fill("local draft");
  await conflictEditor.press("Control+s");
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
  await conflictEditor.press("Control+s");
  await conflictPage.locator('[data-action="review-code-conflict"]').waitFor();
  await conflictPage.locator('[data-action="review-code-conflict"]').click();
  await conflictDialog.getByText("文件版本（已删除）", { exact: true }).waitFor();
  await conflictDialog.getByRole("button", { name: "使用文件版本", exact: true }).click();
  await conflictDialog.waitFor({ state: "hidden" });
  assert.equal(await conflictEditor.textContent(), "", "empty CodeMirror line must contain no source characters");
  assert.equal(await conflictPage.evaluate(() => window.__conflictTest.file), null);
  await conflictEditor.fill("after recovery");
  await conflictEditor.press("Control+s");
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
  await openSettings(externalPage,"笔记");
  await externalPage.getByRole("button",{name:"Typora 编辑",exact:true}).click();
  await externalPage.locator(".statusbar").filter({hasText:"请先保存笔记"}).waitFor();
  assert.equal(await externalPage.evaluate(()=>window.__externalTest.opened.length),0,"dirty notes cannot open stale external contents");
  await externalNote.press("Control+s");
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
  await externalNote.press("Control+s");
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
  await solutionCode.press("Control+s");
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
  await solutionCode.press("Control+s");
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
  await solutionsPage.evaluate(()=>{window.__solutionsTest.fail=false;});
  await solutionCode.fill("// unsaved copy A");
  await solutionCode.fill("// unsaved copy B");
  await solutionsPage.locator(".solution-menu>summary").click();
  await solutionsPage.getByRole("button",{name:"复制解答",exact:true}).click();
  const frozenCopy=solutionsPage.getByRole("dialog",{name:"复制解答",exact:true});
  await solutionsPage.evaluate(async()=>{
    const {EditorView}=await import("/tests/input-harness.ts");
    const view=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
    if(!view)throw Error("missing source view");
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:"// changed after copy began"}});
  });
  await frozenCopy.getByRole("textbox",{name:"解答名称",exact:true}).fill("冻结副本");
  await frozenCopy.getByRole("button",{name:"保存",exact:true}).click();
  await frozenCopy.waitFor({state:"hidden"});
  assert.equal(await solutionCode.innerText(),"// unsaved copy B","copy reads newest already-dirty bytes once when operation begins");
  await solutionsPage.getByRole("combobox",{name:"解答",exact:true}).selectOption(first);
  assert.equal(await solutionCode.innerText(),"// changed after copy began","concurrent source edit remains in its original document");
  await solutionsPage.close();
  await writeFile("evidence/NAMED_SOLUTIONS_UI_RESULT.txt","PASS: mocked IPC copy snapshot, rename identity, independent source, language switching, duplicate-name rejection and disk failure preserving draft; native disk/restart tested separately.\n");



  const noTemplatePage=await testPage();
  await noTemplatePage.addInitScript(()=>{
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command)=>{
      if(command==="load_recent_questions")return [{...window.__fixtureQuestions[0],codeSnippets:[]}];
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="load_document")return {code:null,notes:null};
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="external_editor_supported")return false;
      if(command==="stop_language_service")return;
      throw Error("No service in missing-template fixture");
    }};
  });
  await noTemplatePage.goto("http://127.0.0.1:5173");
  const noTemplateCode=noTemplatePage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await noTemplatePage.getByText("官方模板不可用",{exact:true}).waitFor();
  await noTemplateCode.fill("  ");
  await noTemplatePage.getByLabel("源码未保存",{exact:true}).waitFor();
  await noTemplateCode.fill("// user source");
  await noTemplatePage.getByText("官方模板不可用",{exact:true}).waitFor({state:"hidden"});
  await noTemplateCode.fill("   ");
  await noTemplatePage.getByText("官方模板不可用",{exact:true}).waitFor();
  assert.equal(await noTemplatePage.getByLabel("源码未保存",{exact:true}).count(),1,"empty-source indicator updates while dirty membership stays true");
  await noTemplatePage.close();

  const formatPage=await testPage({viewport:{width:1440,height:900}});
  const formatErrors=[];formatPage.on("pageerror",error=>formatErrors.push(error.message));
  await formatPage.addInitScript(()=>{
    window.isTauri=true;
    const state=window.__formatTest={docs:{},saves:[],formats:[],settings:{version:1,formatOnSave:true,overrides:{}},revision:null,failFormat:false,failSave:false,failSettings:false,defer:false};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="external_editor_supported")return false;
      if(command==="login_status")return null;
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return {code:state.docs[args.language]??null,notes:null};
      if(command==="get_editor_settings")return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));
      if(command==="save_editor_settings"){
        if(state.failSettings)throw Error("测试：配置写入失败");
        if(args.expected!==state.revision)throw Error("配置版本冲突");
        state.settings=args.settings;state.revision=JSON.stringify(args.settings);
        return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));
      }
      if(command==="start_language_service")throw Error("No LSP; CLI formatter remains available");
      if(command==="stop_language_service")return;
      if(command==="save_text"){
        if(state.failSave)throw Error("测试：磁盘保存失败");
        if(args.kind==="code"){
          if((state.docs[args.language]??null)!==args.expected)throw Error("fixture CAS conflict");
          state.docs[args.language]=args.text;state.saves.push(args.text);
        }return;
      }
      if(command==="format_source"){
        state.formats.push(args.text);
        if(state.failFormat)throw Error("测试：格式化器失败");
        const output=args.text.replace(/\s*=\s*/g," = ").trimEnd()+"\n";
        if(state.defer)return new Promise(resolve=>{state.reply=()=>resolve(output);});
        return output;
      }
      throw Error("Unexpected formatter IPC: "+command);
    }};
  });
  try {
  await formatPage.goto("http://127.0.0.1:5173");
  await formatPage.getByRole("combobox",{name:"编程语言"}).selectOption("python3");
  const formattedCode=formatPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await formattedCode.fill('中文="值"');
  await formatPage.waitForTimeout(1500);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),0,"idle never formats");
  assert.deepEqual(await formatPage.evaluate(()=>window.__formatTest.saves),[],"idle never writes canonical");
  await formatPage.getByLabel("源码未保存",{exact:true}).waitFor();
  const dirtyGeometry=await formatPage.getByLabel("源码未保存",{exact:true}).evaluate(el=>{const dot=el.getBoundingClientRect(),parent=el.closest(".document-selectors").getBoundingClientRect();return {width:dot.width,height:dot.height,delta:Math.abs(dot.y+dot.height/2-parent.y-parent.height/2),insideActions:!!el.closest(".actions")};});
  assert.equal(dirtyGeometry.width,6);assert.equal(dirtyGeometry.height,6);assert.ok(dirtyGeometry.delta<1,"dirty mark vertically centered beside document identity");assert.equal(dirtyGeometry.insideActions,false);
  assert.equal(await formatPage.locator(".code-pane>.lsp-status").count(),0,"LSP has no duplicate toolbar indicator");

  await formattedCode.press("Control+s");
  await formatPage.waitForFunction(()=>window.__formatTest.docs.python3==='中文 = "值"\n');
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),1);
  assert.deepEqual(await formatPage.evaluate(()=>window.__formatTest.saves),['中文 = "值"\n']);
  await formattedCode.press("Control+z");
  assert.equal(await formattedCode.innerText(),'中文="值"');
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.docs.python3),'中文 = "值"\n');
  await formatPage.getByLabel("源码未保存",{exact:true}).waitFor();
  await formatPage.waitForTimeout(1400);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),1,"undo never triggers format loop");
  await formattedCode.press("Control+y");
  assert.equal((await formattedCode.locator(".cm-line").allTextContents()).join("\n"),'中文 = "值"\n');
  assert.equal(await formatPage.getByLabel("源码未保存",{exact:true}).count(),0);
  await openSettings(formatPage,"编辑器");
  await formatPage.getByRole("checkbox",{name:"保存时格式化",exact:true}).uncheck();
  await formatPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await formatPage.waitForFunction(()=>window.__formatTest.settings.formatOnSave===false);
  await formatPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await formattedCode.fill("x=2");
  await formatPage.waitForTimeout(1400);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),1,"disabled automatic formatter stays idle");
  await formattedCode.press("Control+s");
  await formatPage.waitForFunction(()=>window.__formatTest.docs.python3==="x=2");
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),1,"disabled save skips formatter");
  await openSettings(formatPage,"编辑器");
  await formatPage.evaluate(()=>{window.__formatTest.failSettings=true;});
  await formatPage.getByRole("checkbox",{name:"保存时格式化",exact:true}).check();
  await formatPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await formatPage.getByRole("alert").filter({hasText:"配置写入失败"}).waitFor();
  assert.equal(await formatPage.getByRole("checkbox",{name:"保存时格式化",exact:true}).isChecked(),true,"failed save preserves settings draft");
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.settings.formatOnSave),false);
  await formatPage.evaluate(()=>{window.__formatTest.failSettings=false;});
  await formatPage.getByRole("button",{name:"重新读取",exact:true}).click();
  await formatPage.waitForFunction(()=>!document.querySelector(".format-switch input").checked);
  await formatPage.getByRole("checkbox",{name:"保存时格式化",exact:true}).check();
  await formatPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await formatPage.waitForFunction(()=>window.__formatTest.settings.formatOnSave===true);
  await formatPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await formatPage.evaluate(()=>{window.__formatTest.defer=true;});
  await formattedCode.fill("old=1");await formattedCode.press("Control+s");
  await formatPage.waitForFunction(()=>typeof window.__formatTest.reply==="function");
  await formattedCode.fill("new=2");
  await formatPage.evaluate(()=>{window.__formatTest.reply();window.__formatTest.defer=false;});
  await formatPage.waitForTimeout(200);
  assert.equal(await formattedCode.innerText(),"new=2","late format cannot replace newer input");
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.docs.python3),"x=2","stale format cannot write canonical");


  await formatPage.evaluate(()=>{window.__formatTest.defer=true;window.__formatTest.reply=null;});
  await formattedCode.fill("explicit=1");await formattedCode.press("Control+s");
  await formatPage.waitForFunction(()=>typeof window.__formatTest.reply==="function");
  await formattedCode.fill("explicit=2");await formattedCode.press("Control+s");
  await formatPage.evaluate(()=>{window.__formatTest.defer=false;window.__formatTest.reply();});
  await formatPage.waitForFunction(()=>window.__formatTest.docs.python3==="explicit = 2\n");
  await openSettings(formatPage,"编辑器");
  await formatPage.getByRole("checkbox",{name:"保存时格式化",exact:true}).check();
  await formatPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await formatPage.waitForFunction(()=>window.__formatTest.settings.formatOnSave===true);
  await formatPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await formatPage.evaluate(()=>{window.__formatTest.defer=true;window.__formatTest.reply=null;});
  await formattedCode.fill("queued=1");await formattedCode.press("Control+s");
  await formatPage.waitForFunction(()=>typeof window.__formatTest.reply==="function");
  await formatPage.waitForTimeout(750);
  await formattedCode.fill("queued=2");await formattedCode.press("Control+s");
  await formatPage.waitForTimeout(1400);
  await formattedCode.press("Control+z");
  assert.equal(await formattedCode.innerText(),"queued=1");
  const beforeUndoReply=await formatPage.evaluate(()=>window.__formatTest.formats.length);
  await formatPage.evaluate(()=>{window.__formatTest.reply();window.__formatTest.defer=false;});
  await formatPage.waitForTimeout(1600);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),beforeUndoReply,"undo clears a rerun queued while prior formatting was busy");
  await formattedCode.fill("new=2");
  await formatPage.evaluate(()=>{window.__formatTest.failFormat=true;});
  await formattedCode.press("Control+s");
  await formatPage.getByRole("button",{name:"格式化状态",exact:true}).waitFor();
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.docs.python3),"explicit = 2\n","formatter failure preserves canonical");
  assert.equal(await formattedCode.innerText(),"new=2");
  await formatPage.evaluate(()=>{window.__formatTest.failFormat=false;window.__formatTest.failSave=true;});
  const formatCount=await formatPage.evaluate(()=>window.__formatTest.formats.length);
  await formattedCode.fill("protected=3");await formattedCode.press("Control+s");
  await formatPage.locator('[data-action="review-code-conflict"]').waitFor();
  await formatPage.waitForTimeout(200);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),formatCount+1,"first explicit save formats before write attempt");
  await formattedCode.press("Control+s");await formatPage.waitForTimeout(200);
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.formats.length),formatCount+1,"known blocked save prevents another formatter invocation");
  assert.equal((await formattedCode.locator(".cm-line").allTextContents()).join("\n"),"protected = 3\n","failed write keeps formatted live draft");
  await formatPage.getByLabel("源码未保存",{exact:true}).waitFor();
  assert.equal(await formatPage.evaluate(()=>window.__formatTest.docs.python3),"explicit = 2\n");
  assert.deepEqual(formatErrors,[]);
  } catch(error){
    await formatPage.screenshot({path:"evidence/format-failure.png",fullPage:true});
    await writeFile("evidence/format-failure.json",JSON.stringify(await formatPage.evaluate(()=>({state:window.__formatTest,body:document.body.innerText})),null,2));
    throw error;
  } finally {await formatPage.close();}
  await writeFile("evidence/FORMAT_UI_RESULT.txt","PASS: real CodeMirror + worker; mocked formatter IPC; explicit format before canonical save, idle leaves canonical untouched, dirty markers, Unicode, isolated undo/redo, no loop, disabled save skips format, settings failure+reload, stale response and disk/formatter failure protection. Native adapter formatting verified separately.\n");



  const recoveryPage=await testPage({viewport:{width:1200,height:800}});
  recoveryPage.on("dialog",dialog=>dialog.accept());
  await recoveryPage.addInitScript(()=>{
    window.isTauri=true;
    const stored=JSON.parse(sessionStorage.getItem("explicitRecovery")||'{"code":"A","notes":"N","codeDraft":null,"notesDraft":null}');
    const state=window.__recoveryTest={...stored,epoch:0,writes:0,defer:false};
    const persist=()=>sessionStorage.setItem("explicitRecovery",JSON.stringify({code:state.code,notes:state.notes,codeDraft:state.codeDraft,notesDraft:state.notesDraft}));
    window.__persistRecovery=persist;
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="begin_draft_session")return ++state.epoch;
      if(command==="checkpoint_draft"){
        if(args.epoch!==state.epoch)throw Error("stale epoch");
        state[args.kind+"Draft"]={text:args.text,baseline:args.baseline};persist();return;
      }
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="external_editor_supported")return false;
      if(command==="login_status")return null;
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return JSON.parse(JSON.stringify({code:state.code,notes:state.notes,codeDraft:state.codeDraft,notesDraft:state.notesDraft}));
      if(command==="start_language_service")throw Error("offline");
      if(command==="stop_language_service")return;
      if(command==="save_text"){
        const commit=()=>{
          if(state[args.kind]!==args.expected)throw Error("CAS conflict");
          state[args.kind]=args.text;state.writes++;persist();
        };
        if(state.defer)return new Promise((resolve,reject)=>state.reply=()=>{try{commit();resolve();}catch(e){reject(e);}});
        commit();return;
      }
      throw Error("Unexpected recovery IPC "+command);
    }};
  });
  await recoveryPage.goto("http://127.0.0.1:5173");
  const recoveryCode=recoveryPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await recoveryCode.fill("B");
  await recoveryPage.waitForFunction(()=>window.__recoveryTest.codeDraft?.text==="B");
  assert.equal(await recoveryPage.evaluate(()=>window.__recoveryTest.code),"A");
  await recoveryPage.reload();
  await recoveryPage.waitForFunction(()=>document.querySelector('[aria-label="代码编辑器"]')?.textContent==="B");
  await recoveryPage.getByLabel("源码未保存",{exact:true}).waitFor();
  await recoveryPage.evaluate(()=>{window.__recoveryTest.code="C";window.__persistRecovery();});
  await recoveryPage.reload();
  await recoveryPage.getByLabel("源码未保存",{exact:true}).waitFor();
  await recoveryPage.locator('[data-action="review-code-conflict"]').waitFor();
  assert.equal(await recoveryCode.innerText(),"B","external edit preserves conflicting recovered draft");
  assert.equal(await recoveryPage.evaluate(()=>window.__recoveryTest.code),"C");
  await recoveryPage.evaluate(()=>{window.__recoveryTest.codeDraft={text:"A",baseline:"A"};window.__recoveryTest.notesDraft={text:"N",baseline:"N"};window.__recoveryTest.notes="External note";window.__persistRecovery();});
  await recoveryPage.reload();
  await recoveryPage.waitForFunction(()=>document.querySelector('[aria-label="代码编辑器"]')?.textContent==="C");
  assert.equal(await recoveryPage.getByLabel("源码未保存",{exact:true}).count(),0,"clean sidecar cannot resurrect stale code");
  await recoveryPage.getByRole("button",{name:"笔记",exact:true}).click();
  await recoveryPage.waitForFunction(()=>document.querySelector('[aria-label="Markdown 笔记"]')?.textContent==="External note");
  assert.equal(await recoveryPage.getByLabel("笔记未保存",{exact:true}).count(),0,"clean note sidecar cannot resurrect stale note");
  await recoveryPage.evaluate(()=>{window.__recoveryTest.defer=true;});
  await recoveryCode.fill("D");await recoveryCode.press("Control+s");
  await recoveryPage.waitForFunction(()=>typeof window.__recoveryTest.reply==="function");
  await recoveryCode.fill("E");
  await recoveryPage.waitForFunction(()=>window.__recoveryTest.codeDraft?.text==="E");
  await recoveryPage.evaluate(()=>{window.__recoveryTest.reply();});
  await recoveryPage.waitForFunction(()=>window.__recoveryTest.code==="D"&&window.__recoveryTest.codeDraft?.text==="E"&&window.__recoveryTest.codeDraft?.baseline==="D");
  await recoveryPage.getByLabel("源码未保存",{exact:true}).waitFor();
  await recoveryPage.reload();
  await recoveryPage.waitForFunction(()=>document.querySelector('[aria-label="代码编辑器"]')?.textContent==="E");
  assert.equal(await recoveryPage.locator('[data-action="review-code-conflict"]').count(),0,"newer draft rebased against older committed save");
  await recoveryPage.close();
  await writeFile("evidence/EXPLICIT_RECOVERY_UI_RESULT.txt","PASS: mocked disk IPC, real CodeMirror dirty recovery and external conflict, clean source/notes sidecars ignored, save D while editing E rebases recovery to D without clearing dirty.\n");


  const vimPage=await testPage({viewport:{width:1440,height:900}});
  await vimPage.addInitScript(()=>{
    window.isTauri=true;
    const state=window.__vimTest={code:"one two\nthree four",saves:[],formats:[],settings:{version:1,formatOnSave:false,vim:false,overrides:{}},revision:null};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="external_editor_supported")return false;
      if(command==="login_status")return null;
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return {code:state.code,notes:"note"};
      if(command==="get_editor_settings")return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));
      if(command==="save_editor_settings"){if(args.expected!==state.revision)throw Error("settings conflict");state.settings=args.settings;state.revision=JSON.stringify(args.settings);return JSON.parse(JSON.stringify({settings:state.settings,revision:state.revision}));}
      if(command==="start_language_service")throw Error("offline");
      if(command==="stop_language_service")return;
      if(command==="save_text"){if(args.expected!==state.code)throw Error("save conflict");state.code=args.text;state.saves.push(args.text);return;}
      if(command==="format_source"){state.formats.push(args.text);return args.text.trimEnd()+"\n";}
      throw Error("Unexpected Vim IPC "+command);
    }};
  });
  await vimPage.goto("http://127.0.0.1:5173");
  const vimCode=vimPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await vimCode.waitFor();
  await openSettings(vimPage,"编辑器");
  await vimPage.getByRole("checkbox",{name:"Vim",exact:true}).check();
  await vimPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await vimPage.waitForFunction(()=>window.__vimTest.settings.vim===true);
  await vimPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  await vimCode.click();await vimPage.keyboard.press("Escape");
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-mode")?.textContent==="NORMAL");
  assert.equal(await vimPage.locator(".code-pane .cm-vim-panel").count(),0,"no duplicate local mode bar");
  assert.equal(await vimPage.locator(".statusbar .editor-status-mode").count(),1);
  assert.equal(await vimPage.locator(".cm-vimCursorLayer").first().evaluate(node=>getComputedStyle(node).animationName),"none");
  await vimPage.keyboard.type("i");
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-mode")?.textContent==="INSERT");
  const insertBlock=vimPage.locator(".code-pane .inkleet-insert-cursor").first();
  await insertBlock.waitFor({state:"visible"});
  const block=await insertBlock.boundingBox();assert.ok(block.width>5&&block.height>10,"INSERT cursor has measured character cell");
  await vimPage.waitForTimeout(1500);
  assert.equal(await insertBlock.isVisible(),true,"INSERT block remains steady");
  assert.equal(await vimCode.locator(".cm-line").allTextContents().then(lines=>lines.join("\n")),"one two\nthree four","visual cursor cannot enable overwrite");
  await vimPage.screenshot({path:"evidence/vim-insert-status.png"});
  await vimPage.keyboard.press("Escape");
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-mode")?.textContent==="NORMAL");
  assert.equal(await vimPage.locator(".inkleet-insert-cursor").count(),0,"no stale INSERT cursor in NORMAL");
  await vimPage.screenshot({path:"evidence/vim-normal-status.png"});
  await vimPage.keyboard.type("gg0ciwONE");await vimPage.keyboard.press("Escape");
  const vimText=()=>vimCode.locator(".cm-line").allTextContents().then(lines=>lines.join("\n"));
  assert.equal(await vimText(),"ONE two\nthree four","real Vim ciw replaces word");
  await vimPage.keyboard.type("u");assert.equal(await vimText(),"one two\nthree four");
  await vimPage.keyboard.press("Control+r");assert.equal(await vimText(),"ONE two\nthree four");
  await vimPage.keyboard.press("Tab");assert.equal(await vimText(),"ONE two\nthree four","NORMAL Tab cannot indent source");
  await vimPage.keyboard.type("gg0w.");assert.equal(await vimText(),"ONE ONE\nthree four","dot repeats change");
  await vimPage.keyboard.type("u");
  await vimPage.keyboard.type("/three");await vimPage.keyboard.press("Enter");
  await vimPage.keyboard.type("0vll");await vimPage.keyboard.press("Escape");
  assert.equal(await vimText(),"ONE two\nthree four","search and visual selection preserve source");
  await vimPage.keyboard.type("gg0i");await vimPage.keyboard.insertText("中文 ");await vimPage.keyboard.press("Escape");
  assert.equal(await vimText(),"中文 ONE two\nthree four","Unicode insertion preserved");
  await vimPage.waitForTimeout(1400);
  assert.deepEqual(await vimPage.evaluate(()=>window.__vimTest.saves),[],"Vim edits never idle-save");
  await vimPage.keyboard.type(":w");
  await vimPage.locator(".statusbar .cm-vim-panel input").waitFor({state:"visible"});
  assert.equal(await vimPage.locator(".code-pane .cm-vim-panel").count(),0,"Ex command lives in bottom status");
  await vimPage.keyboard.press("Enter");
  await vimPage.waitForFunction(()=>window.__vimTest.saves.length===1);
  assert.equal(await vimPage.evaluate(()=>window.__vimTest.code),await vimText());
  assert.equal(await vimPage.evaluate(()=>window.__vimTest.formats.length),0,"Vim write respects disabled formatter");
  await vimPage.keyboard.type(":w other.rs");await vimPage.keyboard.press("Enter");
  await vimPage.waitForTimeout(100);
  assert.equal(await vimPage.evaluate(()=>window.__vimTest.saves.length),1,"unsupported write path never writes");
  await vimPage.keyboard.press("Escape");
  await vimPage.keyboard.press("Control+Shift+p");
  await vimPage.getByRole("dialog",{name:"编辑器命令",exact:true}).waitFor();
  await vimPage.keyboard.press("Escape");
  assert.equal(await vimCode.evaluate(node=>node===document.activeElement),true,"palette restores editor focus");
  const beforeVimToggle=await vimText();
  await vimPage.getByRole("button",{name:"笔记",exact:true}).click();
  const vimNotes=vimPage.getByRole("textbox",{name:"Markdown 笔记",exact:true});
  await vimNotes.click();await vimPage.keyboard.press("Escape");
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-meta")?.textContent?.includes("Markdown"));
  await vimPage.keyboard.type("/note");
  await vimPage.locator(".statusbar .cm-vim-panel input").waitFor({state:"visible"});
  await vimPage.keyboard.press("Escape");await vimCode.click();
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-meta")?.textContent?.includes("Rust"));
  assert.equal(await vimText(),beforeVimToggle,"code/notes focus routing preserves code");
  await vimNotes.click();
  await vimPage.getByRole("button",{name:"题目",exact:true}).click();
  await vimPage.waitForFunction(()=>document.querySelector(".editor-status-meta")?.textContent?.includes("Rust"));
  assert.equal(await vimPage.locator(".editor-status-mode").innerText(),"NORMAL","closing active notes restores remaining code status");
  await openSettings(vimPage,"编辑器");
  await vimPage.getByRole("checkbox",{name:"Vim",exact:true}).uncheck();
  await vimPage.getByRole("button",{name:"保存设置",exact:true}).click();
  await vimPage.waitForFunction(()=>window.__vimTest.settings.vim===false);
  await vimPage.getByRole("button",{name:"关闭设置",exact:true}).click();
  assert.equal(await vimText(),beforeVimToggle,"Compartment toggle preserves document");
  assert.equal(await vimPage.locator(".code-pane .cm-vim-panel").count(),0);
  await vimPage.screenshot({path:"evidence/vim-workflow.png"});
  await vimPage.close();
  await writeFile("evidence/VIM_UI_RESULT.txt","PASS: real keyboard modal edits, undo/redo/dot/search/visual selection, Unicode insert (not native IME), NORMAL Tab, explicit :w with disabled formatting, rejected filename, palette focus and dynamic toggle. Native IME and full Zed parity remain unverified.\n");

  const gutterPage=await browser.newPage({viewport:{width:1000,height:700}});
  await gutterPage.route("**/gutter-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body style='margin:0'><div id='editor'></div></body></html>"}));
  await gutterPage.goto("http://127.0.0.1:5173/gutter-test");
  await gutterPage.evaluate(async()=>{
    const {EditorView,EditorState,basicSetup}=await import("/tests/input-harness.ts");
    const {debugGutter}=await import("/src/debug-gutter.ts");
    window.__gutterChanges=[];
    const debug=debugGutter([],lines=>window.__gutterChanges.push(lines));
    const view=new EditorView({parent:document.getElementById("editor"),state:EditorState.create({
      doc:"first\nsecond\nthird\nfourth",
      extensions:[...debug.extensions,basicSetup,EditorView.theme({"&":{height:"300px",fontSize:"14px"},".cm-content":{padding:"8px 0"},".cm-line":{padding:"0 8px"},".cm-scroller":{lineHeight:"1.75"}})]
    })});
    window.__gutterView=view;window.__gutterDebug=debug;
  });
  const lane=gutterPage.locator(".cm-debug-gutter");
  assert.equal(await gutterPage.locator(".cm-execution-gutter").count(),1,"execution has its own reserved lane");
  assert.equal(await gutterPage.locator(".cm-gutters>.cm-gutter").first().getAttribute("class").then(x=>x.includes("cm-debug-gutter")),true,"glyph lane precedes line numbers");
  const boxes=await gutterPage.evaluate(()=>{
    const view=window.__gutterView,lane=document.querySelector(".cm-debug-gutter").getBoundingClientRect();
    return [1,2,3,4].map(n=>{const rect=view.coordsAtPos(view.state.doc.line(n).from);return {x:lane.x+lane.width/2,y:(rect.top+rect.bottom)/2};});
  });
  await gutterPage.mouse.move(boxes[1].x,boxes[1].y);
  await gutterPage.waitForTimeout(30);
  assert.equal(await gutterPage.locator(".cm-debug-gutter .cm-gutterElement").evaluateAll(nodes=>nodes.some(n=>getComputedStyle(n,"::before").content==='""')),true,"empty row displays hover ghost");
  await gutterPage.mouse.click(boxes[1].x,boxes[1].y);
  assert.deepEqual(await gutterPage.evaluate(()=>window.__gutterChanges.at(-1)),[2]);
  assert.equal(await gutterPage.locator(".cm-breakpoint-line").count(),1);
  const changes=await gutterPage.evaluate(()=>window.__gutterChanges.length);
  await gutterPage.mouse.click(boxes[2].x,boxes[2].y,{button:"right"});
  await gutterPage.keyboard.press("Escape");
  await gutterPage.mouse.click(boxes[2].x,boxes[2].y,{button:"middle"});
  assert.equal(await gutterPage.evaluate(()=>window.__gutterChanges.length),changes,"secondary buttons do not toggle breakpoints");
  await gutterPage.keyboard.down("Control");await gutterPage.mouse.click(boxes[2].x,boxes[2].y);await gutterPage.keyboard.up("Control");
  assert.equal(await gutterPage.evaluate(()=>window.__gutterChanges.length),changes,"modified click does not toggle breakpoints");
  await gutterPage.evaluate(()=>window.__gutterDebug.stopped(window.__gutterView,{line:2,column:2,execution:true}));
  const breakpointBox=await gutterPage.locator(".cm-debug-gutter").boundingBox(),pointerBox=await gutterPage.locator(".cm-execution-gutter").boundingBox();
  assert.ok(breakpointBox.x+breakpointBox.width<=pointerBox.x,"breakpoint and pointer occupy disjoint reserved lanes");
  const stopped=gutterPage.locator(".cm-debug-stopped");
  const pausedColor=await stopped.evaluate(node=>getComputedStyle(node).backgroundColor);
  await stopped.click();
  assert.equal(await stopped.evaluate(node=>getComputedStyle(node).backgroundColor),pausedColor,"active line cannot override paused line paint");
  await gutterPage.keyboard.down("Shift");await gutterPage.keyboard.press("ArrowRight");await gutterPage.keyboard.up("Shift");
  assert.equal(await stopped.evaluate(node=>getComputedStyle(node).backgroundColor),pausedColor,"text selection preserves paused background");
  await gutterPage.locator(".cm-line").last().click();
  assert.equal(await stopped.evaluate(node=>getComputedStyle(node).backgroundColor),pausedColor,"moving cursor leaves paused row intact");
  await gutterPage.screenshot({path:"evidence/compact-gutter-interaction.png"});
  await gutterPage.mouse.click(boxes[1].x,boxes[1].y);
  assert.deepEqual(await gutterPage.evaluate(()=>window.__gutterChanges.at(-1)),[]);
  assert.equal(await gutterPage.locator(".cm-execution-pointer").count(),1,"removing breakpoint preserves paused arrow");
  await gutterPage.evaluate(()=>window.__gutterDebug.stopped(window.__gutterView,null));
  await gutterPage.mouse.click(boxes[0].x,2);
  await gutterPage.mouse.click(boxes[0].x,260);
  assert.deepEqual(await gutterPage.evaluate(()=>window.__gutterChanges.at(-1)),[],"padding cannot toggle first or last line");
  await gutterPage.evaluate(()=>window.__gutterView.destroy());
  await gutterPage.close();
  await writeFile("evidence/GUTTER_UI_RESULT.txt","PASS: actual mouse events, separate leading breakpoint and execution lanes, empty-row hover, primary/secondary click isolation, paused+breakpoint composite, row shading and padding exclusion. Native/zoom/wrapping remain separately verified.\n");

  const semanticPage=await browser.newPage();
  await semanticPage.route("**/semantic-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor'></div></body></html>"}));
  await semanticPage.goto("http://127.0.0.1:5173/semantic-test");
  await semanticPage.evaluate(async()=>{
    const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
    const {EditorState}=await import("/node_modules/.vite/deps/@codemirror_state.js");
    const {languageIntelligence,completionChanges}=await import("/src/intelligence.ts");
    const {rust}=await import("/node_modules/.vite/deps/@codemirror_lang-rust.js");
    const {basicSetup}=await import("/node_modules/.vite/deps/codemirror.js");
    const state=window.__semanticTest={version:1,requests:0,active:0,maxActive:0,defer:true,reply:null,revision:0,fail:true};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service")return {id:91,version:1,server:"fixture",uri:"file:///solution.rs",semanticTokens:true};
      if(command==="stop_language_service")return;
      if(command==="update_language_document"){state.version=args.version;return;}
      if(command==="language_diagnostics")return {version:state.version,diagnostics:[],semanticRevision:state.revision};
      if(command==="language_semantic_tokens"){
        state.requests++;state.active++;state.maxActive=Math.max(state.active,state.maxActive);
        try{
          if(state.fail){state.fail=false;throw Error("Indexing fixture");}
          const result={version:args.version,tokens:[{line:0,start:3,end:6,kind:"function",modifiers:[]}]};
          if(state.defer)return await new Promise(resolve=>{state.reply=()=>resolve(result);});
          return result;
        }finally{state.active--;}
      }
      throw Error("Unexpected semantic IPC "+command);
    }};
    const client=languageIntelligence("rust",()=>{},()=>{});
    const view=new EditorView({state:EditorState.create({doc:"fn foo() {}",extensions:[basicSetup,rust(),client.extensions]}),parent:document.querySelector("#editor")});
    window.__semanticTest.client=client;window.__semanticTest.view=view;
    await client.connect(view);
  });
  await semanticPage.waitForFunction(()=>typeof window.__semanticTest.reply==="function");
  assert.equal(await semanticPage.locator(".cm-line span").filter({hasText:/^foo$/}).first().evaluate(el=>getComputedStyle(el).color),"rgb(0, 0, 255)","production basicSetup lexical highlight exists before semantic reply");
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;s.defer=false;s.reply();s.reply=null;});
  await semanticPage.locator(".cm-semantic-function").waitFor();
  assert.equal(await semanticPage.locator(".cm-semantic-function").evaluate(el=>{while(el.lastElementChild)el=el.lastElementChild;return getComputedStyle(el).color;}),"rgb(76, 114, 140)","semantic mark overrides actual Lezer lexical highlighting");
  assert.equal(await semanticPage.evaluate(()=>window.__semanticTest.requests),2,"bounded readiness retry recovers without edits");
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;s.defer=true;s.view.dispatch({changes:{from:3,to:6,insert:"bar"}});});
  assert.equal(await semanticPage.locator(".cm-semantic").count(),0,"edit clears semantic classification immediately");
  await semanticPage.waitForFunction(()=>typeof window.__semanticTest.reply==="function");
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;for(const text of ["baz","qux","end"])s.view.dispatch({changes:{from:3,to:6,insert:text}});});
  await semanticPage.waitForTimeout(400);
  assert.equal(await semanticPage.evaluate(()=>window.__semanticTest.maxActive),1);
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;s.defer=false;s.reply();s.reply=null;});
  await semanticPage.locator(".cm-semantic-function").waitFor();
  assert.equal(await semanticPage.locator(".cm-semantic-function").innerText(),"end","only latest coalesced document receives colors");
  const beforeRefresh=await semanticPage.evaluate(()=>window.__semanticTest.requests);
  await semanticPage.evaluate(()=>window.__semanticTest.revision++);
  await semanticPage.waitForFunction(count=>window.__semanticTest.requests>count,beforeRefresh);
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;s.defer=true;s.view.dispatch({changes:{from:3,to:6,insert:"new"}});});
  await semanticPage.waitForFunction(()=>typeof window.__semanticTest.reply==="function");
  await semanticPage.evaluate(()=>{const s=window.__semanticTest;s.client.destroy();s.reply();s.view.destroy();});
  await semanticPage.waitForTimeout(500);
  assert.equal(await semanticPage.locator(".cm-editor").count(),0);
  await semanticPage.close();
  await writeFile("evidence/SEMANTIC_UI_RESULT.txt","PASS: real CodeMirror with mocked LSP IPC; bounded readiness retry, semantic color, edit clearing, single-flight coalescing, refresh and destroy. Native servers separately unverified.\n");


  const commandPage=await testPage({viewport:{width:1440,height:900}});
  await commandPage.addInitScript(() => {
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
  await commandPage.goto("http://127.0.0.1:5173");
  const commandCode=commandPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await commandCode.fill("command palette draft");
  await commandCode.press("F2");
  assert.equal(await commandPage.locator(".lsp-rename").count(),0,"unavailable LSP command cannot fall through a legacy keymap");
  await commandCode.press("Shift+F12");
  assert.equal(await commandPage.locator(".lsp-references").count(),0,"unavailable references do not bypass registry");
  await commandCode.press("Control+Shift+p");
  const commandDialog=commandPage.getByRole("dialog",{name:"编辑器命令",exact:true});
  await commandDialog.waitFor();
  assert.deepEqual(await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).evaluate(el=>{const s=getComputedStyle(el);return [s.outlineStyle,s.borderTopWidth,s.borderRadius];}),["none","0px","0px"],"palette input keeps a single quiet focus surface despite generic form rules");
  await commandPage.screenshot({path:"evidence/editor-command-palette.png"});
  await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).fill("全选");
  await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).press("Enter");
  assert.equal(await commandDialog.count(),0);
  // Selection is checked directly; clipboard permissions are not part of this test.
  assert.equal(await commandPage.evaluate(()=>window.getSelection()?.toString()),"command palette draft");
  await commandCode.press("Control+Shift+p");
  await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).press("Escape");
  assert.equal(await commandDialog.count(),0);
  assert.equal(await commandCode.innerText(),"command palette draft");
  assert.equal(await commandCode.evaluate(el=>el===document.activeElement),true);
  await commandCode.press("Control+Shift+p");
  await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).fill("不存在的命令");
  assert.equal(await commandDialog.getByRole("option").count(),0);
  await commandDialog.getByRole("combobox",{name:"搜索编辑器命令"}).press("Escape");
  await commandPage.screenshot({path:"evidence/editor-command-palette-closed.png"});
  await commandPage.close();
  await writeFile("evidence/COMMAND_UI_RESULT.txt","PASS: real editor palette search and shared select-all execution, Escape focus restoration, no placeholder commands. Global workbench registry remains future work.\n");


  // The actual App must not expose CPP's ready clangd status while C loads.
  const ownerPage=await testPage({viewport:{width:1200,height:800}});
  await ownerPage.addInitScript(()=>{
    window.isTauri=true;
    const s=window.__statusOwner={next:0,versions:{},calls:[],stopped:[]};
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document"){
        if(args.language==="c")return new Promise(resolve=>{s.releaseLoad=()=>resolve({code:"void f(void) { struct { int value; } pair; pair.va }",notes:null});});
        return {code:"",notes:null};
      }
      if(command==="external_editor_supported")return false;
      if(command==="start_language_service"){
        const result={id:++s.next,version:1,server:args.language==="rust"?"rust-analyzer":"clangd",uri:"file:///sample",completionResolve:false,completionTriggerCharacters:["."]};
        s.versions[result.id]=1;
        if(args.language==="c")return new Promise(resolve=>{s.releaseStart=()=>resolve(result);});
        return result;
      }
      if(command==="update_language_document"){s.versions[args.id]=args.version;return;}
      if(command==="language_diagnostics")return {version:s.versions[args.id],diagnostics:[]};
      if(command==="stop_language_service"){s.stopped.push(args.id);return;}
      if(command==="language_request"){if(args.kind==="completion"){s.calls.push(args);return [{label:"value"}];}return null;}
      if(command==="save_text")return;
      throw Error(command);
    }};
  });
  await ownerPage.goto("http://127.0.0.1:5173");
  await ownerPage.waitForFunction(()=>document.querySelector(".lsp-status")?.classList.contains("ready"));
  await ownerPage.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("cpp");
  await ownerPage.waitForFunction(()=>document.querySelector(".lsp-status")?.getAttribute("data-status")?.includes("clangd 已连接"));
  await ownerPage.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("c");
  await ownerPage.waitForFunction(()=>typeof window.__statusOwner.releaseLoad==="function");
  assert.equal(await ownerPage.getByRole("textbox",{name:"代码编辑器",exact:true}).count(),0,"uncached C editor is still loading");
  assert.equal(await ownerPage.locator(".lsp-status.ready").count(),0,"old CPP ready state must not describe loading C");
  await ownerPage.evaluate(()=>window.__statusOwner.releaseLoad());
  await ownerPage.waitForFunction(()=>typeof window.__statusOwner.releaseStart==="function");
  const ownerCode=ownerPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await ownerCode.waitFor();
  assert.equal(await ownerPage.locator(".lsp-status.ready").count(),0,"C remains not ready while its server starts");
  await ownerCode.press("Control+End");await ownerCode.press("ArrowLeft");await ownerCode.press("ArrowLeft");
  await ownerCode.press("Control+Space");
  await ownerPage.waitForTimeout(200);
  assert.equal(await ownerPage.evaluate(()=>window.__statusOwner.calls.length),0,"unavailable session cannot dispatch completion");
  await ownerPage.evaluate(()=>window.__statusOwner.releaseStart());
  await ownerPage.waitForFunction(()=>document.querySelector(".lsp-status")?.getAttribute("data-status")?.includes("clangd 已连接"));
  await ownerCode.press("Control+Space");
  await ownerPage.getByRole("option",{name:"value",exact:true}).waitFor();
  await ownerPage.keyboard.press("Escape");
  await ownerPage.evaluate(()=>{window.__statusOwner.releaseStart=null;});
  await ownerPage.locator(".lsp-status").click();
  await ownerPage.getByRole("dialog",{name:"设置",exact:true}).getByRole("button",{name:"重连语言服务",exact:true}).click();
  await ownerPage.waitForFunction(()=>typeof window.__statusOwner.releaseStart==="function");
  assert.equal(await ownerPage.locator(".lsp-status.ready").count(),0,"same editor reconnect does not relabel old ready status");
  await ownerPage.evaluate(()=>window.__statusOwner.releaseStart());
  await ownerPage.waitForFunction(()=>document.querySelector(".lsp-status")?.getAttribute("data-status")?.includes("clangd 已连接"));
  await ownerPage.close();
  await writeFile("evidence/LSP_STATUS_OWNERSHIP_UI_RESULT.txt","PASS: actual App CPP-to-C switch never displays previous ready state during deferred document load/start; completion unavailable until new session is ready, then succeeds. Mocked IPC; native verification separate.\\n");



  const breakpointPage=await browser.newPage();
  await breakpointPage.route("**/breakpoint-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor'></div></body></html>"}));
  await breakpointPage.goto("http://127.0.0.1:5173/breakpoint-test");
  await breakpointPage.evaluate(async()=>{
    const {EditorView,EditorState,debugGutter,sameBreakpointLines}=await import("/tests/input-harness.ts");
    const s=window.__breakpointTest={lines:[2],notifications:[]};
    s.gutter=debugGutter(s.lines,lines=>{
      if(sameBreakpointLines(s.lines,lines))return;
      s.lines=lines;s.notifications.push([...lines]);
    });
    s.view=new EditorView({state:EditorState.create({doc:"first\nsecond",extensions:s.gutter.extensions}),parent:document.querySelector("#editor")});
    s.view.focus();
  });
  await breakpointPage.keyboard.type("same line typing");
  assert.deepEqual(await breakpointPage.evaluate(()=>window.__breakpointTest.notifications),[],"same-line typing preserves breakpoint array without App notification");
  await breakpointPage.evaluate(()=>{const s=window.__breakpointTest;s.view.dispatch({changes:{from:0,insert:"\n"}});});
  assert.deepEqual(await breakpointPage.evaluate(()=>window.__breakpointTest.notifications),[[3]],"newline remapping must publish changed breakpoint line");
  await breakpointPage.evaluate(()=>{const s=window.__breakpointTest;s.view.dispatch({selection:{anchor:s.view.state.doc.line(3).from}});s.gutter.toggle(s.view);});
  assert.deepEqual(await breakpointPage.evaluate(()=>window.__breakpointTest.notifications),[[3],[]],"explicit toggle must publish removal");
  await breakpointPage.keyboard.type("typing without points");
  assert.equal(await breakpointPage.evaluate(()=>window.__breakpointTest.notifications.length),2,"empty breakpoint set must not update App per key");
  await breakpointPage.evaluate(()=>window.__breakpointTest.view.destroy());await breakpointPage.close();

  const diagnosticPage=await browser.newPage();
  await diagnosticPage.route("**/diagnostic-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor'></div></body></html>"}));
  await diagnosticPage.goto("http://127.0.0.1:5173/diagnostic-test");
  await diagnosticPage.evaluate(async()=>{
    const {EditorView,EditorState,languageIntelligence,setDiagnostics,setDiagnosticsEffect,diagnosticCount}=await import("/tests/input-harness.ts");
    const s=window.__diagnosticTest={polls:0,applied:0,semanticCalls:0,version:1,revision:0,items:[],stopped:false};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service")return {id:190,version:1,server:"fixture",uri:"file:///s.cpp",semanticTokens:true};
      if(command==="stop_language_service"){s.stopped=true;return;}
      if(command==="update_language_document"){s.version=args.version;return;}
      if(command==="language_semantic_tokens"){s.semanticCalls++;return {version:args.version,tokens:[{line:0,start:0,end:1,kind:"variable",modifiers:[]}]};}
      if(command==="language_diagnostics"){
        s.polls++;
        const result={version:s.stale?s.version-1:s.version,semanticRevision:s.revision,diagnostics:structuredClone(s.items)};
        if(s.defer)return new Promise(resolve=>{s.reply=()=>resolve(result);});
        return result;
      }
      if(command==="language_cancel_completion")return;
      if(command==="language_request")return null;
      throw Error(command);
    }};
    s.client=languageIntelligence("cpp",()=>{},()=>{});
    s.view=new EditorView({state:EditorState.create({doc:"abcd",extensions:[s.client.extensions,EditorView.updateListener.of(update=>{
      s.applied+=update.transactions.flatMap(tr=>tr.effects).filter(effect=>effect.is(setDiagnosticsEffect)).length;
    })]}),parent:document.querySelector("#editor")});
    // Simulates restored cached lint state. First [] must still clear it.
    s.view.dispatch(setDiagnostics(s.view.state,[{from:0,to:1,severity:"error",message:"cached"}]));
    s.applied=0;s.count=()=>diagnosticCount(s.view.state);await s.client.connect(s.view);
  });
  await diagnosticPage.waitForFunction(()=>window.__diagnosticTest.polls>=5);
  const stableDiagnostics=await diagnosticPage.evaluate(()=>({polls:window.__diagnosticTest.polls,applied:window.__diagnosticTest.applied,count:window.__diagnosticTest.count()}));
  assert.equal(stableDiagnostics.applied,1,"equal fresh-array polls produce one first diagnostics transaction");
  assert.equal(stableDiagnostics.count,0,"first empty response clears cached lint state");
  const semanticBefore=await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.revision++;return s.semanticCalls;});
  await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.semanticCalls>n,semanticBefore);
  assert.equal(await diagnosticPage.evaluate(()=>window.__diagnosticTest.applied),1,"semantic revision refresh survives unchanged diagnostics without lint transaction");
  let diagnosticApplications=1;
  for(const change of [
    {message:"first",severity:2,range:{start:{line:0,character:0},end:{line:0,character:1}}},
    {message:"changed",severity:2,range:{start:{line:0,character:0},end:{line:0,character:1}}},
    {message:"changed",severity:1,range:{start:{line:0,character:0},end:{line:0,character:1}}},
    {message:"changed",severity:1,range:{start:{line:0,character:1},end:{line:0,character:2}}}
  ]){
    await diagnosticPage.evaluate(item=>{window.__diagnosticTest.items=[item];},change);
    await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.applied===n,++diagnosticApplications);
  }
  await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.view.dispatch({changes:{from:4,insert:"x"}});});
  await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.applied===n,++diagnosticApplications);
  const staleBoundary=await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.stale=true;return s.polls;});
  await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.polls>=n+2,staleBoundary);
  assert.equal(await diagnosticPage.evaluate(()=>window.__diagnosticTest.applied),diagnosticApplications,"stale diagnostic versions cannot apply");
  await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.stale=false;s.defer=true;s.reply=null;});
  await diagnosticPage.waitForFunction(()=>typeof window.__diagnosticTest.reply==="function");
  await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.view.dispatch({changes:{from:5,insert:"y"}});s.defer=false;s.reply();});
  await diagnosticPage.waitForTimeout(100);
  assert.equal(await diagnosticPage.evaluate(()=>window.__diagnosticTest.applied),diagnosticApplications,"late old-document diagnostics cannot apply");
  await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.applied===n,++diagnosticApplications);
  await diagnosticPage.evaluate(()=>{window.__diagnosticTest.items=[];});
  await diagnosticPage.waitForFunction(n=>window.__diagnosticTest.applied===n,++diagnosticApplications);
  assert.equal(await diagnosticPage.evaluate(()=>window.__diagnosticTest.count()),0,"nonempty-to-empty diagnostics clears markers");
  await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.defer=true;s.reply=null;});
  await diagnosticPage.waitForFunction(()=>typeof window.__diagnosticTest.reply==="function");
  await diagnosticPage.evaluate(()=>{const s=window.__diagnosticTest;s.client.destroy();s.reply();});
  await diagnosticPage.waitForTimeout(100);
  assert.equal(await diagnosticPage.evaluate(()=>window.__diagnosticTest.applied),diagnosticApplications,"destroyed client rejects late diagnostics");
  await writeFile("evidence/DIAGNOSTICS_DEDUP_RESULT.json",JSON.stringify({stable:stableDiagnostics,total:await diagnosticPage.evaluate(()=>({polls:window.__diagnosticTest.polls,applied:window.__diagnosticTest.applied,semanticCalls:window.__diagnosticTest.semanticCalls})),scope:"Actual CodeMirror with mocked IPC; deterministic transaction count, not native latency benchmark"},null,2));
  await diagnosticPage.evaluate(()=>window.__diagnosticTest.view.destroy());await diagnosticPage.close();


  const serializationPage=await browser.newPage();
  await serializationPage.route("**/serialization-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor' style='height:500px'></div></body></html>"}));
  await serializationPage.route("**/src/snapshot-text.ts*",async route=>{
    const response=await route.fetch();let body=await response.text();
    const marker=/const text\s*=\s*doc\.toString\(\);/;
    assert.ok(marker.test(body),"instrument actual production cache miss only");
    body=body.replace(marker,'const text = doc.toString(); window.__serializationMisses.set(doc, (window.__serializationMisses.get(doc) ?? 0) + 1);');
    await route.fulfill({response,body});
  });
  await serializationPage.goto("http://127.0.0.1:5173/serialization-test");
  await serializationPage.evaluate(async()=>{
    window.__serializationMisses=new Map();
    const s=window.__serializationTest={edits:[],saves:[],statuses:[],errors:[],updates:[],formats:[],requests:0,version:1,defer:false,reply:null};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service")return {id:93,version:1,server:"serialization",uri:"file:///solution.py",completionResolve:false};
      if(command==="update_language_document"){s.updates.push(args.text);s.version=args.version;return;}
      if(command==="language_diagnostics")return {version:s.version,diagnostics:[]};
      if(command==="language_request"){if(args.kind==="completion"){s.requests++;return [{label:"value"}];}return null;}
      if(command==="language_cancel_completion"||command==="stop_language_service")return;
      if(command==="format_source"){s.formats.push(args.text);if(s.defer)return new Promise(resolve=>{s.reply=()=>resolve(args.text+"# stale");});return args.text;}
      throw Error(command);
    }};
    const {mountSerializationEditor}=await import("/tests/serialization-harness.tsx");
    s.unmount=mountSerializationEditor(document.querySelector("#editor"),s);
  });
  await serializationPage.waitForFunction(()=>window.__serializationTest.statuses.some(s=>s.includes("已连接")));
  const serialCode=serializationPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  const serialText="# 中文😀\nvalue = 1\n";
  await serialCode.fill(serialText);
  await serialCode.press("Control+Space");
  await serializationPage.waitForFunction(()=>window.__serializationTest.requests>0);
  await serialCode.press("Escape");
  await serialCode.press("Control+s");
  await serializationPage.waitForFunction(()=>window.__serializationTest.saves.length===1);
  const serialEvidence=await serializationPage.evaluate(async()=>{
    const {EditorView}=await import("/tests/serialization-harness.tsx");
    const doc=EditorView.findFromDOM(document.querySelector(".cm-editor")).state.doc,s=window.__serializationTest;
    return {misses:window.__serializationMisses.get(doc),edits:s.edits,updates:s.updates,formats:s.formats,saves:s.saves};
  });
  await writeFile("evidence/DOCUMENT_SERIALIZATION_RESULT.json",JSON.stringify(serialEvidence,null,2));
  assert.equal(serialEvidence.misses,1,"actual editor, LSP flush, format validation and save share one materialization");
  assert.equal(serialEvidence.edits.at(-1),serialText);
  assert.equal(serialEvidence.updates.at(-1),serialText);
  assert.equal(serialEvidence.formats.at(-1),serialText);
  assert.equal(serialEvidence.saves.at(-1),serialText);
  await serializationPage.evaluate(()=>{window.__serializationTest.defer=true;});
  await serialCode.fill("value = 2");
  await serialCode.press("Control+s");
  await serializationPage.waitForFunction(()=>typeof window.__serializationTest.reply==="function");
  await serialCode.fill("value = 3");
  await serializationPage.evaluate(()=>{window.__serializationTest.defer=false;window.__serializationTest.reply();});
  await serializationPage.waitForTimeout(250);
  assert.equal(await serialCode.innerText(),"value = 3","late format preserves latest owned source");
  assert.deepEqual(await serializationPage.evaluate(()=>window.__serializationTest.saves),[serialText],"stale formatting cannot save");
  assert.equal(await serializationPage.evaluate(()=>window.__serializationTest.edits.at(-1)),"value = 3");
  await serializationPage.evaluate(()=>window.__serializationTest.unmount());
  await serializationPage.close();



  // The real React CodeEditor remounts with fresh extension owners while recent
  // immutable states retain history. Eviction must never replace workspace text.
  const sessionPage=await browser.newPage({viewport:{width:900,height:500}});
  await sessionPage.route("**/session-cache-test",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><style>#editor{height:240px;display:flex;flex-direction:column}.editor-host{flex:1;min-height:0;overflow:hidden}</style></head><body><div id="editor"></div></body></html>'}));
  await sessionPage.goto("http://127.0.0.1:5173/session-cache-test");
  const sessionOriginal=Array.from({length:120},(_,i)=>"value_"+i+" = "+i).join("\n");
  await sessionPage.evaluate(async text=>{
    const {mountSessionEditor}=await import("/tests/session-cache-harness.tsx");
    window.__sessionCache=mountSessionEditor(document.querySelector("#editor"));
    await window.__sessionCache.open("retained",text);
  },sessionOriginal);
  const sessionCode=sessionPage.getByRole("textbox",{name:"会话代码",exact:true});
  await sessionCode.click();await sessionCode.press("Control+End");await sessionCode.press("End");
  await sessionCode.press("X");
  await sessionPage.waitForFunction(()=>window.__sessionCache.inspect().top>0&&window.__sessionCache.inspect().text.endsWith("X"));
  const sessionBefore=await sessionPage.evaluate(()=>window.__sessionCache.inspect());
  await sessionPage.evaluate(async()=>{await window.__sessionCache.open("other","other = 1");await window.__sessionCache.open("retained");});
  await sessionPage.waitForFunction(top=>Math.abs(window.__sessionCache.inspect().top-top)<2,sessionBefore.top);
  const sessionRestored=await sessionPage.evaluate(()=>window.__sessionCache.inspect());
  assert.equal(sessionRestored.text,sessionOriginal+"X");
  assert.equal(sessionRestored.draft,sessionOriginal+"X");
  assert.equal(sessionRestored.anchor,sessionBefore.anchor);assert.equal(sessionRestored.head,sessionBefore.head);
  assert.equal(sessionRestored.undo,sessionBefore.undo);
  await sessionCode.focus();await sessionCode.press("Control+z");
  assert.equal((await sessionPage.evaluate(()=>window.__sessionCache.inspect())).text,sessionOriginal);
  await sessionCode.press("Control+Shift+z");
  assert.equal((await sessionPage.evaluate(()=>window.__sessionCache.inspect())).text,sessionOriginal+"X");
  await sessionPage.evaluate(async()=>{await window.__sessionCache.open("other");await window.__sessionCache.open("retained","external = 42");});
  const sessionExternal=await sessionPage.evaluate(()=>window.__sessionCache.inspect());
  assert.equal(sessionExternal.text,"external = 42");assert.equal(sessionExternal.undo,0,"external content rejects old undo state");
  await sessionPage.evaluate(()=>window.__sessionCache.open("evicted","draft = 1"));
  await sessionCode.focus();await sessionCode.press("Control+End");await sessionCode.press("X");
  const sessionEvictBefore=await sessionPage.evaluate(()=>window.__sessionCache.inspect());
  assert.equal(sessionEvictBefore.text,"draft = 1X");assert.ok(sessionEvictBefore.undo>0);
  await sessionPage.evaluate(async()=>{
    for(let i=0;i<13;i++)await window.__sessionCache.open("inactive-"+i,"value = "+i);
    await window.__sessionCache.open("evicted");
  });
  const sessionEvicted=await sessionPage.evaluate(()=>window.__sessionCache.inspect());
  assert.equal(sessionEvicted.text,"draft = 1X");assert.equal(sessionEvicted.draft,"draft = 1X","eviction does not discard the canonical draft");
  assert.equal(sessionEvicted.undo,0,"evicted in-memory history is not resurrected");
  await sessionCode.focus();await sessionCode.press("Control+z");
  assert.equal((await sessionPage.evaluate(()=>window.__sessionCache.inspect())).text,"draft = 1X");
  await writeFile("evidence/EDITOR_SESSION_CACHE_RESULT.json",JSON.stringify({environment:"Chromium React CodeEditor; in-memory workspace drafts; no native IPC",retained:sessionRestored,external:sessionExternal,evicted:sessionEvicted},null,2));
  await sessionPage.evaluate(()=>window.__sessionCache.dispose());await sessionPage.close();

  const snippetWorkerPage=await browser.newPage();
  await snippetWorkerPage.route("**/snippet-worker-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body>Snippet worker fixture</body></html>"}));
  await snippetWorkerPage.goto("http://127.0.0.1:5173/snippet-worker-test");
  const snippetWorkerEvidence=await snippetWorkerPage.evaluate(async()=>{
    const {SnippetPreparationService}=await import("/src/snippet-service.ts");
    const s=new SnippetPreparationService(),dollar="$";
    try{
      const normal=await s.prepare(dollar+"{1:中文} "+dollar+"1 "+dollar+"0");
      const pending=await s.prepare(dollar+"{1/(a+)+$/x/}");
      const first=s.prepare("old").then(()=>false,error=>String(error).includes("canceled"));
      s.cancel();const canceled=await first;
      const recovered=await s.prepare(dollar+"{FILE:fallback}",{FILE:{kind:"value",value:"test.rs"}});
      const transformed=await s.prepare(dollar+"{X/(.*)/"+dollar+"{1:/upcase}/}",{X:{kind:"value",value:"hello"}});
      let heartbeat=0;const beat=setInterval(()=>heartbeat++,10);let timedOut=false;
      try{await s.prepare(dollar+"{X/(a+)+$/x/}",{X:{kind:"value",value:"a".repeat(10000)+"!"}});}catch(error){timedOut=String(error).includes("timed out");}finally{clearInterval(beat);}
      const afterTimeout=await s.prepare("recovered");
      let bounded=false;
      try{await s.prepare((dollar+"1 ").repeat(513));}catch{bounded=true;}
      return {normal,pending,canceled,recovered,bounded,transformed,timedOut,heartbeat,afterTimeout,scope:"Actual same-origin Vite module worker including bounded regex evaluation; no native packaged acceptance"};
    }finally{s.destroy();}
  });
  await writeFile("evidence/SNIPPET_WORKER_RESULT.json",JSON.stringify(snippetWorkerEvidence,null,2));
  assert.equal(snippetWorkerEvidence.normal.text,"中文 中文 ");
  assert.deepEqual(snippetWorkerEvidence.normal.navigation,["t:1","t:0"]);
  assert.equal(snippetWorkerEvidence.pending.needsTransformEvaluation,false);
  assert.equal(snippetWorkerEvidence.pending.transformState,"resolved");
  assert.equal(snippetWorkerEvidence.canceled,true);
  assert.equal(snippetWorkerEvidence.recovered.text,"test.rs");
  assert.equal(snippetWorkerEvidence.bounded,true);
  assert.equal(snippetWorkerEvidence.transformed.text,"HELLO");
  assert.equal(snippetWorkerEvidence.timedOut,true,"pathological regex is terminated by its owner");
  assert.ok(snippetWorkerEvidence.heartbeat>10,"UI event loop remains active while regex worker is blocked");
  assert.equal(snippetWorkerEvidence.afterTimeout.text,"recovered","later explicit request can create a fresh worker");
  await snippetWorkerPage.close();


  const snippetPage=await browser.newPage();
  await snippetPage.route("**/snippet-session-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor' style='height:500px'></div></body></html>"}));
  await snippetPage.goto("http://127.0.0.1:5173/snippet-session-test");
  await snippetPage.evaluate(async()=>{
    const api=await import("/tests/snippet-session-harness.tsx");
    const s=window.__snippetSessionTest={api,value:"",edits:[],statuses:[],saves:[],formats:[],errors:[],version:1};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="format_source"){s.formats.push(args.text);return args.text;}
      if(command==="start_language_service")return {id:97,version:1,server:"snippet-fixture",uri:"file:///solution.py",completionResolve:false};
      if(command==="update_language_document"){s.version=args.version;return;}
      if(command==="language_diagnostics")return {version:s.version,diagnostics:[]};
      if(command==="language_request")return args.kind==="completion"?[{label:"nameComplete"}]:null;
      if(command==="language_cancel_completion"||command==="stop_language_service")return;
      throw Error(command);
    }};
    s.mount=api.mountSnippetEditor(document.querySelector("#editor"),s);
    s.view=()=>api.EditorView.findFromDOM(document.querySelector(".cm-editor"));
    s.insert=()=>{
      const v=s.view(),d="$",prepared=api.prepareSnippet(d+"{1:name} = "+d+"1; "+d+"{2:value}"+d+"0");
      const spec=api.snippetInsertion(v.state,prepared,0,v.state.doc.length);
      if(!spec)throw Error("Snippet refused");v.dispatch(spec);v.focus();
    };
  });
  const snippetCode=snippetPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await snippetCode.waitFor();
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.statuses.some(text=>text.includes("已连接")));
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insert());
  await snippetCode.press("ArrowRight");await snippetCode.press("X");
  assert.equal(await snippetCode.innerText(),"nameX = nameX; value","narrowing selection does not break mirrors");
  await snippetCode.press("Tab");
  await snippetCode.press("4");await snippetCode.press("2");
  assert.equal(await snippetCode.innerText(),"nameX = nameX; 42");
  await snippetCode.press("Shift+Tab");
  const selectedSnippet=await snippetPage.evaluate(()=>{const v=window.__snippetSessionTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);});
  assert.equal(selectedSnippet,"nameX","Shift-Tab navigates rather than outdents");
  await snippetCode.press("Escape");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)),null);
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.selection.main.head),5,"Escape collapses the existing selection at its end");
  await snippetCode.press("Y");
  assert.equal(await snippetCode.innerText(),"nameXY = nameX; 42","Escape cancels linkage without removing text");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.mount.setVim(true));
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.api.vimNormal(window.__snippetSessionTest.view()));
  await snippetCode.press("i");
  await snippetPage.waitForFunction(()=>!window.__snippetSessionTest.api.vimNormal(window.__snippetSessionTest.view()));
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insert());
  await snippetCode.press("Escape");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.api.vimNormal(window.__snippetSessionTest.view())),true,"snippet Escape does not swallow Vim normal transition");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)),null);
  await snippetPage.evaluate(()=>window.__snippetSessionTest.mount.setVim(false));
  await snippetPage.waitForFunction(()=>!window.__snippetSessionTest.api.getCM(window.__snippetSessionTest.view()));
  await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest;s.insert();
    s.view().contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"中"}));
  });
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)),null,"composition boundary cancels partial session without consuming input");
  await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest;s.insert();s.mount.destroy();
    s.mount=s.api.mountSnippetEditor(document.querySelector("#editor"),s);
  });
  await snippetCode.waitFor();
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)),null,"cached EditorState cannot revive disposed snippet ownership");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insert());
  await snippetCode.press("ArrowRight");await snippetCode.press("Control+Space");
  await snippetPage.getByRole("option",{name:"nameComplete",exact:true}).waitFor();
  await snippetCode.press("Tab");
  const fastSnippetTab=await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest,v=s.view(),session=v.state.field(s.api.snippetSessionState);
    return {text:v.state.doc.toString(),head:v.state.selection.main.head,group:session?.fields.find(f=>f.id===session.active)?.group,completion:s.api.completionStatus(v.state)};
  });
  await writeFile("evidence/snippet-fast-tab.json",JSON.stringify(fastSnippetTab,null,2));
  if(fastSnippetTab.text!=="nameComplete = nameComplete; value"){
    assert.equal(fastSnippetTab.text,"name = name; value","fast popup Tab must not insert indentation");
    assert.equal(fastSnippetTab.group,"t:1","fast popup Tab must not advance snippet");
    assert.equal(fastSnippetTab.head,4);
    assert.equal(fastSnippetTab.completion,"active","unaccepted completion remains available during CM interaction delay");
    await snippetPage.waitForTimeout(100);
    await snippetCode.press("Tab");
  }
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.value==="nameComplete = nameComplete; value");
  assert.equal(await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState);return s.fields.find(f=>f.id===s.active).group;}),"t:1","popup Tab accepts completion without also advancing snippet");
  await snippetCode.press("Tab");
  assert.equal(await snippetPage.evaluate(()=>{const v=window.__snippetSessionTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"value");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insert());
  await snippetCode.press("ArrowRight");await snippetCode.press("X");await snippetCode.press("Control+z");
  assert.equal(await snippetCode.innerText(),"name = name; value","keyboard undo restores source and mirror together");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)),null);
  await snippetCode.press("Control+y");
  assert.equal(await snippetCode.innerText(),"nameX = nameX; value","keyboard redo restores linked text without reactivating session");

  await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest;
    s.insertChoice=()=>{
      const v=s.view(),d="$",prepared=s.api.prepareSnippet(d+"{1|one,two,three|} / "+d+"1; "+d+"{2:done}"+d+"0");
      const spec=s.api.snippetInsertion(v.state,prepared,0,v.state.doc.length);if(!spec)throw Error("Choice refused");
      v.dispatch(spec);v.focus();
    };s.insertChoice();
  });
  const choiceList=snippetPage.getByRole("listbox",{name:"参数选项",exact:true});
  await choiceList.waitFor();await snippetCode.press("ArrowDown");await snippetCode.press("Enter");
  assert.equal(await snippetCode.innerText(),"two / two; done","choice Enter updates every mirror");
  await choiceList.waitFor({state:"hidden"});
  await snippetCode.press("Shift+Tab");
  await choiceList.getByRole("option",{name:"two",exact:true}).getAttribute("aria-selected").then(value=>assert.equal(value,"true"));
  await snippetCode.press("ArrowDown");await snippetCode.press("Tab");
  assert.equal(await snippetCode.innerText(),"three / three; done","choice Tab commits then advances");
  assert.equal(await snippetPage.evaluate(()=>{const v=window.__snippetSessionTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"done");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertChoice());
  await choiceList.getByRole("option",{name:"two",exact:true}).click();
  assert.equal(await snippetCode.innerText(),"two / two; done","pointer choice keeps editor ownership and mirrors");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertChoice());
  const staleChoice=await choiceList.getByRole("option",{name:"two",exact:true}).elementHandle();
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insert());
  await staleChoice.evaluate(button=>button.click());
  assert.equal(await snippetCode.innerText(),"name = name; value","detached choice cannot change a replacement session");
  await snippetPage.screenshot({path:"evidence/snippet-flat-session.png"});
  await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest;
    s.insertNested=()=>{
      const v=s.view(),d="$",prepared=s.api.prepareSnippet(d+"{1:a"+d+"{2:b}c} / "+d+"1 / "+d+"2"+d+"0");
      const spec=s.api.snippetInsertion(v.state,prepared,0,v.state.doc.length);if(!spec)throw Error("Nested snippet refused");
      v.dispatch(spec);v.setTabFocusMode(false);v.focus();
    };s.insertNested();
  });
  await snippetCode.press("Tab");await snippetPage.keyboard.insertText("nested");
  assert.equal(await snippetCode.innerText(),"anestedc / anestedc / nested");
  await snippetCode.press("Control+z");assert.equal(await snippetCode.innerText(),"abc / abc / b","nested mirrors undo atomically");
  await snippetCode.press("Control+y");assert.equal(await snippetCode.innerText(),"anestedc / anestedc / nested");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertNested());
  await snippetPage.keyboard.insertText("Z");
  assert.equal(await snippetCode.innerText(),"Z / Z / b","replacing parent prunes contained children only");
  await snippetCode.press("Tab");await snippetPage.keyboard.insertText("Q");
  assert.equal(await snippetCode.innerText(),"Z / Z / Q","external child survivor remains reachable by Tab");
  await snippetPage.screenshot({path:"evidence/snippet-nested-session.png"});
  await writeFile("evidence/SNIPPET_NESTED_SESSION_RESULT.txt","PASS: actual CodeEditor Tab child navigation, nested mirror typing, atomic undo/redo, whole-parent replacement and external-child survivor navigation. Plain nested placeholders only; nested transforms and native IME remain unverified.\n");

  await snippetPage.evaluate(async()=>{
    const s=window.__snippetSessionTest;
    s.insertDerived=async(catastrophic=false)=>{
      const d="$",source=catastrophic?d+"{1:a} / "+d+"{1/(a+)+$/x/}; "+d+"{2:tail}"+d+"0":
        d+"{1:hello} -> "+d+"{1/(.*)/"+d+"{1:/upcase}/}; "+d+"{2:tail}"+d+"0";
      const service=new s.api.SnippetPreparationService(),view=s.view(),doc=view.state.doc;
      try{
        const prepared=await service.prepare(source);if(view.state.doc!==doc)throw Error("Fixture source changed");
        const spec=s.api.snippetInsertion(view.state,prepared,0,view.state.doc.length);if(!spec)throw Error("Derived snippet refused");
        view.dispatch(spec);view.focus();
      }finally{service.destroy();}
    };
    await s.insertDerived();
  });
  await snippetPage.keyboard.insertText("world");
  assert.equal(await snippetCode.innerText(),"world -> HELLO; tail","placeholder transform waits for field-leave commit");
  await snippetCode.press("Tab");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.value==="world -> WORLD; tail");
  assert.equal(await snippetPage.evaluate(()=>{const v=window.__snippetSessionTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"tail");
  await snippetPage.screenshot({path:"evidence/snippet-transform-session.png"});
  await snippetCode.press("Control+z");
  assert.equal(await snippetCode.innerText(),"world -> HELLO; tail","undo first reverses transform/navigation commit");
  await snippetCode.press("Control+z");assert.equal(await snippetCode.innerText(),"hello -> HELLO; tail","next undo reverses typing");
  await snippetCode.press("Control+y");await snippetCode.press("Control+y");
  assert.equal(await snippetCode.innerText(),"world -> WORLD; tail","redo replays committed transform text without a new worker");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived());
  await snippetPage.keyboard.insertText("saved");
  await snippetCode.press("Control+s");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.saves.at(-1)==="saved -> SAVED; tail");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.formats.at(-1)),"saved -> SAVED; tail","formatter sees settled transform text");

  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived());
  await snippetPage.keyboard.insertText("button");
  await snippetPage.evaluate(()=>{
    const button=document.createElement("button");button.id="snippet-save-button";button.textContent="Save fixture";
    button.onclick=()=>window.__snippetSessionTest.save?.();document.body.appendChild(button);
  });
  await snippetPage.locator("#snippet-save-button").click();
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.saves.at(-1)==="button -> BUTTON; tail");
  for(const command of ["保存","格式化文档"]){
    await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived());
    const before=await snippetPage.evaluate(()=>({saves:window.__snippetSessionTest.saves.length,formats:window.__snippetSessionTest.formats.length}));
    await snippetPage.keyboard.insertText("palette");
    await snippetCode.press("Control+Shift+p");
    const search=snippetPage.getByRole("combobox",{name:"搜索编辑器命令",exact:true});
    await search.fill(command);await search.press("Enter");
    await snippetPage.waitForFunction(n=>window.__snippetSessionTest.formats.length>n&&window.__snippetSessionTest.formats.at(-1)==="palette -> PALETTE; tail",before.formats);
    if(command==="保存")await snippetPage.waitForFunction(n=>window.__snippetSessionTest.saves.length===n+1,before.saves);
    else assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length),before.saves,"format command does not save");
    assert.ok(await snippetPage.evaluate(n=>window.__snippetSessionTest.formats.length>n,before.formats));
  }
  await snippetPage.evaluate(()=>window.__snippetSessionTest.mount.setVim(true));
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.api.vimNormal(window.__snippetSessionTest.view()));
  await snippetCode.press("i");await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived());
  await snippetPage.keyboard.insertText("vim");
  await snippetCode.press("Escape");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)?.dormant),true);
  await snippetCode.press(":");await snippetPage.keyboard.type("w");await snippetPage.keyboard.press("Enter");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.saves.at(-1)==="vim -> VIM; tail");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.mount.setVim(false));
  await snippetPage.waitForFunction(()=>!window.__snippetSessionTest.api.getCM(window.__snippetSessionTest.view()));
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived(true));
  await snippetPage.keyboard.insertText("a".repeat(5000)+"!");
  await snippetCode.press("Tab");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)?.waiting===true);
  await snippetCode.press("Control+z");
  await snippetPage.waitForTimeout(200);
  assert.equal(await snippetCode.innerText(),"a / x; tail","undo cancels pending transform ownership");
  const savesBeforeCanceledTransform=await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length);
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived(true));
  await snippetPage.keyboard.insertText("a".repeat(5000)+"!");
  await snippetCode.press("Control+s");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)?.waiting===true);
  await snippetCode.press("x");
  await snippetPage.waitForTimeout(200);
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length),savesBeforeCanceledTransform,"editing cancels pending save settlement, never saves stale derived output");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)?.waiting),false);
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived(true));
  await snippetPage.keyboard.insertText("a".repeat(5000)+"!");
  await snippetCode.press("Tab");
  await snippetPage.getByRole("alert").filter({hasText:"参数转换失败"}).waitFor();
  assert.ok((await snippetCode.innerText()).endsWith("! / x; tail"),"worker timeout preserves user source and previous derived value");
  await snippetCode.press("Escape");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.insertDerived(true));
  await snippetPage.keyboard.insertText("a".repeat(5000)+"!");
  await snippetCode.press("Escape");
  const dormantSaveCount=await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length);
  await snippetCode.press("Control+s");
  await snippetPage.waitForFunction(()=>window.__snippetSessionTest.view().state.field(window.__snippetSessionTest.api.snippetSessionState)?.waiting===true);
  await snippetCode.press("Escape");
  assert.deepEqual(await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest,v=s.view(),f=v.state.field(s.api.snippetSessionState);return {dormant:f?.dormant,waiting:f?.waiting,error:f?.error};}),{dormant:true,waiting:false,error:null},"Escape cancels dormant save ownership");
  await snippetPage.waitForTimeout(1700);
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length),dormantSaveCount,"canceled dormant save never runs after worker deadline");
  await snippetCode.press("Control+s");
  await snippetPage.getByRole("alert").filter({hasText:"参数转换失败"}).waitFor();
  const failedSnapshot=await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest,v=s.view();return {text:v.state.doc.toString(),undo:s.api.undoDepth(v.state)};});
  await snippetPage.evaluate(()=>window.__snippetSessionTest.view().contentDOM.blur());
  await snippetCode.focus();
  await snippetCode.press("Escape");
  await snippetPage.getByRole("alert").filter({hasText:"参数转换失败"}).waitFor({state:"hidden"});
  assert.deepEqual(await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest,v=s.view();return {text:v.state.doc.toString(),undo:s.api.undoDepth(v.state)};}),failedSnapshot,"explicit failure exit preserves text and undo history");
  assert.equal(await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest;return s.view().state.field(s.api.snippetSessionState);}),null,"explicit Escape after failure relinquishes transform authority");
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length),dormantSaveCount,"failed dormant settlement never saves");
  await snippetCode.press("Control+s");
  await snippetPage.waitForFunction(n=>window.__snippetSessionTest.saves.length===n+1,dormantSaveCount);
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.at(-1)),failedSnapshot.text,"after explicit failure exit the user can save exactly the visible text");
  // Hold delivery after a real worker has produced a valid result. This tests
  // runtime intent arbitration and ignored-cancellation replies without timers
  // or production hooks; worker computation itself is exercised above.
  await snippetPage.evaluate(()=>{
    const s=window.__snippetSessionTest,prototype=s.api.SnippetPreparationService.prototype,original=prototype.evaluate;
    s.restoreEvaluation=()=>{prototype.evaluate=original;};
    prototype.evaluate=async function(prepared){
      const result=await original.call(this,prepared);
      if(s.holdEvaluation)await new Promise(resolve=>{s.releaseEvaluation=resolve;});
      return result;
    };
  });
  for(const keys of [["Control+s","Control+Shift+KeyI"],["Control+Shift+KeyI","Control+s"],["Control+s","Control+s"],["Control+s","Tab"]]){
    await snippetPage.evaluate(async()=>{const s=window.__snippetSessionTest;s.holdEvaluation=false;await s.insertDerived();s.view().setTabFocusMode(false);s.holdEvaluation=true;s.releaseEvaluation=null;});
    await snippetPage.keyboard.insertText("mixed");
    const before=await snippetPage.evaluate(()=>({saves:window.__snippetSessionTest.saves.length,formats:window.__snippetSessionTest.formats.length}));
    await snippetCode.press(keys[0]);
    await snippetPage.waitForFunction(()=>typeof window.__snippetSessionTest.releaseEvaluation==="function");
    await snippetCode.press(keys[1]);
    await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest;s.holdEvaluation=false;s.releaseEvaluation();});
    try{await snippetPage.waitForFunction(n=>window.__snippetSessionTest.saves.length===n+1,before.saves);}catch(error){
      await writeFile("evidence/snippet-mixed-intent-failure.json",JSON.stringify({keys,before,state:await snippetPage.evaluate(()=>{
        const s=window.__snippetSessionTest,v=s.view(),f=v.state.field(s.api.snippetSessionState);
        return {saves:s.saves,formats:s.formats,errors:s.errors,text:v.state.doc.toString(),selection:v.state.selection.toJSON(),focused:v.hasFocus,session:f};
      })},null,2));throw error;
    }
    assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.at(-1)),"mixed -> MIXED; tail");
    assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.formats.length),before.formats+1,"mixed intent settles and formats once");
    if(keys[1]==="Tab")assert.equal(await snippetPage.evaluate(()=>{const v=window.__snippetSessionTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"tail","pending save preserves requested field navigation");
  }
  await snippetPage.evaluate(async()=>{const s=window.__snippetSessionTest;await s.insertDerived();s.holdEvaluation=true;s.releaseEvaluation=null;});
  await snippetPage.keyboard.insertText("canceled");
  const staleSaveCount=await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length);
  await snippetCode.press("Control+s");
  await snippetPage.waitForFunction(()=>typeof window.__snippetSessionTest.releaseEvaluation==="function");
  await snippetCode.press("Escape");
  await snippetPage.evaluate(()=>{const s=window.__snippetSessionTest;s.holdEvaluation=false;s.releaseEvaluation();});
  await snippetPage.waitForTimeout(100);
  assert.equal(await snippetPage.evaluate(()=>window.__snippetSessionTest.saves.length),staleSaveCount,"late valid worker reply cannot revive canceled save");
  assert.equal(await snippetCode.innerText(),"canceled -> HELLO; tail");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.restoreEvaluation());
  await writeFile("evidence/SNIPPET_TRANSFORM_SESSION_RESULT.txt","PASS: actual editor + owned worker transforms on field leave, separate atomic transform history, no-worker redo, focused save, external-button save and Vim :w settlement, undo/edit cancellation and visible timeout preserving text. Flat derived fields only; plain nested sessions have a separate regression. Nested transforms and native/real-IME acceptance remain unverified.\n");

  await writeFile("evidence/SNIPPET_FLAT_SESSION_RESULT.txt","PASS: actual CodeEditor keyboard arrows/typing keep mirrors, Tab/Shift-Tab navigate, popup Tab accepts first, keyboard undo/redo are atomic, Escape preserves text, Vim Escape enters normal mode, synthetic composition boundary clears linkage, remount cannot revive session. Flat session including literal choices; plain nested sessions have a separate regression. This browser fixture does not verify real IME or native acceptance. Derived transforms are separately tested as commit-on-leave, not live typing transforms.\n");
  await snippetPage.evaluate(()=>window.__snippetSessionTest.mount.destroy());await snippetPage.close();


  const snippetLspPage=await browser.newPage(),snippetLspErrors=[];
  snippetLspPage.on("pageerror",error=>snippetLspErrors.push(error.message));
  await snippetLspPage.route("**/snippet-lsp-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor' style='height:500px'></div></body></html>"}));
  await snippetLspPage.goto("http://127.0.0.1:5173/snippet-lsp-test");
  await snippetLspPage.evaluate(async()=>{
    const api=await import("/tests/snippet-session-harness.tsx"),d="$";
    const s=window.__snippetLspTest={api,value:"call",edits:[],statuses:[],saves:[],errors:[],version:1,source:"call("+d+"{1:value}, "+d+"1)"+d+"0",format:2,mode:1,indented:false,deferResolve:false,resolveReply:null,holdPreparation:false,preparedReply:null,capability:true,prepareCalls:0};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service"){s.starts=(s.starts??0)+1;const mode=s.sessionMode??2;(s.sessionModes??=[]).push(mode);return {id:109,version:1,server:"snippet-lsp-fixture",uri:"file:///solution.py",completionResolve:true,completionInsertTextMode:mode,...(s.capability==="omitted"?{}:{completionSnippets:s.capability})};}
      if(command==="update_language_document"){s.version=args.version;return;}
      if(command==="language_diagnostics")return {version:s.version,diagnostics:[]};
      if(command==="language_request"){
        if(args.kind!=="completion")return null;
        (s.requests??=[]).push({...args});
        if(s.retryProbe&&args.completionContext?.triggerKind===1&&s.noiseServed<2){
          s.noiseServed++;
          return [{label:s.noiseServed===1?"call":"unrelated",insertTextFormat:1,textEdit:{range:{start:{line:0,character:0},end:{line:0,character:s.noiseServed===1?0:4}},newText:"bad"},_inkleetCompletion:1}];
        }
        const start=s.editStart??(s.indented?2:0),line=s.editLine??0;
        s.item={label:"call",insertTextFormat:s.format,insertTextMode:s.mode,textEdit:{range:{start:{line,character:start},end:{line,character:start+4}},newText:s.source},_inkleetCompletion:1};
        if(s.capabilityProbe){
          s.item={label:"call",insertTextFormat:1,insertTextMode:1,textEdit:{range:{start:{line:0,character:0},end:{line:0,character:4}},newText:"callPlain"},_inkleetCompletion:1};
          return [s.item,{...s.item,label:"callSnippet",insertTextFormat:2,textEdit:{...s.item.textEdit,newText:"call("+d+"{1:value})"},_inkleetCompletion:2}];
        }
        if(s.omitMode)delete s.item.insertTextMode;
        if(s.labelOnly){delete s.item.textEdit;s.item.insertText=s.source;}
        return [s.item];
      }
      if(command==="language_completion_resolve"){
        const result={...s.item,additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"import helper\r\n"}]};
        if(s.capabilityProbe&&s.resolveAsSnippet){result.insertTextFormat=2;result.textEdit={...result.textEdit,newText:"call("+d+"{1:value})"};}
        if(s.omitImports)result.additionalTextEdits=[];
        if(s.deferResolve)return new Promise(resolve=>{s.resolveReply=()=>resolve(result);});
        return result;
      }
      if(command==="language_cancel_completion"||command==="stop_language_service")return;
      if(command==="format_source")return args.text;
      throw Error(command);
    }};
    s.mount=api.mountSnippetEditor(document.querySelector("#editor"),s);
    s.view=()=>api.EditorView.findFromDOM(document.querySelector(".cm-editor"));
    s.reset=(source="call("+d+"{1:value}, "+d+"1)"+d+"0",indented=false,mode=1,format=2)=>{
      s.omitMode=false;s.editLine=0;s.editStart=null;s.requests=[];s.retryProbe=false;s.noiseServed=0;s.labelOnly=false;s.source=source;s.indented=indented;s.mode=mode;s.format=format;s.omitImports=false;s.deferResolve=false;s.resolveReply=null;s.holdPreparation=false;s.preparedReply=null;
      const v=s.view(),text=indented?"  call":"call";v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.length}});v.setTabFocusMode(false);v.focus();
    };
    const prototype=api.SnippetPreparationService.prototype,original=prototype.prepare;
    prototype.prepare=async function(...args){
      s.prepareCalls++;
      const result=await original.apply(this,args);
      if(s.holdPreparation)await new Promise(resolve=>{s.preparedReply=resolve;});
      return result;
    };
    s.restorePreparation=()=>{prototype.prepare=original;};
  });
  const snippetLspCode=snippetLspPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await snippetLspCode.waitFor();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("已连接")));
  const acceptLspSnippet=async()=>{
    await snippetLspCode.press("Control+Space");
    await snippetLspPage.getByRole("option",{name:"call",exact:true}).waitFor();
    await snippetLspPage.waitForTimeout(150);await snippetLspCode.press("Enter");
  };


  // Capability belongs to the started session, not to the returned item or editor extension.
  for(const capability of [false,"omitted","true"]){
    await snippetLspPage.evaluate(()=>window.__snippetLspTest.mount.destroy());
    await snippetLspCode.waitFor({state:"hidden"});
    await snippetLspPage.evaluate(capability=>{
      const s=window.__snippetLspTest;s.capability=capability;s.capabilityProbe=true;s.resolveAsSnippet=false;
      s.value="call";s.statuses=[];s.prepareCalls=0;s.mount=s.api.mountSnippetEditor(document.querySelector("#editor"),s);
    },capability);
    await snippetLspCode.waitFor();
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("已连接")));
    await snippetLspPage.evaluate(()=>window.__snippetLspTest.reset());
    await snippetLspCode.press("Control+Space");
    await snippetLspPage.getByRole("option",{name:"call",exact:true}).waitFor();
    assert.equal(await snippetLspPage.getByRole("option",{name:"callSnippet",exact:true}).count(),0,"unadvertised format2 is filtered for "+capability);
    assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.prepareCalls),0,"candidate filtering never prepares snippets");
    await snippetLspPage.waitForTimeout(150);await snippetLspCode.press("Enter");
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncallPlain");
    assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.prepareCalls),0,"plaintext remains usable without snippet capability");
    await snippetLspCode.press("Control+z");
    assert.equal(await snippetLspCode.innerText(),"call","plaintext and import remain one undo step");

    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset();s.resolveAsSnippet=true;s.statuses=[];});
    const before=await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest,v=s.view();return {source:v.state.doc.toString(),selection:v.state.selection.toJSON(),undo:s.api.undoDepth(v.state),preparations:s.prepareCalls};});
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("此会话未启用参数补全")));
    assert.deepEqual(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest,v=s.view();return {source:v.state.doc.toString(),selection:v.state.selection.toJSON(),undo:s.api.undoDepth(v.state),preparations:s.prepareCalls};}),before,"resolved format2 refusal preserves source, selection, history and preparation count");
  }
  await snippetLspPage.evaluate(()=>window.__snippetLspTest.mount.destroy());
  await snippetLspCode.waitFor({state:"hidden"});
  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest;s.capability=true;s.capabilityProbe=false;s.resolveAsSnippet=false;
    s.value="call";s.statuses=[];s.mount=s.api.mountSnippetEditor(document.querySelector("#editor"),s);
  });
  await snippetLspCode.waitFor();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("已连接")));
  await writeFile("evidence/COMPLETION_SNIPPET_CAPABILITY_RESULT.txt","PASS: fresh false, missing and malformed capability sessions reject format2 candidates and resolved format2 before preparation; plaintext plus import and undo remain usable. Source, selection and undo depth are unchanged on refusal. Subsequent positive fixture explicitly advertises true. Mocked transport only.\n");


  for(const format of [1,2]){
    await snippetLspPage.evaluate(format=>{
      const s=window.__snippetLspTest;
      s.reset(format===2?"call(self):\r\n    ${0:pass}":"call(self):\r\n    pass",false,1,format);
      s.omitMode=true;s.editLine=1;s.editStart=8;
      const v=s.view(),text="class Child:\n    def call";
      v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.length}});v.focus();
    },format);
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\nclass Child:\n    def call(self):\n        pass");
    if(format===2){
      assert.equal(await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"pass","inherited mode2 retains complete final-default selection");
      await snippetLspPage.keyboard.insertText("return 1");
      assert.equal(await snippetLspCode.innerText(),"import helper\nclass Child:\n    def call(self):\n        return 1");
      await snippetLspCode.press("Control+z");
    }
    await snippetLspCode.press("Control+z");
    assert.equal(await snippetLspCode.innerText(),"class Child:\n    def call","inherited mode2 plus import undoes atomically in both formats");
  }
  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest;s.reset("call(self):\n        pass",false,1,1);s.editLine=1;s.editStart=8;
    const v=s.view(),text="class Child:\n    def call";v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.length}});v.focus();
  });
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\nclass Child:\n    def call(self):\n        pass");
  await snippetLspCode.press("Control+z");
  assert.equal(await snippetLspCode.innerText(),"class Child:\n    def call","explicit asIs overrides default2 without double indentation");
  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest;s.reset("call(${1:a\nb})");s.omitMode=true;s.statuses=[];
    const v=s.view();s.modeFailureBefore={text:v.state.doc.toString(),selection:v.state.selection.toJSON(),undo:s.api.undoDepth(v.state)};
  });
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("Multiline parameter indentation")));
  assert.equal(await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest,v=s.view();
    return JSON.stringify({text:v.state.doc.toString(),selection:v.state.selection.toJSON(),undo:s.api.undoDepth(v.state)})===JSON.stringify(s.modeFailureBefore);
  }),true,"unsupported inherited mode2 never applies imports, text or history");
  await snippetLspPage.evaluate(()=>{window.__snippetLspTest.statuses=[];});
  const readinessStarts=await snippetLspPage.evaluate(()=>window.__snippetLspTest.starts);
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset();s.retryProbe=true;});
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(value, value)");
  assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.noiseServed),2,"explicit completion retries nonempty invalid and unmatched candidates");
  const readinessRequests=await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;return {starts:s.starts,requests:s.requests.filter(r=>r.completionContext?.triggerKind===1)};});
  assert.equal(readinessRequests.starts,readinessStarts,"readiness retries never restart the server");
  assert.equal(readinessRequests.requests.length,3);
  for(let i=1;i<readinessRequests.requests.length;i++){
    const a=readinessRequests.requests[0],b=readinessRequests.requests[i];
    for(const key of ["id","version","line","character"])assert.equal(b[key],a[key],"readiness retries retain "+key);
    assert.ok(b.completionSequence>readinessRequests.requests[i-1].completionSequence);
  }
  for(const boundary of ["Escape","blur"]){
    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset();s.retryProbe=true;});
    await snippetLspCode.press("Control+Space");
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.noiseServed===1);
    if(boundary==="Escape")await snippetLspCode.press("Escape");
    else await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.blur());
    await snippetLspPage.waitForTimeout(500);
    assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.noiseServed),1,boundary+" stops backoff requests");
    assert.equal(await snippetLspCode.innerText(),"call");
    assert.equal(await snippetLspPage.getByRole("option",{name:"call",exact:true}).count(),0);
  }
  for(const reverse of [false,true]){
    await snippetLspPage.evaluate(reverse=>{
      const s=window.__snippetLspTest;s.reset("wrap($TM_SELECTED_TEXT, ${1:value})$0");
      const v=s.view();v.dispatch({selection:{anchor:reverse?4:0,head:reverse?0:4}});v.focus();
    },reverse);
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\nwrap(call, value)");
    assert.equal(await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"value");
    await snippetLspCode.press("Control+z");
    assert.equal(await snippetLspCode.innerText(),"call","selected completion and import share one undo");
  }
  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest;s.reset("wrap($TM_SELECTED_TEXT, ${1:value})$0");s.labelOnly=true;
    const v=s.view(),text="prefix$1";v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:6,head:8}});v.focus();
  });
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\nprefixwrap($1, value)");
  await snippetLspCode.press("Control+z");assert.equal(await snippetLspCode.innerText(),"prefix$1","fallback replaces only the selection and never parses selected dollars");
  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest;s.reset("plain",false,1,1);const v=s.view();v.dispatch({selection:{anchor:0,head:4}});v.focus();
  });
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\nplain");
  await snippetLspCode.press("Control+z");assert.equal(await snippetLspCode.innerText(),"call");
  for(const stage of ["resolve","prepare"])for(const restore of [false,true]){
    await snippetLspPage.evaluate(stage=>{
      const s=window.__snippetLspTest;s.reset();s.deferResolve=stage==="resolve";s.holdPreparation=stage==="prepare";
      const v=s.view();v.dispatch({selection:{anchor:0,head:4}});v.focus();s.selectedUndoDepth=s.api.undoDepth(v.state);
    },stage);
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(stage=>typeof window.__snippetLspTest[stage==="resolve"?"resolveReply":"preparedReply"]==="function",stage);
    await snippetLspPage.evaluate(({stage,restore})=>{
      const s=window.__snippetLspTest,v=s.view();v.dispatch({selection:{anchor:1,head:4}});
      if(restore)v.dispatch({selection:{anchor:0,head:4}});
      s[stage==="resolve"?"resolveReply":"preparedReply"]();
    },{stage,restore});
    await snippetLspPage.waitForTimeout(150);
    assert.equal(await snippetLspCode.innerText(),"call",stage+" anchor-only movement invalidates selected completion");
    assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest,v=s.view();return s.api.undoDepth(v.state)===s.selectedUndoDepth&&v.state.field(s.api.snippetSessionState)===null;}),true,"stale selected completion adds neither history nor session");
  }
  await writeFile("evidence/SELECTED_COMPLETION_RESULT.txt","PASS: forward/reverse selected-text format2 completion, literal selected dollars, insertText-only exact selection replacement without prefix filtering, plain selected replacement, atomic imports/undo, anchor-only and ABA invalidation during resolve and preparation. Actual CodeEditor/public keyboard path with installed autocomplete; mocked LSP.\n");
  await snippetLspPage.evaluate(()=>window.__snippetLspTest.reset());
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(value, value)");
  await snippetLspPage.keyboard.insertText("x");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(x, x)","real LSP acceptance starts linked parameter editing");
  await snippetLspCode.press("Control+z");await snippetLspCode.press("Control+z");
  assert.equal(await snippetLspCode.innerText(),"call","resolved import and snippet insertion undo together");
  await snippetLspPage.evaluate(()=>{const d="$";window.__snippetLspTest.reset("call("+d+"{1:a"+d+"{2:b}c}, "+d+"1)"+d+"0");});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(abc, abc)");
  await snippetLspCode.press("Tab");await snippetLspPage.keyboard.insertText("Q");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(aQc, aQc)","nested format2 candidate reaches the actual session");

  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest,d="$";
    s.nestedDerivedSource="call("+d+"{1:a"+d+"{2:b}-"+d+"{2/(.*)/"+d+"{1:/upcase}/}}, "+d+"1, "+d+"{3:tail})"+d+"0";
    s.reset(s.nestedDerivedSource);
  });
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(ab-B, ab-B, tail)");
  await snippetLspCode.press("Tab");await snippetLspPage.keyboard.insertText("bee");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(abee-B, abee-B, tail)");
  await snippetLspCode.press("Tab");
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(abee-BEE, abee-BEE, tail)");
  assert.equal(await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"tail");
  await snippetLspPage.screenshot({path:"evidence/snippet-nested-derived.png"});
  await snippetLspCode.press("Control+z");assert.equal(await snippetLspCode.innerText(),"import helper\ncall(abee-B, abee-B, tail)","nested derived commit has separate keyboard undo");
  await snippetLspCode.press("Control+y");assert.equal(await snippetLspCode.innerText(),"import helper\ncall(abee-BEE, abee-BEE, tail)");
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset(s.nestedDerivedSource);});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(ab-B, ab-B, tail)");
  await snippetLspCode.press("Tab");await snippetLspPage.keyboard.insertText("q");await snippetLspCode.press("Control+s");
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.saves.at(-1)==="import helper\ncall(aq-Q, aq-Q, tail)");
  await snippetLspCode.press("Shift+Tab");await snippetLspPage.keyboard.insertText("Z");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(Z, Z, tail)","nested targets are pruned when their parent is replaced");
  await snippetLspCode.press("Tab");
  assert.equal(await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"tail");
  await writeFile("evidence/NESTED_DERIVED_SNIPPET_RESULT.txt","PASS: actual format2 completion, owned worker nested transforms on Tab and Ctrl+S, child/parent mirrors, selected next field, separate undo/redo, subsequent parent pruning. Mocked LSP; native/real-IME and mode2 derived indentation remain unverified.\n");
  await snippetLspPage.evaluate(()=>{const d="$";window.__snippetLspTest.reset("call("+d+"TM_FILENAME, "+d+"{1:value})"+d+"0");});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(solution.py, value)");
  await snippetLspPage.evaluate(()=>{const d="$";window.__snippetLspTest.reset("call("+d+"{1:value})\r\n"+d+"0",true,2);});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\n  call(value)\n  ");
  await snippetLspCode.press("Tab");
  assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest,v=s.view();return v.state.selection.main.head===v.state.doc.length;}),true,"mode2 final stop maps after generated indentation");
  await snippetLspPage.screenshot({path:"evidence/snippet-lsp-application.png"});

  await snippetLspPage.evaluate(()=>{window.__snippetLspTest.reset("call(${0:pass})");});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(pass)");
  assert.equal(await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to);}),"pass","final-only default is selected for replacement");
  await snippetLspPage.keyboard.insertText("value");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(value)");
  await snippetLspPage.evaluate(()=>{window.__snippetLspTest.reset("call(${1:value}) ${0:tail}");});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall(value) tail");
  await snippetLspCode.press("Tab");await snippetLspPage.keyboard.insertText("done");
  assert.equal(await snippetLspCode.innerText(),"import helper\ncall(value) done","Tab final default is replaced, never prefixed");
  await snippetLspPage.evaluate(()=>{window.__snippetLspTest.reset("call($1)",false,1,1);});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\ncall($1)");
  assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;return s.view().state.field(s.api.snippetSessionState);}),null,"plain format never parses dollar syntax");
  await snippetLspPage.evaluate(()=>{const d="$";window.__snippetLspTest.reset("call("+d+"{1:a\nb})",true,2);});
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("Multiline parameter indentation")));
  assert.equal(await snippetLspCode.innerText(),"  call","unsupported layout cannot apply imports alone");


  await snippetLspPage.evaluate(()=>{
    const s=window.__snippetLspTest,d="$";s.reset();
    const v=s.view(),spec=s.api.snippetInsertion(v.state,s.api.prepareSnippet(d+"{1:call} = "+d+"1"),0,v.state.doc.length);
    if(!spec)throw Error("Existing session fixture refused");v.dispatch(spec);v.dispatch({selection:{anchor:4}});v.focus();
  });
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.statuses.some(text=>text.includes("结束当前参数补全")));
  assert.equal(await snippetLspCode.innerText(),"call = call","new snippet cannot silently replace existing linked ownership");
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.source="callDone";s.format=1;});
  await acceptLspSnippet();await snippetLspPage.waitForTimeout(200);
  assert.equal(await snippetLspCode.innerText(),"call = call","plain completion with outside imports cannot break active mirrors");
  await snippetLspPage.evaluate(()=>{window.__snippetLspTest.omitImports=true;});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="callDone = callDone");
  for(const boundary of ["Escape","selection","selection-restore","typing","edit-restore","blur","blur-restore","composition"]){
    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset();s.deferResolve=true;});
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(()=>typeof window.__snippetLspTest.resolveReply==="function");
    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.oldResolve=s.resolveReply;s.deferResolve=false;});
    if(boundary==="Escape")await snippetLspCode.press("Escape");
    if(boundary==="selection")await snippetLspCode.press("ArrowLeft");
    if(boundary==="selection-restore"){await snippetLspCode.press("ArrowLeft");await snippetLspCode.press("ArrowRight");}
    if(boundary==="typing")await snippetLspCode.press("X");
    if(boundary==="edit-restore"){await snippetLspCode.press("X");await snippetLspCode.press("Backspace");}
    if(boundary==="blur")await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.blur());
    if(boundary==="blur-restore")await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();v.contentDOM.blur();v.focus();});
    if(boundary==="composition")await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true})));
    await snippetLspPage.evaluate(()=>window.__snippetLspTest.oldResolve());
    await snippetLspPage.waitForTimeout(150);
    assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.value),boundary==="typing"?"callX":"call",boundary+" invalidates pending snippet resolve without imports");
    assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;return s.view().state.field(s.api.snippetSessionState);}),null);
    if(boundary==="composition"){await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true})));await snippetLspPage.waitForTimeout(100);}
  }
  for(const boundary of ["Escape","selection","selection-restore","typing","edit-restore","blur","blur-restore","composition"]){
    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset();s.holdPreparation=true;});
    await acceptLspSnippet();
    await snippetLspPage.waitForFunction(()=>typeof window.__snippetLspTest.preparedReply==="function");
    if(boundary==="Escape")await snippetLspCode.press("Escape");
    if(boundary==="selection")await snippetLspCode.press("ArrowLeft");
    if(boundary==="selection-restore"){await snippetLspCode.press("ArrowLeft");await snippetLspCode.press("ArrowRight");}
    if(boundary==="typing")await snippetLspCode.press("X");
    if(boundary==="edit-restore"){await snippetLspCode.press("X");await snippetLspCode.press("Backspace");}
    if(boundary==="blur")await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.blur());
    if(boundary==="blur-restore")await snippetLspPage.evaluate(()=>{const v=window.__snippetLspTest.view();v.contentDOM.blur();v.focus();});
    if(boundary==="composition")await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true})));
    await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.holdPreparation=false;s.preparedReply();});
    await snippetLspPage.waitForTimeout(150);
    assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.value),boundary==="typing"?"callX":"call",boundary+" invalidates a late valid prepared snippet");
    assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;return s.view().state.field(s.api.snippetSessionState);}),null);
    if(boundary==="composition"){await snippetLspPage.evaluate(()=>window.__snippetLspTest.view().contentDOM.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true})));await snippetLspPage.waitForTimeout(100);}
  }
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset("call(${1:value})\n$0",true);s.omitMode=true;s.holdPreparation=true;});
  await acceptLspSnippet();await snippetLspPage.waitForFunction(()=>typeof window.__snippetLspTest.preparedReply==="function");
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.oldView=s.view();s.mount.destroy();});
  await snippetLspCode.waitFor({state:"hidden"});
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.sessionMode=1;s.mount=s.api.mountSnippetEditor(document.querySelector("#editor"),s);});
  await snippetLspCode.waitFor();
  assert.equal(await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;return s.view()!==s.oldView;}),true,"recreation uses a different editor owner");
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.holdPreparation=false;s.preparedReply();s.restorePreparation();});
  await snippetLspPage.waitForTimeout(150);
  assert.equal(await snippetLspPage.evaluate(()=>window.__snippetLspTest.value),"  call","destroyed default2 editor cannot receive prepared snippet");
  await writeFile("evidence/LSP_SNIPPET_APPLICATION_RESULT.txt","PASS: actual CodeEditor format2 candidate acceptance through mocked LSP resolve and real preparation worker, atomic imports/undo, linked and nested parameters, variables, mode2/final stop, plain literal dollar text, unsupported-layout atomic refusal, delayed resolve/preparation cancellation on Escape/selection/typing/blur/synthetic composition and destroy. This mocked-LSP fixture does not verify server capability negotiation, native server behavior or real IME.\n");
  assert.equal(await snippetLspCode.innerText(),"  call","replacement default1 editor ignores old default2 prepared result");
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.sessionModes?.at(-1)===1);
  await snippetLspPage.evaluate(()=>{const s=window.__snippetLspTest;s.reset("call()\n    tail",true,1,1);s.omitMode=true;});
  await acceptLspSnippet();
  await snippetLspPage.waitForFunction(()=>window.__snippetLspTest.value==="import helper\n  call()\n    tail");
  await writeFile("evidence/COMPLETION_DEFAULT_MODE_RESULT.txt","PASS: immutable mocked session default2 applies to plaintext and snippets, CRLF and imports, final-default selection/replacement, explicit mode1 precedence, atomic unsupported-layout refusal, and a replacement default1 session rejects old work and retains its own mode. No Python provider rollout or native default2 claim.\n");

  await snippetLspPage.evaluate(()=>window.__snippetLspTest.mount.destroy());
  assert.deepEqual(snippetLspErrors,[],"LSP snippet lifecycle produces no page errors");
  await snippetLspPage.close();

  const presentationPage=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:2});
  const presentationErrors=[],externalDocRequests=[];
  presentationPage.on("pageerror",e=>presentationErrors.push(e.message));
  presentationPage.on("request",r=>{if(r.url().includes("invalid.example"))externalDocRequests.push(r.url());});
  await presentationPage.route("**/presentation-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><head><link rel='stylesheet' href='/src/style.css'></head><body><div id='editor' style='height:70vh;width:100%;padding:24px'></div></body></html>"}));
  await presentationPage.goto("http://127.0.0.1:5173/presentation-test");
  await presentationPage.evaluate(async()=>{
    const api=await import("/tests/snippet-session-harness.tsx");
    const s=window.__presentation={api,value:"Hash",edits:[],statuses:[],version:1};
    s.docs={kind:"markdown",value:"**HashMap** stores key–value pairs.\n\nUse \u0060entry\u0060 to update a value without a second lookup.\n\n\u0060\u0060\u0060rust\nuse std::collections::HashMap;\nlet mut map = HashMap::new();\n\u0060\u0060\u0060\n\n| Operation | Cost |\n| --- | --- |\n| Insert | Expected O(1) |\n\n"+("中文文档保持清晰，不应撑开弹窗。 ".repeat(40))+"\n\n<img src='https://invalid.example/track' onerror='window.__unsafe=1'><script>window.__unsafe=1</script>[link](javascript:alert(1))"};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service")return {id:801,version:1,server:"presentation",uri:"file:///solution.rs",completionResolve:true,completionSnippets:true};
      if(command==="update_language_document"){s.version=args.version;return;}
      if(command==="language_diagnostics")return {version:s.version,diagnostics:[]};
      if(command==="language_request"){
        if(args.kind==="completion"&&s.oversized)return [{label:s.oversizedLabel,detail:s.oversizedDetail,kind:22,insertText:"HashMap",_inkleetCompletion:1}];
        if(args.kind==="completion"&&s.manyRows)return Array.from({length:72},(_,i)=>({label:"Hash"+String(i).padStart(2,"0")+(i%2?"WithLongGenericContainerName<Key, Value>":""),detail:i%2?s.longDetail:"std::collections",kind:22,insertText:"HashMap",_inkleetCompletion:i+1}));
        if(args.kind==="completion")return [{label:s.longRows?s.longLabel:"HashMap",detail:s.longRows?s.longDetail:"std::collections · map",kind:22,insertText:"HashMap",_inkleetCompletion:1},{label:"HashSet",detail:"std::collections · set",kind:22,insertText:"HashSet",_inkleetCompletion:2}];
        if(args.kind==="hover")return {contents:s.docs};
        if(args.kind==="signatureHelp")return {activeSignature:0,activeParameter:0,signatures:[{label:"insert(key: K, value: V) -> Option<V>",parameters:[{label:[7,13],documentation:{kind:"markdown",value:"The **key** to insert."}},{label:[15,23]}],documentation:{kind:"markdown",value:"Inserts a key–value pair into the map."}}]};
        return null;
      }
      if(command==="language_completion_resolve"){
        const item={label:args.token===1?"HashMap":"HashSet",insertTextFormat:1,insertText:args.token===1?"HashMap":"HashSet",documentation:args.token===1?s.docs:{kind:"plaintext",value:"**literal** HashSet documentation"}};
        if(s.detailOnly){item.detail=s.resolvedDetail;delete item.documentation;}
        if(s.hold)return new Promise(resolve=>{s.release=()=>resolve(item);});
        return item;
      }
      if(command==="stop_language_service"||command==="language_cancel_completion")return;
      throw Error(command);
    }};
    s.mount=api.mountSnippetEditor(document.querySelector("#editor"),s);
    s.view=()=>api.EditorView.findFromDOM(document.querySelector(".cm-editor"));
  });
  const presentationCode=presentationPage.getByRole("textbox",{name:"代码编辑器",exact:true});
  await presentationCode.waitFor();await presentationPage.waitForFunction(()=>window.__presentation.statuses.some(t=>t.includes("已连接")));
  const showPresentation=async()=>{
    await presentationPage.evaluate(()=>{const v=window.__presentation.view();v.dispatch({selection:{anchor:v.state.doc.length}});v.focus();});
    await presentationCode.press("Control+Space");
    await presentationPage.locator(".lsp-completion-documentation strong").waitFor();
  };
  for(const viewport of [{width:1200,height:800},{width:640,height:600},{width:400,height:500}]){
    await presentationPage.setViewportSize(viewport);await showPresentation();
    await presentationPage.waitForTimeout(100);
    const layout=await presentationPage.evaluate(()=>{
      const list=document.querySelector(".inkleet-completion"),info=document.querySelector(".cm-completionInfo");
      const a=list.getBoundingClientRect(),b=info.getBoundingClientRect(),style=getComputedStyle(info),ul=getComputedStyle(list.querySelector("ul")),row=getComputedStyle(list.querySelector("li"));
      return {a:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},b:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},font:ul.fontFamily,rowPadding:row.paddingTop,rowHeight:row.lineHeight,listHeight:ul.maxHeight,visible:style.visibility,overflow:getComputedStyle(list).overflow,scroll:info.scrollHeight>info.clientHeight,shadow:getComputedStyle(document.querySelector(".cm-content")).textShadow};
    });
    assert.equal(layout.visible,"visible");assert.equal(layout.overflow,"visible");
    assert.match(layout.font,/Intel One Mono/);assert.equal(layout.rowPadding,"4px");assert.equal(layout.rowHeight,"20px");assert.ok(parseFloat(layout.listHeight)<=288);
    assert.ok(layout.b.left>=-1&&layout.b.right<=viewport.width+1&&layout.b.top>=-1&&layout.b.bottom<=viewport.height+1,"documentation stays inside "+JSON.stringify(viewport));
    assert.ok(layout.b.left>=layout.a.right-1||layout.b.right<=layout.a.left+1||layout.b.top>=layout.a.bottom-1||layout.b.bottom<=layout.a.top+1,"documentation never covers completion list");
    assert.equal(layout.shadow,"none");assert.equal(layout.scroll,true);
    const scrollSelection=await presentationPage.evaluate(()=>window.__presentation.view().state.selection.toJSON());
    await presentationCode.press("Alt+PageDown");
    assert.ok(await presentationPage.locator(".cm-completionInfo").evaluate(dom=>dom.scrollTop>0),"documentation scrolls without moving editor focus");
    assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true);
    const scrolledDown=await presentationPage.locator(".cm-completionInfo").evaluate(dom=>dom.scrollTop);
    await presentationCode.press("Alt+PageUp");
    assert.ok(await presentationPage.locator(".cm-completionInfo").evaluate((dom,before)=>dom.scrollTop<before,scrolledDown));
    assert.deepEqual(await presentationPage.evaluate(()=>window.__presentation.view().state.selection.toJSON()),scrollSelection,"documentation scroll never moves code selection");
    assert.equal(await presentationPage.locator(".cm-completionInfo img,.cm-completionInfo script,.cm-completionInfo a").count(),0,"server docs contain no active HTML or navigation");
    assert.equal(await presentationPage.locator(".inkleet-completion li[aria-selected] svg").count(),1);
    assert.equal(await presentationPage.locator(".inkleet-completion li[aria-selected] .cm-completionMatchedText").innerText(),"Hash","native matching spans are retained for ordinary labels");
    assert.equal(await presentationPage.locator(".inkleet-completion .cm-completionLabel").first().evaluate(dom=>getComputedStyle(dom).textOverflow),"clip");
    assert.equal(await presentationPage.locator(".inkleet-completion .cm-completionDetail").first().innerText(),"std::collections · map");
    if(viewport.width===1200)await presentationPage.screenshot({path:"evidence/completion-documentation-polished.png"});
    if(viewport.width===400)await presentationPage.screenshot({path:"evidence/completion-documentation-narrow.png"});
    await presentationCode.press("ArrowDown");
    await presentationPage.waitForFunction(()=>document.querySelector(".lsp-completion-documentation")?.textContent.includes("**literal** HashSet"));
    assert.equal(await presentationPage.locator(".lsp-completion-documentation strong").count(),0,"plaintext remains literal");
    await presentationCode.press("Escape");
    assert.equal(await presentationPage.locator(".inkleet-completion").count(),0);
    assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true);
  }

  await presentationPage.evaluate(()=>{
    const s=window.__presentation;s.longRows=true;
    s.longLabel="HashMapWithAnIntentionallyLongTypeNameAndFullGenericParameters<Key, Value>";
    s.longDetail="fn insert(&mut self, key: Key, value: Value) -> Option<Value> — std::collections::hash_map::HashMap<Key, Value>";
  });
  await presentationPage.setViewportSize({width:400,height:600});
  await presentationPage.evaluate(()=>{const v=window.__presentation.view();v.dispatch({selection:{anchor:v.state.doc.length}});v.focus();});
  await presentationCode.press("Control+Space");
  await presentationPage.getByRole("option").first().waitFor();
  const fullRows=await presentationPage.evaluate(()=>{
    const s=window.__presentation,row=document.querySelector(".inkleet-completion li"),label=row.querySelector(".cm-completionLabel"),detail=row.querySelector(".cm-completionDetail");
    return {label:label.textContent,detail:detail.textContent,labelOverflow:label.scrollWidth-label.clientWidth,detailOverflow:detail.scrollWidth-detail.clientWidth,labelHeight:label.getBoundingClientRect().height,detailHeight:detail.getBoundingClientRect().height,row:row.getBoundingClientRect().toJSON(),name:s.longLabel,signature:s.longDetail};
  });
  assert.equal(fullRows.label,fullRows.name);assert.equal(fullRows.detail,fullRows.signature);
  assert.ok(fullRows.labelOverflow<=1&&fullRows.detailOverflow<=1,"full names and signatures wrap within narrow row");
  assert.ok(fullRows.labelHeight>20&&fullRows.detailHeight>18,"long content uses actual extra lines instead of ellipsis");
  assert.ok(fullRows.row.left>=0&&fullRows.row.right<=400);
  await presentationPage.screenshot({path:"evidence/completion-full-content-narrow.png"});
  await presentationCode.press("ArrowDown");
  assert.equal(await presentationPage.locator(".inkleet-completion li[aria-selected] .cm-completionLabel").innerText(),"HashSet");
  await presentationCode.press("ArrowUp");
  assert.equal(await presentationPage.locator(".inkleet-completion li[aria-selected] .cm-completionLabel").innerText(),fullRows.name);
  await presentationCode.press("Escape");
  await presentationPage.evaluate(()=>{const s=window.__presentation;s.longRows=false;s.manyRows=true;});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".inkleet-completion li[aria-selected]").waitFor();
  await presentationPage.waitForTimeout(150); // Respect CodeMirror\'s initial interaction guard before testing navigation.
  const assertSelectedVisible=async()=>{
    const visible=await presentationPage.evaluate(()=>{
      const selected=document.querySelector(".inkleet-completion li[aria-selected]"),list=selected.closest("ul"),a=selected.getBoundingClientRect(),b=list.getBoundingClientRect();
      return {top:a.top,bottom:a.bottom,listTop:b.top,listBottom:b.bottom,label:selected.querySelector(".cm-completionLabel").textContent,focus:window.__presentation.view().hasFocus};
    });
    assert.ok(visible.top>=visible.listTop-1&&visible.bottom<=visible.listBottom+1,"wrapped selected row is fully scrolled into view");
    assert.equal(visible.focus,true);return visible.label;
  };
  await presentationCode.press("PageDown");assert.notEqual(await assertSelectedVisible(),"Hash00");
  await presentationCode.press("PageUp");await assertSelectedVisible();
  await presentationCode.press("Escape");
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".inkleet-completion li[aria-selected]").waitFor();
  await presentationPage.waitForTimeout(150); // Respect CodeMirror\'s initial interaction guard before testing navigation.
  for(let i=0;i<71;i++)await presentationCode.press("ArrowDown");
  assert.match(await assertSelectedVisible(),/^Hash71/);
  await presentationCode.press("Escape");

  await presentationPage.evaluate(()=>{const s=window.__presentation;s.manyRows=false;s.oversized=true;s.oversizedLabel="Hash"+"LongIdentifier".repeat(25);s.oversizedDetail="完整类型信息 ".repeat(50)+"END_OF_SIGNATURE";});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".inkleet-completion li[aria-selected]").waitFor();
  await presentationPage.waitForTimeout(150); // Respect CodeMirror\'s initial interaction guard before testing navigation.
  const oversizedRow=await presentationPage.evaluate(()=>{
    const s=window.__presentation,row=document.querySelector(".inkleet-completion li"),list=row.closest("ul");
    return {label:row.querySelector(".cm-completionLabel").textContent,detail:row.querySelector(".cm-completionDetail").textContent,expectedLabel:s.oversizedLabel,expectedDetail:s.oversizedDetail,height:row.getBoundingClientRect().height,listHeight:list.clientHeight};
  });
  assert.equal(oversizedRow.label,oversizedRow.expectedLabel);assert.equal(oversizedRow.detail,oversizedRow.expectedDetail);
  assert.ok(oversizedRow.height>oversizedRow.listHeight,"oversized row exercises bounded list scrolling");
  const listBox=await presentationPage.locator(".inkleet-completion>ul").boundingBox();
  await presentationPage.mouse.move(listBox.x+listBox.width/2,listBox.y+listBox.height/2);
  await presentationPage.mouse.wheel(0,10000);
  await presentationPage.waitForFunction(()=>{const list=document.querySelector(".inkleet-completion>ul");return list.scrollTop+list.clientHeight>=list.scrollHeight-2;});
  await presentationPage.mouse.wheel(0,-10000);
  await presentationPage.waitForFunction(()=>document.querySelector(".inkleet-completion>ul").scrollTop===0);
  await presentationPage.mouse.wheel(0,10000);
  await presentationPage.waitForFunction(()=>{const list=document.querySelector(".inkleet-completion>ul");return list.scrollTop+list.clientHeight>=list.scrollHeight-2;});
  const detailPoint=await presentationPage.locator(".inkleet-completion .cm-completionDetail").evaluate(dom=>{
    const a=dom.getBoundingClientRect(),b=dom.closest("ul").getBoundingClientRect();
    return {x:Math.max(a.left,b.left)+12,y:(Math.max(a.top,b.top)+Math.min(a.bottom,b.bottom))/2};
  });
  await presentationPage.waitForTimeout(150);await presentationPage.mouse.click(detailPoint.x,detailPoint.y);
  await presentationPage.waitForFunction(()=>window.__presentation.value==="HashMap");
  await presentationCode.press("Control+z");
  assert.equal(await presentationCode.innerText(),"Hash","clicking wrapped detail accepts the correct candidate atomically");
  await presentationPage.evaluate(()=>{window.__presentation.oversized=false;});
  await presentationPage.mouse.move(10,580);


  await presentationPage.setViewportSize({width:1000,height:700});
  await presentationPage.evaluate(()=>{document.body.style.zoom="1.25";});
  await showPresentation();await presentationPage.waitForTimeout(100);
  const zoomBounds=await presentationPage.locator(".cm-completionInfo").boundingBox();
  assert.ok(zoomBounds&&zoomBounds.x>=-1&&zoomBounds.y>=-1&&zoomBounds.x+zoomBounds.width<=1001&&zoomBounds.y+zoomBounds.height<=701,"125% CSS zoom keeps documentation within viewport");
  await presentationPage.screenshot({path:"evidence/completion-documentation-zoom.png"});
  await presentationCode.press("Escape");
  await presentationPage.evaluate(()=>{document.body.style.zoom="";});
  await presentationCode.press("Control+Shift+Space");
  await presentationPage.locator(".lsp-active-parameter").waitFor();
  assert.equal(await presentationPage.locator(".lsp-active-parameter").innerText(),"key: K");
  assert.equal(await presentationPage.locator(".lsp-signature").evaluate(dom=>getComputedStyle(dom).borderRadius),"7px");
  assert.notEqual(await presentationPage.locator(".lsp-signature").evaluate(dom=>getComputedStyle(dom).boxShadow),"none");
  assert.equal(await presentationPage.locator(".lsp-parameter-documentation strong").innerText(),"key");
  await presentationPage.screenshot({path:"evidence/signature-documentation-polished.png"});
  await presentationCode.press("Escape");

  const hoverPoint=await presentationPage.evaluate(()=>{const p=window.__presentation.view().coordsAtPos(2);return {x:(p.left+p.right)/2,y:(p.top+p.bottom)/2};});
  await presentationPage.mouse.move(hoverPoint.x,hoverPoint.y);
  await presentationPage.locator(".lsp-hover strong").waitFor();
  assert.equal(await presentationPage.locator(".lsp-hover").evaluate(dom=>getComputedStyle(dom.closest(".cm-tooltip")).borderRadius),"7px","hover outer shell matches completion/signature radius");
  assert.notEqual(await presentationPage.locator(".lsp-hover").evaluate(dom=>getComputedStyle(dom.closest(".cm-tooltip")).boxShadow),"none");
  assert.equal(await presentationPage.locator(".lsp-hover img,.lsp-hover script").count(),0);
  await presentationPage.screenshot({path:"evidence/hover-documentation-polished.png"});
  await presentationPage.mouse.move(900,600);await presentationCode.press("Escape");
  await presentationPage.evaluate(()=>{window.__presentation.hold=true;});
  await presentationCode.press("Control+Space");
  await presentationPage.waitForFunction(()=>typeof window.__presentation.release==="function");
  await presentationCode.press("Escape");
  await presentationPage.evaluate(()=>window.__presentation.release());
  await presentationPage.waitForTimeout(150);
  assert.equal(await presentationPage.locator(".cm-completionInfo").count(),0,"late resolved documentation cannot reopen dismissed popup");
  const safe=await presentationPage.evaluate(async()=>{
    const {renderDocumentation}=await import("/src/lsp-documentation.ts");
    const controller=new AbortController();controller.abort();
    return {cancelled:await renderDocumentation({kind:"markdown",value:"cancelled"},false,controller.signal)===null,unsafe:window.__unsafe??null};
  });

  assert.deepEqual(safe,{cancelled:true,unsafe:null});assert.deepEqual(externalDocRequests,[]);

  await presentationPage.evaluate(()=>{window.__presentation.hold=false;});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-expand").waitFor();
  await presentationPage.locator(".cm-completionInfo").getByRole("button",{name:"展开文档",exact:true}).click();
  const richReader=presentationPage.getByRole("dialog",{name:"文档阅读",exact:true});
  await richReader.waitFor();
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-body")?.getAttribute("aria-busy")==="false");
  assert.ok((await richReader.locator("pre code").innerText()).includes("HashMap::new"));
  assert.equal(await richReader.locator("img,script,a").count(),0,"expanded Markdown keeps untrusted content inert");
  await presentationPage.screenshot({path:"evidence/expanded-documentation-reader-rich.png"});
  const beforeResize=await richReader.boundingBox();
  await presentationPage.mouse.move(beforeResize.x+beforeResize.width-3,beforeResize.y+beforeResize.height-3);
  await presentationPage.mouse.down();
  await presentationPage.mouse.move(beforeResize.x+beforeResize.width-163,beforeResize.y+beforeResize.height-103,{steps:10});
  await presentationPage.mouse.up();
  await presentationPage.waitForFunction(width=>document.querySelector(".lsp-document-reader").getBoundingClientRect().width<width-60,beforeResize.width);
  const afterResize=await richReader.boundingBox(),sizeViewport=presentationPage.viewportSize();
  assert.ok(afterResize.width>=320&&afterResize.height<beforeResize.height-40,"reader resizes through the actual pointer handle");
  assert.ok(afterResize.x>=0&&afterResize.y>=0&&afterResize.x+afterResize.width<=sizeViewport.width+1&&afterResize.y+afterResize.height<=sizeViewport.height+1);
  await presentationPage.screenshot({path:"evidence/expanded-documentation-reader-resized.png"});
  await presentationPage.keyboard.press("Escape");await richReader.waitFor({state:"hidden"});
  await presentationPage.evaluate(()=>{const s=window.__presentation;s.hold=false;s.docs={kind:"plaintext",value:"START_OF_DOCUMENT\n"+"Documentation content ".repeat(2000)+"\nEND_OF_COMPLETE_DOCUMENT"};});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-limit").waitFor();
  assert.equal(await presentationPage.locator(".cm-completionInfo").evaluate(dom=>dom.textContent.includes("END_OF_COMPLETE_DOCUMENT")),false,"bounded preview does not pretend to contain the tail");
  await presentationPage.locator(".cm-completionInfo").getByRole("button",{name:"展开文档",exact:true}).click();
  const reader=presentationPage.getByRole("dialog",{name:"文档阅读",exact:true});
  await reader.waitFor();
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-body")?.textContent.includes("END_OF_COMPLETE_DOCUMENT"));
  assert.equal(await reader.locator(".lsp-document-limit").count(),0,"accepted full document has no false truncation notice");
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.value),"Hash");
  const readerBox=await reader.boundingBox(),readerViewport=presentationPage.viewportSize();
  assert.ok(readerBox.x>=0&&readerBox.y>=0&&readerBox.x+readerBox.width<=readerViewport.width+1&&readerBox.y+readerBox.height<=readerViewport.height+1);

  const originalReaderText=await reader.getByLabel("文档正文",{exact:true}).textContent();
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");
  const readerFind=reader.getByRole("searchbox",{name:"查找文档内容",exact:true});
  await readerFind.fill("Documentation content");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 2000");
  await readerFind.press("Shift+Enter");
  assert.equal(await reader.locator(".lsp-reader-find-count").innerText(),"2000 / 2000","all matches beyond 1000 remain reachable");
  await readerFind.press("Enter");
  assert.equal(await reader.locator(".lsp-reader-find-count").innerText(),"1 / 2000");
  await readerFind.fill("END_OF_COMPLETE_DOCUMENT");
  await reader.locator(".lsp-reader-search-match").filter({hasText:"END_OF_COMPLETE_DOCUMENT"}).waitFor();
  assert.equal(await reader.getByLabel("文档正文",{exact:true}).textContent(),originalReaderText,"search retains full original text");
  await presentationPage.screenshot({path:"evidence/document-reader-search-tail.png"});
  await readerFind.press("Escape");
  assert.equal(await reader.isVisible(),true,"first Escape hides search only");
  assert.equal(await reader.locator(".lsp-reader-find").isVisible(),false);

  await reader.getByLabel("文档正文",{exact:true}).press("Control+End");
  await presentationPage.waitForFunction(()=>{const body=document.querySelector(".lsp-reader-body");return body.scrollTop+body.clientHeight>=body.scrollHeight-2;});
  const tailVisible=await reader.evaluate(dialog=>{
    const body=dialog.querySelector(".lsp-reader-body"),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){
      const at=node.textContent.indexOf("END_OF_COMPLETE_DOCUMENT");if(at<0)continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+"END_OF_COMPLETE_DOCUMENT".length);
      const a=range.getBoundingClientRect(),b=body.getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;
    }
    return false;
  });
  assert.equal(tailVisible,true,"keyboard can reveal the complete document tail, not just retain it in DOM");
  await presentationPage.screenshot({path:"evidence/expanded-documentation-reader.png"});
  await presentationPage.keyboard.press("Escape");
  await reader.waitFor({state:"hidden"});
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true,"closing reader restores code focus");


  // Search across inline markup without re-rendering or changing text-node identity.
  await presentationPage.evaluate(async()=>{
    const {renderDocumentation}=await import("/src/lsp-documentation.ts");
    const owner=new AbortController();window.__readerSearchOwner=owner;
    const node=await renderDocumentation({kind:"markdown",value:"Ha**sh**Map and HASHMAP. 😀\n\nHash\n\nMap\n\nliteral [x]+.*\n\n<blockquote>alpha<hr>beta</blockquote>\n\n<blockquote>alpha<p></p>beta</blockquote>\n\n<div><em>inline</em> <strong>space</strong></div>"},false,owner.signal);
    node.id="reader-search-fixture";document.body.append(node);
  });
  await presentationPage.locator("#reader-search-fixture .lsp-document-expand").click();
  await reader.waitFor();await reader.locator("strong").first().waitFor();
  const searchMarkup=await reader.getByLabel("文档正文",{exact:true}).innerHTML();
  await reader.evaluate(dialog=>{window.__readerOriginalStrong=dialog.querySelector("strong");window.__readerOriginalText=dialog.querySelector("strong").firstChild;});
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");
  await readerFind.fill("hashmap");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 2");
  assert.equal(await reader.locator(".lsp-reader-search-match").count(),3,"one active result can span inline text and bold nodes");
  await readerFind.press("Enter");assert.equal(await reader.locator(".lsp-reader-find-count").innerText(),"2 / 2");
  await readerFind.press("Shift+Enter");assert.equal(await reader.locator(".lsp-reader-find-count").innerText(),"1 / 2");
  await readerFind.fill("HashMapHash");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="0 / 0");
  await readerFind.fill("alphabeta");await readerFind.press("Enter");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="0 / 0");
  await readerFind.fill("inline space");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 1");
  assert.equal((await reader.locator(".lsp-reader-search-match").allTextContents()).join(""),"inline space","visible inline whitespace remains searchable after sanitizer removes wrappers");
  await readerFind.fill("😀");
  await reader.locator(".lsp-reader-search-match").filter({hasText:"😀"}).waitFor();
  await readerFind.evaluate(input=>{
    input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
    input.value="Hash";input.dispatchEvent(new InputEvent("input",{bubbles:true,isComposing:true}));
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true,isComposing:true}));
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true,isComposing:true}));
  });
  assert.equal(await reader.locator(".lsp-reader-search-match").innerText(),"😀","composition does not navigate or apply partial query");
  assert.equal(await reader.isVisible(),true);
  await reader.evaluate(dialog=>dialog.dispatchEvent(new Event("cancel",{cancelable:true})));
  assert.equal(await reader.isVisible(),true,"composition also owns native-style dialog cancel events");
  await readerFind.evaluate(input=>input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"Hash"})));
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 3");
  await readerFind.press("Escape");
  assert.equal(await reader.getByLabel("文档正文",{exact:true}).innerHTML(),searchMarkup,"search teardown preserves sanitized markup exactly");
  assert.equal(await reader.evaluate(dialog=>dialog.querySelector("strong")===window.__readerOriginalStrong&&dialog.querySelector("strong").firstChild===window.__readerOriginalText),true,"original inline nodes are restored");
  await presentationPage.setViewportSize({width:390,height:844});
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");
  await readerFind.fill("literal [x]+.*");
  await reader.locator(".lsp-reader-search-match").filter({hasText:"literal [x]+.*"}).waitFor();
  assert.equal(await reader.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),true,"search controls fit narrow reader");
  await presentationPage.screenshot({path:"evidence/document-reader-search-narrow.png"});
  await readerFind.fill("pending debounce");
  await reader.getByRole("button",{name:"关闭文档",exact:true}).click();
  await presentationPage.waitForTimeout(150);
  assert.equal(await presentationPage.locator(".lsp-reader-find,.lsp-reader-search-match").count(),0,"close owns pending search work");
  await presentationPage.evaluate(()=>{window.__readerSearchOwner.abort();document.getElementById("reader-search-fixture").remove();});
  await presentationPage.setViewportSize({width:1200,height:800});

  // Insert after the reader-search fixture cleanup/viewport reset, before Reader race.
  // Uses the real Markdown and language workers; no synthetic token replies here.
  const highlightCases = [
    ["rust", 'fn highlight_probe() { let answer = 42; println!("rust"); }\n'],
    ["python", 'def highlight_probe():\n    return "python", 42\n'],
    ["go", 'package main\nfunc highlight_probe() string { return "go" }\n'],
    ["c", 'int highlight_probe(void) { return 42; }\n'],
    ["c++", 'int highlight_probe() { return 42; }\n'],
    ["java", 'class HighlightProbe { int answer() { return 42; } }\n'],
    ["", 'fn untagged_plain() { return 42; }\n'],
    ["unknown_language", 'fn unknown_plain() { return 42; }\n'],
    ["rust", 'let unsafe_text = "<img src=https://invalid.example/code onerror=window.__highlightUnsafe=1>";\n'],
  ];
  const mountHighlightFixture = async (value, legacy = false) => {
    await presentationPage.evaluate(async ({value,legacy}) => {
      const {renderDocumentation}=await import("/src/lsp-documentation.ts");
      const owner=new AbortController(),host=document.createElement("div");
      host.id="reader-highlight-fixture";document.body.append(host);
      window.__highlightFixture={owner,host};
      host.append(await renderDocumentation(value,legacy,owner.signal));
    },{value,legacy});
    await presentationPage.locator("#reader-highlight-fixture .lsp-document-expand").click();
    await reader.waitFor();
    await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-body")?.getAttribute("aria-busy")==="false");
  };
  const removeHighlightFixture = async () => {
    await reader.getByRole("button",{name:"关闭文档",exact:true}).click();
    await presentationPage.evaluate(()=>{window.__highlightFixture.owner.abort();window.__highlightFixture.host.remove();});
  };
  await mountHighlightFixture({kind:"markdown",value:highlightCases.map(([language,code])=>"```"+language+"\n"+code+"```").join("\n\n")});
  assert.deepEqual(await reader.locator("pre code").allTextContents(),highlightCases.map(([,code])=>code),"highlighting preserves every code point and newline");
  for(let i=0;i<6;i++){
    const code=reader.locator("pre code").nth(i),keyword=code.locator(".lsp-code-keyword").first();
    assert.ok(await keyword.count(),highlightCases[i][0]+" has real parser keyword tokens");
    await keyword.scrollIntoViewIfNeeded();
    assert.equal(await keyword.isVisible(),true);
    assert.equal(await keyword.evaluate(node=>getComputedStyle(node).color!==getComputedStyle(node.closest("code")).color),true,highlightCases[i][0]+" token has visible syntax color");
  }
  for(const i of [6,7])assert.equal(await reader.locator("pre code").nth(i).locator("span").count(),0,"unknown and untagged fences remain plain");
  assert.equal(await reader.locator("img,script,iframe,a").count(),0,"code resembling HTML stays inert");
  assert.equal(await presentationPage.evaluate(()=>window.__highlightUnsafe??null),null);
  assert.deepEqual(externalDocRequests,[]);
  const beforeHighlightSearch=await reader.getByLabel("文档正文",{exact:true}).innerHTML();
  await reader.evaluate(dialog=>{
    const code=dialog.querySelector("pre code"),walker=document.createTreeWalker(code,NodeFilter.SHOW_ALL),nodes=[];let node;
    while(node=walker.nextNode())nodes.push(node);
    window.__highlightOriginal={code,nodes};
  });
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");
  await readerFind.fill("let answer = 42");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 1");
  assert.ok(await reader.locator(".lsp-reader-search-match").count()>1,"one search result crosses token and plain-text boundaries");
  assert.equal((await reader.locator(".lsp-reader-search-match").allTextContents()).join(""),"let answer = 42");
  await presentationPage.screenshot({path:"evidence/document-reader-highlight-search.png"});
  await readerFind.press("Escape");
  assert.equal(await reader.isVisible(),true);
  assert.equal(await reader.getByLabel("文档正文",{exact:true}).innerHTML(),beforeHighlightSearch);
  assert.equal(await reader.evaluate(dialog=>{
    const old=window.__highlightOriginal,code=dialog.querySelector("pre code"),walker=document.createTreeWalker(code,NodeFilter.SHOW_ALL),nodes=[];let node;
    while(node=walker.nextNode())nodes.push(node);
    return code===old.code&&nodes.length===old.nodes.length&&nodes.every((node,i)=>node===old.nodes[i]);
  }),true,"Escape restores original token spans and text nodes by identity");
  await removeHighlightFixture();

  // Reopening identical Markdown exercises the sanitized cache plus fence sidecar.
  await mountHighlightFixture({kind:"markdown",value:highlightCases.map(([language,code])=>"```"+language+"\n"+code+"```").join("\n\n")});
  assert.deepEqual(await reader.locator("pre code").allTextContents(),highlightCases.map(([,code])=>code));
  assert.ok(await reader.locator("pre code").first().locator(".lsp-code-keyword").count(),"cache hit retains trusted fence metadata");
  await presentationPage.setViewportSize({width:390,height:844});
  assert.equal(await reader.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),true,"highlighted code does not expand narrow dialog");
  await presentationPage.screenshot({path:"evidence/document-reader-highlight-narrow.png"});
  await presentationPage.emulateMedia({forcedColors:"active"});
  const forcedKeyword=reader.locator("pre code").first().locator(".lsp-code-keyword").first();
  await forcedKeyword.scrollIntoViewIfNeeded();
  assert.equal(await forcedKeyword.isVisible(),true);
  assert.equal(await forcedKeyword.evaluate(node=>matchMedia("(forced-colors: active)").matches&&getComputedStyle(node).forcedColorAdjust!=="none"&&getComputedStyle(node).opacity!=="0"),true,"tokens remain visible and allow the system high-contrast palette");
  await presentationPage.screenshot({path:"evidence/document-reader-highlight-forced-colors.png"});
  await presentationPage.emulateMedia({forcedColors:"none"});
  await presentationPage.setViewportSize({width:1200,height:800});
  await removeHighlightFixture();

  const legacyHighlightText='fn legacy_probe() {\n\tlet label = "中文 😀";\n}\n';
  await mountHighlightFixture([{language:"RuSt",value:legacyHighlightText},{language:"not-a-language",value:legacyHighlightText}],true);
  assert.deepEqual(await reader.locator("pre code").allTextContents(),[legacyHighlightText,legacyHighlightText],"legacy MarkedString preserves tabs, Unicode and line endings");
  assert.ok(await reader.locator("pre code").first().locator(".lsp-code-keyword").count(),"legacy language alias receives real parser tokens");
  assert.equal(await reader.locator("pre code").nth(1).locator("span").count(),0,"unknown legacy label stays plain");
  await removeHighlightFixture();

  const largeHighlightCode='// large code stays complete\n'+"let repeated = 1;\n".repeat(700)+"// HIGHLIGHT_FALLBACK_TAIL\n";
  await mountHighlightFixture({kind:"markdown",value:"```rust\n"+largeHighlightCode+"```"});
  assert.equal(await reader.locator("pre code").textContent(),largeHighlightCode);
  assert.equal(await reader.locator("pre code span").count(),0,"oversized code skips optional highlighting");
  assert.equal(await reader.locator(".lsp-document-limit").count(),0,"highlight limit does not truncate accepted documentation");
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");
  await readerFind.fill("HIGHLIGHT_FALLBACK_TAIL");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="1 / 1");
  await reader.locator(".lsp-reader-search-match").waitFor({state:"visible"});
  await readerFind.press("Escape");
  assert.equal(await reader.locator("pre code").textContent(),largeHighlightCode);
  await removeHighlightFixture();

  const markerValidation=await presentationPage.evaluate(async()=>{
    const {collectCodeFences,highlightDocumentCode}=await import("/src/document-code-highlight.ts");
    const {CODE_MARKER}=await import("/src/document-code-model.ts");
    const section=document.createElement("div"),id="f-"+"a".repeat(32)+"-0",fence={id,part:0,language:"rust",text:"fn x() {}\n"};
    section.innerHTML='<pre><code class="lsp-code-keyword" '+CODE_MARKER+'="'+id+'">spoof</code></pre>';
    const wrong=collectCodeFences([section],[fence]).length,remaining=section.querySelectorAll("["+CODE_MARKER+"]").length;
    section.replaceChildren();
    for(let i=0;i<2;i++){const pre=document.createElement("pre"),code=document.createElement("code");code.setAttribute(CODE_MARKER,id);code.textContent=fence.text;pre.append(code);section.append(pre);}
    const duplicate=collectCodeFences([section],[fence]).length;
    const dom=document.createElement("div"),code=document.createElement("code");code.textContent=fence.text;dom.append(code);
    const frag=document.createDocumentFragment();for(let i=0;i<28001;i++)frag.append(document.createElement("br"));dom.append(frag);
    await highlightDocumentCode(dom,[{...fence,node:code}]);
    return {wrong,remaining,duplicate,text:code.textContent,spans:code.children.length};
  });
  assert.deepEqual(markerValidation,{wrong:0,remaining:0,duplicate:0,text:"fn x() {}\n",spans:0},"untrusted/duplicate markers rejected; node budget preserves plain code");
  const denseHighlightCode="let x=1;\n".repeat(600);
  await mountHighlightFixture({kind:"markdown",value:"\`\`\`rust\n"+denseHighlightCode+"\`\`\`"});
  assert.equal(await reader.locator("pre code").textContent(),denseHighlightCode);
  assert.equal(await reader.locator("pre code span").count(),0,"token budget never produces partial highlighted code");
  await removeHighlightFixture();

  // Deterministic close before optional worker delivery. Close in the same browser
  // turn as postMessage, so a short fallback timeout cannot win this regression.
  const highlightRace=await presentationPage.evaluate(async()=>{
    const {renderDocumentation}=await import("/src/lsp-documentation.ts");
    const NativeWorker=window.Worker,owner=new AbortController(),host=document.createElement("div");
    const before=window.__presentation.view().state.doc.toString();document.body.append(host);
    let held,lateHandler;
    window.Worker=class {
      constructor(url,options){
        if(!String(url).includes("document-code.worker"))return new NativeWorker(url,options);
        held=this;this.terminated=0;
      }
      postMessage(message){
        this.message=message;lateHandler=this.onmessage;
        document.querySelector('.lsp-document-reader [aria-label="关闭文档"]').click();
      }
      terminate(){this.terminated++;}
    };
    try{
      host.append(await renderDocumentation({language:"rust",value:"fn race_probe() { let answer = 42; }"},true,owner.signal));
      host.querySelector(".lsp-document-expand").click();
      await Promise.resolve();await Promise.resolve();
      if(!held)throw Error("Expected optional highlight worker");
      const candidate=held.message.candidates[0];
      lateHandler({data:{highlights:[{id:candidate.id,ranges:[{from:0,to:2,token:"keyword"}]}]}});
      await Promise.resolve();await Promise.resolve();
      return {terminated:held.terminated,readers:document.querySelectorAll(".lsp-document-reader").length,unchanged:window.__presentation.view().state.doc.toString()===before};
    }finally{window.Worker=NativeWorker;owner.abort();host.remove();}
  });
  assert.deepEqual(highlightRace,{terminated:1,readers:0,unchanged:true},"late syntax reply cannot revive closed reader or change source");
  // Isolated failure-path fixtures only: timeout, worker error, and invalid ranges
  // all preserve plain content and immediately release the single optional slot.
  const highlightFallbacks=await presentationPage.evaluate(async()=>{
    const {renderDocumentation}=await import("/src/lsp-documentation.ts");
    const NativeWorker=window.Worker,records=[];
    let mode="timeout";
    window.Worker=class {
      constructor(url,options){
        if(!String(url).includes("document-code.worker"))return new NativeWorker(url,options);
        this.mode=mode;this.terminated=0;records.push(this);
      }
      postMessage({candidates}){
        const candidate=candidates[0];
        if(this.mode==="timeout")return;
        queueMicrotask(()=>{
          if(this.mode==="error"){this.onerror?.(new Event("error"));return;}
          const ranges=this.mode==="malformed"?[{from:0,to:candidate.text.length+1,token:"keyword"}]:[{from:0,to:2,token:"keyword"}];
          this.onmessage?.({data:{highlights:[{id:candidate.id,ranges}]}});
        });
      }
      terminate(){this.terminated++;}
    };
    try{
      const results=[],value={language:"rust",value:'fn fallback_probe() { let label = "😀"; }'};
      for(const failure of ["timeout","error","malformed"]){
        mode=failure;
        const plain=await renderDocumentation(value,true,undefined,{expanded:true});
        mode="success";
        const recovered=await renderDocumentation(value,true,undefined,{expanded:true});
        results.push({failure,text:plain.querySelector("code").textContent,plain:plain.querySelectorAll("code span").length===0,recovered:recovered.querySelector(".lsp-code-keyword")?.textContent});
      }
      return {results,terminated:records.map(worker=>worker.terminated)};
    }finally{window.Worker=NativeWorker;}
  });
  assert.deepEqual(highlightFallbacks.results,["timeout","error","malformed"].map(failure=>({failure,text:'fn fallback_probe() { let label = "😀"; }',plain:true,recovered:"fn"})));
  assert.deepEqual(highlightFallbacks.terminated,[1,1,1,1,1,1],"every fallback and recovery worker terminates exactly once");
  await writeFile("evidence/DOCUMENT_CODE_HIGHLIGHT_RESULT.txt","PASS: real parser workers for Rust/Python/Go/C/C++/Java; exact code text, visibly colored keywords, unknown/untagged plain fallback, inert HTML-like code, search across token boundaries with original-node restoration, oversized-code tail search, and close-before-late-reply ownership. Browser fixture only.\n");

  // Keyboard reader activation and close during an owned worker's pending parse.
  await presentationPage.evaluate(()=>{const s=window.__presentation;s.docs={kind:"markdown",value:"**Reader race**\n\n"+"bounded document ".repeat(2400)+"END_OF_RACE_DOCUMENT"};});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-limit").waitFor();
  await presentationPage.evaluate(async()=>{
    const {completionStatus}=await import("/node_modules/.vite/deps/@codemirror_autocomplete.js");
    const s=window.__presentation;s.readerBlurState="not-blurred";s.view().contentDOM.addEventListener("blur",()=>{s.readerBlurState=completionStatus(s.view().state);},{once:true});
    s.NativeWorker=window.Worker;s.readerWorkers=[];
    window.Worker=class {constructor(){this.terminated=0;s.readerWorkers.push(this);}postMessage(){}terminate(){this.terminated++;}};
  });
  await presentationCode.press("Alt+Enter");
  await reader.waitFor();
  assert.equal(await reader.getByLabel("文档正文",{exact:true}).getAttribute("aria-busy"),"true");
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");await readerFind.fill("Reader race");await readerFind.press("Escape");
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.readerBlurState),null,"completion is closed before modal blur can schedule a stale close timer");
  await presentationPage.keyboard.press("Escape");
  await reader.waitFor({state:"hidden"});
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true);
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.readerWorkers[0].terminated),1);
  await presentationPage.evaluate(()=>{
    const s=window.__presentation;const worker=s.readerWorkers[0];worker.onmessage?.({data:{html:["late content"]}});window.Worker=s.NativeWorker;
  });
  assert.equal(await presentationPage.locator(".lsp-document-reader").count(),0,"late worker callback cannot revive closed reader");
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-expand").waitFor();
  await presentationCode.press("Alt+Enter");
  await reader.waitFor();
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-body")?.textContent.includes("END_OF_RACE_DOCUMENT"));
  await presentationPage.keyboard.press("Escape");
  await reader.waitFor({state:"hidden"});

  // Query entered while the expanded worker is held applies on successful mount.
  await presentationPage.evaluate(()=>{window.__presentation.docs={kind:"markdown",value:"Reader loading\n\n"+"bounded ".repeat(5000)+" END_OF_READY_DOCUMENT"};});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-expand").waitFor();
  const waitingSearch=await presentationPage.evaluate(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class{constructor(){this.terminated=0;window.__readyReaderWorker=this;}postMessage(value){this.parts=value.parts;}terminate(){this.terminated++;}};
    try{
      document.querySelector(".cm-completionInfo .lsp-document-expand").click();
      const dialog=document.querySelector(".lsp-document-reader"),body=dialog.querySelector(".lsp-reader-body");
      body.dispatchEvent(new KeyboardEvent("keydown",{key:"f",ctrlKey:true,bubbles:true,cancelable:true}));
      const input=dialog.querySelector(".lsp-reader-find input");input.value="END_OF_READY_DOCUMENT";
      input.dispatchEvent(new InputEvent("input",{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
      const pending={busy:body.getAttribute("aria-busy"),count:dialog.querySelector(".lsp-reader-find-count").textContent,marks:dialog.querySelectorAll(".lsp-reader-search-match").length,focused:document.activeElement===input};
      const worker=window.__readyReaderWorker;
      worker.onmessage({data:{html:worker.parts.map(part=>{if(part.kind!=="markdown")return null;const p=document.createElement("p");p.textContent=part.text;return p.outerHTML;})}});
      return pending;
    }finally{window.Worker=NativeWorker;}
  });
  assert.deepEqual(waitingSearch,{busy:"true",count:"载入中",marks:0,focused:true});
  await reader.locator(".lsp-reader-search-match").filter({hasText:"END_OF_READY_DOCUMENT"}).waitFor();
  assert.equal(await readerFind.inputValue(),"END_OF_READY_DOCUMENT");
  assert.equal(await reader.locator(".lsp-reader-find-count").innerText(),"1 / 1");
  assert.equal(await readerFind.evaluate(input=>input===document.activeElement),true);
  assert.equal(await presentationPage.evaluate(()=>window.__readyReaderWorker.terminated),1);
  await readerFind.press("Escape");assert.equal(await reader.isVisible(),true);
  await presentationPage.keyboard.press("Escape");await reader.waitFor({state:"hidden"});
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true);

  await presentationPage.evaluate(()=>{const s=window.__presentation;s.detailOnly=true;s.resolvedDetail="fn resolved_signature("+("parameter: VeryLongType, ".repeat(40))+") -> END_OF_RESOLVED_DETAIL";});
  await presentationCode.press("Control+Space");
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-completion-documentation")?.textContent.includes("END_OF_RESOLVED_DETAIL"));
  await presentationPage.locator(".cm-completionInfo").getByRole("button",{name:"展开文档",exact:true}).click();
  await reader.waitFor();
  await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-body")?.textContent.includes("END_OF_RESOLVED_DETAIL"));
  assert.equal(await reader.locator("img,script,a").count(),0);
  await reader.getByRole("button",{name:"关闭文档",exact:true}).click();
  assert.equal(await presentationPage.evaluate(()=>window.__presentation.view().hasFocus),true);
  await presentationPage.evaluate(()=>{window.__presentation.detailOnly=false;});

  const lifecycle=await presentationPage.evaluate(async()=>{
    const {renderDocumentation}=await import("/src/lsp-documentation.ts");
    const NativeWorker=window.Worker,workers=[];
    class HeldWorker {
      constructor(){this.terminated=0;workers.push(this);}
      postMessage(){}
      terminate(){this.terminated++;}
    }
    window.Worker=HeldWorker;
    try{
      const a=new AbortController(),b=new AbortController();
      const first=renderDocumentation({kind:"markdown",value:"**held-one**"},false,a.signal);
      const second=renderDocumentation({kind:"markdown",value:"**held-two**"},false,b.signal);
      const saturated=await renderDocumentation({kind:"markdown",value:"**busy-fallback**"});
      const count=workers.length;
      a.abort();b.abort();
      const cancelled=await Promise.all([first,second]);
      const started=performance.now();
      const timeout=await renderDocumentation({kind:"markdown",value:"**timeout-fallback**"});
      return {count,saturated:saturated?.textContent,cancelled:cancelled.every(v=>v===null),terminated:workers.map(w=>w.terminated),timeout:timeout?.textContent,elapsed:performance.now()-started};
    }finally{window.Worker=NativeWorker;}
  });
  assert.equal(lifecycle.count,2);assert.equal(lifecycle.saturated,"**busy-fallback**");assert.equal(lifecycle.cancelled,true);
  assert.deepEqual(lifecycle.terminated,[1,1,1]);assert.equal(lifecycle.timeout,"**timeout-fallback**");assert.ok(lifecycle.elapsed<2000);
  assert.equal(await presentationPage.evaluate(async()=>{const {renderDocumentation}=await import("/src/lsp-documentation.ts");const dom=await renderDocumentation({kind:"markdown",value:"**recovered-real-worker**"});return dom?.querySelector("strong")?.textContent;}),"recovered-real-worker","worker slots recover after abort and timeout");

  await presentationPage.evaluate(()=>{const s=window.__presentation;s.docs={kind:"plaintext",value:"oversized ".repeat(30000)+"UNREACHABLE_TAIL"};});
  await presentationCode.press("Control+Space");
  await presentationPage.locator(".cm-completionInfo .lsp-document-limit").waitFor();
  await presentationPage.locator(".cm-completionInfo").getByRole("button",{name:"展开文档",exact:true}).click();
  await reader.waitFor();await reader.locator(".lsp-document-limit").waitFor();
  assert.equal(await reader.locator(".lsp-document-limit").innerText(),"文档超出显示上限，当前内容不完整");
  await reader.getByLabel("文档正文",{exact:true}).press("Control+f");await readerFind.fill("文档超出显示上限");await presentationPage.waitForFunction(()=>document.querySelector(".lsp-reader-find-count")?.textContent==="0 / 0");await readerFind.press("Escape");
  assert.equal(await reader.evaluate(dom=>dom.textContent.includes("UNREACHABLE_TAIL")),false);
  await presentationPage.evaluate(()=>window.__presentation.mount.destroy());
  assert.equal(await presentationPage.locator(".lsp-document-reader").count(),0,"editor destruction owns and closes its expanded reader");
  assert.equal(await presentationPage.locator(".cm-tooltip").count(),0);
  await writeFile("evidence/EXPANDED_DOCUMENTATION_RESULT.txt","PASS: explicit preview limits, >32K original document tail in reader, resolved-detail-only expansion past500characters, modal bounds, Escape/close restoring code focus, explicit >256K limit and owner destruction. Browser fixture, not native reader qualification.\n");
  assert.deepEqual(presentationErrors,[]);
  await writeFile("evidence/EDITOR_POPOVER_PRESENTATION_RESULT.txt","PASS: actual CodeEditor completion/documentation and active signature parameter; 1200/640/400 CSS-pixel viewports at DPR2 and 125% CSS zoom; controlled in-flight worker cancellation, saturation and timeout recovery plus real-worker recovery; independent bounded scroll, no list overlap, SVG alignment, literal plaintext vs sanitized Markdown, no remote resources, keyboard selection/Escape, delayed resolve and destroyed editor cleanup. Browser mock only; real OS zoom, native screenshots, other platforms and real IME require independent qualification.\n");
  await presentationPage.close();

  const providerPage=await browser.newPage();
  await providerPage.route("**/provider-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor'></div></body></html>"}));
  await providerPage.goto("http://127.0.0.1:5173/provider-test");
  await providerPage.evaluate(async()=>{
    const {EditorView,EditorState,basicSetup,languageIntelligence}=await import("/tests/input-harness.ts");
    const s=window.__providerTest={calls:[],sequences:[],cancellations:[],statuses:[],version:1};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="language_cancel_completion"){s.cancellations.push(args);return;}
      if(command==="start_language_service")return {id:89,version:1,server:"provider-fixture",uri:"file:///s.cpp",completionResolve:false,completionTriggerCharacters:[".",">","@"]};
      if(command==="update_language_document"){if(s.deferSync)await new Promise(resolve=>{s.syncReply=resolve;});s.version=args.version;return;}
      if(command==="stop_language_service")return;
      if(command==="language_diagnostics")return {version:s.version,diagnostics:[]};
      if(command==="language_request"){if(args.kind==="completion"){s.calls.push(args.completionContext);s.sequences.push(args.completionSequence);const result={isIncomplete:s.incomplete!==false,items:[{label:"itemName"}]};if(s.defer)return new Promise((resolve,reject)=>{s.reply=()=>resolve(result);s.reject=reject;});return result;}return null;}
      throw Error(command);
    }};
    s.client=languageIntelligence("cpp",message=>s.statuses.push(message),()=>{});
    s.view=new EditorView({state:EditorState.create({doc:"item",extensions:[basicSetup,s.client.extensions]}),parent:document.querySelector("#editor")});
    await s.client.connect(s.view);s.view.dispatch({selection:{anchor:4}});s.view.focus();
  });
  await providerPage.keyboard.press("Control+Space");
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  assert.deepEqual(await providerPage.evaluate(()=>window.__providerTest.calls.at(-1)),{triggerKind:1});
  await providerPage.keyboard.type(".");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.at(-1)?.triggerKind===2&&window.__providerTest.calls.at(-1)?.triggerCharacter===".");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>window.__providerTest.calls.at(-1)?.triggerKind===1);
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.incomplete=false;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();});
  await providerPage.keyboard.press("Control+Space");
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  await providerPage.keyboard.type(".");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.at(-1)?.triggerKind===2&&window.__providerTest.calls.at(-1)?.triggerCharacter===".");
  await providerPage.keyboard.press("Control+Space");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.at(-1)?.triggerKind===1);
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.incomplete=true;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();});
  await providerPage.keyboard.press("Control+Space");
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  await providerPage.keyboard.type("N");
  try{await providerPage.waitForFunction(()=>window.__providerTest.calls.some(x=>x.triggerKind===3));}catch(error){await writeFile("evidence/completion-context-failure.json",JSON.stringify(await providerPage.evaluate(()=>({calls:window.__providerTest.calls,text:window.__providerTest.view.state.doc.toString()}))));throw error;}
  await providerPage.evaluate(()=>{window.__providerTest.calls=[];});
  await providerPage.keyboard.type(">");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.some(x=>x.triggerKind===2&&x.triggerCharacter===">"));
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"obj"},selection:{anchor:3}});s.view.focus();});
  await providerPage.keyboard.type(">");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.some(x=>x.triggerKind===2&&x.triggerCharacter===">"));
  await providerPage.keyboard.press("Escape");
  await providerPage.keyboard.press("Control+Space");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.at(-1)?.triggerKind===1);
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.defer=true;s.reply=null;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();});
  await providerPage.keyboard.press("Control+Space");
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=false;s.reply();});
  await providerPage.keyboard.type("N");
  await providerPage.waitForFunction(()=>window.__providerTest.calls.length>=2);
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.calls.at(-1).triggerKind),1,"late response after Escape cannot restore incomplete context");
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.defer=true;s.reply=null;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.oldReply=s.reply;s.reply=null;s.client.commands.completion(s.view);s.oldReply();});
  await providerPage.waitForFunction(()=>window.__providerTest.calls.length>=2&&typeof window.__providerTest.reply==="function");
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.calls.at(-1).triggerKind),1,"explicit command replaces a pending completion");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=false;s.reply();});
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.defer=true;s.reply=null;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.oldReply=s.reply;s.reply=null;});
  await providerPage.keyboard.press("Control+Space");
  await providerPage.evaluate(()=>window.__providerTest.oldReply());
  await providerPage.waitForFunction(()=>window.__providerTest.calls.length>=2&&typeof window.__providerTest.reply==="function");
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.calls.at(-1).triggerKind),1,"keyboard invocation replaces a pending completion");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=false;s.reply();});
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.defer=true;s.reply=null;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.oldReject=s.reject;s.defer=false;});
  await providerPage.keyboard.press("Escape");
  await providerPage.keyboard.press("Control+Space");
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  await providerPage.evaluate(()=>window.__providerTest.oldReject(Error("obsolete completion transport failure")));
  await providerPage.waitForTimeout(250);
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.statuses.some(s=>s.includes("obsolete completion transport failure"))),false,"obsolete failure cannot overwrite newer successful completion status");
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=true;s.reply=null;s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=false;s.reject(Error("current completion transport failure"));});
  await providerPage.waitForFunction(()=>window.__providerTest.statuses.at(-1)?.includes("current completion transport failure"));
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.calls=[];s.deferSync=true;s.syncReply=null;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"itemN"},selection:{anchor:5}});s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.syncReply==="function");
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.deferSync=false;s.syncReply();});
  await providerPage.waitForTimeout(400);
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.calls.length),0,"completion canceled during document flush never enters IPC");
  await providerPage.keyboard.press("Control+Space");
  await providerPage.getByRole("option",{name:"itemName",exact:true}).waitFor();
  assert.equal(await providerPage.evaluate(()=>window.__providerTest.calls.at(-1)?.triggerKind),1,"current completion still works after canceled flush");
  // Real CodeMirror invalidation hooks send the exact issued ownership ticket.
  // The fixture intentionally ignores cancellation and delivers late replies.
  for(const action of ["Escape","typing","selection","blur","composition"]){
    await providerPage.keyboard.press("Escape");
    await providerPage.evaluate(()=>{
      const s=window.__providerTest;s.defer=true;s.reply=null;
      s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:"item"},selection:{anchor:4}});
      s.view.focus();s.client.commands.completion(s.view);
    });
    await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
    const ticket=await providerPage.evaluate(()=>{
      const s=window.__providerTest;s.lateReply=s.reply;s.defer=false;return s.sequences.at(-1);
    });
    if(action==="Escape")await providerPage.keyboard.press("Escape");
    if(action==="typing")await providerPage.keyboard.type("N");
    if(action==="selection")await providerPage.keyboard.press("ArrowLeft");
    if(action==="blur")await providerPage.evaluate(()=>window.__providerTest.view.contentDOM.blur());
    if(action==="composition")await providerPage.evaluate(()=>window.__providerTest.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true})));
    await providerPage.waitForFunction(n=>window.__providerTest.cancellations.some(c=>c.id===89&&c.throughSequence===n),ticket);
    assert.equal(await providerPage.evaluate(n=>window.__providerTest.cancellations.filter(c=>c.id===89&&c.throughSequence===n).length,ticket),1,action+" cancels its owned request exactly once");
    await providerPage.evaluate(()=>{
      const s=window.__providerTest;s.lateReply();
      s.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));s.view.focus();
    });
  }
  const issuedSequences=await providerPage.evaluate(()=>window.__providerTest.sequences);
  assert.ok(issuedSequences.length>8,"exercise multiple completion intents and retries");
  assert.ok(issuedSequences.every((n,i)=>Number.isSafeInteger(n)&&n>0&&(i===0||n>issuedSequences[i-1])),"outbound completion sequences are positive, safe and strictly increasing");
  await providerPage.keyboard.press("Escape");
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.defer=true;s.reply=null;s.view.focus();s.client.commands.completion(s.view);});
  await providerPage.waitForFunction(()=>typeof window.__providerTest.reply==="function");
  const destroyTicket=await providerPage.evaluate(()=>window.__providerTest.sequences.at(-1));
  await providerPage.evaluate(()=>{const s=window.__providerTest;s.client.destroy();s.view.destroy();s.reply();});
  assert.equal(await providerPage.evaluate(n=>window.__providerTest.cancellations.filter(c=>c.id===89&&c.throughSequence===n).length,destroyTicket),1,"destroy cancels exactly the owned issued request");
  await providerPage.close();
  await writeFile("evidence/COMPLETION_CONTEXT_UI_RESULT.txt","PASS: actual CodeMirror keyboard manual context1, adjacent incomplete context3, provider-specific > context2 and manual override; exact-ticket cancellation on Escape, typing, selection, blur, simulated composition and destruction with ignored-cancel late replies. Mocked IPC; native adapter verification is a separate required check.\\n");

  const inputPage=await browser.newPage({viewport:{width:1200,height:800}});
  await inputPage.route("**/input-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='editor' style='width:600px'></div></body></html>"}));
  await inputPage.goto("http://127.0.0.1:5173/input-test");
  await inputPage.evaluate(async()=>{
    const {EditorView,EditorState,basicSetup,indentGuides,indentationColumns,indentUnit,acceptCompletion,completionStatus,selectedCompletionIndex,languageIntelligence,rust}=await import("/tests/input-harness.ts");
    const state=window.__inputTest={version:1,resolves:0,reply:null,status:[],text:"fn example() {\n    let _map = HashM\n}",defer:true};
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==="start_language_service")return {id:72,version:1,server:"fixture",uri:"file:///s.rs",completionResolve:true};
      if(command==="stop_language_service")return;
      if(command==="update_language_document"){state.text=args.text;state.version=args.version;return;}
      if(command==="language_diagnostics")return {version:state.version,diagnostics:[]};
      if(command==="language_request"){
        if(args.kind==="completion")return [{label:"HashMap",kind:7,_inkleetCompletion:1,textEdit:{range:{start:{line:1,character:15},end:{line:1,character:20}},newText:"HashMap"}}];
        return null;
      }
      if(command==="language_completion_resolve"){
        state.resolves++;
        const result={label:"HashMap",textEdit:{range:{start:{line:1,character:15},end:{line:1,character:20}},newText:"HashMap"},additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"use std::collections::HashMap;\n"}]};
        if(state.defer)return new Promise(resolve=>{state.reply=()=>resolve(result);});
        return result;
      }
      throw Error("unexpected input command "+command);
    }};
    const client=languageIntelligence("rust",message=>state.status.push(message),()=>{});
    const view=new EditorView({state:EditorState.create({doc:state.text,extensions:[basicSetup,rust(),indentUnit.of("    "),indentGuides,client.extensions,EditorView.theme({".cm-scroller":{maxHeight:"240px",overflow:"auto"}})]}),parent:document.querySelector("#editor")});
    state.client=client;state.view=view;state.accept=()=>acceptCompletion(view);state.columns=indentationColumns;state.completionStatus=()=>completionStatus(view);state.selectedIndex=()=>selectedCompletionIndex(view);
    state.boundaryCheck=async()=>{const {completionChanges}=await import("/src/intelligence.ts");const doc=EditorState.create({doc:"HashM"}).doc;const result=completionChanges(doc,{label:"HashMap",textEdit:{range:{start:{line:0,character:0},end:{line:0,character:5}},newText:"HashMap"},additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"use std::collections::HashMap;\n"}]},0,5);const change=EditorState.create({doc:"HashM"}).update({changes:result.changes,selection:{anchor:result.anchor}});return {text:change.state.doc.toString(),cursor:change.state.selection.main.head};};
    await client.connect(view);view.dispatch({selection:{anchor:view.state.doc.line(2).to}});view.focus();
  });
  const boundary=await inputPage.evaluate(()=>window.__inputTest.boundaryCheck());
  assert.equal(boundary.text,"use std::collections::HashMap;\nHashMap");
  assert.equal(boundary.cursor,boundary.text.length,"same-offset import precedes primary and cursor maps correctly");
  await inputPage.keyboard.press("Control+Space");
  await inputPage.getByRole("option",{name:/HashMap/}).waitFor();
  await inputPage.waitForTimeout(150);
  await writeFile("evidence/completion-before-accept.json",JSON.stringify(await inputPage.evaluate(()=>({focused:window.__inputTest.view.hasFocus,composing:window.__inputTest.view.composing,text:window.__inputTest.view.state.doc.toString(),options:[...document.querySelectorAll('[role="option"]')].map(el=>el.outerHTML)})),null,2));
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.accept()),true,"shared-module completion command accepts the visible candidate");
  await inputPage.waitForFunction(()=>typeof window.__inputTest.reply==="function");
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.view.state.doc.toString()),"fn example() {\n    let _map = HashM\n}","unresolved acceptance inserts nothing");
  await inputPage.evaluate(()=>window.__inputTest.reply());
  await inputPage.waitForFunction(()=>window.__inputTest.view.state.doc.toString().startsWith("use std::collections::HashMap;"));
  assert.match(await inputPage.evaluate(()=>window.__inputTest.view.state.doc.toString()),/let _map = HashMap/);
  await inputPage.keyboard.press("Control+z");
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.view.state.doc.toString()),"fn example() {\n    let _map = HashM\n}","atomic import and primary edit undo together");
  await inputPage.evaluate(()=>{window.__inputTest.reply=null;});
  await inputPage.keyboard.press("Control+Space");await inputPage.getByRole("option",{name:/HashMap/}).waitFor();
  await inputPage.waitForTimeout(150);
  await inputPage.keyboard.press("Enter");
  await inputPage.waitForFunction(()=>typeof window.__inputTest.reply==="function");
  await inputPage.keyboard.press("ArrowLeft");
  await inputPage.evaluate(()=>window.__inputTest.reply());
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.view.state.doc.toString()),"fn example() {\n    let _map = HashM\n}","cursor movement discards resolve result without partial imports");
  await inputPage.evaluate(()=>{const s=window.__inputTest;s.reply=null;s.view.dispatch({selection:{anchor:s.view.state.doc.line(2).to}});});
  await inputPage.keyboard.press("Control+Space");await inputPage.getByRole("option",{name:/HashMap/}).waitFor();
  await inputPage.waitForTimeout(150);await inputPage.keyboard.press("Enter");
  await inputPage.waitForFunction(()=>typeof window.__inputTest.reply==="function");
  await inputPage.keyboard.press("Escape");
  await inputPage.evaluate(()=>window.__inputTest.reply());
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.view.state.doc.toString()),"fn example() {\n    let _map = HashM\n}","Escape cancels pending acceptance even when autocomplete consumes the key");

  assert.deepEqual(await inputPage.evaluate(()=>window.__inputTest.columns("  \tvalue",4)),{columns:4,blank:false});
  assert.equal(await inputPage.evaluate(()=>window.__inputTest.columns(" ".repeat(1000000),4).columns),128);
  await inputPage.evaluate(()=>{const s=window.__inputTest;const text="fn example() {\n    if true {\n        let value = 1;\n\n        println!(\"{value}\");\n    }\n}";s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:text},selection:{anchor:text.indexOf("let value")}});});
  await inputPage.locator(".cm-indent-guide-active").first().waitFor();
  assert.equal(await inputPage.locator(".cm-indent-guide-active").first().evaluate(el=>getComputedStyle(el,"::after").pointerEvents),"none");
  await inputPage.screenshot({path:"evidence/indent-guides.png"});
  await inputPage.evaluate(()=>{const s=window.__inputTest;s.view.dispatch({changes:{from:0,to:s.view.state.doc.length,insert:Array.from({length:10000},(_,i)=>"    let v"+i+" = 1;").join("\n")},selection:{anchor:1}});});
  assert.ok(await inputPage.locator(".cm-indent-guides").count()<500,"guide decorations are viewport-bounded, not document-sized");
  await inputPage.evaluate(()=>{window.__inputTest.client.destroy();window.__inputTest.view.destroy();});
  await inputPage.close();
  await writeFile("evidence/INPUT_RELIABILITY_UI_RESULT.txt","PASS: resolve-before-insert, atomic import undo, stale cursor rejection, bounded indentation helpers and viewport-only guide rendering. Mocked IPC; real Rust native test is separate.\\n");

  await writeFile("evidence/UI_RESULT.txt", "PASS: frontend draft switching, notes editing, responsive layout, no page errors.\nScreenshots: Linux Chromium frontend preview; authored samples; NOT native app or real LeetCode.\n");
} finally { await browser.close(); server.kill(); }
