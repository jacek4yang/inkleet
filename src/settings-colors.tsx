import React,{useState} from "react";
import {themeColors,setColorOverride,type ColorMode,type ThemeColorKey} from "./theme-colors";
import type {EditorSettings} from "./format-settings";
export function SettingsColors({draft,busy,onChange}:{draft:EditorSettings;busy:boolean;onChange:(draft:EditorSettings)=>void}){
 const [mode,setMode]=useState<ColorMode>("light"),[key,setKey]=useState<ThemeColorKey>("accent");
 const token=themeColors.find(token=>token.key===key)!,explicit=draft.colorOverrides?.[mode]?.[key],value=explicit??token[mode];
 function change(color:string|undefined){
  const next={...draft},colors=setColorOverride(draft.colorOverrides,mode,key,color);
  if(colors)next.colorOverrides=colors;else delete next.colorOverrides;
  onChange(next);
 }
 return <fieldset className="settings-colors" disabled={busy}>
  <legend>自定义配色</legend>
  <label>模式<select disabled={busy} aria-label="自定义配色模式" value={mode} onChange={event=>setMode(event.target.value as ColorMode)}><option value="light">浅色</option><option value="dark">深色</option></select></label>
  <label>颜色项<select disabled={busy} aria-label="自定义颜色项" value={key} onChange={event=>setKey(event.target.value as ThemeColorKey)}>{themeColors.map(token=><option key={token.key} value={token.key}>{token.label}</option>)}</select></label>
  <div className="settings-color-value"><input type="color" disabled={busy} aria-label="选择自定义颜色" value={value} onChange={event=>change(event.target.value)}/><code>{explicit??"继承默认"}</code></div>
  <div className="settings-color-actions"><button type="button" disabled={busy} onClick={()=>change(value)}>使用此颜色</button><button type="button" disabled={busy||explicit===undefined} onClick={()=>change(undefined)}>恢复此颜色</button></div>
  <small>保存后生效；浅色和深色分别保留。继承时选择器仅显示参考色，不改变原配色。仅接受 #RRGGBB，可通过 JSON 精确填写。</small>
  <small>自选前景与背景可能降低可读性；右侧重置可恢复全部默认配色。语法色与语言服务语义色分别设置；语言服务不支持的分类不会凭空出现。</small>
 </fieldset>;
}
