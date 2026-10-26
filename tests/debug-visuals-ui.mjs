import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runDebugVisualsUI(testPage){
 const page=await testPage({viewport:{width:1400,height:1100}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  const state=window.__visualTest={debug:null,calls:[],defer:false,reply:null,repeat:false,pairDefer:false,pairReplies:[]};
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
     if(args.reference===1)return {variables:[variable("values","size=101",2,"alloc::vec::Vec<i32>",{indexedVariables:101}),variable("map","{...}",3,"std::collections::hash::map::HashMap<i32, usize>"),variable("words","{...}",10,"std::collections::hash::map::HashMap<alloc::string::String, i32>"),variable("nested","{...}",20,"std::collections::hash::map::HashMap<alloc::string::String, alloc::vec::Vec<i32>>"),variable("empty_leaf","size=0",0,"std::collections::hash::map::HashMap<i32, i32>"),variable("empty","size=0",30,"std::collections::hash::map::HashMap<i32, i32>"),variable("long_map","{...}",40,"std::collections::hash::map::HashMap<alloc::string::String, i32>"),variable("long_value","x".repeat(17000)),variable("repeat","size=?",5,"alloc::vec::Vec<i32>")]};
     if(args.reference===2){
      if(state.defer)return new Promise(resolve=>state.reply=()=>resolve({variables:[variable("late_child","stale")]}));
      return {variables:Array.from({length:Math.min(args.count??100,101-(args.start??0))},(_,i)=>variable(`[${i+(args.start??0)}]`,String(i+(args.start??0))))};
     }
     if(args.reference===3)return {variables:[variable("[0]","{...}",4,"(i32, usize)"),variable("[1]","{...}",6,"(i32, usize)")]};
     if(args.reference===4||args.reference===6){
      const variables=args.reference===4?[variable("0","3"),variable("1","30",0,"usize")]:[variable("0","8"),variable("1","80",0,"usize")];
      if(state.pairDefer)return new Promise(resolve=>state.pairReplies.push(()=>resolve({variables})));
      return{variables};
     }
     if(args.reference===10)return{variables:[variable("[0]","{...}",11,"(alloc::string::String, i32)")]};
     if(args.reference===11)return{variables:[variable("0",'"hello"',0,"alloc::string::String"),variable("1","42")]};
     if(args.reference===20)return{variables:[variable("[0]","{...}",21,"(alloc::string::String, alloc::vec::Vec<i32>)")]};
     if(args.reference===21)return{variables:[variable("0",'"nums"',0,"alloc::string::String"),variable("1","size=2",22,"alloc::vec::Vec<i32>")]};
     if(args.reference===22)return{variables:[variable("[0]","5"),variable("[1]","9")]};
     if(args.reference===30)return{variables:[]};
     if(args.reference===40)return{variables:[variable("[0]","{...}",41,"(alloc::string::String, i32)")]};
     if(args.reference===41)return{variables:[variable("0",'"'+"long-key-".repeat(10)+'"',0,"alloc::string::String"),variable("1","7")]};
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
 await values.locator(':scope > .debug-variable > .debug-variable-type').getByText('Vec<i32>',{exact:true}).waitFor();
 assert.equal(await values.locator(':scope > .debug-tree-children > .debug-tree-node .debug-variable-type').count(),0);
 const map=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="map"])');
 await map.getByRole("button",{name:"map",exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.debug-kind-map .debug-map-row').length===2);
 const pairs=await map.locator('.debug-map-row').evaluateAll(rows=>rows.map(row=>[row.querySelector('[data-map-field="key"] .debug-variable button code').textContent,row.querySelector('[data-map-field="value"] .debug-variable button code').textContent]));
 assert.deepEqual(pairs,[["3","30"],["8","80"]]);
 assert.equal(await map.getByRole("button",{name:"[0]",exact:true}).count(),0);
 assert.equal(await map.locator('.debug-variable-meta,.debug-field-label,.debug-page-controls').count(),0);
 assert.equal((await map.innerText()).includes("键 → 值"),false);
 assert.equal((await map.innerText()).includes("{...}"),false);
 assert.deepEqual(await page.evaluate(()=>window.__visualTest.calls.filter(c=>c.reference===3).map(c=>[c.start,c.count])),[[0,20]]);
 const words=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="words"])');
 await words.getByRole("button",{name:"words",exact:true}).click();
 await words.locator('[data-map-field="key"]').getByText('"hello"',{exact:true}).waitFor();
 await words.locator('[data-map-field="value"]').getByText('42',{exact:true}).waitFor();
 const nested=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="nested"])');
 await nested.getByRole("button",{name:"nested",exact:true}).click();
 await nested.getByRole("button",{name:"[0] 的值",exact:true}).click();
 await nested.getByRole("button",{name:"[1]",exact:true}).waitFor();
 assert.deepEqual(await nested.locator('[data-map-field="value"] .debug-tree-children > .debug-tree-node > .debug-variable > code').allTextContents(),["5","9"]);
 const empty=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="empty"])');
 await empty.getByRole("button",{name:"empty",exact:true}).click();
 await empty.getByText("空",{exact:true}).waitFor();
 const emptyLeaf=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="empty_leaf"])');
 assert.equal(await emptyLeaf.getByRole("button",{name:"empty_leaf",exact:true}).isDisabled(),true);
 await emptyLeaf.getByText("空",{exact:true}).waitFor();
 await page.screenshot({path:"evidence/rust-map-readable-rows-ui.png"});
 await panel.getByRole("button",{name:"查看变量详情 long_value",exact:true}).click();
 const detail=panel.getByRole("region",{name:"变量详情 long_value",exact:true});
 assert.equal((await detail.locator('pre').textContent()).length,16000);
 await detail.getByText(/这不是完整值/).waitFor();
 const repeat=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="repeat"])');
 await repeat.getByRole("button",{name:"repeat",exact:true}).click();
 await repeat.getByRole("button",{name:"加载下一页",exact:true}).click();
 await repeat.getByText("调试器未提供下一页，已停止重复加载",{exact:true}).waitFor();
 assert.equal(await repeat.locator(':scope > .debug-tree-children > .debug-tree-node').count(),100);
 const longMap=panel.locator('.debug-tree-node:has(> .debug-variable > button[aria-label="long_map"])');
 await longMap.getByRole("button",{name:"long_map",exact:true}).click();
 const longKey=longMap.getByRole("button",{name:"[0] 的键",exact:true});
 await longKey.waitFor();
 await longMap.evaluate(node=>{node.style.width="240px";});
 await longKey.focus();await page.keyboard.press("Enter");
 const keyDetail=longMap.getByRole("region",{name:"变量详情 [0] 的键",exact:true});
 assert.equal(await keyDetail.locator('pre').textContent(),'"'+"long-key-".repeat(10)+'"');
 assert.equal(await longKey.locator('code').getAttribute('title'),'"'+"long-key-".repeat(10)+'"');
 // A collapsed map must not reveal pair data from a completed old read.
 await map.getByRole("button",{name:"map",exact:true}).click();
 await page.evaluate(()=>{window.__visualTest.pairDefer=true;});
 await map.getByRole("button",{name:"map",exact:true}).click();
 await page.waitForFunction(()=>window.__visualTest.pairReplies.length===2);
 await map.getByRole("button",{name:"map",exact:true}).click();
 await page.evaluate(()=>window.__visualTest.pairReplies.forEach(resolve=>resolve()));
 await page.waitForTimeout(50);
 assert.equal(await map.locator('.debug-map-row').count(),0);
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
 await writeFile("evidence/RUST_VARIABLE_VISUALS_UI_RESULT.txt","PASS: mocked DAP 101-item paging, visible types, one-expand actual key/value rows, String keys, nested Vec values, empty maps, bounded pair reads, collapsed pair cancellation, long-value truncation, repeated adapter page guard and collapsed late response. Not native Rust/CodeLLDB qualification.\n");
}
