import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runOutputCompletenessUI(testPage){
 const page=await testPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  const s=window.__outputTest={result:null,record:null,count:0,next:[],timedOut:false,canceled:false};
  const q=()=>({...window.__fixtureQuestions[0],metaData:JSON.stringify({name:"solve",params:[{name:"values",type:"integer[]"}],return:{type:"integer"}}),sampleTestCase:"[1]",exampleTestcases:"[1]"});
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="load_recent_questions")return [q()];
   if(command==="search_questions")return {questions:[],total:0,hasMore:false};
   if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
   if(command==="load_document")return {code:"// result fixture",notes:null};
   if(command==="external_editor_supported")return false;
   if(command==="start_language_service")throw Error("offline");
   if(command==="stop_language_service")return;
   if(command==="debug_status")return null;
   if(command==="local_run_status")return s.result;
   if(command==="local_run_record")return s.record;
   if(command==="start_local_run"){
    const p=args.snapshot;
    s.record={mode:p.mode,documentKey:p.documentKey,clientRequestId:p.clientRequestId,
     snapshot:{code:p.code,input:p.input,metadata:p.metadata,title:p.title,language:p.language},
     cases:p.cases,invocations:[]};
    p.cases.forEach((item,caseIndex)=>item.input.split("\n").filter(v=>v.trim()).forEach((_,groupIndex)=>s.record.invocations.push({caseIndex,groupIndex,caseNumber:s.record.invocations.length+1})));
    s.result={id:++s.count,documentKey:p.documentKey,clientRequestId:p.clientRequestId,phase:"finished",title:p.title,
     stdout:"",stderr:"",results:s.next,exitCode:0,timedOut:s.timedOut,canceled:s.canceled,truncated:false,elapsedMs:1,error:""};
    return s.count;
   }
   throw Error("Unexpected output fixture IPC "+command);
  }};
 });
 await page.goto("http://127.0.0.1:5173");
 await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
 await page.getByRole("button",{name:"本地",exact:true}).click();
 const panel=page.getByRole("region",{name:"本地运行",exact:true});
 await page.getByRole("separator",{name:"调整本地面板高度",exact:true}).press("End");
 const input=panel.getByRole("textbox",{name:"本地测试输入",exact:true});
 let count=0;
 const run=async(next,patch={})=>{
  await page.evaluate(({next,patch})=>Object.assign(window.__outputTest,{next,timedOut:false,canceled:false},patch),{next,patch});
  await panel.getByRole("button",{name:"本地执行",exact:true}).click();
  await page.waitForFunction(n=>window.__outputTest.count===n,++count);
  await panel.getByText("执行结束 · 1 ms",{exact:true}).waitFor({state:patch.timedOut||patch.canceled?"hidden":"visible"});
 };
 await run([]);
 await panel.getByText("0/1 组",{exact:true}).waitFor();
 await panel.getByText("未返回结果",{exact:true}).waitFor();
 await panel.getByRole("alert").filter({hasText:"结果不完整或格式异常"}).waitFor();
 await input.fill("[1]\n[2]");
 await run(['{"case":1,"ok":true,"value":1}']);
 await panel.getByText("1/2 组",{exact:true}).waitFor();
 assert.equal(await panel.getByText("未返回结果",{exact:true}).count(),1);
 await run(['{"case":1,"ok":true,"value":1}','{"case":2,"ok":true,"value":2}']);
 await panel.getByText("2/2 组",{exact:true}).waitFor();
 assert.equal(await panel.getByRole("alert").filter({hasText:"结果不完整或格式异常"}).count(),0);
 assert.equal(await panel.getByText("未返回结果",{exact:true}).count(),0);
 await input.fill("[1]");
 await panel.locator(".case-expectation summary").click();
 await panel.getByRole("textbox",{name:"预期结果",exact:true}).fill("0");
 await run([JSON.stringify({case:1,ok:true,value:Array(10001).fill(0)})]);
 await panel.getByText("1/1 组",{exact:true}).waitFor();
 await panel.getByText("结果无法比较",{exact:true}).waitFor();
 assert.equal(await panel.getByText("未返回结果",{exact:true}).count(),0);
 assert.equal(await panel.locator(".local-result").innerText(),"["+Array(10001).fill(0).join(",")+"]","large output remains complete and exact");
 await run([],{timedOut:true});
 await panel.getByText("超过时限，已终止",{exact:true}).waitFor();
 assert.equal(await panel.getByRole("alert").filter({hasText:"结果不完整或格式异常"}).count(),0,"timeout has its own explanation");
 await run([],{canceled:true});
 await panel.getByText("已停止",{exact:true}).waitFor();
 assert.equal(await panel.getByRole("alert").filter({hasText:"结果不完整或格式异常"}).count(),0,"cancellation has its own explanation");
 assert.deepEqual(errors,[]);
 await page.screenshot({path:"evidence/selected-output-completeness.png"});
 await page.close();
 await writeFile("evidence/OUTPUT_COMPLETENESS_UI_RESULT.txt","PASS: selected empty/partial/complete multi-invocation results, large valid output identity and full text, timeout and cancellation distinction. Mocked runner IPC.\n");
}
