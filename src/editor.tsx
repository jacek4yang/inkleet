import {editorSyntaxTheme} from "./editor-syntax-theme";
import {editorJumpExtensions,moveEditorJump,settleEditorJump} from "./editor-jump-history";
import {navigationBindings} from "./command-registry";
import {snippetSession,moveSnippetField,endSnippet,discardSnippet,snippetChoiceOpen,moveSnippetChoice,acceptSnippetChoice,settleSnippetForAction} from "./snippet-session";
import {snapshotText} from "./snapshot-text";
import {createEditorSessionCache} from "./editor-session-cache";
import {editorStatus} from "./editor-status";
import {vimEditing,vimNormal,getCM} from "./vim";
import {indentGuides} from "./indent-guides";
import {editorCommands} from "./editor-commands";
import {formatBinding,type Command} from "./command-registry";
import type { DebugPosition } from "./debug-position";
import { formatOnSave, formatDocument, saveDocument } from "./format-on-save";
import React, { useLayoutEffect, useRef, useState } from "react";
import { EditorState, StateEffect, Prec, Compartment } from "@codemirror/state";
import { EditorView, keymap, tooltips, panels } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentMore, indentLess, undo, redo, selectAll } from "@codemirror/commands";
import { acceptCompletion, closeCompletion, completionStatus } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { markdown } from "@codemirror/lang-markdown";
import type { Language } from "./domain";
import { languageIntelligence, type Source } from "./intelligence";
import { debugGutter } from "./debug-gutter";
import { SourceViewer } from "./source-viewer";

// 仅保存本次运行的编辑器状态；正文持久化由原生存储负责。
// 切换题目/语言时保留各自的撤销历史、光标与滚动位置。
// Retain only recent inactive states; evictions never change workspace drafts.
const sessions = createEditorSessionCache<{ state: EditorState; scroll: number; scrollLeft:number }>();
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--surface-editor)", color: "var(--ink)", fontSize: "14px", fontWeight:"400", textShadow:"none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 8px" },
  ".cm-gutters": { backgroundColor: "var(--surface-editor)", color: "var(--muted)", border: "none" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "var(--editor-active-line,var(--active-line))" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--selection)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--line)" },
});
function syntax(language: Language | "markdown") {
  switch (language) {
    case "rust": return rust();
    case "python3": return python();
    case "golang": return go();
    case "c": case "cpp": return cpp();
    case "java": return java();
    case "markdown": return markdown();
  }
}
export type EditorLanguageStatus={owner:string;text:string};
type Props = {
  statusOwner?:string;
  vimEnabled?:boolean;
  wordWrap?:boolean;showIndentGuides?:boolean;
  tabSize?:number;
  documentKey: string; language: Language | "markdown"; value: string; metadata?: string;
  label: string; onChange: (text: string) => void; onStatus?: (status: EditorLanguageStatus) => void; reconnectToken?: number; onSettings?: () => void;
  onSave?:()=>void;onSaveReady?:(save:(()=>boolean)|null)=>void;
  formatting?: {epoch?:()=>number;ready?:(save:boolean)=>boolean;enabled:boolean;save:(text:string)=>Promise<boolean>;report:(message:string)=>void};
  breakpoints?: number[]; onBreakpoints?: (lines: number[]) => void; pausedPosition?: DebugPosition|null;
};
export function CodeEditor({ vimEnabled=false, tabSize=4, wordWrap=false, showIndentGuides=true, documentKey, language, value, label, onChange, metadata, breakpoints = [], onBreakpoints, pausedPosition = null, onStatus, statusOwner, reconnectToken = 0, onSettings, formatting, onSave, onSaveReady }: Props) {
  const wrapSlot=useRef(new Compartment()),guideSlot=useRef(new Compartment());
  const formatOptions=useRef(formatting);formatOptions.current=formatting;
  const saveCallback=useRef(onSave),saveReady=useRef(onSaveReady);saveCallback.current=onSave;saveReady.current=onSaveReady;
  const host = useRef<HTMLDivElement>(null);
  const vimSlot=useRef(new Compartment()),tabSizeSlot=useRef(new Compartment()),liveView=useRef<EditorView|null>(null),vimSave=useRef<(view:EditorView)=>boolean>(()=>false);
  const [lspStatus, setLspStatus] = useState<EditorLanguageStatus>({owner:"",text:""});
  const connection = reconnectToken;
  const [source, setSource] = useState<Source | null>(null);
  const callback = useRef(onChange), pointCallback = useRef(onBreakpoints);
  const debugView = useRef<{ view: EditorView; stopped: (view: EditorView, position: DebugPosition|null) => void } | null>(null);
  useLayoutEffect(() => { callback.current = onChange; pointCallback.current = onBreakpoints; });
  useLayoutEffect(() => { onStatus?.(lspStatus); }, [lspStatus,onStatus]);
  useLayoutEffect(() => {
    let live=true;setSource(null);
    const owner=statusOwner??JSON.stringify([documentKey,language,reconnectToken]);
    const report=(text:string)=>{if(live)setLspStatus(current=>current.owner===owner&&current.text===text?current:{owner,text});};
    const intelligence = (language !== "markdown") ? languageIntelligence(language, report, setSource, metadata, true) : null;
    const debug = ["python3", "golang", "cpp", "c", "rust", "java"].includes(language) && onBreakpoints ? debugGutter(breakpoints, lines => pointCallback.current?.(lines)) : null;
    const save=(target:EditorView)=>{if(target.composing)return false;if(language==="markdown"){saveCallback.current?.();return true;}return settleSnippetForAction(target,()=>saveDocument(target))||saveDocument(target);};
    vimSave.current=save;
    const commands:Command<EditorView>[]=[
      {id:"editor.save",label:"保存",key:"Mod-s",run:save},
      {id:"editor.goBack",label:"返回上一个代码位置",key:navigationBindings(navigator.platform).back,run:target=>moveEditorJump(target,-1,()=>intelligence?.cancelNavigation())},
      {id:"editor.goForward",label:"前进到下一个代码位置",key:navigationBindings(navigator.platform).forward,run:target=>moveEditorJump(target,1,()=>intelligence?.cancelNavigation())},
      {id:"editor.undo",label:"撤销",run:undo},
      {id:"editor.redo",label:"重做",run:redo},
      {id:"editor.selectAll",label:"全选",run:selectAll},
      ...(intelligence?[
        {id:"editor.rename",enabled:()=>intelligence.available(),label:"重命名符号",key:"F2",run:intelligence.commands.rename},
        {id:"editor.implementation",enabled:()=>intelligence.implementationAvailable(),label:"转到实现",key:"Mod-F12",run:intelligence.commands.implementation},
        {id:"editor.definition",enabled:()=>intelligence.available(),label:"转到定义",key:"F12",run:intelligence.commands.definition},
        {id:"editor.references",enabled:()=>intelligence.available(),label:"查找引用",key:"Shift-F12",run:intelligence.commands.references},
        {id:"editor.signature",enabled:()=>intelligence.available(),label:"参数提示",key:"Mod-Shift-Space",run:intelligence.commands.signature},
        {id:"editor.completion",enabled:()=>intelligence.available(),label:"触发补全",run:intelligence.commands.completion},
      ]:[]),
      ...(intelligence&&formatting?[{id:"editor.format",label:"格式化文档",key:formatBinding(navigator.platform),run:(target:EditorView)=>settleSnippetForAction(target,()=>formatDocument(target),"format")||formatDocument(target)}]:[]),
      ...(debug?[{id:"debug.toggleBreakpoint",label:"切换断点",key:"F9",run:debug.toggle}]:[]),
    ];
    const footer=document.getElementById("vim-command-slot");
    const commandHost=footer?document.createElement("div"):null;
    if(commandHost){commandHost.className="vim-command-host";footer!.appendChild(commandHost);}
    const extensions = [...editorJumpExtensions,editorCommands(commands), ...(debug?.extensions ?? []),vimSlot.current.of(vimEnabled?vimEditing(save):[]),
      basicSetup, editorSyntaxTheme, snippetSession, syntax(language), theme, ...(commandHost?[panels({bottomContainer:commandHost})]:[]), editorStatus(language,documentKey,commandHost), guideSlot.current.of(language!=="markdown"&&showIndentGuides?indentGuides:[]),
      ...(intelligence&&formatting?formatOnSave({epoch:()=>formatOptions.current?.epoch?.()??0,ready:save=>formatOptions.current?.ready?.(save)??true,enabled:()=>!!formatOptions.current?.enabled,save:text=>formatOptions.current?.save(text)??Promise.resolve(false),request:text=>intelligence.format(text),report:message=>formatOptions.current?.report(message)}):[]),
      tabSizeSlot.current.of(EditorState.tabSize.of(tabSize)),
      indentUnit.of(language === "golang" ? "\t" : language === "markdown" ? "  " : "    "),
      // 补全优先，其次缩进；Escape 然后 Tab 仍可退出编辑器，避免键盘焦点陷阱。
      Prec.high(keymap.of([{ key: "Tab", run: view => vimNormal(view)||acceptCompletion(view)||completionStatus(view.state)==="active"||acceptSnippetChoice(view,true)||moveSnippetField(view,1)||indentMore(view), shift:view=>vimNormal(view)||moveSnippetField(view,-1)||indentLess(view) },
       {key:"Enter",run:view=>snippetChoiceOpen(view)&&(acceptCompletion(view)||completionStatus(view.state)==="active"||acceptSnippetChoice(view))},
       {key:"ArrowDown",run:view=>completionStatus(view.state)!=="active"&&moveSnippetChoice(view,1)},
       {key:"ArrowUp",run:view=>completionStatus(view.state)!=="active"&&moveSnippetChoice(view,-1)}])),
      // 脱离面板的 overflow / stacking context；CM 自动同步主题并在销毁时移除容器。
      keymap.of([{key:"Mod-m",run:view=>{view.setTabFocusMode(2000);return true;}}]),
      tooltips({ parent: document.body, position: "fixed" }),
      EditorView.domEventObservers({
        compositionstart(_event,view){discardSnippet(view);},
        blur(_event,view){endSnippet(view);},
        keydown(event, view) {
          // 即使 Escape 被补全/选区消耗，也保留显式移出编辑器的键盘通道。
          if (event.key === "Escape") {endSnippet(view,true);if(getCM(view)){closeCompletion(view);view.setTabFocusMode(false);}else view.setTabFocusMode(2000);}
        },
      }), ...(intelligence?.extensions ?? []),
      EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callback.current(snapshotText(update.state.doc));
      }),
      wrapSlot.current.of(language==="markdown"||wordWrap?EditorView.lineWrapping:[]),
    ];
    const cached = sessions.take(documentKey);
    // 外部正文变化时重新建状态，不能将另一个版本的撤销历史套上去。
    const state = cached && snapshotText(cached.state.doc) === value
      ? cached.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: host.current! });
    liveView.current=view;
    saveReady.current?.(()=>save(view));
    if (debug) debugView.current = { view, stopped: debug.stopped };
    if (cached) {view.scrollDOM.scrollTop = cached.scroll;view.scrollDOM.scrollLeft=cached.scrollLeft;}
    if (intelligence) void intelligence.connect(view);
    return () => {
      live=false;setSource(null);
      liveView.current=null;
      saveReady.current?.(null);
      debugView.current = null;
      intelligence?.destroy();
      discardSnippet(view);
      settleEditorJump(view);
      sessions.set(documentKey, { state: view.state, scroll: view.scrollDOM.scrollTop,scrollLeft:view.scrollDOM.scrollLeft });
      view.destroy();
      commandHost?.remove();
    };
  }, [documentKey, language, label, connection, metadata, statusOwner]);
  useLayoutEffect(()=>{const view=liveView.current;if(view)view.dispatch({effects:[wrapSlot.current.reconfigure(language==="markdown"||wordWrap?EditorView.lineWrapping:[]),guideSlot.current.reconfigure(language!=="markdown"&&showIndentGuides?indentGuides:[])]});},[wordWrap,showIndentGuides,language]);
  // Display-only reconfiguration keeps the view, document, history and LSP owner.
  useLayoutEffect(()=>{const view=liveView.current;if(view&&view.state.tabSize!==tabSize)view.dispatch({effects:tabSizeSlot.current.reconfigure(EditorState.tabSize.of(tabSize))});},[tabSize]);
  useLayoutEffect(()=>{const view=liveView.current;if(view){endSnippet(view);view.dispatch({effects:vimSlot.current.reconfigure(vimEnabled?vimEditing(view=>vimSave.current(view)):[])});}},[vimEnabled]);
  useLayoutEffect(() => { const active = debugView.current; if (active) active.stopped(active.view, pausedPosition); }, [pausedPosition, documentKey, connection, language, label, metadata]);
  return <><div className="editor-host" ref={host} />{source && <SourceViewer source={source} vimEnabled={vimEnabled} tabSize={tabSize} wordWrap={wordWrap} showIndentGuides={showIndentGuides} onClose={() => { setSource(null); host.current?.querySelector<HTMLElement>(".cm-content")?.focus(); }} />}</>;
}
