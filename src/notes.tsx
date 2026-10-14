import { IconButton } from "./icons";
import React, { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { CodeEditor } from "./editor";

function MarkdownPreview({ text }: { text: string }) {
  const [result, setResult] = useState<{ source: string; html?: string; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: string) => {
      if (alive) setResult({ source: text, error });
      worker?.terminate();
      clearTimeout(timer);
    };
    try {
      worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" });
      timer = setTimeout(() => fail("预览耗时过长，已停止解析；原文仍可编辑和导出。"), 2000);
      worker.onmessage = (event: MessageEvent<{ html?: string; error?: string }>) => {
        if (!alive) return;
        clearTimeout(timer);
        worker?.terminate();
        if (event.data.error || typeof event.data.html !== "string") {
          fail(event.data.error ?? "预览未返回有效内容；原文未改变。"); return;
        }
        // 不允许脚本、样式、表单、媒体、远程图片或导航；源码和导出不经此转换。
        const html = DOMPurify.sanitize(event.data.html, {
          ALLOWED_TAGS: ["h1","h2","h3","h4","h5","h6","p","br","hr","strong","em","del","s","blockquote","ul","ol","li","pre","code","table","thead","tbody","tr","th","td","div","span","kbd","sub","sup"],
          ALLOWED_ATTR: ["start", "colspan", "rowspan"],
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
        });
        setResult({ source: text, html });
      };
      worker.onerror = () => fail("预览解析失败；原文未改变，可返回编辑。");
      worker.postMessage({ text });
    } catch {
      fail("此环境暂时无法启动预览；原文仍可编辑和导出。");
    }
    return () => { alive = false; clearTimeout(timer); worker?.terminate(); };
  }, [text]);
  const current = result?.source === text ? result : null;
  return <div className="notes-preview" aria-label="Markdown 预览">
    {!current ? <p aria-live="polite">正在生成预览…</p> : current.error
      ? <p className="error" aria-live="polite">{current.error}</p>
      : text.trim() ? <div className="notes-rendered" dangerouslySetInnerHTML={{ __html: current.html ?? "" }} />
      : <p className="muted">暂无笔记</p>}
  </div>;
}
export function Notes({ documentKey, value, loading, onChange, onSettings }: {
  documentKey: string; value: string; loading: boolean;
  onChange: (value: string) => void; onExport: () => void;
  onSettings?: () => void; onRecovery?: () => void;
  externalEditors?: boolean; onExternal?: (editor: "default" | "typora") => void; onReload?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  return <>
    <div className="pane-heading notes-heading"><div>
      <IconButton icon={preview ? "edit" : "eye"} label={preview ? "返回编辑" : "预览笔记"} disabled={loading} aria-pressed={preview} onClick={() => setPreview(v => !v)} />
      <IconButton icon="settings" label="笔记设置" onClick={onSettings} />
    </div></div>
    {loading ? <p className="loading">正在读取笔记…</p> : preview
      ? <MarkdownPreview text={value} />
      : <CodeEditor documentKey={documentKey} language="markdown" label="Markdown 笔记" value={value} onChange={onChange} />}
  </>;
}
