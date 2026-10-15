import {prepareSnippet} from "./snippet-prepare.ts";
import {validatePreparedSnippet} from "./snippet-validation.ts";
// Bundled same-origin module worker. Never discovers variables from the machine.
self.onmessage=(event:MessageEvent<unknown>)=>{
 const request=event.data as {id?:unknown;source?:unknown;variables?:unknown}|null;
 if(!request||!Number.isSafeInteger(request.id)||Number(request.id)<=0)return;
 try{
  if(typeof request.source!=="string")throw Error("Invalid snippet request");
  const result=validatePreparedSnippet(prepareSnippet(request.source,request.variables as any));
  self.postMessage({id:request.id,result});
 }catch(error){self.postMessage({id:request.id,error:String(error).slice(0,512)});}
};
