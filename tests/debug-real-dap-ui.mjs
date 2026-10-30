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
const optionNames = ["option_some", "option_none", "option_nested_some", "option_nested_none"];
assert.equal(result.optionQualification?.status, "CAPTURED_NOT_CLASSIFIED", "capture does not imply an unreviewed Option classifier");
assert.equal(result.optionQualification.rawTraversal, "DEFERRED", "raw storage graphs are not logical payload evidence");
assert.deepEqual(Object.keys(result.optionCapture ?? {}).sort(), [...optionNames].sort());
assert.equal(result.optionQualification.scalarPayloads.option_some.value, "41");
assert.equal(result.optionQualification.scalarPayloads.option_nested_some.value, "7");
assert.equal(trace.requests.some(request => request.command === "evaluate"), false, "pretty inspection must not invoke debuggee functions");
const isRaw = variable => variable.name === "[raw]" && variable.presentationHint?.attributes?.includes("readOnly") && variable.presentationHint.attributes.includes("virtual");
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
  // Replay only actual captured children through the existing generic variant
  // renderer. Exact text checks prevent a guessed Some/None label or payload.
  const replayOption = async (node, captured, depth = 0) => {
    assert.ok(depth < 8, "fixture expansion remains bounded");
    const variable = captured.variable;
    const header = node.locator(':scope > .debug-variable');
    assert.equal(await header.locator(':scope > button:first-child').getAttribute('aria-label'), variable.name);
    assert.equal(await header.locator(':scope > code').textContent(), variable.value, "generic Option rendering must preserve the adapter value without inference");
    const logical = (captured.children ?? []).filter(child => !isRaw(child.variable));
    if (variable.variablesReference > 0 && !captured.repeatedReference) {
      const toggle = header.locator(':scope > button:first-child');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      const children = node.locator(':scope > .debug-tree-children > .debug-tree-node');
      await node.locator(':scope > .debug-tree-children').waitFor();
      await node.locator(':scope > .debug-tree-children > [role="status"]').waitFor({ state: 'hidden' });
      assert.equal(await node.locator(':scope > .debug-tree-children > [role="alert"]').count(), 0, "every replay expansion must have a captured response");
      assert.equal(await children.count(), logical.length);
      for (let index = 0; index < logical.length; index++) await replayOption(children.nth(index), logical[index], depth + 1);
    }
  };
  const optionBounds = [];
  for (const name of optionNames) {
    const node = root(name);
    await replayOption(node, result.optionCapture[name]);
    for (const width of [680, 320]) {
      await page.locator('main.debug-panel').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
      await node.scrollIntoViewIfNeeded();
      const cells = node.locator('.debug-variable > code');
      const bounds = await cells.evaluateAll(cells => cells.map(cell => {
        const rect = cell.getBoundingClientRect();
        return { text: cell.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth };
      }));
      const panel = await page.locator('main.debug-panel').boundingBox();
      assert.ok(panel);
      for (const cell of bounds) assert.ok(cell.width > 0 && cell.height > 0 && cell.x >= panel.x && cell.x + cell.width <= panel.x + panel.width && cell.y >= 0 && cell.y + cell.height <= 1000 && cell.scrollWidth <= cell.clientWidth, `actual ${name} value remains visible without clipping at ${width}px: ${cell.text}`);
      const rawAction = (result.optionCapture[name].children ?? []).some(child => isRaw(child.variable)) ? await checkInlineRawAction(page, node) : null;
      optionBounds.push({ name, width, cells: bounds, rawAction });
      await page.screenshot({ path: path.join(directory, `actual-dap-${name}-${width}.png`) });
    }
  }
  await writeFile(path.join(directory, "actual-dap-option-bounds.json"), JSON.stringify(optionBounds, null, 2));
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, "UI_RESULT.txt"), "PASS: production VariableNode renders captured native CodeLLDB map keys and values in the same visible row after one expansion, plus empty map, HashSet and Vec. Captured Some/None/nested Option fixtures retain their exact adapter tree and structural scalar payloads; no Option classifier or None inference is claimed. Chromium replay of actual adapter data; not a native WebView interaction test.\n");
} finally { await browser?.close(); server.kill(); }
