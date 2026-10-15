import {localResultReport,type OutputRow} from "./local-result-model";
import {validateRunContext,sameRunStatus,type RunContext} from "./run-context";
import {canonicalJson,compareJson,invocationCount,type Expectation} from "./case-expectations";
import "./case-results.css";
import {parameterNames,seedCases,validateCases,inputParts,compactCaseValue,type LocalCase} from "./test-cases";
import { useResizablePanel } from "./resizable-panel";
import type { DebugPosition } from "./debug-position";
import { Icon, IconButton } from "./icons";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DebugPanel } from "./debug-panel";
import type { Language } from "./domain";
type Snapshot = { localContext?:RunContext;clientRequestId?:string;invocationCount?:number;expectation?:Expectation|null;runId?:number;caseId?:string;caseName?:string;documentKey?: string; code: string; input: string; metadata: string; title: string; language: Language };
type Result = { documentKey?:string|null;clientRequestId?:string|null;id: number; phase: string; title: string; stdout: string; stderr: string; results: string[]; exitCode: number | null; timedOut: boolean; canceled: boolean; truncated: boolean; elapsedMs: number; error: string };
const busy = (r: Result | null) => !!r && ["queued", "compiling", "running", "canceling"].includes(r.phase);
// The report is memoized by immutable run context and deduplicated status.
const CaseResult=memo(function CaseResult({row}:{row:OutputRow}){
 const {raw,value,caseName,multiple,names,expectation,comparison}=row;
 const argumentsAfter=value.argumentsAfterCall;
 return <section className="case-result" title="本地结果不代表通过力扣判题">
  <header><span>{caseName??"用例 "+value.caseNumber}{caseName&&multiple?" · "+value.caseNumber:""}</span><span>{value.error?"执行失败":comparison?comparison.label:value.raw?"输出":argumentsAfter?.length?"调用后参数":"返回值"}</span></header>
  {row.missing?null:value.error?<pre role="alert" className="error">{value.error}</pre>:argumentsAfter?.length?<>{value.value!=="null"&&<div className="case-argument"><span>返回值</span><pre className="local-result">{value.value}</pre></div>}{argumentsAfter.map((argument,i)=><div className="case-argument" key={i}><span>{names[i]??"参数 "+(i+1)}</span><pre className="local-result" aria-label={"调用后 "+(names[i]??"参数 "+(i+1))}>{argument.unavailable?"不可读取（值已移交）":argument.value}</pre></div>)}</>:<pre className="local-result">{value.value}</pre>}
  {comparison?.state==="mismatch"&&expectation&&<div className="case-argument case-expected"><span>预期</span><pre>{expectation.value}</pre></div>}
  {!row.missing&&<details className="local-raw"><summary aria-label="查看原始结果"><Icon name="more"/></summary><pre>{raw}</pre></details>}
 </section>;
});
export function LocalRunner({ documentKey, code, language, title, metadata, sampleInput, exampleInputs = "", onClose, breakpoints, onPauseLine, onSettings, onReveal, hidden = false }: {
  onReveal?:()=>void; hidden?:boolean; documentKey?: string; onSettings?: () => void; code: string; language: Language; title: string; metadata: string; sampleInput: string; exampleInputs?:string; onClose: () => void; breakpoints: number[]; onPauseLine: (position: DebugPosition|null) => void;
}) {
  const resize=useResizablePanel("local",!hidden);
  const names=useMemo(()=>parameterNames(metadata),[metadata]),storageKey="inkleet.test-cases.v1:"+(documentKey??title+":"+language);
  const [initial]=useState(()=>{
    const fallback=seedCases(sampleInput,exampleInputs,names);
    try{const raw=localStorage.getItem(storageKey);return {...(raw?validateCases(JSON.parse(raw)):{cases:fallback,selected:fallback[0].id}),error:"",blocked:false};}
    catch{return {cases:fallback,selected:fallback[0].id,error:"用例记录不可读，原记录已保留；当前修改仅保留在内存",blocked:true};}
  });
  const [cases,setCases]=useState<LocalCase[]>(initial.cases),[selected,setSelected]=useState(initial.selected);
  const [caseError,setCaseError]=useState(initial.error),[rename,setRename]=useState<string|null>(null);
  const currentCase=cases.find(item=>item.id===selected)??cases[0],input=currentCase.input;
  function updateCases(next:LocalCase[],id=selected){
    if(next.length>64||next.reduce((n,c)=>n+c.input.length+(c.expectation?.value.length??0),0)>2*1024*1024){setCaseError("用例超过大小限制");return;}
    setCases(next);setSelected(id);
    if(!initial.blocked)try{localStorage.setItem(storageKey,JSON.stringify({version:2,cases:next,selected:id}));setCaseError("");}catch{setCaseError("用例未保存，当前修改仍保留在内存");}
  }
  function setInput(value:string){updateCases(cases.map(item=>item.id===selected?{...item,input:value}:item));}
  function setExpectation(value:string,target:Expectation["target"]=currentCase.expectation?.target??{kind:"return"}){
    if(value.length>65536){setCaseError("预期结果超过大小限制");return;}
    updateCases(cases.map(item=>item.id===selected?{...item,expectation:{mode:"exact-json",target,value}}:item));
  }
  function chooseCase(id:string){setRename(null);updateCases(cases,id);}
  function addCase(){const next={id:crypto.randomUUID(),name:"用例 "+(cases.length+1),input:currentCase.input,expectation:currentCase.expectation};updateCases([...cases,next],next.id);}
  function removeCase(){if(cases.length===1)return;const next=cases.filter(item=>item.id!==selected);updateCases(next,next[0].id);}
  const parts=useMemo(()=>inputParts(input,names),[input,names]);
  const [pane, setPane] = useState<"run" | "debug">("run");
  const [result, setResult] = useState<Result | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [context,setContext]=useState<{id:number;record:RunContext}|null>(null);
  const lastRequest=useRef<string|null>(null);
  const activeRecord=useMemo(()=>{
    if(context&&result&&context.id===result.id&&context.record.documentKey===documentKey&&result.documentKey===documentKey&&context.record.clientRequestId===result.clientRequestId)return context.record;
    if(snapshot?.runId===result?.id&&snapshot?.documentKey===documentKey&&(!result?.documentKey||result.documentKey===documentKey)&&(!result?.clientRequestId||snapshot?.clientRequestId===result.clientRequestId))return snapshot?.localContext??null;
    return null;
  },[context,result?.id,result?.documentKey,result?.clientRequestId,documentKey,snapshot]);
  const report=useMemo(()=>result?localResultReport(result,activeRecord):null,[result,activeRecord]);
  const currentPlans=useMemo(()=>cases.map(item=>({...item,expectation:item.expectation?.value.trim()?item.expectation:null})),[cases]);
  const stale=!!activeRecord&&(activeRecord.snapshot.code!==code||activeRecord.snapshot.language!==language||activeRecord.snapshot.metadata!==metadata||activeRecord.snapshot.title!==title||
    (activeRecord.mode==="all"?JSON.stringify(activeRecord.cases)!==JSON.stringify(currentPlans):
      activeRecord.cases.some(item=>JSON.stringify(item)!==JSON.stringify(currentPlans.find(current=>current.id===item.id)))||
      ((activeRecord.mode??"selected")==="selected"&&activeRecord.cases.length===1&&activeRecord.cases[0].id!==selected)));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const guard = useRef(false), alive = useRef(true), sequence = useRef(0);
  useEffect(()=>{
    let live=true;setContext(null);
    const id=result?.id,key=result?.documentKey,request=result?.clientRequestId;
    if(id&&key===documentKey&&key&&request&&isTauri()){
      void invoke<unknown>("local_run_record",{id}).then(value=>{
        if(!live)return;
        const record=validateRunContext(value,key,request);
        setContext({id,record});
        if(lastRequest.current===request)setError("");
      }).catch(error=>{if(live)setError("无法读取运行快照："+String(error));});
    }
    return ()=>{live=false;};
  },[result?.id,result?.documentKey,result?.clientRequestId,documentKey]);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = ++sequence.current;
      try {
        const next = await invoke<Result | null>("local_run_status");
        if (alive.current && sequence.current === current) setResult(previous=>sameRunStatus(previous,next)?previous:next);
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) timer = setTimeout(poll, 300); }
    }
    if (isTauri()) void poll();
    return () => { alive.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (!["python3", "golang", "cpp", "c", "rust", "java"].includes(language)) setPane("run"); }, [language]);
  async function run(mode:"selected"|"all"|"failed"="selected") {
    if(guard.current||busy(result))return;
    guard.current=true;setPending(true);setError("");
    try{
      if(!documentKey)throw Error("当前解答标识不可用");
      const failedIds=new Set(report?.rows.filter(row=>row.comparison?.state==="mismatch"||row.comparison?.state==="error").map(row=>row.caseId).filter(Boolean));
      const chosen=mode==="all"?currentPlans:mode==="failed"?currentPlans.filter(item=>failedIds.has(item.id)):currentPlans.filter(item=>item.id===selected);
      if(!chosen.length)throw Error("没有可运行的用例");
      const invocations:RunContext["invocations"]=[];
      for(let caseIndex=0;caseIndex<chosen.length;caseIndex++){
        const item=chosen[caseIndex],expectation=item.expectation;
        if(expectation){canonicalJson(expectation.value);if(expectation.target.kind==="argument"&&expectation.target.index>=names.length)throw Error("预期参数不属于当前函数");}
        const groups=invocationCount(item.input,names.length);
        if(invocations.length+groups>100)throw Error("一批运行最多 100 组函数调用");
        for(let groupIndex=0;groupIndex<groups;groupIndex++)invocations.push({caseIndex,groupIndex,caseNumber:invocations.length+1});
      }
      const clientRequestId=crypto.randomUUID();lastRequest.current=clientRequestId;
      const combined=chosen.map(item=>item.input).join("\n");
      const source={code,input:combined,metadata,title,language};
      const localContext=validateRunContext({mode,documentKey,clientRequestId,snapshot:source,cases:chosen,invocations},documentKey,clientRequestId);
      const next={...source,mode,documentKey,clientRequestId,cases:chosen};
      const id=await invoke<number>("start_local_run",{snapshot:next});
      if(alive.current){
        ++sequence.current;
        setSnapshot({...source,documentKey,clientRequestId,runId:id,localContext});
        setContext({id,record:localContext});
        setResult({id,documentKey,clientRequestId,phase:"queued",title,stdout:"",stderr:"",results:[],exitCode:null,timedOut:false,canceled:false,truncated:false,elapsedMs:0,error:""});
      }
    }catch(e){if(alive.current)setError(String(e));}
    finally{guard.current=false;if(alive.current)setPending(false);}
  }
  async function cancel() {
    if (!result || guard.current) return;
    guard.current = true;
    try { await invoke("cancel_local_run", { id: result.id }); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { guard.current = false; }
  }
  return <section ref={resize.panel} style={resize.style} hidden={hidden} className="local-runner resizable-panel" aria-label="本地运行">
    {resize.handle}
    <header><div className="local-actions"><button data-local-tab="run" aria-pressed={pane === "run"} onClick={() => setPane("run")}>运行结果</button><button data-local-tab="debug" disabled={!["python3", "golang", "cpp", "c", "rust", "java"].includes(language)} title={["python3", "golang", "cpp", "c", "rust", "java"].includes(language) ? "断点调试" : "此语言的界面调试尚未接入"} aria-pressed={pane === "debug"} onClick={() => setPane("debug")}>调试</button></div><div className="local-actions">{pane==="run"&&<><IconButton icon="play" label="本地执行" title="本地执行 · 仅运行可信代码，非安全沙箱" data-action="local-execute" onClick={()=>void run("selected")} disabled={!isTauri() || !["python3", "golang", "cpp", "c", "rust", "java"].includes(language) || pending || busy(result)} />{busy(result) && <IconButton icon="stop" label="停止" onClick={cancel} disabled={result?.phase === "canceling"} />}</>}{pane==="run"&&<><IconButton icon="tests" label="运行全部用例" title="运行全部用例 · 共用进程与运行时限" onClick={()=>void run("all")} disabled={!isTauri()||pending||busy(result)}/>{activeRecord&&report?.rows.some(row=>row.comparison?.state==="mismatch"||row.comparison?.state==="error")&&<IconButton icon="refresh" label="重跑失败用例" onClick={()=>void run("failed")} disabled={!isTauri()||pending||busy(result)}/>}</>}<IconButton icon="settings" label="运行与调试设置" onClick={onSettings} /><IconButton icon="collapse" label="收起" onClick={onClose} /></div></header>

    <div className="case-toolbar">
      <div role="tablist" aria-label="测试用例">{cases.map(item=><button key={item.id} role="tab" aria-selected={item.id===selected} tabIndex={item.id===selected?0:-1} onClick={()=>chooseCase(item.id)} onKeyDown={event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();const i=cases.findIndex(c=>c.id===selected),next=cases[(i+(event.key==="ArrowRight"?1:-1)+cases.length)%cases.length];chooseCase(next.id);(event.currentTarget.parentElement?.children[cases.indexOf(next)] as HTMLElement)?.focus();}}>{item.name}</button>)}</div>
      <IconButton icon="add" label="添加用例" disabled={cases.length>=64} onClick={addCase}/>
      <details className="case-menu"><summary aria-label="用例操作">···</summary><div><button onClick={()=>setRename(currentCase.name)}>重命名</button><button disabled={cases.length===1} onClick={removeCase}>删除用例</button></div></details>
      {rename!==null&&<form className="case-rename" onSubmit={event=>{event.preventDefault();const name=rename.trim();if(name&&name.length<=80){updateCases(cases.map(c=>c.id===selected?{...c,name}:c));setRename(null);}}}><input autoFocus aria-label="用例名称" maxLength={80} value={rename} onChange={e=>setRename(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();setRename(null);}}}/><button type="submit">确定</button></form>}
      {caseError&&<span role="alert">{caseError}</span>}
    </div>
    <div data-runner-pane="run" hidden={pane !== "run"}>
    <div className="case-inputs">
    {parts?parts.map((value,index)=><label key={index}><span>{names[index]}</span><textarea rows={2} aria-label={parts.length===1?"本地测试输入":"参数 "+names[index]} value={value} onChange={e=>{const next=[...parts];next[index]=compactCaseValue(e.target.value);setInput(next.join("\n"));}} spellCheck={false}/></label>):<label><span>输入</span><textarea aria-label="本地测试输入" value={input} onChange={e=>setInput(e.target.value)} spellCheck={false}/></label>}
    </div>
    <details className="case-expectation"><summary>预期结果</summary><div className="case-inputs"><label><span>比较目标</span><select aria-label="预期结果比较目标" value={currentCase.expectation?.target.kind==="argument"?"argument:"+currentCase.expectation.target.index:"return"} onChange={e=>setExpectation(currentCase.expectation?.value??"",e.target.value==="return"?{kind:"return"}:{kind:"argument",index:Number(e.target.value.slice(9))})}><option value="return">返回值</option>{names.map((name,index)=><option key={index} value={"argument:"+index}>调用后 {name}</option>)}</select></label><label><span>预期</span><textarea rows={2} aria-label="预期结果" placeholder="未设置" value={currentCase.expectation?.value??""} onChange={e=>setExpectation(e.target.value)} spellCheck={false}/></label></div></details>
    <div className="local-actions"><span role="status" hidden={!result}>{result ? busy(result) ? result.phase === "canceling" ? "正在停止" : result.phase === "compiling" ? "编译中…" : "执行中…" : result.canceled ? "已停止" : result.timedOut ? "超过时限，已终止" : result.phase === "error" || result.error ? "未完成" : "执行结束 · " + result.elapsedMs + " ms" : "尚未运行"}</span></div>
    {result?.documentKey&&result.documentKey!==documentKey&&<p className="cache-warning">其他解答的运行结果</p>}
    {stale && <p className="cache-warning">结果已过期</p>}
    {!activeRecord && result && <p className="muted">上次运行</p>}
    {(error || result?.error) && <p role="alert" className="error">{error || result?.error}</p>}
    {result?.truncated && <p role="alert">输出达到上限，已截断并终止进程。</p>}
    {activeRecord&&report&&(activeRecord.mode==="all"||activeRecord.mode==="failed"||activeRecord.cases.length>1)&&<div className="batch-summary" role="status" aria-label="批量运行汇总"><span>{report.received}/{report.expected} 组</span>{report.matched>0&&<span>符合 {report.matched}</span>}{report.mismatched>0&&<span>不符 {report.mismatched}</span>}{report.errors>0&&<span>错误 {report.errors}</span>}{report.unchecked>0&&<span>未比较 {report.unchecked}</span>}{report.missing>0&&<span>未返回 {report.missing}</span>}</div>}
    {report?.rows.map((row,index)=><CaseResult key={index} row={row}/>)}
    {result?.stdout && <><h4>标准输出</h4><pre>{result.stdout}</pre></>}
    {result?.stderr && <><h4>错误输出</h4><pre>{result.stderr}</pre></>}

    {result && !busy(result) && result.exitCode!==null&&result.exitCode!==0 && <small className="exit-code">退出码 {result.exitCode}</small>}
    </div>
    <div data-runner-pane="debug" hidden={pane !== "debug"}><DebugPanel onReveal={()=>{setPane("debug");onReveal?.();}} snapshot={{ documentKey, code, input, metadata, title, language }} breakpoints={breakpoints} onPauseLine={onPauseLine} running={busy(result) || pending} /></div>
  </section>;
}
