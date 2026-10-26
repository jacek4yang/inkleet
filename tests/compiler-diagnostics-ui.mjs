import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runCompilerDiagnosticsUI(testPage){
 const page=await testPage({viewport:{width:1200,height:900}}),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  const s=window.__diagnosticTest={result:null,record:null,count:0,raw:'\u001b[31mSolution.java:2: error: cannot find symbol <img src=x onerror=alert(1)>\u001b[0m\n  int value = missing;\n              ^\n/tmp/other/Solution.java:2: error: external\nSolution.java:999: error: out of range',copied:null,copyFail:false,copyCalls:0,deferCopy:false,copyResume:null};
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{s.copyCalls++;if(s.deferCopy)await new Promise(resolve=>{s.copyResume=resolve;});if(s.copyFail)throw Error("denied");s.copied=text;}}});
  const q=()=>({...window.__fixtureQuestions[0],metaData:JSON.stringify({name:"solve",params:[{name:"values",type:"integer[]"}],return:{type:"integer"}}),sampleTestCase:"[1]",exampleTestcases:"[1]"});
  localStorage.setItem("inkleet.language","java");
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="load_recent_questions")return [q()];
   if(command==="search_questions")return {questions:[],total:0,hasMore:false};
   if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
   if(command==="load_document")return {code:"class Solution {\n\tint value = missing;\n}",notes:null};
   if(command==="external_editor_supported")return false;
   if(command==="start_language_service")throw Error("offline");
   if(command==="stop_language_service"||command==="save_text")return;
   if(command==="debug_status")return null;
   if(command==="local_run_status")return s.result;
   if(command==="local_run_record")return s.record;
   if(command==="start_local_run"){
    const p=args.snapshot;s.record={mode:p.mode,documentKey:p.documentKey,clientRequestId:p.clientRequestId,snapshot:{code:p.code,input:p.input,metadata:p.metadata,title:p.title,language:p.language},cases:p.cases,invocations:[{caseIndex:0,groupIndex:0,caseNumber:1}]};
    s.result={id:++s.count,documentKey:p.documentKey,clientRequestId:p.clientRequestId,phase:"finished",title:p.title,stdout:"",stderr:s.raw,results:[],exitCode:1,timedOut:false,canceled:false,truncated:false,elapsedMs:1,error:"编译未完成，请查看错误输出"};return s.count;
   }
   throw Error("Unexpected diagnostic fixture IPC "+command);
  }};
 });
 await page.goto("http://127.0.0.1:5173");
 const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true});await editor.waitFor();
 // Select language explicitly rather than relying on saved preference formats.
 await page.locator('select[aria-label="编程语言"]').selectOption("java");
 await page.getByRole("button",{name:"本地",exact:true}).click();
 const panel=page.getByRole("region",{name:"本地运行",exact:true});
 await page.getByRole("separator",{name:"调整本地面板高度",exact:true}).press("End");
 await panel.getByRole("button",{name:"本地执行",exact:true}).click();
 const diagnostics=panel.getByRole("region",{name:"错误输出",exact:true});
 await diagnostics.getByRole("button",{name:"Solution.java:2",exact:true}).waitFor();
 assert.equal(await diagnostics.locator(".diagnostic-list li").count(),3);
 assert.equal(await diagnostics.locator(".diagnostic-location button").count(),1,"only exact owned in-bounds source is navigable");
 assert.equal(await diagnostics.locator("img").count(),0,"compiler text is not interpreted as HTML");
 assert.equal(await diagnostics.locator(".diagnostic-excerpt pre").nth(1).textContent(),"\tint value = missing;");
 await diagnostics.getByRole("button",{name:"复制原始错误输出",exact:true}).click();
 await diagnostics.getByText("已复制原始错误输出",{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__diagnosticTest.copied),await page.evaluate(()=>window.__diagnosticTest.raw));
 await page.evaluate(()=>{window.__diagnosticTest.copyFail=true;});
 await diagnostics.getByRole("button",{name:"复制原始错误输出",exact:true}).click();
 await diagnostics.getByText("复制失败，请展开原始错误输出并手动复制",{exact:true}).waitFor();
 await diagnostics.getByRole("button",{name:"Solution.java:2",exact:true}).click();
 assert.equal(await editor.evaluate(el=>el===document.activeElement),true,"navigation focuses owned editor");
 await editor.press("Home");await editor.press("x");
 await diagnostics.getByText(/当前代码已改变/).waitFor();
 assert.equal(await diagnostics.locator(".diagnostic-location button").count(),0,"stale source is no longer navigable");
 await diagnostics.locator("summary").click();
 assert.equal(await diagnostics.locator(".diagnostic-raw pre").textContent(),await page.evaluate(()=>window.__diagnosticTest.raw));
 await page.screenshot({path:"evidence/compiler-diagnostics.png"});
 await page.evaluate(()=>{Object.assign(window.__diagnosticTest,{copyFail:false,deferCopy:true});});
 await diagnostics.getByRole("button",{name:"复制原始错误输出",exact:true}).click();
 assert.equal(await diagnostics.getByRole("button",{name:"复制原始错误输出",exact:true}).isDisabled(),true,"duplicate copy clicks are disabled while pending");
 await page.evaluate(()=>{window.__diagnosticTest.raw="unrecognized failure\n"+"x".repeat(70000);});
 await panel.getByRole("button",{name:"本地执行",exact:true}).click();
 await diagnostics.getByText("未识别到可结构化的诊断，请查看原始错误输出。",{exact:true}).waitFor();
 assert.equal(await diagnostics.locator(".diagnostic-raw pre").textContent(),await page.evaluate(()=>window.__diagnosticTest.raw));
 await page.evaluate(()=>window.__diagnosticTest.copyResume());
 await page.waitForTimeout(50);
 assert.equal(await diagnostics.getByText("已复制原始错误输出",{exact:true}).count(),0,"late clipboard success cannot claim a newer log was copied");
 assert.equal(await diagnostics.getByRole("button",{name:"复制原始错误输出",exact:true}).isEnabled(),true);
 assert.deepEqual(errors,[]);await page.close();
 await writeFile("evidence/COMPILER_DIAGNOSTICS_UI_RESULT.txt","PASS: ANSI summaries, exact owned source jump, external/out-of-range denial, untrusted text, source alignment, stale source guard, raw clipboard success/failure, bounded fallback with complete raw text. Mocked IPC; not native compiler execution.\n");
}
