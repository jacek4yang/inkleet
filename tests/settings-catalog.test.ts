import assert from "node:assert/strict";
import test from "node:test";
import { defaultEditorSettings } from "../src/format-settings.ts";
import { createSettingsCatalog, languageFormatSettingIds, preferenceRows, settingsCategories, type RuntimeSettingsAction } from "../src/settings-catalog.ts";
import { MAX_SETTINGS_QUERY_LENGTH, MAX_SETTINGS_QUERY_TERMS, searchSettingsCatalog } from "../src/settings-search.ts";

function actions(): RuntimeSettingsAction[] {
  const noRun = () => { throw new Error("Catalog/search must not run App actions"); };
  return [
    { id: "font", label: "Intel One Mono", section: "editor", icon: "type", run: noRun },
    { id: "environment", label: "开发环境", section: "environment", icon: "terminal", dataAction: "open-environments", run: noRun },
    { id: "reconnect", label: "重连语言服务", section: "environment", icon: "refresh", disabled: true, run: noRun },
    { id: "source-recovery", label: "恢复副本", section: "files", icon: "history", dataAction: "code-recovery", run: noRun },
    { id: "source-export", label: "导出源码", section: "files", icon: "download", run: noRun },
    { id: "notes-export", label: "导出 Markdown", section: "notes", icon: "download", run: noRun },
    { id: "notes-recovery", label: "恢复笔记副本", section: "notes", icon: "history", dataAction: "notes-recovery", run: noRun },
    { id: "typora", label: "Typora 编辑", section: "notes", icon: "edit", run: noRun },
    { id: "external-editor", label: "系统编辑器", section: "notes", icon: "file", run: noRun },
    { id: "refresh-notes", label: "刷新文件", section: "notes", icon: "refresh", run: noRun },
  ];
}
function directIds(query: string) {
  return searchSettingsCatalog(createSettingsCatalog(actions()), query).rows.filter(result => result.match === "direct").map(result => result.row.id);
}

test("catalog has only implemented real preferences and supplied App actions", () => {
  assert.equal(preferenceRows.length, 18);
  assert.equal(preferenceRows.filter(row => row.owner === "editor-settings").length, 16);
  assert.equal(preferenceRows.filter(row => row.owner === "download-settings").length, 2);
  assert.deepEqual(preferenceRows.filter(row => row.kind === "language-format").map(row => row.id), Object.values(languageFormatSettingIds));
  const catalog = createSettingsCatalog(actions());
  assert.equal(catalog.length, 28);
  assert.equal(new Set(catalog.map(row => row.id)).size, catalog.length);
  assert.equal(catalog.filter(row => row.category === "debug").length, 0);
  assert.deepEqual(settingsCategories.map(category => category.id), ["editor", "environment", "downloads", "files", "notes", "debug"]);
  assert.equal(createSettingsCatalog([]).length, 18);
});

test("defaults and reset metadata describe the existing owners", () => {
  assert.equal(preferenceRows.find(row => row.id === "editor.vim")?.defaultValue, defaultEditorSettings.vim ?? false);
  assert.equal(preferenceRows.find(row => row.id === "editor.formatOnSave")?.defaultValue, defaultEditorSettings.formatOnSave);
  const tab = preferenceRows.find(row => row.kind === "integer");
  assert.ok(tab?.kind === "integer");
  assert.deepEqual([tab.min, tab.max, tab.defaultValue, tab.reset], [1, 8, 4, "remove-tab-size"]);
  for (const row of preferenceRows.filter(row => row.kind === "language-format")) {
    assert.equal(row.defaultValue, "inherit");
    assert.equal(row.reset, "remove-language-override");
  }
  const url = preferenceRows.find(row => row.kind === "proxy-url");
  assert.ok(url?.kind === "proxy-url");
  assert.deepEqual(url.dependsOn, { id: "downloads.proxy.mode", equals: "custom" });
  assert.equal(url.reset, "proxy-bundle");
});

test("action labels, callbacks, availability and dataAction stay App-owned", () => {
  const supplied = actions();
  const catalog = createSettingsCatalog(supplied);
  for (const action of supplied) {
    const row = catalog.find(row => row.kind === "action" && row.action.id === action.id);
    assert.ok(row?.kind === "action");
    assert.equal(row.action, action);
    assert.equal(row.label, action.label);
    assert.equal(row.action.run, action.run);
    assert.equal(row.action.disabled, action.disabled);
    assert.equal(row.action.dataAction, action.dataAction);
    assert.equal(row.reset, "none");
    assert.equal(row.defaultValue, null);
  }
  assert.equal(directIds("reconnect").length, 1); // Disabled actions remain discoverable.
});

test("live runtime labels are reused instead of replaced with catalog-owned action text", () => {
  const action = { id: "font", label: "Current font information", section: "editor" as const, icon: "type", run: () => {} };
  const catalog = createSettingsCatalog([action]);
  const row = catalog.find(row => row.kind === "action");
  assert.ok(row?.kind === "action");
  action.label = "Runtime label updated";
  assert.equal(row.label, action.label);
  assert.deepEqual(searchSettingsCatalog(catalog, "runtime label").rows.map(result => result.row.id), ["actions.font"]);
});

test("catalog and search have deterministic order independent of action input order", () => {
  const forward = createSettingsCatalog(actions());
  const backward = createSettingsCatalog(actions().reverse());
  assert.deepEqual(backward.map(row => row.id), forward.map(row => row.id));
  assert.deepEqual(searchSettingsCatalog(backward, "").rows.map(result => result.row.id), forward.map(row => row.id));
  assert.deepEqual(forward.filter(row => row.category === "notes").map(row => row.id), [
    "actions.notes-export", "actions.notes-recovery", "actions.typora", "actions.external-editor", "actions.refresh-notes",
  ]);
});

test("unavailable or unknown actions do not create imaginary controls; duplicate known IDs are rejected", () => {
  const supplied = actions().filter(action => action.id === "font");
  const unknown: RuntimeSettingsAction = { id: "theme", label: "Theme", section: "editor", icon: "type", run: () => {} };
  const catalog = createSettingsCatalog([...supplied, unknown]);
  assert.deepEqual(catalog.filter(row => row.kind === "action").map(row => row.id), ["actions.font"]);
  assert.throws(() => createSettingsCatalog([...supplied, ...supplied]), /Duplicate Settings action/);
});

test("multiword English and Chinese aliases match each actual language row", () => {
  for (const [query, id] of [
    ["Python format", "python3"], ["python3 保存", "python3"], ["Ｐｙｔｈｏｎ FORMAT", "python3"],
    ["Rust format on save", "rust"], ["rust 格式化", "rust"], ["Rust格式化", "rust"],
    ["Go format", "golang"], ["Java 保存时格式化", "java"],
  ] as const) assert.deepEqual(directIds(query), [languageFormatSettingIds[id]], query);
  assert.deepEqual(directIds("python rust format"), []); // AND terms cannot leak across rows.
  assert.deepEqual(directIds("编辑器 显示宽度"), ["editor.tabSize"]);
  assert.deepEqual(directIds("tab width"), ["editor.tabSize"]);
  assert.deepEqual(directIds("format").filter(id => id.startsWith("editor.formatOnSave")), ["editor.formatOnSave", ...Object.values(languageFormatSettingIds)]);
});

test("C++ punctuation survives normalization and never broadens into C", () => {
  assert.deepEqual(directIds("C++ format"), ["editor.formatOnSave.cpp"]);
  assert.deepEqual(directIds("Ｃ＋＋ 格式化"), ["editor.formatOnSave.cpp"]);
  assert.deepEqual(directIds("C format"), ["editor.formatOnSave.c"]);
  assert.deepEqual(directIds("cpp format"), ["editor.formatOnSave.cpp"]);
  assert.deepEqual(directIds("C# format"), []);
});

test("exact stable IDs select one row; punctuation is never interpreted as a regex or write path", () => {
  for (const id of ["editor.vim", "editor.tabSize", "editor.formatOnSave.c", "actions.notes-recovery"] as const) {
    assert.deepEqual(directIds(id), [id]);
    assert.deepEqual(directIds(id.toUpperCase()), [id]);
  }
  assert.deepEqual(directIds("__proto__.polluted"), []);
  assert.deepEqual(directIds("(a+)+$"), []);
});

test("proxy address matches include uncounted mode context in stable order", () => {
  const catalog = createSettingsCatalog(actions());
  for (const query of ["http", "proxy address", "代理地址", "downloads.proxy.url"]) {
    const result = searchSettingsCatalog(catalog, query);
    assert.equal(result.issue, null);
    assert.equal(result.directMatchCount, 1, query);
    assert.equal(result.categoryCounts.downloads, 1, query);
    assert.deepEqual(result.rows.map(({ row, match }) => [row.id, match]), [
      ["downloads.proxy.mode", "supporting"], ["downloads.proxy.url", "direct"],
    ]);
  }
  const both = searchSettingsCatalog(catalog, "proxy");
  assert.equal(both.directMatchCount, 2);
  assert.deepEqual(both.rows.map(result => result.match), ["direct", "direct"]);
  assert.deepEqual(directIds("downloads.proxy.mode"), ["downloads.proxy.mode"]);
});

test("blank, unmatched and category-scoped searches have honest counts", () => {
  const catalog = createSettingsCatalog(actions());
  for (const query of ["", " \n\t "]) {
    const result = searchSettingsCatalog(catalog, query);
    assert.equal(result.directMatchCount, 28);
    assert.equal(Object.values(result.categoryCounts).reduce((a, b) => a + b, 0), 28);
  }
  const missing = searchSettingsCatalog(catalog, "not-a-real-setting");
  assert.equal(missing.directMatchCount, 0);
  assert.deepEqual(missing.rows, []);
  assert.equal(searchSettingsCatalog(catalog, "", { category: "debug" }).directMatchCount, 0);
  const files = searchSettingsCatalog(catalog, "export", { category: "files" });
  assert.deepEqual(files.rows.map(result => result.row.id), ["actions.source-export"]);
  assert.equal(files.categoryCounts.files, 1);
  assert.equal(files.categoryCounts.notes, 0);
});

test("search bounds reject excessive input without dropping AND terms", () => {
  const catalog = createSettingsCatalog(actions());
  assert.equal(searchSettingsCatalog(catalog, "a".repeat(MAX_SETTINGS_QUERY_LENGTH)).issue, null);
  assert.equal(searchSettingsCatalog(catalog, "a".repeat(MAX_SETTINGS_QUERY_LENGTH + 1)).issue, "query-too-long");
  const tooMany = Array.from({ length: MAX_SETTINGS_QUERY_TERMS + 1 }, (_, index) => `term${index}`).join(" ");
  const result = searchSettingsCatalog(catalog, tooMany);
  assert.equal(result.issue, "too-many-terms");
  assert.equal(result.directMatchCount, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(searchSettingsCatalog(catalog, " ... ").issue, "no-search-terms");
  assert.deepEqual(directIds("python python format"), ["editor.formatOnSave.python3"]);
});

test("modified filtering is editor-scoped and tests configuration intent", () => {
  const catalog = createSettingsCatalog(actions());
  const draft = { ...defaultEditorSettings, vim: true, tabSize: 4, formatOnSave: false, overrides: { rust: false } };
  const result = searchSettingsCatalog(catalog, "", { modified: "editor", editorDraft: draft });
  assert.equal(result.modifiedScope, "editor");
  assert.equal(result.modifiedState, "known");
  assert.deepEqual(result.rows.map(result => result.row.id), ["editor.vim", "editor.formatOnSave", "editor.formatOnSave.rust"]);
  assert.equal(result.categoryCounts.downloads, 0);
  assert.equal(result.directMatchCount, 3);
  assert.deepEqual(searchSettingsCatalog(catalog, "rust format", { modified: "editor", editorDraft: draft }).rows.map(result => result.row.id), ["editor.formatOnSave.rust"]);
  assert.equal(searchSettingsCatalog(catalog, "proxy", { modified: "editor", editorDraft: draft }).directMatchCount, 0);
  const unknown = searchSettingsCatalog(catalog, "", { modified: "editor", editorDraft: null });
  assert.equal(unknown.modifiedState, "unknown");
  assert.deepEqual(unknown.rows, []);
  assert.equal(searchSettingsCatalog(catalog, "proxy").directMatchCount, 2); // No eager Downloads load is needed.
});

test("search leaves catalog, actions and editor drafts untouched", () => {
  const supplied = actions().map(action => Object.freeze(action));
  const catalog = Object.freeze(createSettingsCatalog(supplied));
  const draft = Object.freeze({ ...defaultEditorSettings, overrides: Object.freeze({ rust: true }) });
  const before = JSON.stringify({ catalog, draft });
  searchSettingsCatalog(catalog, "rust format", { modified: "editor", editorDraft: draft });
  searchSettingsCatalog(catalog, "http");
  assert.equal(JSON.stringify({ catalog, draft }), before);
});
