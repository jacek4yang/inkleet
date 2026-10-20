import assert from "node:assert/strict";
import test from "node:test";
import { languages } from "../src/domain.ts";
import { defaultEditorSettings, type EditorSettings } from "../src/format-settings.ts";
import { defaultDownloadProxy, languageFormatSettingIds, type DownloadProxyDraft, type EditorSettingId } from "../src/settings-catalog.ts";
import { inspectEditorDraft, inspectProxyDraft, readEditorSettingState, readProxySettingState, resetEditorSetting, resetProxyBundle } from "../src/settings-state.ts";

function sample(): EditorSettings {
  return { version: 1, vim: true, tabSize: 8, formatOnSave: false, overrides: { python3: true, rust: false, golang: true, c: false, cpp: true, java: false } };
}

test("legacy absence resolves defaults without mutating the loaded settings", () => {
  const legacy: EditorSettings = Object.freeze({ version: 1, formatOnSave: true, overrides: Object.freeze({}) });
  assert.deepEqual(readEditorSettingState(legacy, "editor.vim"), {
    status: "known", value: false, effectiveValue: false, defaultValue: false, isDefault: true, hasExplicitValue: false, hasLanguageOverride: false, canReset: false,
  });
  assert.deepEqual(readEditorSettingState(legacy, "editor.tabSize"), {
    status: "known", value: 4, effectiveValue: 4, defaultValue: 4, isDefault: true, hasExplicitValue: false, hasLanguageOverride: false, canReset: false,
  });
  assert.equal(Object.hasOwn(legacy, "vim"), false);
  assert.equal(Object.hasOwn(legacy, "tabSize"), false);
});

test("unloaded values are unknown, never implicitly default", () => {
  assert.deepEqual(readEditorSettingState(null, "editor.tabSize"), { status: "unknown" });
  assert.deepEqual(readProxySettingState(null, "downloads.proxy.mode"), { status: "unknown" });
  assert.deepEqual(readProxySettingState(null, "downloads.proxy.url"), { status: "unknown" });
  assert.deepEqual(inspectEditorDraft(null, defaultEditorSettings), { status: "unknown" });
  assert.deepEqual(inspectEditorDraft(defaultEditorSettings, null), { status: "unknown" });
  assert.deepEqual(inspectProxyDraft(null, defaultDownloadProxy), { status: "unknown" });
});

test("language default, explicit override and current effective value are distinct", () => {
  for (const globalValue of [false, true]) {
    for (const language of languages) {
      const inherited = { ...defaultEditorSettings, formatOnSave: globalValue };
      assert.deepEqual(readEditorSettingState(inherited, languageFormatSettingIds[language.id]), {
        status: "known", value: "inherit", effectiveValue: globalValue, defaultValue: "inherit", isDefault: true, hasExplicitValue: false, hasLanguageOverride: false, canReset: false,
      });
      for (const explicit of [false, true]) {
        const settings = { ...inherited, overrides: { [language.id]: explicit } };
        assert.deepEqual(readEditorSettingState(settings, languageFormatSettingIds[language.id]), {
          status: "known", value: explicit, effectiveValue: explicit, defaultValue: "inherit", isDefault: false, hasExplicitValue: true, hasLanguageOverride: true, canReset: true,
        });
      }
    }
  }
});

test("each supported tab width has explicit default and reset semantics", () => {
  for (const tabSize of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const state = readEditorSettingState({ ...defaultEditorSettings, tabSize }, "editor.tabSize");
    assert.ok(state.status === "known");
    assert.equal(state.value, tabSize);
    assert.equal(state.effectiveValue, tabSize);
    assert.equal(state.isDefault, tabSize === 4);
    assert.equal(state.canReset, true);
  }
});

test("per-row global resets preserve unrelated settings and never mutate snapshots", () => {
  const extra = Object.freeze({ kept: "future caller-owned field" });
  const source = Object.freeze({ ...sample(), futureField: extra, overrides: Object.freeze(sample().overrides) });
  const before = JSON.stringify(source);
  const vim = resetEditorSetting(source, "editor.vim");
  assert.equal(vim.vim, false);
  assert.equal(vim.tabSize, 8);
  assert.equal(vim.formatOnSave, false);
  assert.equal(vim.overrides, source.overrides);
  const format = resetEditorSetting(source, "editor.formatOnSave");
  assert.equal(format.formatOnSave, true);
  assert.equal(format.vim, true);
  assert.equal(format.tabSize, 8);
  assert.equal(format.overrides, source.overrides);
  const tab = resetEditorSetting(source, "editor.tabSize");
  assert.equal(Object.hasOwn(tab, "tabSize"), false);
  assert.equal(tab.vim, true);
  assert.equal(tab.formatOnSave, false);
  assert.equal(tab.overrides, source.overrides);
  for (const reset of [vim, format, tab]) assert.equal(Reflect.get(reset, "futureField"), extra);
  assert.equal(JSON.stringify(source), before);
});

test("language reset deletes only that override instead of writing false", () => {
  for (const language of languages) {
    const source = Object.freeze({ ...sample(), overrides: Object.freeze(sample().overrides) });
    const result = resetEditorSetting(source, languageFormatSettingIds[language.id]);
    assert.equal(Object.hasOwn(result.overrides, language.id), false);
    assert.notEqual(result.overrides, source.overrides);
    for (const other of languages.filter(other => other.id !== language.id)) assert.equal(result.overrides[other.id], source.overrides[other.id]);
    assert.equal(result.vim, source.vim);
    assert.equal(result.tabSize, source.tabSize);
    assert.equal(result.formatOnSave, source.formatOnSave);
    assert.equal(Object.hasOwn(source.overrides, language.id), true);
    const state = readEditorSettingState(result, languageFormatSettingIds[language.id]);
    assert.ok(state.status === "known");
    assert.equal(state.value, "inherit");
    assert.equal(state.effectiveValue, source.formatOnSave);
  }
});

test("unknown editor IDs are rejected rather than treated as arbitrary JSON paths", () => {
  const source = sample();
  const before = JSON.stringify(source);
  assert.throws(() => resetEditorSetting(source, "editor.__proto__.bad" as EditorSettingId), /Unknown editor setting/);
  assert.equal(JSON.stringify(source), before);
});

test("dirty compares draft to saved fields, independently of default/override state", () => {
  const saved = sample();
  assert.deepEqual(inspectEditorDraft(saved, { ...saved, overrides: { ...saved.overrides } }), {
    status: "known", dirty: false, needsTabSizeCanonicalization: false,
  });
  for (const changed of [
    { ...saved, vim: false }, { ...saved, tabSize: 2 }, { ...saved, formatOnSave: true },
    { ...saved, overrides: { ...saved.overrides, rust: true } },
    resetEditorSetting(saved, "editor.formatOnSave.python3"),
  ]) {
    const state = inspectEditorDraft(saved, changed);
    assert.ok(state.status === "known");
    assert.equal(state.dirty, true);
  }
  const equalEffectiveOverride = { ...defaultEditorSettings, overrides: { rust: true } };
  assert.deepEqual(inspectEditorDraft(defaultEditorSettings, equalEffectiveOverride), {
    status: "known", dirty: true, needsTabSizeCanonicalization: false,
  });
  const legacy: EditorSettings = { version: 1, formatOnSave: true, overrides: {} };
  assert.deepEqual(inspectEditorDraft(legacy, { ...legacy, vim: false }), {
    status: "known", dirty: true, needsTabSizeCanonicalization: false,
  });
});

test("unchanged explicit tabSize 4 is canonicalizable even without dirty edits", () => {
  const saved = Object.freeze({ ...defaultEditorSettings, tabSize: 4 });
  const before = JSON.stringify(saved);
  assert.deepEqual(inspectEditorDraft(saved, saved), {
    status: "known", dirty: false, needsTabSizeCanonicalization: true,
  });
  const state = readEditorSettingState(saved, "editor.tabSize");
  assert.ok(state.status === "known");
  assert.equal(state.isDefault, true);
  assert.equal(state.canReset, true);
  const reset = resetEditorSetting(saved, "editor.tabSize");
  assert.equal(Object.hasOwn(reset, "tabSize"), false);
  assert.deepEqual(inspectEditorDraft(saved, reset), {
    status: "known", dirty: true, needsTabSizeCanonicalization: false,
  });
  assert.equal(JSON.stringify(saved), before); // Inspection does not canonicalize on load.
});

test("proxy reset restores both fields while preserving unrelated data", () => {
  for (const mode of ["system", "direct", "custom"] as const) {
    const marker = Object.freeze({ kept: true });
    const source = Object.freeze({ mode, url: "http://127.0.0.1:7890", marker });
    const reset = resetProxyBundle(source);
    assert.equal(reset.mode, "system");
    assert.equal(reset.url, "");
    assert.equal(Reflect.get(reset, "marker"), marker);
    assert.equal(source.mode, mode);
    assert.equal(source.url, "http://127.0.0.1:7890");
  }
});

test("proxy applicability is metadata; inspection never switches modes or clears URLs", () => {
  const proxy: DownloadProxyDraft = Object.freeze({ mode: "system", url: "http://127.0.0.1:7890" });
  assert.deepEqual(readProxySettingState(proxy, "downloads.proxy.mode"), {
    status: "known", value: "system", defaultValue: "system", isDefault: true, applicable: true, canResetBundle: true,
  });
  assert.deepEqual(readProxySettingState(proxy, "downloads.proxy.url"), {
    status: "known", value: "http://127.0.0.1:7890", defaultValue: "", isDefault: false, applicable: false, canResetBundle: true,
  });
  assert.equal(proxy.mode, "system");
  assert.equal(proxy.url, "http://127.0.0.1:7890");
  const custom = readProxySettingState({ ...proxy, mode: "custom" }, "downloads.proxy.url");
  assert.ok(custom.status === "known");
  assert.equal(custom.applicable, true);
});

test("proxy dirty preserves existing mode and active-URL Save semantics", () => {
  assert.deepEqual(inspectProxyDraft(defaultDownloadProxy, { mode: "system", url: "remembered but inactive" }), { status: "known", dirty: false });
  assert.deepEqual(inspectProxyDraft(defaultDownloadProxy, { mode: "direct", url: "" }), { status: "known", dirty: true });
  const custom: DownloadProxyDraft = { mode: "custom", url: "http://localhost:7890" };
  assert.deepEqual(inspectProxyDraft(custom, { ...custom }), { status: "known", dirty: false });
  assert.deepEqual(inspectProxyDraft(custom, { ...custom, url: "http://localhost:7891" }), { status: "known", dirty: true });
  assert.deepEqual(inspectProxyDraft(custom, null), { status: "unknown" });
});
