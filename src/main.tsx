import {CopyAIContext} from "./copy-ai-context";
import {buildAIContext} from "./ai-context";
import {statementText} from "./ai-context-html";
import {editorText,hasRecoveryEdits} from "./editor-text";
import {sameBreakpointLines} from "./breakpoint-lines";
import {CodeSignals,useCodeEmpty} from "./live-code";
import {EditorStatus} from "./editor-status";
import {getCurrentWindow} from "@tauri-apps/api/window";
import type { DebugPosition } from "./debug-position";
import { formatEnabled, validateEditorSettings, type EditorSettings, type EditorSettingsSnapshot } from "./format-settings";
import { officialTemplate } from "./official-template";
import { SolutionPicker } from "./solution-picker";
import { QuestionSidebar } from "./question-sidebar";
import { Icon, IconButton } from "./icons";
import { SettingsHub, type SettingsSection, type SettingsAction } from "./settings-hub";
import { UserManual } from "./user-manual";
import { RecoveryDialog } from "./recovery";
import { ConflictDialog, type FileConflict } from "./conflict";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { languages, draftKey, type Language } from "./domain";
import "./style.css";
import { SaveQueue } from "./save-queue";
import { CodeEditor, type EditorLanguageStatus } from "./editor";
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
type RecoveredDraft={text:string;baseline:string|null};
type LoadedDocument={code:string|null;notes:string|null;codeDraft?:RecoveredDraft|null;notesDraft?:RecoveredDraft|null;draftWarnings?:string[]};
type SaveTarget={key:string;problem:string;language:string;solution?:string;kind:"code"|"notes"};
type PendingNoteSave={target:SaveTarget;text:string;resolve:(saved:boolean)=>void};
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
  const [manual, setManual] = useState(false);
  const [editorSettings,setEditorSettings]=useState<EditorSettingsSnapshot|null>(null);
  const settingsVersion=useRef(0);
  const [formatConfigError,setFormatConfigError]=useState("");
  const [formatMessage,setFormatMessage]=useState("");
  const [languageStatusSnapshot,setLanguageStatusSnapshot]=useState<EditorLanguageStatus>({owner:"",text:""});
  const [reconnectToken, setReconnectToken] = useState(0);
  const points = useRef(new Map<string, number[]>());
  const [, updatePoints] = useState(0);
  const [paused, setPaused] = useState<{key:string;position:DebugPosition|null}>({key:"",position:null});
  const [localOpened,setLocalOpened]=useState(false);
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
  const codeSignals=useRef(new CodeSignals());
  const persisted = useRef(new Map<string, string | null>());
  const sequence = useRef(0);
  const notes = useRef(new Map<string, string>());
  const queue = useRef(new SaveQueue()),draftQueue=useRef(new SaveQueue());
  const clean=useRef(new Map<string,string>()),dirty=useRef(new Set<string>()),saving=useRef(new Set<string>()),draftRevision=useRef(0);
  const pendingNoteSaves=useRef(new Map<string,PendingNoteSave>());
  const draftEpoch=useRef<Promise<number>|null>(null);
  const sourceSave=useRef<(()=>boolean)|null>(null);
  const [draftError,setDraftError]=useState(""),[closeRequested,setCloseRequested]=useState(false),[closing,setClosing]=useState(false);
  const shuttingDown=useRef(false),formatEpoch=useRef(0),failedDrafts=useRef(new Set<string>());
  const closeAllowed=useRef(false),closeDialog=useRef<HTMLDialogElement>(null);
  const activeKey = problemId ? draftKey({ account: "local", problem: problemId, language, solution }) : "";
  const selected = useRef(activeKey); selected.current = activeKey;
  const problem = problems.find(p => p.id === problemId);
  const baseTemplate = officialTemplate(problem?.official.codeSnippets,language);
  const baseCode = editorText(baseTemplate ?? "");
  const doc = documents.current.get(activeKey) ?? { code: baseCode, notes: notes.current.get(problemId) ?? "" };

  const codeSource=useMemo(()=>codeSignals.current.source(activeKey,()=>documents.current.get(activeKey)?.code??baseCode),[activeKey,baseCode]);
  const sourceEmpty=useCodeEmpty(codeSource,baseTemplate===null);
  const judge = useOnlineJudge({ identity, question: problem?.official, language, solution, codeSource });
  const editorLoading = !problem || loading || !documents.current.has(activeKey);
  const languageStatusOwner=JSON.stringify([activeKey,reload,reconnectToken]);
  const languageStatus=!editorLoading&&languageStatusSnapshot.owner===languageStatusOwner?languageStatusSnapshot.text:"";
  const judgeDisabledReason=!problem?.official?"请先打开力扣题目":editorLoading?"正在读取源码":!identity?"请先登录并验证 LeetCode 账号":judge.busy?"正在处理当前评测":judge.blockedReason;

  useEffect(()=>{
    let alive=true;const token=++settingsVersion.current;
    if(isTauri())invoke("get_editor_settings").then(value=>{if(alive&&token===settingsVersion.current)setEditorSettings(validateEditorSettings(value));}).catch(error=>{if(alive&&token===settingsVersion.current)setFormatConfigError(String(error));});
    return()=>{alive=false;};
  },[]);
  async function reloadEditorSettings():Promise<EditorSettingsSnapshot|null>{
    const token=++settingsVersion.current;
    try{
      const value=validateEditorSettings(await invoke("get_editor_settings"));
      if(token!==settingsVersion.current)return null;
      setEditorSettings(value);setFormatConfigError("");return value;
    }catch(error){
      if(token!==settingsVersion.current)return null;
      setFormatConfigError(String(error));throw error;
    }
  }
  async function saveEditorSettings(settings:EditorSettings){
    const token=++settingsVersion.current;
    const saved=validateEditorSettings(await invoke("save_editor_settings",{settings,expected:editorSettings?.revision??null}));
    if(token===settingsVersion.current){setEditorSettings(saved);setFormatConfigError("");}
  }
  function currentText(target:SaveTarget){return target.kind==="notes"?notes.current.get(target.problem)??"":documents.current.get(target.key)?.code??"";}
  function storageKey(target:SaveTarget){return target.kind==="notes"?target.problem+"/notes":target.key;}
  function reconcileDirty(target:SaveTarget){const key=storageKey(target);if(currentText(target)===(clean.current.get(key)??""))dirty.current.delete(key);else dirty.current.add(key);}
  function checkpoint(target:SaveTarget,text:string,baseline:string|null){
    if(!isTauri())return;
    const key=storageKey(target),version=++draftRevision.current;
    draftQueue.current.enqueue({key,write:async()=>{
      if(!draftEpoch.current)draftEpoch.current=invoke<number>("begin_draft_session").catch(error=>{draftEpoch.current=null;throw error;});
      const epoch=await draftEpoch.current;
      await invoke("checkpoint_draft",{problem:target.problem,language:target.language,solution:target.solution,kind:target.kind,text,baseline,epoch,revision:version});
    },
      saved:()=>{failedDrafts.current.delete(key);void draftQueue.current.idle.then(()=>{if(!draftQueue.current.busy)setDraftError("");});},
      failed:error=>{failedDrafts.current.add(key);setDraftError("恢复草稿未写入 · "+String(error).slice(0,200));}});
  }
  async function saveSnapshot(kind:"code"|"notes",text:string):Promise<boolean>{
    const target:SaveTarget={key:activeKey,problem:problemId,language,solution,kind},key=storageKey(target);
    if(shuttingDown.current||!isTauri()||selected.current!==target.key||currentText(target)!==text)return false;
    if(queue.current.failed(key)){setStatus("请先处理保存失败或文件冲突");return false;}
    if(saving.current.has(key)){
      if(kind!=="notes")return false; // Source formatting owns its own save-intent queue.
      return new Promise(resolve=>{
        pendingNoteSaves.current.get(key)?.resolve(false);
        pendingNoteSaves.current.set(key,{target,text,resolve});
        setStatus("已排队保存笔记");
      });
    }
    return saveOwnedSnapshot(target,text);
  }
  function saveOwnedSnapshot(target:SaveTarget,text:string):Promise<boolean>{
    const key=storageKey(target),kind=target.kind;
    saving.current.add(key);if(selected.current===target.key)setStatus("保存中");
    return new Promise(resolve=>queue.current.enqueue({key,write:async()=>{
      await invoke("save_text",{problem:target.problem,language:target.language,solution:target.solution,kind,text,expected:persisted.current.get(key)??null});
      persisted.current.set(key,text);clean.current.set(key,text);reconcileDirty(target);
      // A newer live draft must never be cleared by completion of an older save.
      checkpoint(target,currentText(target),text);
    },saved:()=>{
      saving.current.delete(key);refresh(n=>n+1);
      if(selected.current===target.key)setStatus(dirty.current.has(key)?"已保存快照 · 仍有未保存修改":"已保存到本机文件");
      resolve(true);
      const next=pendingNoteSaves.current.get(key);pendingNoteSaves.current.delete(key);
      // Enqueue synchronously before SaveQueue becomes idle. Closing/switching
      // must wait for already requested snapshots, never save later plain edits.
      if(next)void saveOwnedSnapshot(next.target,next.text).then(next.resolve);
    },
    failed:()=>{
      saving.current.delete(key);
      const next=pendingNoteSaves.current.get(key);pendingNoteSaves.current.delete(key);next?.resolve(false);
      dirty.current.add(key);refresh(n=>n+1);
      if(selected.current===target.key)setStatus("保存失败 · 草稿仍在，请先导出");
      resolve(false);
    }}));
  }
  useEffect(()=>{setFormatMessage("");},[activeKey]);

  useEffect(() => {
    let alive = true;
    if (!problemId) { setLoading(false); setStatus("选择题目"); return; }
    setLoading(true);
    queue.current.idle.then(async () => {
      if (!documents.current.has(activeKey)) {
        if (isTauri()) {
          const loaded = await invoke<LoadedDocument>("load_document", { problem: problemId, language, solution });
          // 迟到的读取不能覆盖已打开/已编辑的草稿；笔记跨语言共享，不能被新语言读取重置。
          if (!notes.current.has(problemId)) {
            const key=problemId+"/notes",recovered=hasRecoveryEdits(loaded.notesDraft,loaded.notes)?loaded.notesDraft:null;
            notes.current.set(problemId,editorText(recovered?.text??loaded.notes??""));
            persisted.current.set(key,loaded.notes);clean.current.set(key,editorText(loaded.notes??""));
            if(recovered){dirty.current.add(key);if(recovered.baseline!==loaded.notes){persisted.current.set(key,recovered.baseline);queue.current.block(key);}}
          }
          if (!documents.current.has(activeKey)) {
            const recovered=hasRecoveryEdits(loaded.codeDraft,loaded.code)?loaded.codeDraft:null;
            documents.current.set(activeKey,{code:editorText(recovered?.text??loaded.code??baseCode),notes:notes.current.get(problemId)??""});
            persisted.current.set(activeKey,loaded.code);clean.current.set(activeKey,editorText(loaded.code??baseCode));
            if(recovered){dirty.current.add(activeKey);if(recovered.baseline!==loaded.code){persisted.current.set(activeKey,recovered.baseline);queue.current.block(activeKey);}}
            if(loaded.draftWarnings?.length)setDraftError(loaded.draftWarnings.join(" · "));
          }
        } else {
          documents.current.set(activeKey, { code: baseCode, notes: notes.current.get(problemId) ?? "" });clean.current.set(activeKey,baseCode);clean.current.set(problemId+"/notes",notes.current.get(problemId)??"");
        }
      }
      codeSignals.current.notify(activeKey);
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

  function edit(kind:"code"|"notes",text:string){
    const target:SaveTarget={key:activeKey,problem:problemId,language,solution,kind};
    const previous=documents.current.get(activeKey)??doc;
    const wasDirty=dirty.current.has(storageKey(target));
    documents.current.set(activeKey,{...previous,[kind]:text});
    if(kind==="notes")notes.current.set(problemId,text);
    ++sequence.current;reconcileDirty(target);
    if(kind==="code")codeSignals.current.notify(target.key);
    if(kind==="notes"||wasDirty!==dirty.current.has(storageKey(target)))refresh(r=>r+1);
    checkpoint(target,text,persisted.current.get(storageKey(target))??null);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current.size||queue.current.busy||draftQueue.current.busy) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function retrySave(){
    await queue.current.idle;
    for(const key of [activeKey,problemId+"/notes"]){if(queue.current.failed(key))queue.current.discard(key);draftQueue.current.retry(key);}
    sourceSave.current?.();
    if(dirty.current.has(problemId+"/notes"))void saveSnapshot("notes",notes.current.get(problemId)??"");
  }
  useEffect(()=>{
    if(!isTauri()||!(window as unknown as {__TAURI_INTERNALS__?:{metadata?:unknown}}).__TAURI_INTERNALS__?.metadata)return;let alive=true,unlisten:(()=>void)|undefined;
    getCurrentWindow().onCloseRequested(event=>{
      if(closeAllowed.current)return;
      if(dirty.current.size||queue.current.busy||draftQueue.current.busy){event.preventDefault();setCloseRequested(true);}
    }).then(stop=>{if(alive)unlisten=stop;else stop();}).catch(error=>setDraftError("关闭保护不可用 · "+String(error)));
    return()=>{alive=false;unlisten?.();};
  },[]);
  useEffect(()=>{if(closeRequested&&!closeDialog.current?.open)closeDialog.current?.showModal();},[closeRequested]);
  async function closeWithDrafts(){
    if(shuttingDown.current)return;shuttingDown.current=true;++formatEpoch.current;setClosing(true);
    try{
      await queue.current.idle;await draftQueue.current.idle;
      if(draftQueue.current.busy||saving.current.size>0)throw Error("请先处理草稿或文件保存错误，或导出内容");
      closeAllowed.current=true;await getCurrentWindow().close();
    }catch(error){shuttingDown.current=false;closeAllowed.current=false;setDraftError(String(error));}
    finally{setClosing(false);}
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
    persisted.current.set(current.saveKey, resolved.text);clean.current.set(current.saveKey,editorText(resolved.text??""));
    if (currentText() !== current.local) {
      reconcileDirty(current);checkpoint(current,currentText(),resolved.text);refresh(n=>n+1);
      setConflict({ ...current, local: currentText(), external: resolved.text });
      throw new Error("处理期间编辑器又有更新，新草稿仍被保留，请重新确认");
    }
    queue.current.discard(current.saveKey);
    const text = editorText(resolved.text ?? "");
    if (current.kind === "notes") {
      notes.current.set(current.problem, text);
      for (const [key, value] of documents.current) if (JSON.parse(key)[1] === current.problem) documents.current.set(key, { ...value, notes: text });
    } else {
      const previous = documents.current.get(current.key);
      if (previous) documents.current.set(current.key, { ...previous, code: text });
    }
    reconcileDirty({...current});checkpoint({...current},text,resolved.text);if(current.kind==="code")codeSignals.current.notify(current.key);
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
    persisted.current.set(target.saveKey, result.text);clean.current.set(target.saveKey,editorText(result.text??""));
    if (currentText() !== target.local) {
      reconcileDirty(target);checkpoint(target,currentText(),result.text);refresh(n=>n+1);
      setRecovery({ ...target, local: currentText(), external: result.text });
      throw new Error("恢复期间编辑器又有更新，新草稿仍被保留，请刷新后确认");
    }
    queue.current.discard(target.saveKey);
    const text = editorText(result.text ?? "");
    if (target.kind === "notes") {
      notes.current.set(target.problem, text);
      for (const [key, value] of documents.current) if (JSON.parse(key)[1] === target.problem) documents.current.set(key, { ...value, notes: text });
    } else {
      const previous = documents.current.get(target.key);
      if (previous) documents.current.set(target.key, { ...previous, code: text });
    }
    reconcileDirty({...target});checkpoint({...target},text,result.text);if(target.kind==="code")codeSignals.current.notify(target.key);
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
      if (local === editorText(baseline ?? "") && !queue.current.failed(saveKey) && loaded.notes !== null) {
        notes.current.set(target, editorText(loaded.notes)); persisted.current.set(saveKey, loaded.notes);clean.current.set(saveKey,editorText(loaded.notes));dirty.current.delete(saveKey);
        for (const [entryKey, value] of documents.current) if (JSON.parse(entryKey)[1] === target) documents.current.set(entryKey, { ...value, notes: editorText(loaded.notes) });
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
      if(dirty.current.has(target+"/notes"))throw new Error("请先保存笔记，再用外部编辑器打开");
      await invoke("open_note_external", { problem: target, editor });
      // Opening a new empty notes.md establishes an empty persisted baseline.
      if (persisted.current.get(target + "/notes") === null && (notes.current.get(target) ?? "") === "") persisted.current.set(target + "/notes", "");
      if (selected.current === key) setStatus("已请求外部编辑器打开笔记 · 返回时自动检查更新");
    } catch (e) { if (selected.current === key) setStatus(String(e)); }
    finally { openingNotes.current = false; }
  }
  const chooseQuestion=useCallback((question: RemoteQuestion, warning?: string | null, fromCache = false) => {
    const entry: WorkbenchProblem = { id: "lc-" + question.questionId, number: question.questionFrontendId, title: question.translatedTitle || question.title, official: question, cached: fromCache };
    setCacheWarning(warning ?? "");
    setProblems(current => [...current.filter(p => p.id !== entry.id), entry]);
    setProblemId(entry.id); setTab("problem");
  },[]);
  function settingsRun(action: () => void) { setSettings(null); action(); }
  function copyContextSnapshot(){
    if(!problem||editorLoading||selected.current!==activeKey)throw new Error("Document changed");
    const q=problem.official,raw=q.translatedContent||q.content||"";
    return buildAIContext({number:q.questionFrontendId,title:q.translatedTitle||q.title,originalTitle:q.title,
      url:"https://leetcode.cn/problems/"+encodeURIComponent(q.titleSlug)+"/",difficulty:q.difficulty,
      statement:statementText(raw),hasVisuals:/<(?:img|svg|math)\b/i.test(raw),
      sampleInput:q.sampleTestCase,exampleInputs:q.exampleTestcases,
      language:languages.find(item=>item.id===language)!.label,code:codeSource.read(),notes:notes.current.get(problemId)??""});
  }
  const settingsActions: SettingsAction[] = [
    { id:"font", label:"Intel One Mono", section:"editor", icon:"type", run:() => settingsRun(() => setFontInfo(true)) },
    { id:"environment", label:"开发环境", section:"environment", icon:"terminal", dataAction:"open-environments", run:() => settingsRun(() => setEnvironments(true)) },
    { id:"reconnect", label:"重连语言服务", section:"environment", icon:"refresh", disabled:editorLoading, run:() => settingsRun(() => setReconnectToken(n => n + 1)) },
    { id:"source-recovery", label:"恢复副本", section:"files", icon:"history", dataAction:"code-recovery", disabled:editorLoading || !isTauri(), run:() => settingsRun(() => void openRecovery("code")) },
    { id:"source-export", label:"导出源码", section:"files", icon:"download", disabled:editorLoading, run:() => settingsRun(() => download("solution." + languages.find(l => l.id === language)!.extension,codeSource.read())) },
    { id:"notes-export", label:"导出 Markdown", section:"notes", icon:"download", disabled:editorLoading, run:() => settingsRun(() => download("notes.md",notes.current.get(problemId) ?? "")) },
    { id:"notes-recovery", label:"恢复笔记副本", section:"notes", icon:"history", dataAction:"notes-recovery", disabled:editorLoading || !isTauri(), run:() => settingsRun(() => void openRecovery("notes")) },
    { id:"typora", label:"Typora 编辑", section:"notes", icon:"edit", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void openExternalNotes("typora")) },
    { id:"external-editor", label:"系统编辑器", section:"notes", icon:"file", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void openExternalNotes("default")) },
    { id:"refresh-notes", label:"刷新文件", section:"notes", icon:"refresh", disabled:editorLoading || !externalEditors, run:() => settingsRun(() => void refreshExternalNotes()) },
  ];
  return <main className={focus ? "workbench focus" : "workbench"}>
    <header className="topbar"><div className="brand-group"><IconButton icon="panel" label={focus ? "退出专注" : "专注"} onClick={() => setFocus(!focus)} /><span className="brand-mark" role="img" aria-label="墨题 InkLeet" title="墨题 InkLeet"><Icon name="inkleet" /></span></div>
      <div><Login onIdentity={setIdentity} /><IconButton icon="search" label="中国站题库" disabled={!isTauri()} data-action="open-catalogue" onClick={() => { setCatalogueMode("search"); setCatalogue(true); }} /><IconButton icon="link" label="链接打开" disabled={!isTauri()} data-action="open-link" onClick={() => { setCatalogueMode("link"); setCatalogue(true); }} /><IconButton icon="settings" label="设置" data-action="open-settings" onClick={() => setSettings("editor")} /></div>
    </header>
    <QuestionSidebar account={identity?.account ?? null} recent={problems} selected={problemId} onSelectRecent={setProblemId} onChoose={chooseQuestion} />

    <nav className="tabs" aria-label="工作区">{[["problem","题目"],["code","代码"],["notes","笔记"]].map(([id,label]) => <button key={id} aria-label={label} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}{id==="notes"&&dirty.current.has(problemId+"/notes")&&<span className="unsaved-mark" role="img" aria-label="笔记未保存" title="未保存" />}</button>)}</nav>
    <section className={"reading " + (tab === "code" ? "mobile-hidden" : "")}>
      {!problem ? <div className="workspace-empty"><span>选择一道题目</span><IconButton icon="link" label="打开题目链接" disabled={!isTauri()} onClick={() => { setCatalogueMode("link"); setCatalogue(true); }} /></div> : tab === "notes" ? <Notes copyAction={<CopyAIContext key={activeKey} disabled={editorLoading} snapshot={copyContextSnapshot}/>} vimEnabled={editorSettings?.settings.vim??false} tabSize={editorSettings?.settings.tabSize??4} dirty={dirty.current.has(problemId+"/notes")} onSave={()=>void saveSnapshot("notes",notes.current.get(problemId)??"")} onSettings={() => setSettings("notes")} onRecovery={isTauri() ? () => void openRecovery("notes") : undefined} key={problemId + ":" + reload + ":" + noteRevision} externalEditors={externalEditors} onExternal={editor => void openExternalNotes(editor)} onReload={() => void refreshExternalNotes()} documentKey={problemId + "/notes"} value={notes.current.get(problemId) ?? ""} loading={editorLoading} onChange={text => edit("notes", text)} onExport={() => download("notes.md", notes.current.get(problemId) ?? "")} /> :
      <article>{problem.cached && <p className="cache-warning" title="本机公开题面缓存">已缓存题面</p>}<QuestionStatement question={problem.official} /></article>}
      {cacheWarning && <p className="cache-warning error" role="alert">{cacheWarning}</p>}
    </section>
    <section className={"code-pane " + (tab !== "code" ? "mobile-hidden" : "")}>
      <div className="pane-heading"><div className="document-selectors"><select aria-label="编程语言" value={language} onChange={e => setLanguage(e.target.value as Language)}>{languages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select>{problem && <SolutionPicker key={solutionGroup} problem={problemId} language={language} value={solution} codeSource={codeSource} template={baseCode} templateAvailable={baseTemplate!==null} disabled={editorLoading} onChange={selectSolution} onCreated={(entry,text) => {
        const key=draftKey({account:"local",problem:problemId,language,solution:entry.id});
        documents.current.set(key,{code:editorText(text),notes:notes.current.get(problemId)??""});
        persisted.current.set(key,isTauri()?text:null);clean.current.set(key,editorText(text));dirty.current.delete(key);codeSignals.current.notify(key);selectSolution(entry.id);
      }} />}{dirty.current.has(activeKey)&&<span className="unsaved-mark" role="img" aria-label="源码未保存" title="未保存" />}</div><div className="actions"><CopyAIContext key={activeKey} disabled={editorLoading} snapshot={copyContextSnapshot}/><IconButton icon="save" label="保存源码" shortcut="Ctrl+S" disabled={editorLoading} onClick={()=>sourceSave.current?.()} /><IconButton icon="terminal" label="本地" disabled={editorLoading || !["python3", "golang", "cpp", "c", "rust", "java"].includes(language) || !isTauri()} aria-expanded={localRunner} onClick={() => {setLocalOpened(true);setLocalRunner(v => !v);}} title="本地运行与调试" /><button disabled={editorLoading || !identity || !problem?.official || judge.busy || judge.blocked} onClick={judge.run} title={judgeDisabledReason||"将当前代码与用例发送到中国站运行"}>运行</button><button disabled={editorLoading || !identity || !problem?.official || judge.busy || judge.blocked} className="primary" onClick={judge.submit} title={judgeDisabledReason||"确认后正式提交到中国站"}>提交</button></div></div>
      {problem && baseTemplate===null && sourceEmpty && <p className="error" role="alert">官方模板不可用</p>}
      {!problem ? <div className="workspace-empty" aria-label="尚未打开题目" /> : editorLoading ? <p className="loading">正在读取草稿…</p> : <CodeEditor vimEnabled={editorSettings?.settings.vim??false} tabSize={editorSettings?.settings.tabSize??4} onSaveReady={save=>{sourceSave.current=save;}} formatting={{epoch:()=>formatEpoch.current,ready:(save)=>!shuttingDown.current&&(!save||(!queue.current.failed(activeKey)&&!conflict&&!recovery)),enabled:formatEnabled(editorSettings?.settings??null,language),save:text=>saveSnapshot("code",text),report:setFormatMessage}} onSettings={() => setSettings("environment")} onStatus={setLanguageStatusSnapshot} statusOwner={languageStatusOwner} reconnectToken={reconnectToken} key={activeKey + ":" + reload} documentKey={activeKey} language={language} metadata={problem.official?.metaData ?? '{"inkleetFunctionStyle":"free","params":[]}' } label="代码编辑器" breakpoints={points.current.get(activeKey) ?? []} onBreakpoints={lines => { if(sameBreakpointLines(points.current.get(activeKey)??[],lines))return;points.current.set(activeKey, lines); updatePoints(n => n + 1); }} pausedPosition={paused.key === activeKey ? paused.position : null} value={doc.code} onChange={text => edit("code", text)} />}
      {localOpened && problem && <LocalRunner onReveal={()=>setLocalRunner(true)} hidden={!localRunner} onHelp={() => setManual(true)} breakpoints={points.current.get(activeKey) ?? []} onPauseLine={position => setPaused({ key: activeKey, position })} key={activeKey} documentKey={activeKey} codeSource={codeSource} language={language} title={problem.title} metadata={localMetadata(problem.official.metaData ?? "", language, problem.official.codeSnippets?.find(s => s.langSlug === language)?.code)} sampleInput={problem.official.sampleTestCase ?? ""} exampleInputs={problem.official.exampleTestcases??""} onClose={() => {setLocalRunner(false);document.querySelector<HTMLElement>('.code-pane .cm-content')?.focus();}} />}
      {judge.panel}
    </section>
    {settings && <SettingsHub editorSettings={editorSettings} editorSettingsError={formatConfigError} formattingStatus={formatMessage} onReloadEditorSettings={reloadEditorSettings} onSaveEditorSettings={saveEditorSettings} initial={settings} languageStatus={languageStatus} onClose={() => setSettings(null)} actions={settingsActions} />}
    {manual && <UserManual onClose={() => setManual(false)} />}
    {environments && <Environments onClose={() => setEnvironments(false)} />}
    {fontInfo && <FontInfo onClose={() => setFontInfo(false)} />}
    {catalogue && <Catalogue initialMode={catalogueMode} onChoose={chooseQuestion} onClose={() => setCatalogue(false)} />}
    {recovery && <RecoveryDialog target={recovery} onClose={() => setRecovery(null)} onRefresh={async () => { setRecovery(await readConflict(recovery)); }} onRestore={restoreRecovery} />}
    {conflict && <ConflictDialog conflict={conflict} onClose={() => { ++conflictSequence.current; setConflict(null); }} onRefresh={async () => { setConflict(await readConflict(conflict)); }} onResolve={resolveConflict} />}
    {closeRequested&&<dialog ref={closeDialog} className="close-drafts" aria-label="未保存更改" onCancel={event=>{event.preventDefault();if(!closing)setCloseRequested(false);}}><h3>未保存更改</h3><p>保留恢复草稿后退出？源码文件不会被覆盖。</p><button disabled={closing} onClick={()=>setCloseRequested(false)}>取消</button><button disabled={closing} onClick={()=>void closeWithDrafts()}>保留草稿并退出</button>{draftError&&<p role="alert">{draftError}</p>}</dialog>}
    <footer className="statusbar" role="status" data-storage-state={status}><EditorStatus/><div id="vim-command-slot"/><span className="storage-status">{draftError&&<span role="alert">{draftError}<button onClick={()=>{for(const key of failedDrafts.current)draftQueue.current.retry(key);}}>重试草稿</button></span>}{["选择题目", "已读取本机文件", "已保存到本机文件", "已处理冲突 · 两份内容已保留", "已恢复所选副本 · 恢复前的两份内容仍已保留", "已重新读取外部笔记", "已请求外部编辑器打开笔记 · 返回时自动检查更新"].includes(status) ? "" : status}{queue.current.failed(activeKey) && <button data-action="review-code-conflict" onClick={() => void openConflict("code")}>对比源码</button>}{queue.current.failed(problemId + "/notes") && <button data-action="review-notes-conflict" onClick={() => void openConflict("notes")}>对比笔记</button>}{(queue.current.failed(activeKey) || queue.current.failed(problemId + "/notes")) && <button onClick={retrySave}>重试保存</button>}</span>{problem&&<button type="button" className={"lsp-status "+(languageStatus.includes("已连接")?"ready":"unavailable")} data-status={languageStatus} aria-label="语言服务设置" title={languageStatus||"语言服务未启动"} onClick={()=>setSettings("environment")}><i/><span>LSP</span></button>}{(formatConfigError||formatMessage)&&<IconButton icon="info" label="格式化状态" title={formatConfigError||formatMessage} onClick={()=>setSettings("editor")} />}</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
