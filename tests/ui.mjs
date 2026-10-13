import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
  assert.deepEqual(errors, []);
  await writeFile("evidence/UI_RESULT.txt", "PASS: frontend draft switching, notes editing, responsive layout, no page errors.\nScreenshots: Linux Chromium frontend preview; authored samples; NOT native app or real LeetCode.\n");
} finally { await browser.close(); server.kill(); }
