import {evaluateSnippetTransforms} from "./snippet-transform.worker-core.ts";
import {prepareSnippet} from "./snippet-prepare.ts";
import {validatePreparedSnippet} from "./snippet-validation.ts";
// Bundled same-origin module worker. Never discovers variables from the machine.
self.onmessage=(event:MessageEvent<unknown>)=>{
 const request=event.data as {id?:unknown;kind?:unknown;source?:unknown;variables?:unknown;prepared?:unknown}|null;
 if(!request||!Number.isSafeInteger(request.id)||Number(request.id)<=0)return;
 try{
  let prepared;
  if(request.kind==="prepare"&&typeof request.source==="string")prepared=prepareSnippet(request.source,request.variables as any);
  else if(request.kind==="evaluate")prepared=validatePreparedSnippet(request.prepared);
  else throw Error("Invalid snippet request");
  const result=validatePreparedSnippet(evaluateSnippetTransforms(prepared));
  self.postMessage({id:request.id,result});
 }catch(error){self.postMessage({id:request.id,error:String(error).slice(0,512)});}
};
