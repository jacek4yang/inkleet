import {validateColorOverrides,type ColorOverrides} from "./theme-colors.ts";
import type {Language} from "./domain";
import {canonicalJson} from "./case-expectations.ts";
export type EditorSettings={version:1;colorOverrides?:ColorOverrides;vim?:boolean;tabSize?:number;formatOnSave:boolean;overrides:Partial<Record<Language,boolean>>;
 theme?:"light"|"dark"|"system";fontSize?:number;lineHeight?:number;wordWrap?:boolean;lineNumbers?:boolean;indentGuides?:boolean;highlightActiveLine?:boolean};
export type EditorSettingsSnapshot={settings:EditorSettings;revision:string|null};
export const defaultEditorSettings:EditorSettings={version:1,vim:false,formatOnSave:true,overrides:{}};
export type EditorOptionKey="theme"|"fontSize"|"lineHeight"|"wordWrap"|"lineNumbers"|"indentGuides"|"highlightActiveLine";
export type EditorOptionDefinition={key:EditorOptionKey;label:string;description:string;kind:"enum"|"number"|"boolean";defaultValue:string|number|boolean;min?:number;max?:number;step?:number;choices?:readonly {value:string;label:string}[];group:"appearance"|"behavior"};
export const editorOptions:readonly EditorOptionDefinition[]=[
 {key:"theme",label:"配色主题",description:"默认保持当前浅色；也可使用深色或跟随系统。",kind:"enum",defaultValue:"light",choices:[{value:"light",label:"浅色 · 默认"},{value:"dark",label:"深色"},{value:"system",label:"跟随系统"}],group:"appearance"},
 {key:"fontSize",label:"编辑器字号",description:"代码、笔记与源码阅读器的字体大小（px）。",kind:"number",defaultValue:14,min:10,max:32,step:1,group:"appearance"},
 {key:"lineHeight",label:"编辑器行高",description:"行高相对于字号的倍数。",kind:"number",defaultValue:1.75,min:1.2,max:2.4,step:0.05,group:"appearance"},
 {key:"wordWrap",label:"代码自动换行",description:"只改变显示，不插入换行符；笔记保持自动换行。",kind:"boolean",defaultValue:false,group:"behavior"},
 {key:"lineNumbers",label:"显示行号",description:"隐藏行号不影响断点栏。",kind:"boolean",defaultValue:true,group:"appearance"},
 {key:"indentGuides",label:"显示缩进参考线",description:"显示代码缩进层级。",kind:"boolean",defaultValue:true,group:"appearance"},
 {key:"highlightActiveLine",label:"高亮当前行",description:"不影响调试暂停行和文本选择高亮。",kind:"boolean",defaultValue:true,group:"appearance"},
];
export function effectiveTabSize(settings:EditorSettings|null):number{return settings?.tabSize??4;}
export function formatEnabled(settings:EditorSettings|null,language:Language){return !!settings&&(settings.overrides[language]??settings.formatOnSave);}
export function validateEditorDocument(value:unknown):EditorSettings{
 const fail=(message:string):never=>{throw Error(message+"，原配置未修改");};
 if(!value||typeof value!=="object"||Array.isArray(value))return fail("设置必须是 JSON 对象");
 const s=value as Record<string,unknown>,allowed=new Set(["version","vim","tabSize","formatOnSave","overrides","colorOverrides",...editorOptions.map(o=>o.key)]);
 for(const key of Object.keys(s))if(!allowed.has(key))fail("不支持的设置字段："+key);
 if(Object.hasOwn(s,"colorOverrides"))validateColorOverrides(s.colorOverrides);
 if(s.version!==1)fail("不支持的设置版本");
 if(s.vim!==undefined&&typeof s.vim!=="boolean")fail("vim 必须为布尔值");
 if(s.tabSize!==undefined&&(!Number.isInteger(s.tabSize)||Number(s.tabSize)<1||Number(s.tabSize)>8))fail("tabSize 必须为 1 到 8 的整数");
 if(typeof s.formatOnSave!=="boolean")fail("formatOnSave 必须为布尔值");
 if(!s.overrides||typeof s.overrides!=="object"||Array.isArray(s.overrides)||Object.entries(s.overrides).some(([k,v])=>!["python3","rust","golang","c","cpp","java"].includes(k)||typeof v!=="boolean"))fail("overrides 仅支持六种语言的布尔覆盖值");
 for(const option of editorOptions){
  if(!Object.hasOwn(s,option.key))continue;
  const v=s[option.key];
  if(option.kind==="boolean"&&typeof v!=="boolean")fail(option.key+" 必须为布尔值");
  if(option.kind==="enum"&&!option.choices?.some(choice=>choice.value===v))fail(option.key+" 的值不受支持");
  if(option.kind==="number"&&(typeof v!=="number"||!Number.isFinite(v)||v<option.min!||v>option.max!||(option.step===1&&!Number.isInteger(v))))fail(option.key+" 超出允许范围");
 }
 return value as EditorSettings;
}
export function validateEditorSettings(value:unknown):EditorSettingsSnapshot{
 const v=value as EditorSettingsSnapshot;
 if(!v||(v.revision!==null&&typeof v.revision!=="string"))throw Error("编辑器配置版本无效，原配置未修改");
 validateEditorDocument(v.settings);return v;
}
export function parseEditorSettingsJSON(text:string):EditorSettings{
 if(new TextEncoder().encode(text).length>4096)throw Error("设置 JSON 超过 4096 字节");
 let value:unknown;try{value=JSON.parse(text);}catch(error){throw Error("JSON 语法错误："+(error instanceof Error?error.message:"无法解析"));}
 try{canonicalJson(text);}catch{throw Error("JSON 对象键不能重复，且嵌套必须保持在安全范围内");}
 return validateEditorDocument(value);
}
export function serializeEditorSettings(settings:EditorSettings):string{return JSON.stringify(settings,null,2);}
