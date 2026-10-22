import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runSettingsJSONUI(browser,fixtures){
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await page.addInitScript(fixtures=>{
  window.isTauri=true;
  const defaults={version:1,vim:false,formatOnSave:true,overrides:{}};
  const stored=JSON.parse(localStorage.getItem("settings-json-fixture")||"null");
  const state=window.__settingsJSON={snapshot:stored??{settings:defaults,revision:null},writes:[],hold:false,resolve:null};
  window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
   if(command==="get_editor_settings")return structuredClone(state.snapshot);
   if(command==="save_editor_settings"){
    state.writes.push(structuredClone(args));if(state.hold)await new Promise(resolve=>state.resolve=resolve);
    if(args.expected!==state.snapshot.revision)throw Error("fixture revision conflict");
    state.snapshot={settings:args.settings,revision:JSON.stringify(args.settings)};
    localStorage.setItem("settings-json-fixture",JSON.stringify(state.snapshot));return structuredClone(state.snapshot);
   }
   if(command==="load_recent_questions")return [fixtures[0]];
   if(command==="load_document")return {code:"// initial source",notes:""};
   if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
   if(command==="search_questions")return {questions:[],total:0,hasMore:false};
   if(command==="login_status"||command==="local_run_status")return null;
   if(command==="external_editor_supported")return false;
   if(command==="begin_draft_session")return 1;
   if(command==="checkpoint_draft"||command==="stop_language_service")return;
   throw Error("offline "+command);
  }};
 },fixtures);
 try{
  await page.goto("http://127.0.0.1:5173");
  const code=page.getByRole("textbox",{name:"代码编辑器",exact:true});await code.waitFor();
  await code.fill("// retained across setting changes");
  await code.evaluate(async node=>{const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");window.__settingsOriginalView=EditorView.findFromDOM(node.closest(".cm-editor"));});
  const open=async()=>{await page.locator('[data-action="open-settings"]').click();return page.getByRole("dialog",{name:"设置",exact:true});};
  let dialog=await open();const json=()=>dialog.getByRole("textbox",{name:"设置 JSON",exact:true});
  const model=()=>json().evaluate(async node=>{const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");return EditorView.findFromDOM(node.closest(".cm-editor")).state.doc.toString();});
  const jsonMode=()=>dialog.getByRole("button",{name:"JSON",exact:true}).click();
  const save=()=>dialog.getByRole("button",{name:"保存设置",exact:true});
  await jsonMode();assert.equal(JSON.parse(await model()).vim,false);
  const broken='{"version":1,"vim":false,"vim":true,"formatOnSave":true,"overrides":{}}';
  await json().fill(broken);assert.equal(await save().isDisabled(),true);
  await dialog.getByRole("button",{name:"可视化",exact:true}).click();
  await dialog.getByText("JSON 尚未通过校验，请返回 JSON 修复；原草稿保留。",{exact:true}).waitFor();
  await dialog.getByRole("navigation",{name:"设置分类"}).getByRole("button",{name:"源码",exact:true}).click();
  await dialog.getByRole("navigation",{name:"设置分类"}).getByRole("button",{name:"编辑器",exact:true}).click();
  await jsonMode();assert.equal(await model(),broken);
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  const discard=page.getByRole("dialog",{name:"未保存的设置",exact:true});await discard.waitFor();
  await discard.getByRole("button",{name:"继续编辑",exact:true}).click();assert.equal(await model(),broken);
  await json().focus();
  const beforeDiscardSelection=await json().evaluate(async node=>{const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");return EditorView.findFromDOM(node.closest(".cm-editor")).state.selection.toJSON();});
  await page.keyboard.press("Escape");await discard.waitFor();await discard.getByRole("button",{name:"继续编辑",exact:true}).click();assert.equal(await model(),broken);
  assert.equal(await json().evaluate(node=>node===document.activeElement),true,"cancel discard restores JSON editor focus");
  assert.deepEqual(await json().evaluate(async node=>{const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");return EditorView.findFromDOM(node.closest(".cm-editor")).state.selection.toJSON();}),beforeDiscardSelection);
  const custom={version:1,vim:false,formatOnSave:true,overrides:{rust:false},theme:"dark",fontSize:18,lineHeight:1.6,wordWrap:true,lineNumbers:false,indentGuides:false,highlightActiveLine:false};
  await json().fill(JSON.stringify(custom,null,2));
  await dialog.getByRole("button",{name:"可视化",exact:true}).click();
  assert.equal(await dialog.getByRole("combobox",{name:"配色主题",exact:true}).inputValue(),"dark");
  await dialog.getByRole("combobox",{name:"编辑器字号",exact:true}).selectOption("20");
  await jsonMode();assert.equal(JSON.parse(await model()).fontSize,20);
  await page.evaluate(()=>window.__settingsJSON.hold=true);
  await save().evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>window.__settingsJSON.writes.length===1);
  assert.equal(await json().evaluate(node=>node.isContentEditable),false);
  assert.equal(await dialog.getByRole("button",{name:"关闭设置",exact:true}).isDisabled(),true);
  await page.evaluate(()=>{window.__settingsJSON.hold=false;window.__settingsJSON.resolve();});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  await page.waitForFunction(()=>!document.querySelector('[aria-label="关闭设置"]').disabled);
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();await dialog.waitFor({state:"hidden"});
  assert.deepEqual(await code.evaluate(async node=>{
   const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");const view=EditorView.findFromDOM(node.closest(".cm-editor"));
   return {same:view===window.__settingsOriginalView,text:view.state.doc.toString(),size:getComputedStyle(view.dom).fontSize,wrap:view.contentDOM.classList.contains("cm-lineWrapping"),lineNumbers:getComputedStyle(view.dom.querySelector(".cm-lineNumbers")).display};
  }),{same:true,text:"// retained across setting changes",size:"20px",wrap:true,lineNumbers:"none"});
  // CSS precedence probe only; inspect synchronously before CodeMirror repairs DOM.
  const pausedTint=await code.evaluate(node=>{
   const line=node.querySelector(".cm-line"),original=line.className;
   try{line.classList.add("cm-activeLine","cm-debug-stopped");return getComputedStyle(line).backgroundColor;}
   finally{line.className=original;}
  });
  assert.notEqual(pausedTint,"rgba(0, 0, 0, 0)","disabling active-line tint must not erase debug pause styling");
  await page.screenshot({path:"evidence/settings-dark-editor.png"});
  dialog=await open();await jsonMode();
  const conflicting=JSON.stringify({...custom,fontSize:22},null,2);await json().fill(conflicting);
  await page.evaluate(()=>{window.__settingsJSON.snapshot={settings:{...window.__settingsJSON.snapshot.settings,fontSize:21},revision:"external-change"};});
  await save().click();await dialog.getByRole("alert").filter({hasText:"fixture revision conflict"}).waitFor();assert.equal(await model(),conflicting);
  await dialog.getByRole("button",{name:"重新读取",exact:true}).click();
  const reload=dialog.getByRole("alertdialog",{name:"放弃设置草稿并重新读取",exact:true});await reload.waitFor();
  await page.keyboard.press("Escape");await reload.waitFor({state:"hidden"});assert.equal(await model(),conflicting);
  await dialog.getByRole("button",{name:"重新读取",exact:true}).click();await reload.waitFor();
  await reload.getByRole("button",{name:"继续编辑",exact:true}).click();assert.equal(await model(),conflicting);
  await dialog.getByRole("button",{name:"重新读取",exact:true}).click();await reload.getByRole("button",{name:"放弃草稿并读取",exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue("--editor-font-size")==="21px");
  assert.equal(JSON.parse(await model()).fontSize,21);
  await json().fill(JSON.stringify({...custom,theme:"system"}));await save().click();
  await page.waitForFunction(()=>window.__settingsJSON.snapshot.settings.theme==="system");
  await page.emulateMedia({colorScheme:"dark"});await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  await page.emulateMedia({colorScheme:"light"});await page.waitForFunction(()=>document.documentElement.dataset.theme==="light");
  await page.screenshot({path:"evidence/settings-json-editor.png"});
  await json().fill("{");await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();await discard.waitFor();
  await discard.getByRole("button",{name:"放弃修改并继续",exact:true}).click();await dialog.waitFor({state:"hidden"});
  await page.reload();await code.waitFor();assert.equal(await page.evaluate(()=>window.__settingsJSON.snapshot.settings.theme),"system");
  assert.equal(await page.evaluate(()=>window.__settingsJSON.snapshot.settings.vim),false);
  assert.deepEqual(errors,[]);
  await writeFile("evidence/SETTINGS_JSON_RESULT.txt","PASS: strict shared JSON/visual draft, invalid retention, discard/reload confirmations, guarded save, stale revision conflict, live theme/font/wrap/line numbers without editor remount, system-theme updates and fixture-backed restart. Mocked settings IPC; native filesystem safety is tested separately.\n");
 }finally{await page.close();}
}
