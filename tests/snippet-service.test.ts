import test from "node:test";
import assert from "node:assert/strict";
import {SnippetPreparationService,type SnippetWorkerPort} from "../src/snippet-service.ts";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {validatePreparedSnippet,validateSnippetVariables} from "../src/snippet-validation.ts";
class FakeWorker implements SnippetWorkerPort{
 onmessage:SnippetWorkerPort["onmessage"]=null;onerror:SnippetWorkerPort["onerror"]=null;onmessageerror:SnippetWorkerPort["onmessageerror"]=null;
 sent:any[]=[];terminated=0;failSend=false;
 postMessage(value:unknown){if(this.failSend)throw Error("send failed");this.sent.push(value);}
 terminate(){this.terminated++;}
 reply(result=prepareSnippet("ok")){this.onmessage?.({data:{id:this.sent.at(-1).id,result}});}
}
test("owned preparation returns validated output and releases worker listeners",async()=>{
 const w=new FakeWorker(),s=new SnippetPreparationService(()=>w);
 const promise=s.prepare("$"+"{1:ok}");w.reply(prepareSnippet("$"+"{1:ok}"));
 assert.equal((await promise).text,"ok");assert.equal(w.terminated,1);assert.equal(w.onmessage,null);
 s.destroy();
});
test("new request cancels old ownership; late replies cannot settle the new request",async()=>{
 const workers:FakeWorker[]=[],s=new SnippetPreparationService(()=>{const w=new FakeWorker();workers.push(w);return w;});
 const first=s.prepare("old").then(()=>"",e=>e.message),late=workers[0].onmessage!;
 const second=s.prepare("new");assert.match(await first,/canceled/);
 late({data:{id:workers[0].sent[0].id,result:prepareSnippet("old")}});
 workers[1].reply(prepareSnippet("new"));assert.equal((await second).text,"new");
 assert.equal(workers[0].terminated,1);s.destroy();
});
test("timeout terminates worker, releases capacity and allows a later explicit request",async()=>{
 const workers:FakeWorker[]=[],s=new SnippetPreparationService(()=>{const w=new FakeWorker();workers.push(w);return w;},10);
 await assert.rejects(s.prepare("slow"),/timed out/);assert.equal(workers[0].terminated,1);
 const next=s.prepare("new");workers[1].reply();assert.equal((await next).text,"ok");s.destroy();
});
test("worker errors, malformed results and send failures never leave hanging ownership",async()=>{
 for(const failure of ["error","message","invalid","send"]){
  const w=new FakeWorker(),s=new SnippetPreparationService(()=>w);w.failSend=failure==="send";
  const p=s.prepare("x");
  if(failure==="error")w.onerror?.({});
  if(failure==="message")w.onmessageerror?.({});
  if(failure==="invalid")w.onmessage?.({data:{id:w.sent[0].id,result:{text:"x"}}});
  await assert.rejects(p);assert.equal(w.terminated,1);s.destroy();
 }
});
test("disposed owner cannot launch; global concurrent workers are bounded",async()=>{
 const a=new SnippetPreparationService(()=>new FakeWorker()),b=new SnippetPreparationService(()=>new FakeWorker()),c=new SnippetPreparationService(()=>new FakeWorker());
 const pa=a.prepare("a").catch(e=>e),pb=b.prepare("b").catch(e=>e);
 await assert.rejects(c.prepare("c"),/busy/);
 a.destroy();b.destroy();c.destroy();await pa;await pb;
 await assert.rejects(a.prepare("later"),/disposed/);
});
test("context validation occurs before posting and copies supplied records",async()=>{
 const w=new FakeWorker(),s=new SnippetPreparationService(()=>w);
 await assert.rejects(s.prepare("x",{X:{kind:"value",value:"x".repeat(65537)}}));
 assert.equal(w.sent.length,0);
 const context={X:{kind:"value" as const,value:"before"}},p=s.prepare("$X",context);context.X.value="after";
 assert.equal(w.sent[0].variables.X.value,"before");w.reply();await p;s.destroy();
 const inherited=Object.create({X:{kind:"value",value:"secret"}});
 assert.deepEqual(Object.keys(validateSnippetVariables(inherited)),[]);
});
test("prepared DTO validation rejects malformed ownership and Unicode boundaries",()=>{
 const valid=prepareSnippet("$"+"{1:😀}");assert.equal(validatePreparedSnippet(valid),valid);
 for(const change of [
 (r:any)=>{r.fields[0].to=1;},
 (r:any)=>{r.fields[0].parent=0;},
 (r:any)=>{r.fields[0].id=9;},
 (r:any)=>{r.navigation=[];},
 (r:any)=>{r.fields[0].derived=true;},
 (r:any)=>{r.needsTransformEvaluation=true;},
 (r:any)=>{r.fields[0].group="x".repeat(513);}
 ]){
  const r=structuredClone(valid);change(r);assert.throws(()=>validatePreparedSnippet(r));
 }
});
test("pending transforms remain pending across the worker boundary",async()=>{
 const result=prepareSnippet("$"+"{1/(a+)+$/x/}"),w=new FakeWorker(),s=new SnippetPreparationService(()=>w);
 const promise=s.prepare("ignored");w.reply(result);assert.equal((await promise).needsTransformEvaluation,true);s.destroy();
});
