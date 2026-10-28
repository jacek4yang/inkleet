/** Render actual captured native CodeLLDB output, not an invented adapter fixture. */
import assert from "node:assert/strict";
import { checkInlineRawAction } from "./debug-raw-action-ui.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
const directory = path.resolve(process.argv[2] ?? "evidence/rust-debugger");
const result = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8"));
assert.equal(result.status, "PASS", "actual native adapter probe must pass before UI replay");
const trace = JSON.parse(await readFile(path.join(directory, "dap-transcript.json"), "utf8"));
const responses = {};
for (const request of trace.requests) {
  if (request.command !== "variables" || request.error || !Array.isArray(request.response?.variables)) continue;
  const start = request.arguments?.start ?? 0;
  assert.equal(start, 0, "this small-map capture must contain complete first-page data");
  const key = String(request.arguments.variablesReference);
  if (!responses[key] || responses[key].length < request.response.variables.length) responses[key] = request.response.variables;
}
assert.ok(result.locals?.length, "capture must include actual locals");
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5175", "--strictPort"], { stdio: "inherit" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:5175/tests/debug-dap-preview.html")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "actual renderer preview must start");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { window.__dapEvidence = value; }, { locals: result.locals, responses });
  await page.goto("http://127.0.0.1:5175/tests/debug-dap-preview.html");
  const root = name => page.locator(`.debug-variables > .debug-tree-node:has(> .debug-variable > button[aria-label="${name}"])`);
  const readPairs = async node => node.locator('.debug-map-row').evaluateAll(rows => rows.map(row => [row.querySelector('[data-map-field="key"] .debug-variable button code')?.textContent, row.querySelector('[data-map-field="value"] .debug-variable button code')?.textContent]).sort());
  for (const [name, expected] of [["map", result.numericPairs], ["string_map", result.stringPairs]]) {
    const node = root(name);
    await node.getByRole("button", { name, exact: true }).click();
    await page.waitForFunction(name => {
      const node = [...document.querySelectorAll('.debug-variables > .debug-tree-node')].find(item => item.querySelector(':scope > .debug-variable > button')?.getAttribute('aria-label') === name);
      return node?.querySelectorAll('.debug-map-row').length === 2;
    }, name);
    assert.deepEqual(await readPairs(node), [...expected].sort(), "actual native key/value associations must share a row after one expansion");
    assert.equal(await node.getByRole("button", { name: "[0]", exact: true }).count(), 0, "no extra tuple expansion step");
    assert.equal((await node.innerText()).includes("{...}"), false, "decoded scalar map must not display opaque summaries");
    assert.equal(await node.locator('.debug-variable-meta,.debug-field-label,.debug-page-controls').count(), 0);
  }
  const emptyToggle = root("empty").getByRole("button", { name: "empty", exact: true });
  if (await emptyToggle.isEnabled()) await emptyToggle.click();
  await root("empty").getByText("空", { exact: true }).waitFor();
  for (const [name, expected] of [["set", result.setMembers], ["vector", result.vectorElements]]) {
    const node = root(name);
    await node.getByRole("button", { name, exact: true }).click();
    const values = node.locator(':scope > .debug-tree-children > .debug-tree-node > .debug-variable > code');
    await page.waitForFunction(({ name, length }) => [...document.querySelectorAll('.debug-variables > .debug-tree-node')].find(item => item.querySelector(':scope > .debug-variable > button')?.getAttribute('aria-label') === name)?.querySelectorAll(':scope > .debug-tree-children > .debug-tree-node > .debug-variable > code').length === length, { name, length: expected.length });
    const actual = await values.allTextContents();
    assert.deepEqual(name === "set" ? actual.sort() : actual, name === "set" ? [...expected].sort() : expected);
  }
  for (const [label, width] of [["", 680], ["-narrow", 320]]) {
    await page.locator('main.debug-panel').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
    assert.equal(await page.locator('.debug-tree-children > .debug-raw-toggle').count(), 0, "raw inspection must not add permanent footer rows");
    const headers = await page.locator('.debug-variables > .debug-tree-node > .debug-variable > code').evaluateAll(cells => cells.map(cell => ({ text: cell.textContent, scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth })));
    for (const header of headers) assert.ok(header.scrollWidth <= header.clientWidth, `container summary must remain readable at ${width}px: ${header.text}`);
    const rawAction = await checkInlineRawAction(page, root("map"));
    const panel = await page.locator('main.debug-panel').boundingBox();
    assert.ok(panel);
    const bounds = await page.locator('.debug-map-row [data-map-field] > .debug-tree-node > .debug-variable > button > code').evaluateAll(cells => cells.map(cell => {
      const rect = cell.getBoundingClientRect();
      return { text: cell.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth };
    }));
    assert.equal(bounds.length, 8);
    for (const cell of bounds) assert.ok(cell.width > 0 && cell.height > 0 && cell.x >= panel.x && cell.y >= 0 && cell.x + cell.width <= panel.x + panel.width && cell.y + cell.height <= 1000 && cell.scrollWidth <= cell.clientWidth, `every native key/value must be visibly readable at ${width}px, not clipped or off-screen`);
    await page.screenshot({ path: path.join(directory, `actual-dap-rendering${label}.png`) });
    await writeFile(path.join(directory, `actual-dap-rendering${label}-bounds.json`), JSON.stringify({ panel, cells: bounds, rawAction }, null, 2));
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, "UI_RESULT.txt"), "PASS: production VariableNode renders captured native CodeLLDB map keys and values in the same visible row after one expansion, plus empty map, HashSet and Vec. Chromium replay of actual adapter data; not a native WebView interaction test.\n");
} finally { await browser?.close(); server.kill(); }
