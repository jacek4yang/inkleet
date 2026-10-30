import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

/** Actual App/CodeMirror DOM; authored storage IPC fixture, not native disk proof. */
export async function runSolutionArchiveUI(testPage){
 const page=await testPage({viewport:{width:1440,height:900}});
 await page.addInitScript(()=>{
  window.isTauri=true;
  const A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const name="完整解答名称".repeat(12);
  const state=window.__solutionArchive={A,B,name,entries:[{id:"default",name:"默认解答"},{id:A,name},{id:B,name:"另一个解答"}],archived:[],docs:{default:"// default",[A]:"// saved A",[B]:"// saved B"},drafts:{},calls:[],pending:[],holdSave:false,holdArchive:false,holdRestore:false,holdList:false,failArchive:false,failRestore:false};
  const defer=(kind,args,run)=>new Promise((resolve,reject)=>state.pending.push({kind,args,release:()=>{try{resolve(run());}catch(e){reject(e);}}}));
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="load_recent_questions")return window.__fixtureQuestions;
   if(command==="search_questions")return {questions:[],total:0,hasMore:false};
   if(command==="external_editor_supported")return false;
   if(command==="login_status")return null;
   if(command==="stop_language_service")return;
   if(command==="start_language_service")throw Error("No real LSP in solution archive fixture");
   if(command==="list_solutions"){
    const run=()=>structuredClone({entries:args.language==="rust"?state.entries:[{id:"default",name:"默认解答"}],archived:args.language==="rust"?state.archived:[],unreadable:0});
    return state.holdList?defer(command,args,run):run();
   }
   if(command==="load_document"){
    const id=args.solution??"default";
    if(state.archived.some(e=>e.id===id))throw Error("解答已归档");
    return {code:state.docs[id]??"// other language",codeDraft:state.drafts[id]??null,notes:"# Shared notes"};
   }
   if(command==="save_text"){
    state.calls.push({command,args});
    const run=()=>{const id=args.solution??"default";if(state.docs[id]!==args.expected)throw Error("源码文件已变化");state.docs[id]=args.text;};
    return state.holdSave?defer(command,args,run):run();
   }
   if(command==="archive_solution"){
    state.calls.push({command,args});
    const run=()=>{
     if(state.failArchive)throw Error("归档失败，原文件保留");
     const entry=state.entries.find(e=>e.id===args.id);if(!entry||entry.name!==args.expected||state.docs[args.id]!==args.baseline)throw Error("源码文件已变化");
     state.drafts[args.id]={text:args.code,baseline:args.baseline};state.entries=state.entries.filter(e=>e.id!==args.id);state.archived.push(entry);return structuredClone(entry);
    };return state.holdArchive?defer(command,args,run):run();
   }
   if(command==="restore_solution"){
    state.calls.push({command,args});
    const run=()=>{if(state.failRestore)throw Error("恢复失败，归档仍保留");const entry=state.archived.find(e=>e.id===args.id);if(!entry||entry.name!==args.expected)throw Error("归档记录已变化");state.archived=state.archived.filter(e=>e.id!==args.id);state.entries.push(entry);return structuredClone(entry);};
    return state.holdRestore?defer(command,args,run):run();
   }
   throw Error("Unexpected archive fixture command: "+command);
  }};
 });
 await page.goto("http://127.0.0.1:5173");
 const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true}),select=page.getByRole("combobox",{name:"解答",exact:true});
 await editor.waitFor();
 const {A,B,name}=await page.evaluate(()=>window.__solutionArchive);
 async function menu(label){await page.locator(".solution-menu>summary").click();await page.getByRole("button",{name:label,exact:true}).click();}
 async function showArchive(){await menu("归档解答");return page.getByRole("dialog",{name:"归档解答",exact:true});}
 async function showArchived(){await page.locator(".solution-menu>summary").click();await page.locator(".solution-menu button").filter({hasText:/^已归档/}).click();return page.getByRole("dialog",{name:"已归档解答",exact:true});}
 async function release(kind){await page.evaluate(k=>{const s=window.__solutionArchive,index=s.pending.findIndex(p=>p.kind===k);if(index<0)throw Error("Missing held "+k);s.pending.splice(index,1)[0].release();},kind);}
 async function archiveNow(){const dialog=await showArchive();await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await dialog.waitFor({state:"hidden"});}
 // Default remains usable: there is always one active solution.
 await page.locator(".solution-menu>summary").click();assert.equal(await page.getByRole("button",{name:"归档解答",exact:true}).isDisabled(),true);await page.locator(".solution-menu>summary").click();
 await select.selectOption(A);await editor.fill("// unsaved archive draft");
 let dialog=await showArchive();assert.ok((await dialog.innerText()).includes(name));
 await dialog.getByRole("button",{name:"取消",exact:true}).click();assert.equal((await page.evaluate(()=>window.__solutionArchive.calls)).length,0,"cancel is non-mutating");
 dialog=await showArchive();await page.evaluate(()=>window.__solutionArchive.failArchive=true);await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.equal(await select.inputValue(),A);assert.equal(await editor.innerText(),"// unsaved archive draft");
 await dialog.getByRole("button",{name:"取消",exact:true}).click();await page.evaluate(()=>window.__solutionArchive.failArchive=false);
 // Confirmed archive waits for an already requested save; never races its old baseline.
 await page.evaluate(()=>window.__solutionArchive.holdSave=true);await editor.press("Control+s");await page.waitForFunction(()=>window.__solutionArchive.pending.some(p=>p.kind==="save_text"));
 dialog=await showArchive();await dialog.getByRole("button",{name:"确认归档",exact:true}).click();
 assert.equal(await dialog.getByRole("button",{name:"取消",exact:true}).isDisabled(),true);
 await dialog.press("Escape");assert.equal(await dialog.isVisible(),true,"pending transition keeps its modal owner");
 assert.equal(await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="archive_solution").length),1,"archive call is not sent before save drains");
 await release("save_text");await dialog.waitFor({state:"hidden"});assert.equal(await select.inputValue(),"default");
 assert.equal(await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="archive_solution").at(-1).args.baseline),"// unsaved archive draft");
 let archived=await showArchived();assert.ok((await archived.innerText()).includes(name),"full archived name is not ellipsized out of the DOM");
 await page.screenshot({path:"evidence/solution-archive-browser.png",fullPage:true});
 // Refresh owns the list until it settles. Restore cannot invalidate its
 // completion and leave the whole picker stuck in the loading state.
 await page.evaluate(()=>window.__solutionArchive.holdList=true);await archived.getByRole("button",{name:"刷新",exact:true}).click();await page.waitForFunction(()=>window.__solutionArchive.pending.some(p=>p.kind==="list_solutions"));
 const restoreButton=archived.getByRole("button",{name:"恢复解答「"+name+"」",exact:true});
 assert.equal(await restoreButton.isDisabled(),true);const restoresBefore=await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="restore_solution").length);
 await restoreButton.evaluate(button=>button.click());assert.equal(await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="restore_solution").length),restoresBefore);
 await page.evaluate(()=>window.__solutionArchive.holdList=false);await release("list_solutions");await page.waitForFunction(()=>!document.querySelector('.solution-archives button').disabled);
 await page.evaluate(()=>window.__solutionArchive.failRestore=true);await archived.getByRole("button",{name:"恢复解答「"+name+"」",exact:true}).click();await archived.getByRole("alert").waitFor();assert.equal(await select.inputValue(),"default");
 await page.evaluate(()=>{window.__solutionArchive.failRestore=false;window.__solutionArchive.holdSave=false;});await archived.getByRole("button",{name:"恢复解答「"+name+"」",exact:true}).click();await archived.waitFor({state:"hidden"});assert.equal(await select.inputValue(),A);assert.equal(await editor.innerText(),"// unsaved archive draft");
 await page.locator(".solution-menu>summary").click();assert.equal(await page.getByRole("button",{name:"复制解答",exact:true}).isDisabled(),false,"picker is not left loading after refresh then restore");await page.locator(".solution-menu>summary").click();
 // Preserve a truly unsaved draft, then restore it from the mock disk load.
 await editor.fill("// dirty draft kept by archive");await archiveNow();assert.equal(await page.evaluate(()=>window.__solutionArchive.docs[window.__solutionArchive.A]),"// unsaved archive draft");
 archived=await showArchived();await archived.getByRole("button",{name:"恢复解答「"+name+"」",exact:true}).click();await archived.waitFor({state:"hidden"});assert.equal(await editor.innerText(),"// dirty draft kept by archive");assert.equal(await page.getByRole("img",{name:"源码未保存",exact:true}).count(),1);
 // A changed snapshot must be reconfirmed, even when a programmatic edit bypasses modal inertness.
 dialog=await showArchive();await page.evaluate(async()=>{const {EditorView}=await import("/tests/input-harness.ts");const view=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:"// new after confirmation"}});});
 const before=await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="archive_solution").length);await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await dialog.getByRole("alert").filter({hasText:"变化"}).waitFor();assert.equal(await page.evaluate(()=>window.__solutionArchive.calls.filter(c=>c.command==="archive_solution").length),before);await dialog.getByRole("button",{name:"取消",exact:true}).click();
 // Duplicate click guard and source ownership after a late successful response.
 await page.evaluate(()=>window.__solutionArchive.holdArchive=true);dialog=await showArchive();await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await page.waitForFunction(()=>window.__solutionArchive.pending.some(p=>p.kind==="archive_solution"));
 await dialog.getByRole("button",{name:"确认归档",exact:true}).evaluate(button=>{button.click();button.click();});assert.equal(await page.evaluate(()=>window.__solutionArchive.pending.filter(p=>p.kind==="archive_solution").length),1);
 await page.evaluate(id=>{const select=document.querySelector('select[aria-label="解答"]');select.value=id;select.dispatchEvent(new Event("change",{bubbles:true}));},B);
 await release("archive_solution");await dialog.waitFor({state:"hidden"});assert.equal(await select.inputValue(),B,"late archive does not replace newer selection");assert.equal(await editor.innerText(),"// saved B");
 // Restore also cannot reclaim focus/selection after newer navigation.
 archived=await showArchived();await page.evaluate(()=>window.__solutionArchive.holdRestore=true);await archived.getByRole("button",{name:"恢复解答「"+name+"」",exact:true}).click();await page.waitForFunction(()=>window.__solutionArchive.pending.some(p=>p.kind==="restore_solution"));
 await page.evaluate(()=>{const select=document.querySelector('select[aria-label="解答"]');select.value="default";select.dispatchEvent(new Event("change",{bubbles:true}));});await release("restore_solution");await page.waitForFunction(()=>!document.querySelector('dialog[aria-label="已归档解答"] button[aria-label^="关闭"]').disabled);assert.equal(await select.inputValue(),"default");await archived.getByRole("button",{name:"关闭",exact:true}).click();
 await select.selectOption(A);assert.equal(await editor.innerText(),"// new after confirmation");
 // Unmount by language during an outstanding archive: no old reply enters the new list.
 await page.evaluate(()=>window.__solutionArchive.holdRestore=false);dialog=await showArchive();await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await page.waitForFunction(()=>window.__solutionArchive.pending.some(p=>p.kind==="archive_solution"));
 await page.evaluate(()=>{const select=document.querySelector('select[aria-label="编程语言"]');select.value="python3";select.dispatchEvent(new Event("change",{bubbles:true}));});await release("archive_solution");await page.waitForFunction(()=>document.querySelector('select[aria-label="编程语言"]').value==="python3");assert.equal(await select.inputValue(),"default");assert.equal(await select.locator(`option[value="${A}"]`).count(),0);
 await page.close();
 await writeFile("evidence/SOLUTION_ARCHIVE_UI_RESULT.txt","PASS: actual Chromium App with mocked storage IPC; archive confirmation/cancel, full names, save-drain ordering, failure retention, dirty draft restoration, duplicate guard, stale source/selection/unmount isolation. Native filesystem and restart evidence are separate.\n");
}
