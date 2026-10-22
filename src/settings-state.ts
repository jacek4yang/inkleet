import {colorOverrideCount,sameColorOverrides} from "./theme-colors.ts";
import { languages } from "./domain.ts";
import { defaultEditorSettings,editorOptions, type EditorSettings } from "./format-settings.ts";
import { DEFAULT_TAB_SIZE, defaultDownloadProxy, languageFormatSettingIds, type DownloadProxyDraft, type EditorSettingId, type ProxySettingId } from "./settings-catalog.ts";

export type EditorSettingState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{
      status: "known";
      value: boolean | number | string;
      effectiveValue: boolean | number | string;
      defaultValue: boolean | number | string;
      // Default concerns configuration intent. An explicit language override is
      // nondefault even when its current effective value equals the global one.
      isDefault: boolean;
      hasExplicitValue: boolean;
      hasLanguageOverride: boolean;
      canReset: boolean;
    }>;

function overrideLanguage(id: EditorSettingId) {
  const language = languages.find(language => languageFormatSettingIds[language.id] === id)?.id;
  if (!language) throw new Error(`Unknown editor setting: ${id}`);
  return language;
}

export function readEditorSettingState(settings: EditorSettings | null, id: EditorSettingId): EditorSettingState {
  if (!settings) return { status: "unknown" };
  if(id==="editor.colorOverrides"){const count=colorOverrideCount(settings.colorOverrides),explicit=settings.colorOverrides!==undefined;return {status:"known",value:count?count+" 项覆盖":"跟随主题",effectiveValue:count?count+" 项覆盖":"跟随主题",defaultValue:"跟随主题",isDefault:!explicit,hasExplicitValue:explicit,hasLanguageOverride:false,canReset:explicit};}
  if (id === "editor.vim") {
    const value = settings.vim ?? false, defaultValue = defaultEditorSettings.vim ?? false;
    return { status: "known", value, effectiveValue: value, defaultValue, isDefault: value === defaultValue,
      hasExplicitValue: settings.vim !== undefined, hasLanguageOverride: false, canReset: value !== defaultValue };
  }
  if (id === "editor.tabSize") {
    const value = settings.tabSize ?? DEFAULT_TAB_SIZE;
    return { status: "known", value, effectiveValue: value, defaultValue: DEFAULT_TAB_SIZE, isDefault: value === DEFAULT_TAB_SIZE,
      hasExplicitValue: settings.tabSize !== undefined, hasLanguageOverride: false, canReset: settings.tabSize !== undefined };
  }
  if (id === "editor.formatOnSave") {
    const value = settings.formatOnSave, defaultValue = defaultEditorSettings.formatOnSave;
    return { status: "known", value, effectiveValue: value, defaultValue, isDefault: value === defaultValue,
      hasExplicitValue: true, hasLanguageOverride: false, canReset: value !== defaultValue };
  }
  const option=editorOptions.find(option=>"editor."+option.key===id);
  if(option){const explicit=settings[option.key],value=explicit??option.defaultValue;return {status:"known",value,effectiveValue:value,defaultValue:option.defaultValue,isDefault:value===option.defaultValue,hasExplicitValue:explicit!==undefined,hasLanguageOverride:false,canReset:explicit!==undefined};}
  const override = settings.overrides[overrideLanguage(id)];
  return { status: "known", value: override ?? "inherit", effectiveValue: override ?? settings.formatOnSave, defaultValue: "inherit",
    isDefault: override === undefined, hasExplicitValue: override !== undefined, hasLanguageOverride: override !== undefined, canReset: override !== undefined };
}

// These return drafts only. The calling owner still decides when to Save and
// retains the original revision token and all existing conflict/error guards.
export function resetEditorSetting(settings: EditorSettings, id: EditorSettingId): EditorSettings {
  if(id==="editor.colorOverrides"){const next={...settings};delete next.colorOverrides;return next;}
  if (id === "editor.vim") return { ...settings, vim: defaultEditorSettings.vim ?? false };
  if (id === "editor.tabSize") {
    const next = { ...settings };
    delete next.tabSize;
    return next;
  }
  if (id === "editor.formatOnSave") return { ...settings, formatOnSave: defaultEditorSettings.formatOnSave };
  const option=editorOptions.find(option=>"editor."+option.key===id);
  if(option){const next={...settings};delete next[option.key];return next;}
  const overrides = { ...settings.overrides };
  delete overrides[overrideLanguage(id)];
  return { ...settings, overrides };
}

export type EditorDraftState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "known"; dirty: boolean; needsTabSizeCanonicalization: boolean }>;

// Dirty is a comparison of supported draft fields against the loaded snapshot,
// not a comparison to defaults or a comparison of raw revision/file bytes.
// Optional absence differs from an explicitly stored value (including 4).
// IMPORTANT: This is informational. Never use !dirty to disable editor Save:
// an unchanged loaded tabSize:4 still needs the existing Save canonicalization.
export function inspectEditorDraft(saved: EditorSettings | null, draft: EditorSettings | null): EditorDraftState {
  if (!saved || !draft) return { status: "unknown" };
  const dirty = !sameColorOverrides(saved.colorOverrides,draft.colorOverrides) || saved.vim !== draft.vim || saved.tabSize !== draft.tabSize || saved.formatOnSave !== draft.formatOnSave
    || languages.some(language => saved.overrides[language.id] !== draft.overrides[language.id]) || editorOptions.some(option=>saved[option.key]!==draft[option.key]);
  return { status: "known", dirty, needsTabSizeCanonicalization: draft.tabSize === DEFAULT_TAB_SIZE };
}

export type ProxySettingState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "known"; value: string; defaultValue: string; isDefault: boolean; applicable: boolean; canResetBundle: boolean }>;

export function readProxySettingState(proxy: DownloadProxyDraft | null, id: ProxySettingId): ProxySettingState {
  if (!proxy) return { status: "unknown" };
  const mode = id === "downloads.proxy.mode";
  const value = mode ? proxy.mode : proxy.url, defaultValue = mode ? defaultDownloadProxy.mode : defaultDownloadProxy.url;
  return { status: "known", value, defaultValue, isDefault: value === defaultValue, applicable: mode || proxy.mode === "custom",
    canResetBundle: proxy.mode !== defaultDownloadProxy.mode || proxy.url !== defaultDownloadProxy.url };
}

// Use this for either proxy row's Reset. Returning a complete default bundle
// avoids an invalid custom-mode/empty-address draft. Unrelated fields survive.
export function resetProxyBundle(proxy: DownloadProxyDraft): DownloadProxyDraft {
  return { ...proxy, mode: defaultDownloadProxy.mode, url: defaultDownloadProxy.url };
}

export type ProxyDraftState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "known"; dirty: boolean }>;

// Matches the existing DownloadSettings Save rule: an inactive remembered URL
// is not a pending network change. The backend still validates/canonicalizes.
export function inspectProxyDraft(saved: DownloadProxyDraft | null, draft: DownloadProxyDraft | null): ProxyDraftState {
  if (!saved || !draft) return { status: "unknown" };
  return { status: "known", dirty: saved.mode !== draft.mode || (draft.mode === "custom" && saved.url !== draft.url) };
}
