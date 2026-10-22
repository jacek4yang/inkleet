import {editorSyntaxTheme} from "./editor-syntax-theme";
import React,{useLayoutEffect,useRef} from "react";
import {EditorState,Compartment} from "@codemirror/state";
import {EditorView,keymap} from "@codemirror/view";
import {basicSetup} from "codemirror";
import {StreamLanguage} from "@codemirror/language";
const jsonSyntax=StreamLanguage.define({
 token(stream){
  if(stream.eatSpace())return null;
  if(stream.peek()==='"'){stream.next();let escaped=false;while(!stream.eol()){const c=stream.next();if(c==='"'&&!escaped)break;escaped=c==="\\"&&!escaped;}return "string";}
  if(stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/))return "number";
  if(stream.match(/^(true|false|null)\b/))return "atom";
  stream.next();return null;
 }
});
export function SettingsJSONEditor({value,onChange,onSave,disabled}:{value:string;onChange:(value:string)=>void;onSave:()=>void;disabled:boolean}){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),callback=useRef(onChange),save=useRef(onSave),readonly=useRef(new Compartment());
 callback.current=onChange;save.current=onSave;
 useLayoutEffect(()=>{
  const current=new EditorView({parent:host.current!,state:EditorState.create({doc:value,extensions:[
   basicSetup,editorSyntaxTheme,jsonSyntax,EditorView.lineWrapping,
   readonly.current.of([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)]),
   keymap.of([{key:"Mod-s",run:()=>{save.current();return true;}}]),
   EditorView.contentAttributes.of({"aria-label":"设置 JSON","spellcheck":"false"}),
   EditorView.updateListener.of(update=>{if(update.docChanged)callback.current(update.state.doc.toString());}),
   EditorView.theme({"&":{height:"320px",border:"1px solid var(--line)",background:"var(--surface-editor)",color:"var(--ink)"},".cm-scroller":{overflow:"auto"}})
  ]})});view.current=current;return()=>{view.current=null;current.destroy();};
 },[]);
 useLayoutEffect(()=>{const current=view.current;if(current&&current.state.doc.toString()!==value)current.dispatch({changes:{from:0,to:current.state.doc.length,insert:value}});},[value]);
 useLayoutEffect(()=>{view.current?.dispatch({effects:readonly.current.reconfigure([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)])});},[disabled]);
 return <div className="settings-json-editor" ref={host}/>;
}
