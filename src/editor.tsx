import type { DebugPosition } from "./debug-position";
import { formatOnSave } from "./format-on-save";
import React, { useLayoutEffect, useRef, useState } from "react";
import { EditorState, StateEffect, Prec } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentMore, indentLess } from "@codemirror/commands";
import { acceptCompletion } from "@codemirror/autocomplete";
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
const sessions = new Map<string, { state: EditorState; scroll: number }>();
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--surface-editor)", color: "var(--ink)", fontSize: "14px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "20px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "var(--surface-editor)", color: "var(--muted)", border: "none" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "var(--active-line)" },
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
type Props = {
  documentKey: string; language: Language | "markdown"; value: string; metadata?: string;
  label: string; onChange: (text: string) => void; onStatus?: (status: string) => void; reconnectToken?: number; onSettings?: () => void;
  formatting?: {enabled:boolean;saved:(text:string)=>Promise<boolean>;report:(message:string)=>void};
  breakpoints?: number[]; onBreakpoints?: (lines: number[]) => void; pausedPosition?: DebugPosition|null;
};
export function CodeEditor({ documentKey, language, value, label, onChange, metadata, breakpoints = [], onBreakpoints, pausedPosition = null, onStatus, reconnectToken = 0, onSettings, formatting }: Props) {
  const formatOptions=useRef(formatting);formatOptions.current=formatting;
  const host = useRef<HTMLDivElement>(null);
  const [lspStatus, setLspStatus] = useState("");
  const connection = reconnectToken;
  const [source, setSource] = useState<Source | null>(null);
  const callback = useRef(onChange), pointCallback = useRef(onBreakpoints);
  const debugView = useRef<{ view: EditorView; stopped: (view: EditorView, position: DebugPosition|null) => void } | null>(null);
  useLayoutEffect(() => { callback.current = onChange; pointCallback.current = onBreakpoints; });
  useLayoutEffect(() => { onStatus?.(lspStatus); }, [lspStatus,onStatus]);
  useLayoutEffect(() => {
    const intelligence = (language !== "markdown") ? languageIntelligence(language, setLspStatus, setSource, metadata) : null;
    const debug = ["python3", "golang", "cpp", "c", "rust", "java"].includes(language) && onBreakpoints ? debugGutter(breakpoints, lines => pointCallback.current?.(lines)) : null;
    const extensions = [
      basicSetup, syntax(language), theme,
      ...(intelligence&&formatting?formatOnSave({enabled:()=>!!formatOptions.current?.enabled,saved:text=>formatOptions.current?.saved(text)??Promise.resolve(false),request:text=>intelligence.format(text),report:message=>formatOptions.current?.report(message)}):[]),
      EditorState.tabSize.of(4),
      indentUnit.of(language === "golang" ? "\t" : language === "markdown" ? "  " : "    "),
      // 补全优先，其次缩进；Escape 然后 Tab 仍可退出编辑器，避免键盘焦点陷阱。
      Prec.high(keymap.of([{ key: "Tab", run: view => acceptCompletion(view) || indentMore(view), shift: indentLess }])),
      // 脱离面板的 overflow / stacking context；CM 自动同步主题并在销毁时移除容器。
      tooltips({ parent: document.body, position: "fixed" }),
      EditorView.domEventObservers({
        keydown(event, view) {
          // 即使 Escape 被补全/选区消耗，也保留显式移出编辑器的键盘通道。
          if (event.key === "Escape") view.setTabFocusMode(2000);
        },
      }), ...(debug?.extensions ?? []), ...(intelligence?.extensions ?? []),
      EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callback.current(update.state.doc.toString());
      }),
      ...(language === "markdown" ? [EditorView.lineWrapping] : []),
    ];
    const cached = sessions.get(documentKey);
    // 外部正文变化时重新建状态，不能将另一个版本的撤销历史套上去。
    const state = cached?.state.doc.toString() === value
      ? cached.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: host.current! });
    if (debug) debugView.current = { view, stopped: debug.stopped };
    if (cached) view.scrollDOM.scrollTop = cached.scroll;
    if (intelligence) void intelligence.connect(view);
    return () => {
      debugView.current = null;
      intelligence?.destroy();
      sessions.set(documentKey, { state: view.state, scroll: view.scrollDOM.scrollTop });
      view.destroy();
    };
  }, [documentKey, language, label, connection, metadata]);
  useLayoutEffect(() => { const active = debugView.current; if (active) active.stopped(active.view, pausedPosition); }, [pausedPosition, documentKey, connection]);
  return <><div className="editor-host" ref={host} />{(language !== "markdown") && <button type="button" onClick={onSettings} className={"lsp-status " + (lspStatus.includes("已连接") ? "ready" : "unavailable")} data-status={lspStatus} aria-label="语言服务设置" title={lspStatus}><i /><span>LSP</span></button>}{source && <SourceViewer source={source} onClose={() => { setSource(null); host.current?.querySelector<HTMLElement>(".cm-content")?.focus(); }} />}</>;
}
