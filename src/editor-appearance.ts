import {themeColors} from "./theme-colors";
import {useEffect} from "react";
import type {EditorSettings} from "./format-settings";
export function useEditorAppearance(settings:EditorSettings|null){
 useEffect(()=>{
  const root=document.documentElement,media=matchMedia("(prefers-color-scheme: dark)");
  const apply=()=>{
   const dark=settings?.theme==="dark"||(settings?.theme==="system"&&media.matches);
   root.dataset.theme=dark?"dark":"light";root.style.colorScheme=dark?"dark":"light";
   const palette=dark?{"surface":"#24272b","editor":"#202328","side":"#292d32","ink":"#e3e7e9","muted":"#a3adb6","line":"#414951","hover":"#353d45","accent":"#e3aa7b","selection":"#42546b","active":"#2b323b","cursor":"#8ba6bc"}:null;
   for(const {key:token} of themeColors){
    const variable=token.startsWith("syntax")||token.startsWith("semantic")?"--"+token.replace(/[A-Z]/g,letter=>"-"+letter.toLowerCase()):"--theme-"+token;
    const custom=settings?.colorOverrides?.[dark?"dark":"light"]?.[token as typeof themeColors[number]["key"]];
    if(custom)root.style.setProperty(variable,custom);
    else if(palette&&token in palette)root.style.setProperty(variable,palette[token as keyof typeof palette]);else root.style.removeProperty(variable);
   }
  };
  if(settings?.fontFamily)root.style.setProperty("--font-mono",(settings.fontFamily==="monospace"?"ui-monospace,monospace":JSON.stringify(settings.fontFamily)+',"Intel One Mono","Maple Mono NF CN","Noto Sans Mono CJK SC",ui-monospace,monospace'));
  else root.style.removeProperty("--font-mono");
  root.style.setProperty("--editor-font-size",(settings?.fontSize??14)+"px");
  root.style.setProperty("--editor-line-height",String(settings?.lineHeight??1.75));
  root.dataset.indentGuides=String(settings?.indentGuides??true);
  root.dataset.lineNumbers=String(settings?.lineNumbers??true);
  root.dataset.activeLine=String(settings?.highlightActiveLine??true);
  apply();media.addEventListener("change",apply);
  return()=>media.removeEventListener("change",apply);
 },[settings]);
}
