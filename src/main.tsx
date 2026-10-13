import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { languages, draftKey, type Language } from "./domain";
import "./style.css";
import { SaveQueue } from "./save-queue";
import { CodeEditor } from "./editor";
import { FontInfo } from "./font-info";
import { Notes } from "./notes";
import { localMetadata } from "./local-metadata";
import { LocalRunner } from "./local-runner";
import { Environments } from "./environments";
import { Login, type Identity } from "./login";
import { useOnlineJudge } from "./online-judge";
import { Catalogue, QuestionStatement, type RemoteQuestion } from "./catalogue";

type WorkbenchProblem = { id: string; number: string; title: string; detail: string; input: string; output: string; official?: RemoteQuestion; cached?: boolean };
const samples: WorkbenchProblem[] = [
  { id: "sample-sum", number: "01", title: "整数数组求和", detail: "给定整数数组 values，返回所有元素的和。\n\n这是 InkLeet 自编的界面与存储测试题，不是来自力扣的真实题目。", input: "[3, -1, 8]", output: "10" },
  { id: "sample-max", number: "02", title: "寻找最大值", detail: "给定非空整数数组 values，返回其中的最大值。\n\n这是自编测试题。可通过上方中国站题库打开真实公开题目。", input: "[4, 9, 2]", output: "9" },
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
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [fontInfo, setFontInfo] = useState(false);
  const points = useRef(new Map<string, number[]>());
  const [, updatePoints] = useState(0);
  const [paused, setPaused] = useState({ key: "", line: 0 });
  const [localRunner, setLocalRunner] = useState(false);
  const [environments, setEnvironments] = useState(false);
  const [problems, setProblems] = useState<WorkbenchProblem[]>(samples);
  const [cacheWarning, setCacheWarning] = useState("");
  const [catalogue, setCatalogue] = useState(false);
  const [catalogueMode, setCatalogueMode] = useState<"search" | "link">("search");
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
  const queue = useRef(new SaveQueue());
  const activeKey = draftKey({ account: "local", problem: problemId, language });
  const selected = useRef(activeKey); selected.current = activeKey;
  const problem = problems.find(p => p.id === problemId)!;
  const baseCode = problem.official ? (problem.official.codeSnippets?.find(s => s.langSlug === language)?.code ?? "") : templates[language];
  const doc = documents.current.get(activeKey) ?? { code: baseCode, notes: notes.current.get(problemId) ?? "" };

  const judge = useOnlineJudge({ identity, question: problem.official, language, code: doc.code });
  const editorLoading = loading || !documents.current.has(activeKey);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    queue.current.idle.then(async () => {
      if (!documents.current.has(activeKey)) {
        if (isTauri()) {
          const loaded = await invoke<{code: string | null; notes: string | null}>("load_document", { problem: problemId, language });
          // 迟到的读取不能覆盖已打开/已编辑的草稿；笔记跨语言共享，不能被新语言读取重置。
          if (!notes.current.has(problemId)) {
            notes.current.set(problemId, loaded.notes ?? "");
            persisted.current.set(problemId + "/notes", loaded.notes);
          }
          if (!documents.current.has(activeKey)) {
            documents.current.set(activeKey, { code: loaded.code ?? baseCode, notes: notes.current.get(problemId) ?? "" });
            persisted.current.set(activeKey, loaded.code);
          }
        } else {
          documents.current.set(activeKey, { code: baseCode, notes: notes.current.get(problemId) ?? "" });
        }
      }
      if (alive) { refresh(r => r + 1); setLoading(false); setStatus(isTauri() ? "已读取本机文件" : "前端预览 · 仅内存，请导出保留"); }
    }).catch(() => { if (alive) { setLoading(true); setStatus("读取失败，已保护现有文件；请重启后重试"); } });
    return () => { alive = false; };
  }, [activeKey, problemId, language, baseCode]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<RemoteQuestion[]>("load_recent_questions").then(items => {
      if (!alive) return;
      setProblems(current => [...current, ...items.filter(q => !current.some(p => p.id === "lc-" + q.questionId)).map(q => ({
        id: "lc-" + q.questionId, number: q.questionFrontendId, title: q.translatedTitle || q.title,
        detail: "", input: "", output: "", official: q, cached: true,
      }))]);
    }).catch(error => { if (alive) setCacheWarning(String(error)); });
    return () => { alive = false; };
  }, []);

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
    // 每个文件只保留最新待写快照；正在写入的版本仍完成原子保存。
    // 外部冲突阻塞该文件，不能随下一次按键反复重试或覆盖外部正文。
    queue.current.enqueue({
      key: saveKey,
      write: async () => {
        await invoke("save_text", { problem: problemId, language, kind, text, expected: persisted.current.get(saveKey) ?? null });
        persisted.current.set(saveKey, text);
      },
      saved: () => { if (selected.current === key && generation === sequence.current) setStatus("已保存到本机文件"); },
      failed: () => { if (selected.current === key) setStatus("保存失败 · 草稿仍在，请先导出"); },
    });
    if (queue.current.failed(saveKey)) setStatus("保存失败 · 草稿仍在，请先导出");
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.current.busy) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function retrySave() {
    setStatus("保存中");
    queue.current.retry(activeKey);
    queue.current.retry(problemId + "/notes");
  }
  function chooseQuestion(question: RemoteQuestion, warning?: string | null, fromCache = false) {
    const entry: WorkbenchProblem = { id: "lc-" + question.questionId, number: question.questionFrontendId, title: question.translatedTitle || question.title, detail: "", input: "", output: "", official: question, cached: fromCache };
    setCacheWarning(warning ?? "");
    setProblems(current => [...current.filter(p => p.id !== entry.id), entry]);
    setProblemId(entry.id); setTab("problem");
  }
  const visible = problems.filter(p => (p.number + p.title).includes(query));
  return <main className={focus ? "workbench focus" : "workbench"}>
    <header className="topbar"><strong><span className="brand">墨</span> 墨题 <small>InkLeet</small></strong>
      <div><Login onIdentity={setIdentity} /><button disabled={!isTauri()} data-action="open-catalogue" onClick={() => { setCatalogueMode("search"); setCatalogue(true); }} title={isTauri() ? "读取中国站公开题目" : "请在原生客户端使用"}>中国站题库</button><button disabled={!isTauri()} data-action="open-link" onClick={() => { setCatalogueMode("link"); setCatalogue(true); }}>链接打开</button><span className="preview">开发预览</span><button onClick={() => setFocus(!focus)}>{focus ? "退出专注" : "专注"}</button></div>
    </header>
    <aside className="sidebar">
      <label className="search"><span>找题</span><input aria-label="搜索题目" placeholder="题号或名称" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <p className="eyebrow">本机题目 / 最近缓存</p>
      {visible.map(p => <button className={p.id === problemId ? "problem-item selected" : "problem-item"} key={p.id} data-problem={p.id} onClick={() => setProblemId(p.id)}><span>{p.number}</span>{p.title}</button>)}
      {!visible.length && <p className="empty">没有匹配的题目</p>}
      {cacheWarning && <p className="cache-warning error" role="alert">{cacheWarning}；源码和笔记保存不受此缓存提示影响。</p>}
      <p className="sidebar-foot">一题一页，慢慢写。<br/>公开题库按需读取。</p>
    </aside>
    <nav className="tabs" aria-label="工作区">{[["problem","题目"],["code","代码"],["notes","笔记"]].map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <section className={"reading " + (tab === "code" ? "mobile-hidden" : "")}>
      {tab === "notes" ? <Notes key={problemId} documentKey={problemId + "/notes"} value={notes.current.get(problemId) ?? ""} loading={editorLoading} onChange={text => edit("notes", text)} onExport={() => download("notes.md", notes.current.get(problemId) ?? "")} /> :
      <article>{problem.official ? <>{problem.cached && <p className="cache-warning">已缓存题面 · 可离线编辑；重新搜索可更新题面。</p>}<QuestionStatement question={problem.official} /></> : <><p className="eyebrow">练习 {problem.number} <span className="badge">自编样例</span></p><h1>{problem.title}</h1><p className="description">{problem.detail}</p><h3>示例</h3><pre>输入：{problem.input}{"\n"}输出：{problem.output}</pre><h3>写下你的第一种思路</h3><p className="muted">先想清楚边界，再开始写代码。笔记和每种语言的草稿相互独立。</p></>}</article>}
    </section>
    <section className={"code-pane " + (tab !== "code" ? "mobile-hidden" : "")}>
      <div className="pane-heading"><select aria-label="编程语言" value={language} onChange={e => setLanguage(e.target.value as Language)}>{languages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select><div className="actions"><button disabled={editorLoading || !["python3", "golang", "cpp", "c", "rust", "java"].includes(language) || !isTauri()} onClick={() => setLocalRunner(v => !v)} title="本机执行 当前语言代码，不上传">本地</button><button disabled={editorLoading || !identity || !problem.official || judge.busy || judge.blocked} onClick={judge.run} title="将当前代码与用例发送到中国站运行">运行</button><button disabled={editorLoading || !identity || !problem.official || judge.busy || judge.blocked} className="primary" onClick={judge.submit} title="确认后正式提交到中国站">提交</button></div></div>
      {editorLoading ? <p className="loading">正在读取草稿…</p> : <CodeEditor key={activeKey} documentKey={activeKey} language={language} label="代码编辑器" breakpoints={points.current.get(activeKey) ?? []} onBreakpoints={lines => { points.current.set(activeKey, lines); updatePoints(n => n + 1); }} pausedLine={paused.key === activeKey ? paused.line : 0} value={doc.code} onChange={text => edit("code", text)} />}
      <div className="editor-foot"><button onClick={() => setFontInfo(true)} title="内置字体与开源许可">Intel One Mono</button><button onClick={() => setEnvironments(true)} data-action="open-environments">开发环境</button><button disabled={editorLoading} onClick={() => download("solution." + languages.find(l => l.id === language)!.extension,doc.code)}>导出源码</button></div>
      {localRunner && <LocalRunner breakpoints={points.current.get(activeKey) ?? []} onPauseLine={line => setPaused({ key: activeKey, line })} key={problemId} code={doc.code} language={language} title={problem.title} metadata={problem.official ? localMetadata(problem.official.metaData ?? "", language, problem.official.codeSnippets?.find(s => s.langSlug === language)?.code) : JSON.stringify({ name: "solve", inkleetFunctionStyle: "free", params: [{ name: "values", type: "integer[]" }], return: { type: "integer" } })} sampleInput={problem.official?.sampleTestCase ?? problem.input} onClose={() => setLocalRunner(false)} />}
      {judge.panel}
    </section>
    {environments && <Environments onClose={() => setEnvironments(false)} />}
    {fontInfo && <FontInfo onClose={() => setFontInfo(false)} />}
    {catalogue && <Catalogue initialMode={catalogueMode} onChoose={chooseQuestion} onClose={() => setCatalogue(false)} />}
    <footer className="statusbar" role="status"><span>{status}{(queue.current.failed(activeKey) || queue.current.failed(problemId + "/notes")) && <button onClick={retrySave}>重试保存</button>}</span><span>源码和笔记本机保存 · 评测按需上传代码</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
