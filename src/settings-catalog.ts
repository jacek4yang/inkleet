import { languages, type Language } from "./domain.ts";
import { defaultEditorSettings,editorOptions,type EditorOptionDefinition,type EditorOptionKey } from "./format-settings.ts";

// This finite catalog describes existing owners. IDs are search/display keys,
// never JSON paths or commands. It does not render, load, save, or run actions.
export const settingsCategories = [
  { id: "editor", label: "编辑器", aliases: ["editor"] },
  { id: "environment", label: "语言与环境", aliases: ["language", "environment"] },
  { id: "downloads", label: "下载", aliases: ["download", "downloads"] },
  { id: "files", label: "源码", aliases: ["source", "files", "code"] },
  { id: "notes", label: "笔记", aliases: ["notes", "markdown"] },
  { id: "debug", label: "运行与调试", aliases: ["run", "debug"] },
] as const;
export type SettingsCategory = typeof settingsCategories[number]["id"];
export type SettingsGroup = "behavior" | "appearance" | "formatting" | "proxy" | "actions";
export type ProxyMode = "system" | "direct" | "custom";
export type DownloadProxyDraft = Readonly<{ mode: ProxyMode; url: string }>;
export const DEFAULT_TAB_SIZE = 4;
export const defaultDownloadProxy: DownloadProxyDraft = Object.freeze({ mode: "system", url: "" });

export const languageFormatSettingIds = {
  python3: "editor.formatOnSave.python3",
  rust: "editor.formatOnSave.rust",
  golang: "editor.formatOnSave.golang",
  c: "editor.formatOnSave.c",
  cpp: "editor.formatOnSave.cpp",
  java: "editor.formatOnSave.java",
} as const satisfies Record<Language, string>;
export type LanguageFormatSettingId = typeof languageFormatSettingIds[Language];
export type EditorSettingId = "editor.colorOverrides" | `editor.${EditorOptionKey}` | "editor.vim" | "editor.tabSize" | "editor.formatOnSave" | LanguageFormatSettingId;
export type ProxySettingId = "downloads.proxy.mode" | "downloads.proxy.url";

interface RowBase {
  readonly label: string;
  readonly aliases: readonly string[];
  readonly category: SettingsCategory;
  readonly group: SettingsGroup;
  readonly order: number;
}
interface EditorRowBase extends RowBase {
  readonly owner: "editor-settings";
  readonly category: "editor";
}
export type EditorSettingRow =
  | (EditorRowBase & {readonly id:"editor.colorOverrides";readonly kind:"color-overrides";readonly defaultValue:"跟随主题";readonly reset:"remove-colors"})
  | (EditorRowBase & {readonly id:`editor.${EditorOptionKey}`;readonly kind:"editor-option";readonly option:EditorOptionDefinition;readonly defaultValue:string|number|boolean;readonly reset:"remove-option"})
  | (EditorRowBase & { readonly id: "editor.vim"; readonly kind: "boolean"; readonly defaultValue: boolean; readonly reset: "vim-default" })
  | (EditorRowBase & { readonly id: "editor.tabSize"; readonly kind: "integer"; readonly defaultValue: number; readonly min: 1; readonly max: 8; readonly reset: "remove-tab-size" })
  | (EditorRowBase & { readonly id: "editor.formatOnSave"; readonly kind: "boolean"; readonly defaultValue: boolean; readonly reset: "format-default" })
  | (EditorRowBase & { readonly id: LanguageFormatSettingId; readonly kind: "language-format"; readonly language: Language; readonly defaultValue: "inherit"; readonly reset: "remove-language-override" });
export type ProxySettingRow = RowBase & {
  readonly owner: "download-settings";
  readonly category: "downloads";
  readonly group: "proxy";
  // Both proxy rows reset the same bundle; never leave custom + empty URL.
  readonly reset: "proxy-bundle";
} & (
  | { readonly id: "downloads.proxy.mode"; readonly kind: "proxy-mode"; readonly defaultValue: ProxyMode; readonly options: readonly ProxyMode[] }
  | { readonly id: "downloads.proxy.url"; readonly kind: "proxy-url"; readonly defaultValue: string; readonly dependsOn: { readonly id: "downloads.proxy.mode"; readonly equals: "custom" } }
);
export type PreferenceRow = EditorSettingRow | ProxySettingRow;

const formattingAliases = ["format", "formatting", "formatter", "format on save", "format-on-save", "保存格式化", "保存时格式化", "自动格式化"] as const;
const languageAliases: Readonly<Record<Language, readonly string[]>> = {
  python3: ["python", "python 3", "python3", "py", "python 格式化", "python格式化"],
  rust: ["rust", "rs", "rust 格式化", "rust格式化"],
  golang: ["go", "golang", "go 格式化"],
  c: ["c", "c 语言", "c 格式化"],
  cpp: ["c++", "cpp", "cplusplus", "c++ 格式化"],
  java: ["java", "java 格式化"],
};
const languageRows: readonly EditorSettingRow[] = languages.map<EditorSettingRow>((language, index) => ({
  id: languageFormatSettingIds[language.id], owner: "editor-settings", category: "editor", group: "formatting", order: 40 + index,
  label: `${language.label} 保存时格式化`, aliases: [...languageAliases[language.id], ...formattingAliases],
  kind: "language-format", language: language.id, defaultValue: "inherit", reset: "remove-language-override",
}));
export const preferenceRows: readonly PreferenceRow[] = [
  {id:"editor.colorOverrides",owner:"editor-settings",category:"editor",group:"appearance",order:28,label:"自定义配色",aliases:["colorOverrides","colors","palette","theme","配色","背景","文字颜色","强调色","选区","光标"],kind:"color-overrides",defaultValue:"跟随主题",reset:"remove-colors"},
  ...editorOptions.map<EditorSettingRow>((option,index)=>({id:`editor.${option.key}`,owner:"editor-settings",category:"editor",group:option.group,order:21+index,label:option.label,aliases:[option.key,option.description,"appearance","编辑显示"],kind:"editor-option",option,defaultValue:option.defaultValue,reset:"remove-option"})),
  { id: "editor.vim", owner: "editor-settings", category: "editor", group: "behavior", order: 10,
    label: "Vim", aliases: ["vim", "vim mode", "modal editing", "模式编辑"], kind: "boolean", defaultValue: defaultEditorSettings.vim ?? false, reset: "vim-default" },
  { id: "editor.tabSize", owner: "editor-settings", category: "editor", group: "behavior", order: 20,
    label: "Tab 显示宽度", aliases: ["tab", "tab size", "tabsize", "tab width", "display width", "制表符", "显示宽度"], kind: "integer", defaultValue: DEFAULT_TAB_SIZE, min: 1, max: 8, reset: "remove-tab-size" },
  { id: "editor.formatOnSave", owner: "editor-settings", category: "editor", group: "formatting", order: 30,
    label: "保存时格式化", aliases: formattingAliases, kind: "boolean", defaultValue: defaultEditorSettings.formatOnSave, reset: "format-default" },
  ...languageRows,
  { id: "downloads.proxy.mode", owner: "download-settings", category: "downloads", group: "proxy", order: 10,
    label: "连接方式", aliases: ["proxy", "代理", "proxy mode", "connection", "system", "direct", "custom", "跟随系统", "直接连接", "自定义代理"], kind: "proxy-mode", defaultValue: defaultDownloadProxy.mode, options: ["system", "direct", "custom"], reset: "proxy-bundle" },
  { id: "downloads.proxy.url", owner: "download-settings", category: "downloads", group: "proxy", order: 20,
    label: "HTTP / HTTPS 地址", aliases: ["proxy", "代理", "address", "url", "http", "https", "代理地址", "代理端口", "port"], kind: "proxy-url", defaultValue: defaultDownloadProxy.url, reset: "proxy-bundle", dependsOn: { id: "downloads.proxy.mode", equals: "custom" } },
];

// App retains labels, callbacks, disabled state, icon and dataAction. The catalog
// wraps the actual supplied object, and omits actions that App did not supply.
export interface RuntimeSettingsAction {
  readonly id: string;
  readonly label: string;
  readonly section: SettingsCategory;
  readonly icon: string;
  readonly run: () => void;
  readonly disabled?: boolean;
  readonly dataAction?: string;
}
const actionMetadata = [
  { id: "font", order: 90, aliases: ["font", "字体", "Intel One Mono"] },
  { id: "environment", order: 10, aliases: ["development environment", "toolchain", "runtime", "开发环境", "工具链"] },
  { id: "reconnect", order: 20, aliases: ["reconnect", "language server", "lsp", "重连语言服务"] },
  { id: "source-recovery", order: 10, aliases: ["source recovery", "restore", "源码恢复", "副本"] },
  { id: "source-export", order: 20, aliases: ["source export", "export code", "导出源码"] },
  { id: "notes-export", order: 10, aliases: ["notes export", "export markdown", "导出笔记"] },
  { id: "notes-recovery", order: 20, aliases: ["notes recovery", "restore", "恢复笔记"] },
  { id: "typora", order: 30, aliases: ["typora", "external editor", "外部编辑器"] },
  { id: "external-editor", order: 40, aliases: ["system editor", "external editor", "系统编辑器", "外部编辑器"] },
  { id: "refresh-notes", order: 50, aliases: ["refresh notes", "reload file", "刷新笔记", "重新读取"] },
] as const;
export type AppSettingsActionId = typeof actionMetadata[number]["id"];
export type ActionSettingRow<A extends RuntimeSettingsAction = RuntimeSettingsAction> = RowBase & {
  readonly id: `actions.${AppSettingsActionId}`;
  readonly owner: "app";
  readonly group: "actions";
  readonly kind: "action";
  readonly defaultValue: null;
  readonly reset: "none";
  readonly action: A;
};
export type SettingsRow<A extends RuntimeSettingsAction = RuntimeSettingsAction> = PreferenceRow | ActionSettingRow<A>;

export function compareSettingsRows(a: RowBase & { readonly id: string }, b: RowBase & { readonly id: string }): number {
  const categoryOrder = settingsCategories.findIndex(category => category.id === a.category) - settingsCategories.findIndex(category => category.id === b.category);
  return categoryOrder || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function createSettingsCatalog<A extends RuntimeSettingsAction>(actions: readonly A[]): readonly SettingsRow<A>[] {
  const rows: SettingsRow<A>[] = [...preferenceRows];
  for (const metadata of actionMetadata) {
    const matches = actions.filter(action => action.id === metadata.id);
    if (matches.length > 1) throw new Error(`Duplicate Settings action: ${metadata.id}`);
    const action = matches[0];
    if (!action) continue;
    rows.push({ id: `actions.${metadata.id}`, owner: "app", category: action.section, group: "actions", order: metadata.order,
      get label() { return action.label; }, aliases: metadata.aliases, kind: "action", defaultValue: null, reset: "none", action });
  }
  return rows.sort(compareSettingsRows);
}
