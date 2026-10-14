import { officialTemplate } from "./official-template";
import { SolutionPicker } from "./solution-picker";
import { QuestionSidebar } from "./question-sidebar";
import { IconButton } from "./icons";
import { SettingsHub, type SettingsSection, type SettingsAction } from "./settings-hub";
import { RecoveryDialog } from "./recovery";
import { ConflictDialog, type FileConflict } from "./conflict";
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

type WorkbenchProblem = { id: string; number: string; title: string; official: RemoteQuestion; cached?: boolean };
type Document = { code: string; notes: string };
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [recovery, setRecovery] = useState<FileConflict | null>(null);
  const [conflict, setConflict] = useState<FileConflict | null>(null);
  const [reload, reloadEditors] = useState(0);
  const [noteRevision, reloadNotes] = useState(0);
  const [externalEditors, setExternalEditors] = useState(false);
  const refreshingNotes = useRef(false), openingNotes = useRef(false);
  const conflictSequence = useRef(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [fontInfo, setFontInfo] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [languageStatus, setLanguageStatus] = useState("");
  const [reconnectToken, setReconnectToken] = useState(0);
  const points = useRef(new Map<string, number[]>());
  const [, updatePoints] = useState(0);
  const [paused, setPaused] = useState({ key: "", line: 0 });
  const [localRunner, setLocalRunner] = useState(false);
  const [environments, setEnvironments] = useState(false);
  const [problems, setProblems] = useState<WorkbenchProblem[]>([]);
  const [cacheWarning, setCacheWarning] = useState("");
  const [catalogue, setCatalogue] = useState(false);
  const [catalogueMode, setCatalogueMode] = useState<"search" | "link">("search");
  const [problemId, setProblemId] = useState("");
  const [language, setLanguage] = useState<Language>("rust");
  const [solutionSelections,setSolutionSelections] = useState<Record<string,string>>({});
  const solutionGroup = JSON.stringify([problemId,language]);
  const solution = solutionSelections[solutionGroup] ?? "default";
  const selectSolution = (id:string) => setSolutionSelections(current => ({...current,[solutionGroup]:id}));
  const [tab, setTab] = useState("problem");
  const [focus, setFocus] = useState(false);
  const [revision, refresh] = useState(0);
  const [status, setStatus] = useState("正在读取");
  const [loading, setLoading] = useState(true);
  const documents = useRef(new Map<string, Document>());
  const persisted = useRef(new Map<string, string | null>());
  const sequence = useRef(0);
  const notes = useRef(new Map<string, string>());
  const queue = useRef(new SaveQueue());
  const activeKey = problemId ? draftKey({ account: "local", problem: problemId, language, solution }) : "";
  const selected = useRef(activeKey); selected.current = activeKey;
  const problem = problems.find(p => p.id === problemId);
  const baseTemplate = officialTemplate(problem?.official.codeSnippets,language);
  const baseCode = baseTemplate ?? "";
  const doc = documents.current.get(activeKey) ?? { code: baseCode, notes: notes.current.get(problemId) ?? "" };

  const judge = useOnlineJudge({ identity, question: problem?.official, language, solution, code: doc.code });
  const editorLoading = !problem || loading || !documents.current.has(activeKey);

  useEffect(() => {
    let alive = true;
    if (!problemId) { setLoading(false); setStatus("选择题目"); return; }
    setLoading(true);
    queue.current.idle.then(async () => {
      if (!documents.current.has(activeKey)) {
        if (isTauri()) {
          const loaded = await invoke<{code: string | null; notes: string | null}>("load_document", { problem: problemId, language, solution });
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
        official: q, cached: true,
      }))]);
      if (items.length) setProblemId(current => current || "lc-" + items[0].questionId);
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
        await invoke("save_text", { problem: problemId, language, solution, kind, text, expected: persisted.current.get(saveKey) ?? null });
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
  async function readConflict(target: Omit<FileConflict, "local" | "external">): Promise<FileConflict> {
    await queue.current.idle;
    const loaded = await invoke<{ code: string | null; notes: string | null }>("load_document", { problem: target.problem, language: target.language, solution: target.solution });
    const local = target.kind === "notes" ? notes.current.get(target.problem) ?? "" : documents.current.get(target.key)?.code ?? "";
    return { ...target, local, external: loaded[target.kind] };
  }
  async function openConflict(kind: "code" | "notes") {
    const token = ++conflictSequence.current, key = activeKey;
    try {
      const value = await readConflict({ key, saveKey: kind === "notes" ? problemId + "/notes" : key, problem: problemId, language, solution, kind });
      if (token === conflictSequence.current && selected.current === key) setConflict(value);
    } catch (e) { if (selected.current === key) setStatus("无法读取对比：" + String(e)); }
  }
  async function resolveConflict(choice: "local" | "external") {
    if (!conflict) return;
    const current = conflict;
    const currentText = () => current.kind === "notes" ? notes.current.get(current.problem) ?? "" : documents.current.get(current.key)?.code ?? "";
    await queue.current.idle;
    if (currentText() !== current.local) throw new Error("编辑器内容已改变，请先刷新对比");
    const resolved = await invoke<{ text: string | null; backup: string }>("resolve_file_conflict", {
      problem: current.problem, language: current.language, solution: current.solution, kind: current.kind,
      expected: current.external, local: current.local, choice,
    });
    persisted.current.set(current.saveKey, resolved.text);
    if (currentText() !== current.local) {
      setConflict({ ...current, local: currentText(), external: resolved.text });
      throw new Error("处理期间编辑器又有更新，新草稿仍被保留，请重新确认");
    }
    queue.current.discard(current.saveKey);
    const text = resolved.text ?? "";
    if (current.kind === "notes") {
      notes.current.set(current.problem, text);
      for (const [key, value] of documents.current) if (JSON.parse(key)[1] === current.problem) documents.current.set(key, { ...value, notes: text });
    } else {
      const previous = documents.current.get(current.key);
      if (previous) documents.current.set(current.key, { ...previous, code: text });
    }
    ++conflictSequence.current; setConflict(null); reloadEditors(n => n + 1); refresh(n => n + 1);
    if (selected.current === current.key) setStatus("已处理冲突 · 两份内容已保留");
  }


  async function openRecovery(kind: "code" | "notes") {
    const key = activeKey;
    try {
      const target = await readConflict({ key, saveKey: kind === "notes" ? problemId + "/notes" : key, problem: problemId, language, solution, kind });
      if (selected.current === key) setRecovery(target);
    } catch (e) { if (selected.current === key) setStatus("无法打开恢复副本：" + String(e)); }
  }
  async function restoreRecovery(id: string, side: "local" | "external", reviewed: string | null) {
    if (!recovery) return;
    const target = recovery;
    const currentText = () => target.kind === "notes" ? notes.current.get(target.problem) ?? "" : documents.current.get(target.key)?.code ?? "";
    await queue.current.idle;
    if (selected.current !== target.key || currentText() !== target.local) throw new Error("当前草稿已变化，请刷新记录与当前版本");
    const result = await invoke<{ text: string | null; backup: string }>("restore_recovery", {
      problem: target.problem, language: target.language, solution: target.solution, kind: target.kind, id, side, reviewed, expected: target.external, local: target.local,
    });
    persisted.current.set(target.saveKey, result.text);
    if (currentText() !== target.local) {
      setRecovery({ ...target, local: currentText(), external: result.text });
      throw new Error("恢复期间编辑器又有更新，新草稿仍被保留，请刷新后确认");
    }
    queue.current.discard(target.saveKey);
    const text = result.text ?? "";
    if (target.kind === "notes") {
      notes.current.set(target.problem, text);
      for (const [key, value] of documents.current) if (JSON.parse(key)[1] === target.problem) documents.current.set(key, { ...value, notes: text });
    } else {
      const previous = documents.current.get(target.key);
      if (previous) documents.current.set(target.key, { ...previous, code: text });
    }
    setRecovery(null); reloadEditors(n => n + 1); refresh(n => n + 1);
    if (selected.current === target.key) setStatus("已恢复所选副本 · 恢复前的两份内容仍已保留");
  }

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<boolean>("external_editor_supported").then(value => { if (alive) setExternalEditors(value); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function refreshExternalNotes() {
    if (!isTauri() || editorLoading || conflict || recovery || refreshingNotes.current) return;
    refreshingNotes.current = true;
    const key = activeKey, target = problemId, saveKey = target + "/notes";
    try {
      await queue.current.idle;
      if (selected.current !== key) return;
      const generation = sequence.current, baseline = persisted.current.get(saveKey) ?? null;
      const local = notes.current.get(target) ?? "";
      const loaded = await invoke<{ code: string | null; notes: string | null }>("load_document", { problem: target, language });
      if (selected.current !== key || sequence.current !== generation || notes.current.get(target) !== local) return;
      if (loaded.notes === baseline) return;
      if (local === (baseline ?? "") && !queue.current.failed(saveKey) && loaded.notes !== null) {
        notes.current.set(target, loaded.notes); persisted.current.set(saveKey, loaded.notes);
        for (const [entryKey, value] of documents.current) if (JSON.parse(entryKey)[1] === target) documents.current.set(entryKey, { ...value, notes: loaded.notes });
        reloadNotes(n => n + 1); refresh(n => n + 1); setStatus("已重新读取外部笔记");
      } else {
        queue.current.block(saveKey); refresh(n => n + 1);
        setStatus("外部笔记已变化 · 请对比两份内容后处理");
      }
    } catch (e) { if (selected.current === key) setStatus("外部笔记读取失败：" + String(e)); }
    finally { refreshingNotes.current = false; }
  }
  useEffect(() => {
    if (!externalEditors || editorLoading || conflict || recovery) return;
    const onFocus = () => { void refreshExternalNotes(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [externalEditors, editorLoading, conflict, recovery, activeKey]);
  async function openExternalNotes(editor: "default" | "typora") {
    if (openingNotes.current) return;
    openingNotes.current = true;
    const key = activeKey, target = problemId;
    try {
      await queue.current.idle;
      if (queue.current.failed(target + "/notes")) throw new Error("请先处理笔记保存失败或文件冲突");
      await invoke("open_note_external", { problem: target, editor });
      // Opening a new empty notes.md establishes an empty persisted baseline.
      if (persisted.current.get(target + "/notes") === null && (notes.current.get(target) ?? "") === "") persisted.current.set(target + "/notes", "");
      if (selected.current === key) setStatus("已请求外部编辑器打开笔记 · 返回时自动检查更新");
    } catch (e) { if (selected.current === key) setStatus(String(e)); }
    finally { openingNotes.current = false; }
  }
  function chooseQuestion(question: RemoteQuestion, warning?: string | null, fromCache = false) {
    const entry: WorkbenchProblem = { id: "lc-" + question.questionId, number: question.questionFrontendId, title: question.translatedTitle || question.title, official: question, cached: fromCache };
    setCacheWarning(warning ?? "");
    setProblems(current => [...current.filter(p => p.id !== entry.id), entry]);
    setProblemId(entry.id); setTab("problem");
  }
  function settingsRun(action: () => void) { setSettings(null); action(); }
  const settingsActions: SettingsAction[] = [
    { id:"font", label:"Intel One Mono", section:"editor", icon:"type", run:() => settingsRun(() => setFontInfo(true)) },
    { id:"environment", label:"开发环境", section:"environment", icon:"terminal", dataAction:"open-environments", run:() => settingsRun(() => setEnvironments(true)) },
    { id:"reconnect", label:"重连语言服务", section:"environment", icon:"refresh", disabled:editorLoading, run:() => settingsRun(() => setReconnectToken(n => n + 1)) },
    { id:"source-recovery", label:"恢复副本", section:"files", icon:"history", dataAction:"code-recovery", disabled:editorLoading || !isTauri(), run:() => settingsRun(() => void openRecovery("code")) },
    { id:"source-export", label:"导出源码", section:"files", icon:"download", disabled:editorLoading, run:() => settingsRun(() => download("solution." + languages.find(l => l.id === language)!.extension,doc.code)) },
    { id:"notes-export", label:"导出 Markdown", section:"notes", icon:"download", disabled:editorLoading, run:() => settingsRun(() => download("notes.md",notes.current.get(problemId) ?? "")) },
    { id:"notes-recovery", label:"恢复笔记副本", section:"notes", icon:"history", dataAction:"notes-recovery", disabled:editorLoading || !isTauri(), run:() => settingsRun(() => void openRecovery("notes")) },
    { id:"typora", label:"Typora 编辑", section:"notes", icon:"edit", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void openExternalNotes("typora")) },
    { id:"external-editor", label:"系统编辑器", section:"notes", icon:"file", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void openExternalNotes("default")) },
    { id:"refresh-notes", label:"刷新文件", section:"notes", icon:"refresh", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void refreshExternalNotes()) },
  ];
  return <main className={focus ? "workbench focus" : "workbench"}>
    <header className="topbar"><div className="brand-group"><IconButton icon="panel" label={focus ? "退出专注" : "专注"} onClick={() => setFocus(!focus)} /><strong>墨题</strong></div>
      <div><Login onIdentity={setIdentity} /><IconButton icon="search" label="中国站题库" disabled={!isTauri()} data-action="open-catalogue" onClick={() => { setCatalogueMode("search"); setCatalogue(true); }} /><IconButton icon="link" label="链接打开" disabled={!isTauri()} data-action="open-link" onClick={() => { setCatalogueMode("link"); setCatalogue(true); }} /><IconButton icon="settings" label="设置" data-action="open-settings" onClick={() => setSettings("editor")} /></div>
    </header>
    <QuestionSidebar account={identity?.account ?? null} recent={problems} selected={problemId} onSelectRecent={setProblemId} onChoose={chooseQuestion} />

    <nav className="tabs" aria-label="工作区">{[["problem","题目"],["code","代码"],["notes","笔记"]].map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <section className={"reading " + (tab === "code" ? "mobile-hidden" : "")}>
      {!problem ? <div className="workspace-empty"><span>选择一道题目</span><IconButton icon="link" label="打开题目链接" disabled={!isTauri()} onClick={() => { setCatalogueMode("link"); setCatalogue(true); }} /></div> : tab === "notes" ? <Notes onSettings={() => setSettings("notes")} onRecovery={isTauri() ? () => void openRecovery("notes") : undefined} key={problemId + ":" + reload + ":" + noteRevision} externalEditors={externalEditors} onExternal={editor => void openExternalNotes(editor)} onReload={() => void refreshExternalNotes()} documentKey={problemId + "/notes"} value={notes.current.get(problemId) ?? ""} loading={editorLoading} onChange={text => edit("notes", text)} onExport={() => download("notes.md", notes.current.get(problemId) ?? "")} /> :
      <article>{problem.cached && <p className="cache-warning" title="本机公开题面缓存">已缓存题面</p>}<QuestionStatement question={problem.official} /></article>}
      {cacheWarning && <p className="cache-warning error" role="alert">{cacheWarning}</p>}
    </section>
    <section className={"code-pane " + (tab !== "code" ? "mobile-hidden" : "")}>
      <div className="pane-heading"><div className="document-selectors"><select aria-label="编程语言" value={language} onChange={e => setLanguage(e.target.value as Language)}>{languages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select>{problem && <SolutionPicker key={solutionGroup} problem={problemId} language={language} value={solution} code={doc.code} template={baseCode} templateAvailable={baseTemplate!==null} disabled={editorLoading} onChange={selectSolution} onCreated={(entry,text) => {
        const key=draftKey({account:"local",problem:problemId,language,solution:entry.id});
        documents.current.set(key,{code:text,notes:notes.current.get(problemId)??""});
        persisted.current.set(key,isTauri()?text:null);selectSolution(entry.id);
      }} />}</div><div className="actions"><IconButton icon="terminal" label="本地" disabled={editorLoading || !["python3", "golang", "cpp", "c", "rust", "java"].includes(language) || !isTauri()} onClick={() => setLocalRunner(v => !v)} title="本地运行与调试" /><button disabled={editorLoading || !identity || !problem?.official || judge.busy || judge.blocked} onClick={judge.run} title="将当前代码与用例发送到中国站运行">运行</button><button disabled={editorLoading || !identity || !problem?.official || judge.busy || judge.blocked} className="primary" onClick={judge.submit} title="确认后正式提交到中国站">提交</button></div></div>
      {problem && baseTemplate===null && !doc.code.trim() && <p className="error" role="alert">官方模板不可用</p>}
      {!problem ? <div className="workspace-empty" aria-label="尚未打开题目" /> : editorLoading ? <p className="loading">正在读取草稿…</p> : <CodeEditor onSettings={() => setSettings("environment")} onStatus={setLanguageStatus} reconnectToken={reconnectToken} key={activeKey + ":" + reload} documentKey={activeKey} language={language} metadata={problem.official?.metaData ?? '{"inkleetFunctionStyle":"free","params":[]}' } label="代码编辑器" breakpoints={points.current.get(activeKey) ?? []} onBreakpoints={lines => { points.current.set(activeKey, lines); updatePoints(n => n + 1); }} pausedLine={paused.key === activeKey ? paused.line : 0} value={doc.code} onChange={text => edit("code", text)} />}
      {localRunner && problem && <LocalRunner onSettings={() => setSettings("debug")} breakpoints={points.current.get(activeKey) ?? []} onPauseLine={line => setPaused({ key: activeKey, line })} key={activeKey} documentKey={activeKey} code={doc.code} language={language} title={problem.title} metadata={localMetadata(problem.official.metaData ?? "", language, problem.official.codeSnippets?.find(s => s.langSlug === language)?.code)} sampleInput={problem.official.sampleTestCase ?? ""} onClose={() => setLocalRunner(false)} />}
      {judge.panel}
    </section>
    {settings && <SettingsHub initial={settings} languageStatus={languageStatus} onClose={() => setSettings(null)} actions={settingsActions} />}
    {environments && <Environments onClose={() => setEnvironments(false)} />}
    {fontInfo && <FontInfo onClose={() => setFontInfo(false)} />}
    {catalogue && <Catalogue initialMode={catalogueMode} onChoose={chooseQuestion} onClose={() => setCatalogue(false)} />}
    {recovery && <RecoveryDialog target={recovery} onClose={() => setRecovery(null)} onRefresh={async () => { setRecovery(await readConflict(recovery)); }} onRestore={restoreRecovery} />}
    {conflict && <ConflictDialog conflict={conflict} onClose={() => { ++conflictSequence.current; setConflict(null); }} onRefresh={async () => { setConflict(await readConflict(conflict)); }} onResolve={resolveConflict} />}
    <footer className="statusbar" role="status" data-storage-state={status}><span>{["选择题目", "已读取本机文件", "已保存到本机文件", "已处理冲突 · 两份内容已保留", "已恢复所选副本 · 恢复前的两份内容仍已保留", "已重新读取外部笔记", "已请求外部编辑器打开笔记 · 返回时自动检查更新"].includes(status) ? "" : status}{queue.current.failed(activeKey) && <button data-action="review-code-conflict" onClick={() => void openConflict("code")}>对比源码</button>}{queue.current.failed(problemId + "/notes") && <button data-action="review-notes-conflict" onClick={() => void openConflict("notes")}>对比笔记</button>}{(queue.current.failed(activeKey) || queue.current.failed(problemId + "/notes")) && <button onClick={retrySave}>重试保存</button>}</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
