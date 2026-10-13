import React, { useLayoutEffect, useRef, useState } from "react";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { markdown } from "@codemirror/lang-markdown";
import type { Language } from "./domain";
import { pythonIntelligence, type Source } from "./intelligence";
import { SourceViewer } from "./source-viewer";

// 仅保存本次运行的编辑器状态；正文持久化由原生存储负责。
// 切换题目/语言时保留各自的撤销历史、光标与滚动位置。
const sessions = new Map<string, { state: EditorState; scroll: number }>();
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#fcfcfa", color: "#2b2621", fontSize: "14px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "20px 0", caretColor: "#bc6a3a" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "#f5f2ec", color: "#9b8d7b", border: "none" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "#f5f2ec88" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#e8ddd0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "#bc6a3a" },
  ".cm-tooltip": { backgroundColor: "#faf9f5", border: "1px solid #ddd5ca" },
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
  documentKey: string; language: Language | "markdown"; value: string;
  label: string; onChange: (text: string) => void;
};
export function CodeEditor({ documentKey, language, value, label, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [lspStatus, setLspStatus] = useState("");
  const [connection, reconnect] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const callback = useRef(onChange);
  useLayoutEffect(() => { callback.current = onChange; });
  useLayoutEffect(() => {
    const intelligence = language === "python3" ? pythonIntelligence(setLspStatus, setSource) : null;
    const extensions = [
      basicSetup, syntax(language), theme, ...(intelligence?.extensions ?? []),
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
    if (cached) view.scrollDOM.scrollTop = cached.scroll;
    if (intelligence) void intelligence.connect(view);
    return () => {
      intelligence?.destroy();
      sessions.set(documentKey, { state: view.state, scroll: view.scrollDOM.scrollTop });
      view.destroy();
    };
  }, [documentKey, language, label, connection]);
  return <><div className="editor-host" ref={host} />{language === "python3" && <div className="lsp-status"><span role="status">{lspStatus}</span><button onClick={() => reconnect(n => n + 1)}>重连语言服务</button></div>}{source && <SourceViewer source={source} onClose={() => { setSource(null); host.current?.querySelector<HTMLElement>(".cm-content")?.focus(); }} />}</>;
}
