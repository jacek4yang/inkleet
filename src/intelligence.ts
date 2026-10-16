import {vimNavigation} from "./vim-navigation";
import {chooseSourceTarget,sourceSpan,sourceTargets,validSourceSnapshot,type Source,type SourceSnapshot,type SourceTarget,type SourceNavigator} from "./source-protocol";
export type {Source} from "./source-protocol";
import {completionPopup} from "./completion-popup";
import {renderDocumentation} from "./lsp-documentation";
import {activeParameterSpan,completionKind,documentationModel} from "./lsp-document-model";
import {completionIcon} from "./lsp-completion-icons";
import {completionApplication,completionTextChanges,plainCompletionChanges as completionChanges} from "./completion-application";
export {completionChanges};
import {SnippetPreparationService} from "./snippet-service";
import {snippetVariables} from "./snippet-context";
import {layoutSnippet} from "./snippet-layout";
import {snippetInsertion,snippetSessionState} from "./snippet-session";
import {snippetParserIdentity} from "./snippet-budget";
import {snapshotText} from "./snapshot-text";
import {unchangedDiagnostics,type DiagnosticSnapshot} from "./diagnostic-snapshot";
import {CompletionRequestOwner,type CompletionTicket} from "./completion-request-owner";
import {advanceIncomplete,completionTrigger,identifierTail,type CompletionTrigger,type IncompleteContext} from "./completion-context";
import { isolateHistory } from "@codemirror/commands";
import { decodeSemanticSpans, semanticField, semanticTheme, setSemanticTokens } from "./semantic-tokens";
// Bound pending formatter work across destroyed/recreated EditorViews.
let formatQueue:Promise<unknown>=Promise.resolve();let queuedFormats=0;
import { DocumentSyncQueue } from "./document-sync-queue";
import { findReferences } from "./references";
import { renameSymbol } from "./rename";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { EditorView, hoverTooltip, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { Prec, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { autocompletion, completionKeymap, startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Started = { id: number; version: number; server: string; uri: string; semanticTokens?: boolean; completionResolve?: boolean; completionSnippets?: boolean; completionTriggerCharacters?: string[]; completionInsertTextMode?:1|2 };
let connectionQueue: Promise<void> = Promise.resolve();
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function offset(doc: Text, position: unknown): number | null {
  if (!object(position) || !Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0 || position.line >= doc.lines) return null;
  const line = doc.line(position.line + 1);
  const col=position.character;
  if(col>line.length||col>0&&col<line.length&&/[\uD800-\uDBFF]/.test(line.text[col-1])&&/[\uDC00-\uDFFF]/.test(line.text[col]))return null;
  return line.from+col;
}
function range(doc: Text, value: unknown) {
  if (!object(value)) return null;
  const from = offset(doc, value.start), to = offset(doc, value.end);
  return from !== null && to !== null && from <= to ? { from, to } : null;
}
function content(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 32768);
  if (Array.isArray(value)) return value.slice(0, 20).map(content).join("\n\n").slice(0, 32768);
  return object(value) && typeof value.value === "string" ? value.value.slice(0, 32768) : "";
}
export function languageIntelligence(language: "python3" | "java" | "golang" | "rust" | "c" | "cpp", status: (text: string) => void, showSource: (source: Source|null) => void, metadata?: string, commandsOwned=false) {
  const documentationLifetime=new AbortController(),popup=completionPopup();
  const serverName = { python3: "Pyright", java: "JDT LS", golang: "gopls", rust: "rust-analyzer", c: "clangd", cpp: "clangd" }[language];
  const signatureEffect = StateEffect.define<Tooltip | null>();
  const signatureField = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) value = null;
      for (const effect of transaction.effects) if (effect.is(signatureEffect)) value = effect.value;
      return value;
    },
    provide: field => showTooltip.from(field),
  });
  let semanticGeneration=0, semanticBusy=false, semanticPending=false, semanticRevision=0, semanticRetries=0;
  let semanticTimer:ReturnType<typeof setTimeout>|undefined;
  function scheduleSemantic(){
    ++semanticGeneration;semanticRetries=0;semanticPending=true;clearTimeout(semanticTimer);
    semanticTimer=setTimeout(()=>{void semantic();},300);
  }
  async function semantic(){
    if(semanticBusy||closed||!view||!session?.semanticTokens)return;
    if(view.composing){semanticTimer=setTimeout(()=>{void semantic();},300);return;}
    semanticBusy=true;semanticPending=false;
    const target=view,doc=target.state.doc,generation=semanticGeneration,id=session.id;
    try{
      await flush();
      if(closed||view!==target||session?.id!==id||target.state.doc!==doc||generation!==semanticGeneration)return;
      const askedVersion=version;
      const result=await invoke<{version:number;tokens:unknown}>("language_semantic_tokens",{id,version:askedVersion});
      if(closed||view!==target||session?.id!==id||version!==askedVersion||result.version!==askedVersion||target.state.doc!==doc||generation!==semanticGeneration||target.composing)return;
      const spans=decodeSemanticSpans(doc,result.tokens);
      target.dispatch({effects:setSemanticTokens.of(spans)});
      if(!spans.length)retrySemantic();
    }catch{
      // At most two readiness retries per snapshot, never restart the server.
      retrySemantic();
    }finally{
      semanticBusy=false;
      if(!closed&&semanticPending){clearTimeout(semanticTimer);semanticTimer=setTimeout(()=>{void semantic();},300);}
    }
  }
  function retrySemantic(){
    if(closed||semanticPending||semanticRetries>=2)return;
    clearTimeout(semanticTimer);
    semanticTimer=setTimeout(()=>{void semantic();},1000*++semanticRetries);
  }
  let signatureGeneration = 0;
  let signatureTimer: ReturnType<typeof setTimeout> | undefined;
  let view: EditorView | null = null, session: Started | null = null, closed = false;
  let version = 1, sent: Text | null = null;
  const synchronization = new DocumentSyncQueue();
  let changeTimer: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    return synchronization.run(async () => {
      while (!closed && view && session && sent !== view.state.doc) {
        const doc = view.state.doc, nextVersion = ++version;
        await invoke("update_language_document", { id: session.id, version: nextVersion, text: snapshotText(doc) });
        sent = doc;
      }
    });
  }
  let completionSequence=0;
  const completionOwner=new CompletionRequestOwner((id,throughSequence)=>invoke("language_cancel_completion",{id,throughSequence}));
  async function request(kind: string, pos: number, doc: Text, newName?: string, completionContext?:CompletionTrigger, stillCurrent:()=>boolean=()=>true,onIssued?:(ticket:CompletionTicket)=>void): Promise<unknown> {
    if (!session || closed || !view || !stillCurrent()) return null;
    const owner=view,id=session.id;
    await flush();
    if (closed || session?.id!==id || view!==owner || owner.state.doc!==doc || !stillCurrent()) return null;
    const line = doc.lineAt(pos), askedVersion = version;
    if(kind==="completion"&&completionSequence>=Number.MAX_SAFE_INTEGER)throw Error("补全请求序号已耗尽，请重新连接语言服务");
    const sequence=kind==="completion"?++completionSequence:null;
    const ticket=sequence===null?null:completionOwner.begin(id,sequence);
    if(ticket)onIssued?.(ticket);
    try{
      const result = await invoke("language_request", { id, version: askedVersion, kind, completionSequence:sequence, line: line.number - 1, character: pos - line.from, newName: newName ?? null, completionContext:completionContext??null });
      return !closed && session?.id === id && version === askedVersion && view===owner && owner.state.doc===doc && stillCurrent() ? result : null;
    }finally{if(ticket)completionOwner.finish(ticket);}
  }
  let completionApplyGeneration=0,activeCompletionResolves=0;
  const snippetPreparation=new SnippetPreparationService();
  function invalidateCompletionApplication(){snippetPreparation.cancel();return ++completionApplyGeneration;}
  let incomplete:IncompleteContext|null=null,typing:{doc:Text;pos:number}|null=null,completionRequestGeneration=0;
  function invokeCompletion(target:EditorView){
    if(closed||view!==target||!session||target.composing)return false;
    incomplete=null;typing=null;++completionRequestGeneration;completionOwner.cancelActive();
    // Reset CodeMirror's active source query as well as our request generation.
    // Starting again alone can leave a stale pending query with no replacement.
    target.dispatch({selection:target.state.selection});
    return startCompletion(target);
  }
  async function complete(context: CompletionContext) {
    if (!session || !view) return null;
    const advertisedSnippets=session.completionSnippets===true;
    const defaultMode=session.completionInsertTextMode===undefined?1:session.completionInsertTextMode;
    if(defaultMode!==1&&defaultMode!==2){if(context.explicit)status("语言服务补全插入模式无效");return null;}
    const contextSelection=context.state.selection;
    if(contextSelection.ranges.length!==1||context.state.doc.lineAt(contextSelection.main.from).number!==context.state.doc.lineAt(contextSelection.main.to).number){
      if(context.explicit)status("此选区暂不支持补全");return null;
    }
    const generation=++completionRequestGeneration;completionOwner.cancelActive();
    const word = contextSelection.main.empty ? context.matchBefore(identifierTail) : null;
    const triggers=session.completionTriggerCharacters??[".",":"];
    const before=context.state.sliceDoc(Math.max(0,context.pos-2),context.pos);
    const continued=!!incomplete?.continued&&incomplete.session===session.id&&incomplete.doc===context.state.doc&&incomplete.from===(word?.from??context.pos)&&incomplete.pos===context.pos;
    const typed=typing?.doc===context.state.doc&&typing.pos===context.pos;
    const trigger=completionTrigger(context.explicit&&!typed,before,triggers,continued);
    if(!context.explicit&&!word?.text&&trigger.triggerKind!==2)return null;
    let attemptTicket:CompletionTicket|null=null;
    context.addEventListener("abort", () => completionOwner.cancel(attemptTicket), { onDocChange: true });
    const doc = context.state.doc,owner=view,sessionId=session.id;
    const current=()=>!closed&&view===owner&&session?.id===sessionId&&generation===completionRequestGeneration&&!context.aborted&&owner.state.doc===doc&&owner.state.selection.eq(contextSelection);
    try {
      const deadline = Date.now() + (context.explicit ? 8000 : 1200);
      let items: unknown[] = [], isIncomplete=false;
      const needle = word?.text.toLowerCase() ?? "";
      const requiresResolve=session.completionResolve===true,snippets=advertisedSnippets&&context.state.field(snippetSessionState,false)!==undefined;
      const admissible=(items:unknown[])=>items.slice(0,5000).filter((item):item is Record<string,any>=>
        object(item)&&typeof item.label==="string"&&(!needle||String(item.filterText??item.label).toLowerCase().includes(needle))
      ).sort((a,b)=>String(a.sortText??a.label).localeCompare(String(b.sortText??b.label))).slice(0,300).filter(item=>{
        if(item.label.length>512||requiresResolve&&(!Number.isSafeInteger(item._inkleetCompletion)||item._inkleetCompletion<=0))return false;
        const application=completionApplication(doc,item,word?.from??context.pos,context.pos,contextSelection.main,defaultMode);
        return !!application&&(application.format!==2||snippets);
      });
      let candidates:Record<string,any>[]=[];
      for (let attempt = 0; ; attempt++) {
        if(attempt>0&&Date.now()>=deadline)break;
        const result = await request("completion", context.pos, doc,undefined,trigger,current,ticket=>{attemptTicket=ticket;});
        if (!current()) return null;
        isIncomplete=object(result)&&result.isIncomplete===true;
        items = Array.isArray(result) ? result : object(result) && Array.isArray(result.items) ? result.items : [];
        candidates=admissible(items);
        if ((context.explicit?candidates.length:items.length) || Date.now() >= deadline) break;
        // initialize confirms transport readiness, not completed project indexing.
        // Explicit requests also retry nonempty responses with no usable candidates.
        // Preserve the automatic empty-response policy; never restart a server.
        if (context.explicit) status(serverName + " 正在准备补全…");
        await new Promise(resolve => setTimeout(resolve, Math.max(0,Math.min(200 * 2 ** attempt,1200,deadline-Date.now()))));
        if (!current()) return null;
      }
      incomplete=isIncomplete&&session?{doc,from:word?.from??context.pos,pos:context.pos,session:session.id}:null;
      const options: Completion[] = [];
      for (const item of candidates) {
        const id=session?.id,askedVersion=version,resolve=session?.completionResolve===true,token=item._inkleetCompletion;
        if(resolve&&(!Number.isSafeInteger(token)||token<=0))continue;
        let resolution:Promise<unknown>|null=null;
        const resolveItem=():Promise<unknown>=>{
          if(!resolve)return Promise.resolve(item);
          if(resolution)return resolution;
          if(closed||session?.id!==id||version!==askedVersion||view?.state.doc!==doc)return Promise.reject(Error("补全快照已过期"));
          if(activeCompletionResolves>=4)return Promise.reject(Error("补全解析繁忙，请重试"));
          activeCompletionResolves++;
          resolution=invoke<unknown>("language_completion_resolve",{id,version:askedVersion,token}).catch(error=>{resolution=null;throw error;}).finally(()=>{activeCompletionResolves--;});
          return resolution;
        };
        options.push({
          label: typeof item.filterText === "string" ? item.filterText.slice(0, 512) : item.label.trimStart(), displayLabel: typeof item.filterText==="string"&&item.filterText.slice(0,512)!==item.label.trimStart()?item.label.trimStart():undefined, detail: typeof item.detail === "string" ? item.detail.slice(0, 500) : undefined,
          info: async()=>{
            try{
              const resolved=resolve?await resolveItem():item;
              if(closed||session?.id!==id||version!==askedVersion||view?.state.doc!==doc)return null;
              const documentation=object(resolved)?resolved.documentation:null;
              const detail=object(resolved)&&typeof resolved.detail==="string"?resolved.detail:typeof item.detail==="string"?item.detail:"";
              const preview=documentationModel(documentation);
              if(!detail&&!preview.parts.length&&!preview.truncated)return null;
              const summary=item.label.slice(0,512)+(detail?"\n"+detail:"");
              const completeValue=[{kind:"plaintext",value:summary},...(Array.isArray(documentation)?documentation:documentation==null?[]:[documentation])];
              const dom=await renderDocumentation(completeValue,false,documentationLifetime.signal,{title:item.label.slice(0,512),summaryFirst:true});
              if(!dom||closed||session?.id!==id||version!==askedVersion||view?.state.doc!==doc)return null;
              dom.classList.add("lsp-completion-documentation");return dom;
            }catch{return null;}
          }, type: completionKind(item.kind),

          apply(target) {
            const ticket=invalidateCompletionApplication(),state=target.state,uri=session?.uri;
            const current=()=>!closed&&view===target&&target.state.doc===doc&&target.state.selection.eq(contextSelection)&&target.state.selection.eq(state.selection)&&target.state.selection.ranges.length===1&&target.hasFocus&&!target.composing&&session?.id===id&&version===askedVersion&&ticket===completionApplyGeneration;
            if(!current())return;
            void (async()=>{
              const resolved=await resolveItem();
              if(!current())return;
              const application=completionApplication(doc,resolved,word?.from??context.pos,context.pos,contextSelection.main,defaultMode);
              if(!application)throw Error("补全或导入编辑无效，未修改源码");
              const existingSnippet=target.state.field(snippetSessionState,false);
              if(existingSnippet&&(application.format===2||application.additional.length))throw Error(existingSnippet.dirty?(existingSnippet.dormant?"请先保存当前参数修改，再应用此候选":"请先保存，再按 Esc 结束当前参数补全"):"请先按 Esc 结束当前参数补全，再应用此候选");
              if(application.format===2){
                if(!advertisedSnippets||target.state.field(snippetSessionState,false)===undefined)throw Error("此会话未启用参数补全，未修改源码");
                const variables=snippetVariables(state,context.pos,uri);
                const prepared=await snippetPreparation.prepare(application.primary.insert,variables);
                if(!current()||target.state.field(snippetSessionState,false)===undefined)return;
                const laid=layoutSnippet(prepared,state,context.pos,application.mode);
                const transaction=snippetInsertion(target.state,laid.prepared,application.primary.from,application.primary.to,application.additional);
                if(!transaction)throw Error("此参数补全结构暂不支持，未修改源码");
                if(current())target.dispatch(transaction);
              }else{
                let insert=application.primary.insert;
                if(application.mode===2)insert=layoutSnippet({schemaVersion:1,parserIdentity:snippetParserIdentity,text:insert,fields:[],navigation:[],transforms:[],needsTransformEvaluation:false,transformState:"resolved"},state,context.pos,2).prepared.text;
                const applied=completionTextChanges(application,insert);if(!applied)throw Error("补全文本超出限制，未修改源码");
                if(current())target.dispatch({changes:applied.changes,selection:{anchor:applied.anchor},annotations:isolateHistory.of("full"),userEvent:"input.complete"});
              }
            })().catch(error=>{if(current())status("补全未应用 · "+String(error).slice(0,220));});
          },
        });
      }
      if (context.explicit) status(options.length ? serverName + " 已连接 · F12 / Ctrl+单击查看定义" : serverName + " 未找到匹配补全 · 服务返回 " + items.length + " 项");
      return options.length ? { from: word?.from ?? context.pos, options } : null;
    } catch (error) { if (context.explicit && current()) status(serverName + " 补全暂不可用：" + String(error).slice(0, 300)); return null; }
  }
  async function hover(target: EditorView, pos: number): Promise<Tooltip | null> {
    const doc = target.state.doc;
    try {
      const result = await request("hover", pos, doc);
      if (!object(result) || closed || target.state.doc !== doc) return null;
      const dom=await renderDocumentation(result.contents,true,documentationLifetime.signal,{title:"符号文档"});
      if(!dom||closed||view!==target||target.state.doc!==doc)return null;
      dom.classList.add("lsp-hover");
      const span = range(doc, result.range) ?? { from: pos, to: pos };
      return { pos: span.from, end: span.to, above: true, create() {
        return { dom };
      }};
    } catch { return null; }
  }
  async function signatureHelp() {
    if (!view || closed || view.composing) return;
    const target = view, doc = target.state.doc, pos = target.state.selection.main.head, generation = ++signatureGeneration;
    try {
      const result = await request("signatureHelp", pos, doc);
      if (closed || generation !== signatureGeneration || view !== target || target.state.doc !== doc || target.state.selection.main.head !== pos || target.composing) return;
      if (!object(result) || !Array.isArray(result.signatures) || !result.signatures.length) {
        target.dispatch({ effects: signatureEffect.of(null) }); return;
      }
      const index = Number.isInteger(result.activeSignature) ? Math.max(0, Math.min(result.signatures.length - 1, result.activeSignature)) : 0;
      const signature = result.signatures[index];
      if (!object(signature) || typeof signature.label !== "string") return;
      const parameter = Number.isInteger(signature.activeParameter) ? signature.activeParameter : result.activeParameter;
      const parameters = Array.isArray(signature.parameters) ? signature.parameters : [];
      const current = Number.isInteger(parameter) && parameter >= 0 ? parameters[parameter] : null;
      const label = signature.label.slice(0, 4096);
      const span=activeParameterSpan(label,current);
      const parameterDocs=await renderDocumentation(object(current)?current.documentation:null,false,documentationLifetime.signal,{title:"参数文档"});
      const documentation=await renderDocumentation(signature.documentation,false,documentationLifetime.signal,{title:"函数文档"});
      if(closed||generation!==signatureGeneration||view!==target||target.state.doc!==doc||target.state.selection.main.head!==pos||target.composing)return;
      target.dispatch({ effects: signatureEffect.of({ pos, above: true, create() {
        const dom = document.createElement("div"); dom.className = "lsp-signature"; dom.setAttribute("role", "status");
        const heading = document.createElement("div"); heading.className = "lsp-signature-label"; if(span){heading.append(label.slice(0,span.from));const active=document.createElement("mark");active.className="lsp-active-parameter";active.textContent=label.slice(span.from,span.to);heading.append(active,label.slice(span.to));}else heading.textContent=label;
        dom.append(heading);
        if(result.signatures.length>1){const count=document.createElement("span");count.className="lsp-overload-count";count.textContent=(index+1)+"/"+result.signatures.length;count.title="当前重载";dom.append(count);}
        if (Number.isInteger(parameter) && parameter >= 0 && parameter < parameters.length) {
          dom.setAttribute("aria-label","参数 "+(parameter+1)+" / "+parameters.length);
        }
        if(parameterDocs){parameterDocs.classList.add("lsp-parameter-documentation");dom.append(parameterDocs);}
        if(documentation)dom.append(documentation);
        return { dom };
      } }) });
    } catch { if (!closed && generation === signatureGeneration && view === target && target.state.doc === doc) target.dispatch({ effects: signatureEffect.of(null) }); }
  }
  let navigationSequence=0,navigationCanceledThrough=0,navigationGeneration=0,navigationAbort:AbortController|null=null;
  function cancelSourceSequence(id:number,sequence:number){
    if(sequence<=navigationCanceledThrough)return;
    navigationCanceledThrough=sequence;
    void invoke("language_cancel_source_navigation",{id,through:sequence}).catch(()=>{});
  }
  function cancelSourceRequests(){if(session)cancelSourceSequence(session.id,navigationSequence);}
  function invalidateNavigation(close=false){
    ++navigationGeneration;navigationAbort?.abort();navigationAbort=null;cancelSourceRequests();
    if(close)showSource(null);
  }
  async function definition(pos: number) {
    if(!view||!session)return;
    invalidateNavigation();
    const target=view,doc=target.state.doc,id=session.id,generation=navigationGeneration;
    const selection=target.state.selection,scrollTop=target.scrollDOM.scrollTop,scrollLeft=target.scrollDOM.scrollLeft;
    const abort=new AbortController();navigationAbort=abort;
    const valid=()=>!closed&&view===target&&session?.id===id&&target.state.doc===doc;
    try {
      const result=await request("definition",pos,doc);
      if(!valid()||generation!==navigationGeneration||abort.signal.aborted)return;
      const location=await chooseSourceTarget(sourceTargets(result),abort.signal);
      if(!location){if(!abort.signal.aborted)status("未找到定义");return;}
      if(!valid()||generation!==navigationGeneration||abort.signal.aborted)return;
      if(location.uri===session?.uri){
        const span=range(doc,location.range);if(!span)throw Error("定义位置与当前代码不一致");
        target.dispatch({selection:{anchor:span.from,head:span.to},effects:EditorView.scrollIntoView(span.from,{y:"center"})});return;
      }
      const askedVersion=version,primary=session!.uri;
      const current=()=>valid()&&version===askedVersion;
      const ensure=(signal:AbortSignal)=>{if(signal.aborted||!current())throw new DOMException("导航已取消","AbortError");};
      const primarySnapshot:SourceSnapshot={sourceId:0,uri:primary,text:snapshotText(doc),name:"当前解答",declaration:false,language};
      const load=async(location:SourceTarget,signal:AbortSignal):Promise<SourceSnapshot|null>=>{
        ensure(signal);if(location.uri===primary)return primarySnapshot;
        const source=await invoke<SourceSnapshot>("acquire_language_source",{id,version:askedVersion,uri:location.uri});
        ensure(signal);
        if(!validSourceSnapshot(source,location.uri)||!sourceSpan(source.text,location.range))throw Error("定义位置与源码内容不一致");
        return source;
      };
      const navigation:SourceNavigator={
        primary:primarySnapshot,originSelection:{ranges:selection.ranges.map(({anchor,head})=>({anchor,head})),mainIndex:selection.mainIndex},originScroll:{top:scrollTop,left:scrollLeft},current,cancel:cancelSourceRequests,load,
        origin(location){
          if(!current())return;
          if(location){
            const span=range(doc,location.range);if(!span)throw Error("定义位置与当前代码不一致");
            showSource(null);target.dispatch({selection:{anchor:span.from,head:span.to},effects:EditorView.scrollIntoView(span.from,{y:"center"})});
          }else{
            showSource(null);target.dispatch({selection});target.scrollDOM.scrollTop=scrollTop;target.scrollDOM.scrollLeft=scrollLeft;
          }
          target.focus();
        },
        async definition(source,position,signal){
          ensure(signal);
          if(source.sourceId===0){const pos=offset(doc,position);if(pos===null)throw Error("定义位置无效");const result=await request("definition",pos,doc);ensure(signal);return {locations:sourceTargets(result),omitted:0};}
          let snapshot=source;
          for(let attempt=0;attempt<2;attempt++){
            ensure(signal);const sequence=++navigationSequence;
            const cancel=()=>cancelSourceSequence(id,sequence);
            signal.addEventListener("abort",cancel,{once:true});
            try{
              const response=await invoke<{locations:SourceTarget[];omitted:number}>("language_source_definition",{id,version:askedVersion,sourceId:snapshot.sourceId,line:position.line,character:position.character,sequence});
              ensure(signal);return {locations:sourceTargets(response.locations),omitted:response.omitted};
            }catch(error){
              ensure(signal);
              if(attempt!==0||String(error)!=="SOURCE_SNAPSHOT_EXPIRED")throw error;
              const refreshed=await invoke<SourceSnapshot>("acquire_language_source",{id,version:askedVersion,uri:source.uri});
              ensure(signal);
              if(!validSourceSnapshot(refreshed,source.uri)||refreshed.text!==source.text)throw Error("源码已改变，请重新打开定义");
              snapshot=refreshed;source.sourceId=refreshed.sourceId;
            }finally{signal.removeEventListener("abort",cancel);}
          }
          throw Error("源码快照不可用");
        }
      };
      const source=await load(location,abort.signal);
      if(source&&valid()&&generation===navigationGeneration&&!abort.signal.aborted)showSource({...source,line:location.range.start.line,range:location.range,navigation});
    } catch(e) {if(valid()&&generation===navigationGeneration&&!abort.signal.aborted)status(String(e));}
  }
  let appliedDiagnostics:DiagnosticSnapshot<Text>|null=null;
  async function poll() {
    if (!session || !view || closed) return;
    try {
      await flush();
      const id = session.id, askedVersion = version, doc = view.state.doc;
      const result = await invoke<{ version: number; diagnostics: unknown[]; semanticRevision?:number }>("language_diagnostics", { id });
      if (!closed && session?.id === id && askedVersion === version && result.version === version && view.state.doc === doc) {
        if(Number.isSafeInteger(result.semanticRevision)&&result.semanticRevision!==semanticRevision){semanticRevision=result.semanticRevision!;scheduleSemantic();}
        const diagnostics: Diagnostic[] = [];
        for (const item of (Array.isArray(result.diagnostics) ? result.diagnostics : []).slice(0, 200)) {
          if (!object(item) || typeof item.message !== "string") continue;
          const span = range(doc, item.range); if (!span) continue;
          diagnostics.push({ ...span, severity: item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info", message: item.message.slice(0, 4000), source: serverName });
        }
        if(!unchangedDiagnostics(appliedDiagnostics,doc,diagnostics)){
          view.dispatch(setDiagnostics(view.state, diagnostics));
          appliedDiagnostics={doc,items:diagnostics};
        }
      }
    } catch (e) { if (!closed) status(String(e)); }
    finally { if (!closed) pollTimer = setTimeout(poll, 1000); }
  }
  const references = findReferences((pos, doc) => request("references", pos, doc), status, !commandsOwned);
  const rename = renameSymbol((pos, doc, name) => request("rename", pos, doc, name), status, !commandsOwned);
  const extensions: Extension[] = [
    vimNavigation({definition:target=>{void definition(target.state.selection.main.head);return true;}}),
    ...references.extensions,
    ...rename.extensions,
    signatureField,
    semanticField, semanticTheme,
    autocompletion({ override: [complete], activateOnTyping: true, maxRenderedOptions: 60, defaultKeymap:false, icons:false, tooltipClass:popup.tooltipClass,positionInfo:popup.positionInfo, addToOptions:[{render:completionIcon,position:20}] }),
    // Keep all native completion bindings, but route explicit starts through the
    // same reset boundary as commands. Disable the earlier basicSetup copy.
    Prec.highest(keymap.of(completionKeymap.map(binding=>binding.run===startCompletion?{...binding,run:invokeCompletion}:binding))),
    keymap.of([{key:"Alt-Enter",run:target=>popup.openDocs(target)},{key:"Alt-PageDown",run:target=>popup.scrollDocs(target,1)},{key:"Alt-PageUp",run:target=>popup.scrollDocs(target,-1)}]),
    hoverTooltip(hover, { hoverTime: 350 }),
    keymap.of([...(commandsOwned?[]:[{ key: "Mod-Shift-Space", run() { void signatureHelp(); return true; } },{ key: "F12", run(target:EditorView) { void definition(target.state.selection.main.head); return true; } }]), { key: "Escape", run(target) { invalidateCompletionApplication(); ++signatureGeneration; clearTimeout(signatureTimer); if (!target.state.field(signatureField)) return false; target.dispatch({ effects: signatureEffect.of(null) }); return true; } }]),
    EditorView.domEventObservers({keydown(event){if(event.key==="Escape"&&!event.isComposing){invalidateCompletionApplication();++completionRequestGeneration;completionOwner.cancelActive();incomplete=null;typing=null;}}}),
    EditorView.domEventHandlers({ blur(){invalidateCompletionApplication();++completionRequestGeneration;completionOwner.cancelActive();incomplete=null;typing=null;return false;}, compositionstart(){invalidateCompletionApplication();++completionRequestGeneration;completionOwner.cancelActive();incomplete=null;typing=null;return false;}, mousedown(event, target) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      event.preventDefault(); void definition(pos); return true;
    }}),
    EditorView.updateListener.of(update => {
      if(update.docChanged||update.selectionSet)invalidateNavigation(update.docChanged);
      if(update.docChanged){
        ++completionRequestGeneration;completionOwner.cancelActive();
        const changes:{from:number;to:number;text:string}[]=[];
        update.changes.iterChanges((from,to,_fromB,_toB,inserted)=>{if(changes.length<2)changes.push({from,to,text:inserted.length<=256?inserted.toString():""});});
        incomplete=update.view.composing?null:advanceIncomplete(incomplete,update.startState.doc,update.state.doc,changes);
        const inserted=changes.length===1?changes[0]:null;
        typing=!update.view.composing&&inserted&&inserted.from===inserted.to&&inserted.text&&update.transactions.some(transaction=>transaction.isUserEvent("input.type"))&&update.state.selection.main.empty&&update.state.selection.main.head===inserted.from+inserted.text.length?{doc:update.state.doc,pos:update.state.selection.main.head}:null;
      }else if(update.selectionSet){incomplete=null;typing=null;++completionRequestGeneration;completionOwner.cancelActive();}

      if (update.docChanged || update.selectionSet) { invalidateCompletionApplication(); ++signatureGeneration; clearTimeout(signatureTimer); }
      if (update.docChanged && !closed && !update.view.composing && /[(,]$/.test(update.state.doc.sliceString(Math.max(0, update.state.selection.main.head - 1), update.state.selection.main.head))) signatureTimer = setTimeout(() => { void signatureHelp(); }, 180);
      if (update.docChanged && !closed) {
        scheduleSemantic();
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { void flush().catch(e => { if (!closed) status(String(e)); }); }, 150);
      }
    }),
  ];
  return {
    extensions,
    available:()=>!closed&&session!==null,
    commands:{completion:invokeCompletion,rename:(target:EditorView)=>rename.open(target),references:(target:EditorView)=>{void references.open(target);return true;},definition:(target:EditorView)=>{void definition(target.state.selection.main.head);return true;},signature:()=>{void signatureHelp();return true;}},
    async format(text:string):Promise<string>{
      if(queuedFormats>=8)throw Error("格式化请求过多，请稍后保存");
      ++queuedFormats;
      const request=formatQueue.then(async()=>{
      if(closed||!view||snapshotText(view.state.doc)!==text)throw Error("格式化文档已切换");
      const doc=view.state.doc;
      if(["c","cpp","java"].includes(language)){
        if(!session)throw Error("语言服务尚未连接");
        await flush();
        if(closed||!session||!view||view.state.doc!==doc)throw Error("格式化快照已过期");
      }
      const id=session?.id??null,askedVersion=version;
      const result=await invoke<string>("format_source",{language,text,id,version:id===null?null:askedVersion});
      if(closed||!view||view.state.doc!==doc||(["c","cpp","java"].includes(language)&&(session?.id!==id||version!==askedVersion)))throw Error("忽略过期格式化结果");
      if(typeof result!=="string")throw Error("格式化器未返回正文");
      return result;
      }).finally(()=>{--queuedFormats;});
      formatQueue=request.then(()=>undefined,()=>undefined);
      return request;
    },
    async connect(target: EditorView) {
      view = target;appliedDiagnostics=null;
      target.dispatch({effects:setSemanticTokens.of([])});
      if (!isTauri()) { status("浏览器预览 · 语言服务需原生客户端"); return; }
      status(`正在连接 ${{ python3: "Python", java: "Java", golang: "Go", rust: "Rust", c: "C", cpp: "C++" }[language]} 语言服务…`);
      const initial = target.state.doc;
      try {
        const connecting = connectionQueue.then(() => closed ? null : invoke<Started>("start_language_service", {text: snapshotText(initial), language, metadata: metadata ?? null}));
        connectionQueue = connecting.then(() => undefined, () => undefined);
        const started = await connecting;
        if (!started) return;
        if (closed) { await invoke("stop_language_service", { id: started.id }); return; }
        incomplete=null;typing=null;++completionRequestGeneration;completionOwner.cancelActive();session = started; version = started.version; sent = initial;
        await flush();
        if (!closed) { status(`${serverName} 已连接 · F12 / Ctrl+单击查看定义`); void poll(); scheduleSemantic(); }
      } catch (e) { if (!closed) status(String(e)); }
    },
    destroy() {
      invalidateNavigation(true);documentationLifetime.abort();snippetPreparation.destroy();references.destroy(); rename.destroy(); incomplete=null;typing=null; ++completionRequestGeneration;completionOwner.cancelActive(); invalidateCompletionApplication(); closed = true; ++semanticGeneration; semanticPending=false; clearTimeout(semanticTimer); ++signatureGeneration; clearTimeout(signatureTimer); clearTimeout(changeTimer); clearTimeout(pollTimer);
      if (session) void invoke("stop_language_service", { id: session.id }).catch(() => {});
      appliedDiagnostics=null;session = null; view = null;
    },
  };
}
