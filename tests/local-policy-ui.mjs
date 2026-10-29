import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runLocalPolicyUI(testPage,origin="http://127.0.0.1:5173"){
 const page=await testPage({viewport:{width:1280,height:960}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  const s=window.__localPolicy={starts:[],record:null,result:null,actual:"[0.30000000000000004,1000001]",metadata:JSON.stringify({name:"solve",params:[{name:"values",type:"double[]"}],return:{type:"double[]"}})};
  const question=()=>({...window.__fixtureQuestions[0],metaData:s.metadata,sampleTestCase:"[0.3,1000000]",exampleTestcases:"[0.3,1000000]"});
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="load_recent_questions")return [question()];
   if(command==="get_question")return {question:question(),cacheWarning:null,fromCache:false};
   if(command==="search_questions"){const q=question();return {questions:[{frontendQuestionId:q.questionFrontendId,title:q.title,titleCn:q.translatedTitle,titleSlug:q.titleSlug,difficulty:"Easy",paidOnly:false}],total:1,hasMore:false};}
   if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
   if(command==="load_document")return {code:"// local policy fixture",notes:null};
   if(command==="external_editor_supported")return false;
   if(command==="start_language_service")throw Error("offline");
   if(command==="stop_language_service")return;
   if(command==="debug_status")return null;
   if(command==="local_run_status")return s.result;
   if(command==="local_run_record")return s.record;
   if(command==="start_local_run"){
    const p=args.snapshot;s.starts.push(p);
    s.record={mode:p.mode,documentKey:p.documentKey,clientRequestId:p.clientRequestId,snapshot:{code:p.code,input:p.input,metadata:p.metadata,title:p.title,language:p.language},cases:p.cases,invocations:p.cases.map((_,caseIndex)=>({caseIndex,groupIndex:0,caseNumber:caseIndex+1}))};
    s.result={id:s.starts.length,documentKey:p.documentKey,clientRequestId:p.clientRequestId,phase:"finished",title:p.title,stdout:"authored stdout retained",stderr:"",results:[`{"case":1,"ok":true,"value":${s.actual}}`],exitCode:0,timedOut:false,canceled:false,truncated:false,elapsedMs:1,error:""};return s.result.id;
   }
   throw Error("Unexpected local policy IPC "+command);
  }};
 });
 await page.goto(origin);await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
 await page.getByRole("button",{name:"本地",exact:true}).click();
 await page.getByRole("separator",{name:"调整本地面板高度",exact:true}).press("End");
 const panel=page.getByRole("region",{name:"本地运行",exact:true});
 await panel.locator(".case-expectation summary").click();
 const expected=panel.getByRole("textbox",{name:"预期结果",exact:true}),policy=panel.getByRole("combobox",{name:"预期结果比较方式",exact:true});
 await expected.fill("[0.3,1000000]");
 async function run(label){await panel.getByRole("button",{name:"本地执行",exact:true}).click();await panel.locator(".case-result header").getByText(label,{exact:true}).waitFor();}
 await run("与预期不符");
 assert.equal(await panel.locator(".local-result").textContent(),"[0.30000000000000004,1000001]","complete raw numbers remain readable");
 await policy.selectOption("float-json");
 await panel.getByLabel("结果对应内容").filter({hasText:"预期结果已修改"}).waitFor();
 await run("符合预期");
 const absolute=panel.getByRole("textbox",{name:"绝对误差",exact:true}),relative=panel.getByRole("textbox",{name:"相对误差",exact:true});
 await absolute.fill("0");await relative.fill("0");await run("与预期不符");
 const before=await page.evaluate(()=>window.__localPolicy.starts.length);
 await absolute.fill("-");await panel.getByRole("button",{name:"本地执行",exact:true}).click();
 await panel.getByRole("alert").filter({hasText:"JSON"}).waitFor();
 assert.equal(await page.evaluate(()=>window.__localPolicy.starts.length),before,"invalid tolerance cannot launch a run");
 await absolute.fill("1e-6");await relative.fill("1e-6");
 await page.evaluate(()=>{window.__localPolicy.actual="[2,1,2]";});
 await policy.selectOption("unordered-array");await expected.fill("[1,2,2]");await run("符合预期");
 await expected.fill("[1,1,2]");await run("与预期不符");
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith("inkleet.test-cases.v1:")))));
 assert.equal(saved.cases[0].expectation.mode,"unordered-array");
 assert.equal(saved.cases[0].expectation.value,"[1,1,2]");
 assert.equal(await panel.getByText("authored stdout retained",{exact:true}).count(),1);
 await page.screenshot({path:"evidence/local-comparison-policies.png"});
 // A design sequence uses two explicit inputs and has no ambiguous post-call target.
 await panel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).selectOption("argument:0");
 await page.evaluate(()=>{window.__localPolicy.metadata=JSON.stringify({systemdesign:true,classname:"Counter",constructor:{params:[]},methods:[{name:"get",params:[],return:{type:"integer"}}]});window.__localPolicy.actual="[null,42]";});
 await page.locator('.question-sidebar [data-slug="inkleet-test-fixture"]').click();
 const input=panel.getByRole("textbox",{name:"本地测试输入",exact:true});await input.fill('["Counter","get"]\n[[],[]]');
 await panel.getByRole("button",{name:"切换为参数输入",exact:true}).click();
 assert.equal(await panel.getByRole("textbox",{name:"参数 操作",exact:true}).inputValue(),'["Counter","get"]');
 assert.equal(await panel.getByRole("textbox",{name:"参数 参数",exact:true}).inputValue(),"[[],[]]");
 assert.equal(await panel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).locator("option:checked").textContent(),"原参数目标不可用");
 await panel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).selectOption("return");
 assert.equal(await panel.getByRole("combobox",{name:"预期结果比较目标",exact:true}).locator("option").count(),1);
 await policy.selectOption("exact-json");await expected.fill("[null,42]");await run("符合预期");
 assert.equal(await page.evaluate(()=>window.__localPolicy.starts.at(-1).input),'["Counter","get"]\n[[],[]]');
 await policy.selectOption("float-json");await absolute.fill("0.25");await relative.fill("0");
 await page.reload();await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();await page.getByRole("button",{name:"本地",exact:true}).click();
 await panel.locator(".case-expectation summary").click();
 assert.equal(await policy.inputValue(),"float-json");assert.equal(await absolute.inputValue(),"0.25");assert.equal(await relative.inputValue(),"0");
 assert.deepEqual(errors,[]);await page.close();
 await writeFile("evidence/LOCAL_POLICY_UI_RESULT.txt","PASS: explicit exact/tolerance/outer-array multiset UI, tolerance validation before launch, duplicate-count mismatches, immutable stale-result notice, full number/stdout display, design operation/argument fields, return-only design target, reload persistence. Authored mocked run IPC; real compiler/interpreter fixtures are separate.\n");
}
