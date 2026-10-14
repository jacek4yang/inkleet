import React, { useLayoutEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { java } from "@codemirror/lang-java";
import type { Source } from "./intelligence";
export function SourceViewer({ source, onClose }: { source: Source; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), host = useRef<HTMLDivElement>(null);
  const close = () => { dialog.current?.close(); onClose(); };
  useLayoutEffect(() => {
    dialog.current?.showModal();
    const state = EditorState.create({ doc: source.text, extensions: [
      basicSetup, source.language === "java" ? java() : source.language === "golang" ? go() : source.language === "rust" ? rust() : source.language === "cpp" || source.language === "c" ? cpp() : python(), EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ "aria-label": "只读标准库源码", tabindex: "0" }),
      EditorView.theme({ "&": { height: "100%", fontSize: "13px", backgroundColor: "#fcfcfa" }, ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" } }),
    ] });
    const view = new EditorView({ state, parent: host.current! });
    const line = state.doc.line(Math.min(state.doc.lines, Math.max(1, source.line + 1)));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    return () => { dialog.current?.close(); view.destroy(); };
  }, [source]);
  return <dialog className="source-viewer" ref={dialog} aria-labelledby="source-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header><div><h2 id="source-title">{source.name}</h2><p>{source.declaration ? "标准库类型声明 · .pyi 不是运行时实现源码" : source.language === "java" ? "Java 语言服务源码视图" : "标准库实现源码"} · 只读</p></div><button onClick={close}>返回代码</button></header>
    <div className="source-editor" ref={host} />
  </dialog>;
}
