import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runDebugVisualsUI(testPage){
 const page=await testPage({viewport:{width:1400,height:1100}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  const state=window.__visualTest={debug:null,calls:[],defer:false,reply:null,repeat:false};
  const variable=(name,value,reference=0,type="i32",extra={})=>({name,value,variablesReference:reference,type,...extra});
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="search_questions")return {questions:[],total:0,hasMore:false};
   if(command==="load_recent_questions")return window.__fixtureQuestions;
   if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
   if(command==="load_document")return {code:null,notes:null};
   if(command==="save_text"||command==="stop_language_service")return;
   if(command==="start_language_service")throw Error("offline fixture");
   if(command==="local_run_status")return null;
   if(command==="debug_status")return state.debug?JSON.parse(JSON.stringify(state.debug)):null;
   if(command==="start_debug"){state.debug={id:1,phase:"paused",title:args.snapshot.title,threadId:1,epoch:1,output:"",truncated:false,reason:"breakpoint",error:"",breakpoints:[]};return 1;}
   if(command==="stop_debug"){state.debug.phase="finished";state.debug.epoch++;return;}
   if(command==="debug_request"){
    if(args.kind==="threads")return {threads:[{id:1,name:"main"}]};
    if(args.kind==="stackTrace")return {stackFrames:[{id:1,name:"solve",line:1,inkleetSource:true,source:{name:"solution.rs"}}]};
    if(args.kind==="scopes")return {scopes:[{name:"Locals",variablesReference:1}]};
    if(args.kind==="variables"){
     state.calls.push({...args});
     if(args.reference===1)return {variables:[variable("values","size=101",2,"alloc::vec::Vec<i32>",{indexedVariables:101}),variable("map","size=1",3,"std::collections::hash::map::HashMap<i32, i32>"),variable("long_value","x".repeat(17000)),variable("repeat","size=?",5,"alloc::vec::Vec<i32>")]};
     if(args.reference===2){
      if(state.defer)return new Promise(resolve=>state.reply=()=>resolve({variables:[variable("late_child","stale")]}));
      return {variables:Array.from({length:Math.min(args.count??100,101-(args.start??0))},(_,i)=>variable(`[${i+(args.start??0)}]`,String(i+(args.start??0))))};
     }
     if(args.reference===3)return {variables:[variable("[0]","(3, 30)",4,"(i32, i32)")]};
     if(args.reference===4)return {variables:[variable("0","3"),variable("1","30")]};
     if(args.reference===5)return {variables:Array.from({length:100},(_,i)=>variable(`[${i}]`,String(i)))};
    }
    if(args.kind==="next"){state.debug.epoch++;return {};}
    return {};
   }
   throw Error("Unexpected visual fixture IPC "+command);
  }};
 });
 await page.goto("http://127.0.0.1:5173");
 await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
 await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("rust");
 await page.getByRole("button",{name:"本地",exact:true}).click();
 const panel=page.getByRole("region",{name:"本地运行",exact:true});
 await panel.locator('[data-local-tab="debug"]').click();
 await panel.getByRole("button",{name:"开始调试",exact:true}).click();
 const values=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="values"])');
 await values.getByRole("button",{name:"values",exact:true}).click();
 await values.getByRole("button",{name:"加载下一页",exact:true}).waitFor();
 assert.equal(await values.locator(':scope > .debug-tree-children > .debug-tree-node').count(),100);
 await values.getByRole("button",{name:"加载下一页",exact:true}).click();
 await values.getByRole("button",{name:"[100]",exact:true}).waitFor();
 assert.equal(await values.locator(':scope > .debug-tree-children > .debug-tree-node').count(),101);
 assert.equal(await values.getByRole("button",{name:"加载下一页",exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.__visualTest.calls.filter(c=>c.reference===2).map(c=>[c.start,c.count])),[[0,100],[100,100]]);
 await values.locator(':scope > .debug-variable-meta').getByText('alloc::vec::Vec<i32>',{exact:true}).waitFor();
 const map=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="map"])');
 await map.getByRole("button",{name:"map",exact:true}).click();
 await map.getByRole("button",{name:"[0]",exact:true}).click();
 await map.locator('.debug-map-fields').waitFor();
 assert.deepEqual(await map.locator('.debug-field-label').allTextContents(),["键","值"]);
 await panel.getByRole("button",{name:"查看变量详情 long_value",exact:true}).click();
 const detail=panel.getByRole("region",{name:"变量详情 long_value",exact:true});
 assert.equal((await detail.locator('pre').textContent()).length,16000);
 await detail.getByText(/这不是完整值/).waitFor();
 const repeat=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="repeat"])');
 await repeat.getByRole("button",{name:"repeat",exact:true}).click();
 await repeat.getByRole("button",{name:"加载下一页",exact:true}).click();
 await repeat.getByText("调试器未提供下一页，已停止重复加载",{exact:true}).waitFor();
 assert.equal(await repeat.locator(':scope > .debug-tree-children > .debug-tree-node').count(),100);
 // A new pause resets pages, and collapse owns any late child response.
 await page.evaluate(()=>{window.__visualTest.debug.epoch++;window.__visualTest.defer=true;});
 await values.getByRole("button",{name:"values",exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.debug-variable > button[aria-label="values"]')?.getAttribute('aria-expanded')==='false');
 await values.getByRole("button",{name:"values",exact:true}).click();
 await page.waitForFunction(()=>typeof window.__visualTest.reply==='function');
 await values.getByRole("button",{name:"values",exact:true}).click();
 await page.evaluate(()=>window.__visualTest.reply());
 await page.waitForTimeout(50);
 assert.equal(await panel.getByRole("button",{name:"late_child",exact:true}).count(),0);
 await page.screenshot({path:"evidence/rust-variable-visuals-ui.png"});
 assert.deepEqual(errors,[]);await page.close();
 await writeFile("evidence/RUST_VARIABLE_VISUALS_UI_RESULT.txt","PASS: mocked DAP 101-item paging, visible types, verified pair columns, long-value truncation, repeated adapter page guard and collapsed late response. Not native Rust/CodeLLDB qualification.\n");
}
