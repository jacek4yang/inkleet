import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { languages, draftKey, type Language } from "./domain";
import "./style.css";
import { CodeEditor } from "./editor";
import { Login } from "./login";

const samples = [
  { id: "sample-sum", number: "01", title: "整数数组求和", detail: "给定整数数组 values，返回所有元素的和。\n\n这是 InkLeet 自编的界面与存储测试题，不是来自力扣的真实题目。", input: "[3, -1, 8]", output: "10" },
  { id: "sample-max", number: "02", title: "寻找最大值", detail: "给定非空整数数组 values，返回其中的最大值。\n\n这是自编测试题。真实中国站题目接入尚未完成。", input: "[4, 9, 2]", output: "9" },
];
const templates: Record<Language, string> = {
  rust: "// 自编测试题草稿\nfn solve(values: Vec<i32>) -> i32 {\n    todo!()\n}\n",
  python3: "# 自编测试题草稿\ndef solve(values):\n    pass\n",
  golang: "// 自编测试题草稿\nfunc solve(values []int) int {\n    return 0\n}\n",
  c: "// 自编测试题草稿\nint solve(int* values, int valuesSize) {\n    return 0;\n}\n",
  cpp: "// 自编测试题草稿\nint solve(vector<int>& values) {\n    return 0;\n}\n",
  java: "// 自编测试题草稿\nclass Solution {\n    public int solve(int[] values) {\n        return 0;\n    }\n}\n",
};
type Document = { code: string; notes: string };
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [problemId, setProblemId] = useState(samples[0].id);
  const [language, setLanguage] = useState<Language>("rust");
  const [tab, setTab] = useState("problem");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  const [revision, refresh] = useState(0);
  const [status, setStatus] = useState("正在读取");
  const [loading, setLoading] = useState(true);
  const documents = useRef(new Map<string, Document>());
  const persisted = useRef(new Map<string, string | null>());
  const sequence = useRef(0);
  const notes = useRef(new Map<string, string>());
  const queue = useRef(Promise.resolve());
  const activeKey = draftKey({ account: "local", problem: problemId, language });
  const selected = useRef(activeKey); selected.current = activeKey;
  const problem = samples.find(p => p.id === problemId)!;
  const doc = documents.current.get(activeKey) ?? { code: templates[language], notes: notes.current.get(problemId) ?? "" };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    queue.current.then(async () => {
      if (!documents.current.has(activeKey)) {
        if (isTauri()) {
          const loaded = await invoke<{code: string | null; notes: string | null}>("load_document", { problem: problemId, language });
          documents.current.set(activeKey, { code: loaded.code ?? templates[language], notes: loaded.notes ?? "" });
          persisted.current.set(activeKey, loaded.code);
          persisted.current.set(problemId + "/notes", loaded.notes);
          notes.current.set(problemId, loaded.notes ?? "");
        } else {
          documents.current.set(activeKey, { code: templates[language], notes: notes.current.get(problemId) ?? "" });
        }
      }
      if (alive) { refresh(r => r + 1); setLoading(false); setStatus(isTauri() ? "已读取本机文件" : "前端预览 · 仅内存，请导出保留"); }
    }).catch(() => { if (alive) { setLoading(true); setStatus("读取失败，已保护现有文件；请重启后重试"); } });
    return () => { alive = false; };
  }, [activeKey, problemId, language]);

  function edit(kind: "code" | "notes", text: string) {
    const next = { ...doc, [kind]: text };
    documents.current.set(activeKey, next);
    if (kind === "notes") notes.current.set(problemId, text);
    refresh(r => r + 1);
    if (!isTauri()) return;
    setStatus("保存中");
    const key = activeKey;
    const saveKey = kind === "notes" ? problemId + "/notes" : key;
    const generation = ++sequence.current;
    // 串行保存保证旧请求不会在新请求之后覆盖正文；失败必须显式可见。
    queue.current = queue.current.then(async () => {
      await invoke("save_text", { problem: problemId, language, kind, text, expected: persisted.current.get(saveKey) ?? null });
      persisted.current.set(saveKey, text);
      if (selected.current === key && generation === sequence.current) setStatus("已保存到本机文件");
    }).catch(() => { if (selected.current === key) setStatus("保存失败 · 草稿仍在，请先导出"); });
  }
  const visible = samples.filter(p => (p.number + p.title).includes(query));
  return <main className={focus ? "workbench focus" : "workbench"}>
    <header className="topbar"><strong><span className="brand">墨</span> 墨题 <small>InkLeet</small></strong>
      <div><Login /><span className="preview">开发预览 · 自编样例</span><button onClick={() => setFocus(!focus)}>{focus ? "退出专注" : "专注"}</button></div>
    </header>
    <aside className="sidebar">
      <label className="search"><span>找题</span><input aria-label="搜索题目" placeholder="题号或名称" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <p className="eyebrow">本机练习 / 示例</p>
      {visible.map(p => <button className={p.id === problemId ? "problem-item selected" : "problem-item"} key={p.id} onClick={() => setProblemId(p.id)}><span>{p.number}</span>{p.title}</button>)}
      {!visible.length && <p className="empty">没有匹配的题目</p>}
      <p className="sidebar-foot">一题一页，慢慢写。<br/>真实力扣接入尚未完成。</p>
    </aside>
    <nav className="tabs" aria-label="工作区">{[["problem","题目"],["code","代码"],["notes","笔记"]].map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <section className={"reading " + (tab === "code" ? "mobile-hidden" : "")}>
      {tab === "notes" ? <><div className="pane-heading"><strong>解题笔记</strong><button disabled={loading} onClick={() => download("notes.md",notes.current.get(problemId) ?? "")}>导出 Markdown</button></div>{loading ? <p className="loading">正在读取笔记…</p> : <CodeEditor key={problemId + "/notes"} documentKey={problemId + "/notes"} language="markdown" label="Markdown 笔记" value={notes.current.get(problemId) ?? ""} onChange={text => edit("notes", text)} />}</> :
      <article><p className="eyebrow">练习 {problem.number} <span className="badge">自编样例</span></p><h1>{problem.title}</h1><p className="description">{problem.detail}</p><h3>示例</h3><pre>输入：{problem.input}{"\n"}输出：{problem.output}</pre><h3>写下你的第一种思路</h3><p className="muted">先想清楚边界，再开始写代码。笔记和每种语言的草稿相互独立。</p></article>}
    </section>
    <section className={"code-pane " + (tab !== "code" ? "mobile-hidden" : "")}>
      <div className="pane-heading"><select aria-label="编程语言" value={language} onChange={e => setLanguage(e.target.value as Language)}>{languages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select><div className="actions"><button disabled title="中国站接入开发中">运行</button><button disabled className="primary" title="中国站接入开发中">提交</button></div></div>
      {loading ? <p className="loading">正在读取草稿…</p> : <CodeEditor key={activeKey} documentKey={activeKey} language={language} label="代码编辑器" value={doc.code} onChange={text => edit("code", text)} />}
      <div className="editor-foot"><span>CodeMirror 6 · 本机编辑</span><button disabled={loading} onClick={() => download("solution." + languages.find(l => l.id === language)!.extension,doc.code)}>导出源码</button></div>
    </section>
    <footer className="statusbar" role="status"><span>{status}</span><span>仅本机 · 不上传私人解答</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
