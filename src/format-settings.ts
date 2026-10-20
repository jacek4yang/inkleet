import type { Language } from "./domain";
export type EditorSettings = {version:1;vim?:boolean;tabSize?:number;formatOnSave:boolean;overrides:Partial<Record<Language,boolean>>};
export type EditorSettingsSnapshot = {settings:EditorSettings;revision:string|null};
export const defaultEditorSettings:EditorSettings={version:1,vim:false,formatOnSave:true,overrides:{}};
// Visual tab width is independent of each language's indentation unit.
export function effectiveTabSize(settings:EditorSettings|null):number{return settings?.tabSize??4;}
export function formatEnabled(settings:EditorSettings|null,language:Language){return !!settings&&(settings.overrides[language]??settings.formatOnSave);}
export function validateEditorSettings(value:unknown):EditorSettingsSnapshot{
  const v=value as EditorSettingsSnapshot;
  const s=v?.settings;
  if(!s||s.version!==1||(s.vim!==undefined&&typeof s.vim!=="boolean")||(s.tabSize!==undefined&&(!Number.isInteger(s.tabSize)||s.tabSize<1||s.tabSize>8))||typeof s.formatOnSave!=="boolean"||!s.overrides||typeof s.overrides!=="object"||Array.isArray(s.overrides)||Object.entries(s.overrides).some(([k,v])=>!["python3","rust","golang","c","cpp","java"].includes(k)||typeof v!=="boolean")||(v.revision!==null&&typeof v.revision!=="string"))throw Error("编辑器配置无效，原配置未修改");
  return v;
}

