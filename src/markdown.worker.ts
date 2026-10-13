import { marked } from "marked";

// 解析放到可终止的 Worker，避免恶意或复杂 Markdown 卡住编辑器主线程。
self.onmessage = (event: MessageEvent<{ text: string }>) => {
  try {
    const text = event.data?.text;
    if (typeof text !== "string" || text.length > 256 * 1024) {
      self.postMessage({ error: "笔记过长，已暂停预览；原文仍可编辑和导出。" }); return;
    }
    const html = marked.parse(text, { async: false, gfm: true });
    if (html.length > 2 * 1024 * 1024) {
      self.postMessage({ error: "预览内容过大，已暂停；原文未改变。" }); return;
    }
    self.postMessage({ html });
  } catch {
    self.postMessage({ error: "无法生成预览；原文未改变，可返回编辑。" });
  }
};
