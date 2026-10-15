import {snippetLimits} from "./snippet-budget.ts";
import {validatePreparedSnippet,validateSnippetVariables} from "./snippet-validation.ts";
import type {PreparedSnippet,VariableValue} from "./snippet-prepare.ts";
export type SnippetWorkerPort={
 onmessage:((event:{data:unknown})=>void)|null;onerror:((event:unknown)=>void)|null;onmessageerror:((event:unknown)=>void)|null;
 postMessage:(data:unknown)=>void;terminate:()=>void;
};
type Factory=()=>SnippetWorkerPort;
let activeWorkers=0;
const MAX_WORKERS=2;
export class SnippetPreparationService {
 private readonly factory:Factory;private readonly timeoutMs:number;
 private sequence=0;private closed=false;
 private active:{id:number;worker:SnippetWorkerPort;timer:ReturnType<typeof setTimeout>;reject:(reason:Error)=>void}|null=null;
 constructor(factory?:Factory,timeoutMs=1500){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error("Invalid snippet preparation timeout");
  this.factory=factory??(()=>new Worker(new URL("./snippet.worker.ts",import.meta.url),{type:"module"}) as unknown as SnippetWorkerPort);
  this.timeoutMs=timeoutMs;
 }
 prepare(source:string,variables:Record<string,VariableValue>={}):Promise<PreparedSnippet>{
  if(this.closed)return Promise.reject(Error("Snippet owner disposed"));
  if(typeof source!=="string"||source.length>snippetLimits.source)return Promise.reject(Error("Snippet source limit"));
  let context:Record<string,VariableValue>;
  try{context=validateSnippetVariables(variables);}catch(error){return Promise.reject(error);}
  this.cancel();
  if(activeWorkers>=MAX_WORKERS)return Promise.reject(Error("Snippet preparation busy"));
  if(this.sequence>=Number.MAX_SAFE_INTEGER)return Promise.reject(Error("Snippet request identity exhausted"));
  const id=++this.sequence;
  let worker:SnippetWorkerPort;
  try{worker=this.factory();}catch(error){return Promise.reject(error);}
  activeWorkers++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.finish(id,Error("Snippet preparation timed out")),this.timeoutMs);
   this.active={id,worker,timer,reject};
   worker.onmessage=event=>{
    if(this.active?.id!==id||this.active.worker!==worker)return;
    const message=event.data as {id?:unknown;result?:unknown;error?:unknown}|null;
    if(!message||message.id!==id)return;
    try{
     if(message.error!==undefined)throw Error(typeof message.error==="string"?message.error.slice(0,512):"Snippet worker failed");
     const result=validatePreparedSnippet(message.result);
     if(result.needsTransformEvaluation)throw Error("Unevaluated snippet worker result");
     this.finish(id);resolve(result);
    }catch(error){this.finish(id,error instanceof Error?error:Error("Invalid snippet result"));}
   };
   worker.onerror=()=>this.finish(id,Error("Snippet worker failed"));
   worker.onmessageerror=()=>this.finish(id,Error("Unreadable snippet worker message"));
   try{worker.postMessage({id,source,variables:context});}catch(error){this.finish(id,error instanceof Error?error:Error("Snippet worker send failed"));}
  });
 }
 private finish(id:number,error?:Error){
  const active=this.active;if(!active||active.id!==id)return;
  this.active=null;clearTimeout(active.timer);
  active.worker.onmessage=null;active.worker.onerror=null;active.worker.onmessageerror=null;
  try{active.worker.terminate();}catch{/* Local ownership is released even if teardown reports failure. */}finally{activeWorkers--;}
  if(error)active.reject(error);
 }
 cancel(){if(this.active)this.finish(this.active.id,Error("Snippet preparation canceled"));}
 destroy(){this.closed=true;this.cancel();}
}
