import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

// Runs against the real App, then the real SourceViewer in an isolated owner.
// IPC models persistence; this does not claim native storage or live LSP coverage.
export async function runTabSizeUI(browser,fixtures,openSettings){
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 try{
  await page.addInitScript(questions=>{
   window.isTauri=true;
   const copy=value=>JSON.parse(JSON.stringify(value));
   const initial={settings:{version:1,vim:false,formatOnSave:false,overrides:{}},revision:null};
   const saved=localStorage.getItem("inkleet-tab-display-fixture");
   const s=window.__tabSizeTest={settings:saved?JSON.parse(saved):initial,reads:0,writes:[],commits:0,starts:[],stops:[],versions:{},updates:[],saves:[],formats:[],unexpected:[],hold:true,nextId:0,tabChanges:{code:0,notes:0}};
   window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
    if(command==="load_recent_questions")return questions;
    if(command==="search_questions")return {questions:[],total:0,hasMore:false};
    if(command==="external_editor_supported")return false;
    if(command==="login_status")return null;
    if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
    if(command==="load_document")return {code:"\talpha\n\tbeta",notes:"\t# note\n"};
    if(command==="begin_draft_session")return 1;
    if(command==="checkpoint_draft")return;
    if(command==="save_text"){s.saves.push(copy(args));return;}
    if(command==="get_editor_settings"){s.reads++;return copy(s.settings);}
    if(command==="save_editor_settings"){
     const request=copy(args);s.writes.push(request);
     if(s.hold)await new Promise(resolve=>{s.release=resolve;});
     if(request.expected!==s.settings.revision)throw Error("fixture settings revision conflict");
     s.settings={settings:request.settings,revision:(s.settings.revision??"tab-size")+"-"+ ++s.commits};
     localStorage.setItem("inkleet-tab-display-fixture",JSON.stringify(s.settings));
     return copy(s.settings);
    }
    if(command==="start_language_service"){const id=++s.nextId;s.starts.push(copy(args));s.versions[id]=1;return {id,version:1,server:"tab-size-fixture",uri:"file:///fixture/solution.rs"};}
    if(command==="stop_language_service"){s.stops.push(args.id);return;}
    if(command==="update_language_document"){s.versions[args.id]=args.version;s.updates.push(copy(args));return;}
    if(command==="language_diagnostics")return {version:s.versions[args.id],diagnostics:[]};
    if(command==="language_request")return args.kind==="definition"?[{uri:"file:///fixture/tab_source.rs",range:{start:{line:0,character:1},end:{line:0,character:4}}}]:null;
    if(command==="acquire_language_source")return {sourceId:1,uri:args.uri,name:"tab_source.rs",text:"\tpub fn tab_target() {}\n",declaration:false,language:"rust"};
    if(command==="language_cancel_source_navigation"||command==="language_cancel_completion")return;
    if(command==="format_source"){s.formats.push(copy(args));return args.text;}
    s.unexpected.push(command);throw Error("Unexpected tab display IPC: "+command);
   }};
  },fixtures);
  await page.goto("http://127.0.0.1:5173");
  const code=page.getByRole("textbox",{name:"代码编辑器",exact:true});
  await code.waitFor();
  await page.waitForFunction(()=>document.querySelector(".lsp-status.ready"));
  await page.getByRole("button",{name:"笔记",exact:true}).click();
  await page.getByRole("textbox",{name:"Markdown 笔记",exact:true}).waitFor();
  await page.evaluate(async()=>{
   const s=window.__tabSizeTest,api=s.api=await import("/tests/tab-size-harness.tsx");
   s.view=label=>api.EditorView.findFromDOM(document.querySelector('[aria-label="'+label+'"]').closest(".cm-editor"));
   const v=s.view("代码编辑器"),notes=s.view("Markdown 笔记");
   // Establish both undo and redo history, then a stationary caret after a tab.
   for(const text of ["!","?"])v.dispatch({changes:{from:v.state.doc.length,insert:text},annotations:api.isolateHistory.of("full")});
   api.undo(v);v.dispatch({selection:{anchor:1}});
   notes.dispatch({changes:{from:notes.state.doc.length,insert:"note edit"},selection:{anchor:1}});
   for(const [kind,view] of [["code",v],["notes",notes]])view.dispatch({effects:api.StateEffect.appendConfig.of(api.EditorView.updateListener.of(update=>{
    if(update.startState.tabSize!==update.state.tabSize)s.tabChanges[kind]++;
   }))});
   s.capture=view=>({view,doc:view.state.doc,selection:view.state.selection,undo:api.undoDepth(view.state),redo:api.redoDepth(view.state),indent:view.state.facet(api.indentUnit)});
   s.before={code:s.capture(v),notes:s.capture(notes),starts:s.starts.length,stops:s.stops.length};
   v.focus();
  });
  await page.waitForFunction(()=>document.querySelector(".editor-status-meta")?.textContent?.includes("1:5"));
  const tabPixels=()=>page.evaluate(()=>{
   const v=window.__tabSizeTest.view("代码编辑器"),a=v.coordsAtPos(0),b=v.coordsAtPos(1);
   if(!a||!b)throw Error("Tab coordinates unavailable");
   return b.left-a.left;
  });
  await page.evaluate(async()=>{await document.fonts.load('14px "Intel One Mono"');await document.fonts.ready;});
  const fourPixels=await tabPixels();
  assert.ok(fourPixels>0,"default tab has visible width");
  let dialog=await openSettings(page,"编辑器");
  const width=()=>dialog.getByRole("combobox",{name:"Tab 显示宽度",exact:true});
  assert.equal(await width().inputValue(),"4","legacy settings without tabSize display the default");
  assert.deepEqual(await width().locator("option").allTextContents(),["1","2","3","4","5","6","7","8"]);
  assert.equal(await width().evaluate(node=>getComputedStyle(node).appearance),"none","tab width uses the existing quiet native select styling");
  assert.equal(await dialog.locator(".format-language select").count(),6,"all original language formatter overrides remain separate");
  await width().selectOption("8");
  assert.deepEqual(await page.evaluate(()=>({code:window.__tabSizeTest.view("代码编辑器").state.tabSize,notes:window.__tabSizeTest.view("Markdown 笔记").state.tabSize})),{code:4,notes:4},"an unsaved width never changes either editor");
  await dialog.getByRole("button",{name:"保存设置",exact:true}).evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>typeof window.__tabSizeTest.release==="function");
  assert.equal(await width().isDisabled(),true,"pending save disables tab width");
  assert.equal(await page.evaluate(()=>window.__tabSizeTest.writes.length),1,"same-task repeated Save submits once");
  assert.deepEqual(await page.evaluate(()=>window.__tabSizeTest.tabChanges),{code:0,notes:0},"width does not apply before successful save");
  await page.evaluate(()=>{const s=window.__tabSizeTest;s.hold=false;s.release();});
  await page.waitForFunction(()=>window.__tabSizeTest.view("代码编辑器").state.tabSize===8&&window.__tabSizeTest.view("Markdown 笔记").state.tabSize===8);
  assert.deepEqual(await page.evaluate(()=>{
   const s=window.__tabSizeTest,api=s.api;
   const preserved=(label,before)=>{const v=s.view(label);return {view:v===before.view,doc:v.state.doc===before.doc,selection:v.state.selection.eq(before.selection),undo:api.undoDepth(v.state)===before.undo,redo:api.redoDepth(v.state)===before.redo,indent:v.state.facet(api.indentUnit)===before.indent};};
   return {code:preserved("代码编辑器",s.before.code),notes:preserved("Markdown 笔记",s.before.notes),sameLsp:s.starts.length===s.before.starts&&s.stops.length===s.before.stops,changes:s.tabChanges,formats:s.formats.length,saves:s.saves.length,commits:s.commits};
  }),{code:{view:true,doc:true,selection:true,undo:true,redo:true,indent:true},notes:{view:true,doc:true,selection:true,undo:true,redo:true,indent:true},sameLsp:true,changes:{code:1,notes:1},formats:0,saves:0,commits:1},"a successful save applies once without changing editor data or ownership");
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  await code.focus();
  await page.waitForFunction(()=>document.querySelector(".editor-status-meta")?.textContent?.includes("1:9"));
  const eightPixels=await tabPixels();
  assert.ok(Math.abs(eightPixels-2*fourPixels)<2,"tab rendering expands from four to eight columns at the same cursor");
  assert.equal(await page.locator(".code-pane .cm-line").first().evaluate(node=>node.style.getPropertyValue("--indent-guide-width")),"8","indent guides follow tab display columns");
  assert.deepEqual(await page.evaluate(()=>({code:window.__tabSizeTest.view("代码编辑器").state.facet(window.__tabSizeTest.api.indentUnit),notes:window.__tabSizeTest.view("Markdown 笔记").state.facet(window.__tabSizeTest.api.indentUnit)})),{code:"    ",notes:"  "},"existing source and Markdown insertion units are independent of tab display");
  dialog=await openSettings(page,"编辑器");
  assert.equal(await width().inputValue(),"8","closing and reopening reads the saved value");
  await width().selectOption("2");
  const reads=await page.evaluate(()=>window.__tabSizeTest.reads);
  await dialog.getByRole("button",{name:"重新读取",exact:true}).click();
  await page.waitForFunction(expected=>window.__tabSizeTest.reads===expected,reads+1);
  await page.waitForFunction(()=>document.querySelector('[aria-label="Tab 显示宽度"]')?.value==="8");
  assert.deepEqual(await page.evaluate(()=>window.__tabSizeTest.tabChanges),{code:1,notes:1},"reload of the same preference does not reconfigure again");
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  // Undo/redo still execute on the retained code view after the settings round-trip.
  assert.deepEqual(await page.evaluate(()=>{
   const s=window.__tabSizeTest,v=s.view("代码编辑器"),before=v.state.doc.toString();
   const undo=s.api.undo(v),undone=v.state.doc.toString(),redo=s.api.redo(v);
   return {undo,undone,redo,restored:v.state.doc.toString()===before,view:v===s.before.code.view};
  }),{undo:true,undone:"\talpha\n\tbeta",redo:true,restored:true,view:true});
  assert.deepEqual(await page.evaluate(()=>{
   const s=window.__tabSizeTest,v=s.view("Markdown 笔记"),before=v.state.doc.toString();
   const undo=s.api.undo(v),undone=v.state.doc.toString(),redo=s.api.redo(v);
   return {undo,undone,redo,restored:v.state.doc.toString()===before,view:v===s.before.notes.view,tabSize:v.state.tabSize};
  }),{undo:true,undone:"\t# note\n",redo:true,restored:true,view:true,tabSize:8},"notes undo/redo remains executable after a display preference save");
  await code.focus();await code.press("F12");
  await page.getByRole("dialog",{name:"tab_source.rs",exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>{
   const s=window.__tabSizeTest,v=s.api.EditorView.findFromDOM(document.querySelector(".source-editor .cm-editor"));
   return {tabSize:v.state.tabSize,text:v.state.doc.toString(),readOnly:v.state.readOnly};
  }),{tabSize:8,text:"\tpub fn tab_target() {}\n",readOnly:true},"source opened from the App inherits the saved tab width");
  await page.getByRole("button",{name:"关闭源码",exact:true}).click();
  page.once("dialog",dialog=>dialog.accept());
  await page.reload();
  await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector(".lsp-status.ready"));
  await page.evaluate(async()=>{
   const s=window.__tabSizeTest;s.api=await import("/tests/tab-size-harness.tsx");
   s.view=label=>s.api.EditorView.findFromDOM(document.querySelector('[aria-label="'+label+'"]').closest(".cm-editor"));
  });
  await page.waitForFunction(()=>window.__tabSizeTest.view("代码编辑器").state.tabSize===8);
  await page.getByRole("button",{name:"笔记",exact:true}).click();
  await page.getByRole("textbox",{name:"Markdown 笔记",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__tabSizeTest.view("Markdown 笔记").state.tabSize),8,"newly opened notes inherit the persisted width");
  dialog=await openSettings(page,"编辑器");
  assert.equal(await width().inputValue(),"8","a fresh App instance restores the persisted width");
  await width().selectOption("4");
  await page.evaluate(()=>{window.__tabSizeTest.hold=false;});
  await dialog.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(()=>window.__tabSizeTest.view("代码编辑器").state.tabSize===4);
  assert.equal(await page.evaluate(()=>Object.hasOwn(window.__tabSizeTest.settings.settings,"tabSize")),false,"resetting to default omits the optional key");
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  await page.reload();
  await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await page.evaluate(async()=>{
   const s=window.__tabSizeTest;s.api=await import("/tests/tab-size-harness.tsx");
   s.view=label=>s.api.EditorView.findFromDOM(document.querySelector('[aria-label="'+label+'"]').closest(".cm-editor"));
   s.hold=false;
  });
  await page.waitForFunction(()=>window.__tabSizeTest.view("代码编辑器").state.tabSize===4);
  dialog=await openSettings(page,"编辑器");
  assert.equal(await width().inputValue(),"4","the omitted default survives an App restart");
  // An external writer may persist explicit 4. Reload it, then save without
  // changing the select again: submission must canonicalize a copy of the draft.
  await width().selectOption("2");
  await page.evaluate(()=>{
   const s=window.__tabSizeTest;
   s.settings={settings:{...s.settings.settings,tabSize:4},revision:"tab-size-explicit-four"};
   localStorage.setItem("inkleet-tab-display-fixture",JSON.stringify(s.settings));
  });
  await dialog.getByRole("button",{name:"重新读取",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Tab 显示宽度"]')?.value==="4");
  assert.equal(await page.evaluate(()=>window.__tabSizeTest.settings.settings.tabSize),4,"fixture reloads a valid explicit default");
  const explicitFourBefore=await page.evaluate(()=>({writes:window.__tabSizeTest.writes.length,commits:window.__tabSizeTest.commits}));
  await dialog.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(before=>{
   const s=window.__tabSizeTest;return s.writes.length===before.writes+1&&s.commits===before.commits+1;
  },explicitFourBefore);
  assert.deepEqual(await page.evaluate(()=>{
   const s=window.__tabSizeTest,request=s.writes.at(-1);
   return {submittedDefault:Object.hasOwn(request.settings,"tabSize"),savedDefault:Object.hasOwn(s.settings.settings,"tabSize"),expected:request.expected};
  }),{submittedDefault:false,savedDefault:false,expected:"tab-size-explicit-four"},"saving an unchanged explicit 4 omits the key using the reloaded revision");
  assert.equal(await width().inputValue(),"4","canonicalizing submission keeps the displayed default");
  // Cache Go at the old width in this App instance, after the reload checks.
  // Switching away must leave that state inactive while the preference changes.
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("golang");
  await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector(".lsp-status.ready"));
  assert.equal(await page.evaluate(()=>{
   const s=window.__tabSizeTest,v=s.view("代码编辑器");
   s.cachedGo={doc:v.state.doc,selection:v.state.selection};
   return v.state.tabSize;
  }),4,"Go is cached with the old display width");
  await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("rust");
  await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector(".lsp-status.ready"));
  dialog=await openSettings(page,"编辑器");
  // Verify insertion policy separately at a non-default display width.
  await width().selectOption("8");
  await dialog.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(()=>window.__tabSizeTest.view("代码编辑器").state.tabSize===8);
  await dialog.getByRole("button",{name:"关闭设置",exact:true}).click();
  for(const [language,unit] of [["golang","\t"],["python3","    "],["rust","    "],["c","    "],["cpp","    "],["java","    "]]){
   await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption(language);
   await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector(".lsp-status.ready"));
   assert.deepEqual(await page.evaluate(()=>{
    const s=window.__tabSizeTest,v=s.view("代码编辑器");
    return {tabSize:v.state.tabSize,indent:v.state.facet(s.api.indentUnit)};
   }),{tabSize:8,indent:unit},language+" keeps its existing indentation policy");
   if(language==="golang")assert.deepEqual(await page.evaluate(()=>{
    const s=window.__tabSizeTest,v=s.view("代码编辑器");
    return {cachedDoc:v.state.doc===s.cachedGo.doc,selection:v.state.selection.eq(s.cachedGo.selection),tabSize:v.state.tabSize};
   }),{cachedDoc:true,selection:true,tabSize:8},"restoring an inactive old-width Go state applies the current width");
  }
  assert.deepEqual(await page.evaluate(()=>window.__tabSizeTest.unexpected),[]);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:"evidence/tab-display-width.png"});
 }finally{await page.close();}

 // Keep the same Source prop and viewer alive while the owner's preference changes.
 const sourcePage=await browser.newPage({viewport:{width:1000,height:700}});
 const sourceErrors=[];sourcePage.on("pageerror",error=>sourceErrors.push(error.message));
 try{
  await sourcePage.route("**/tab-source-test",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='source'></div></body></html>"}));
  await sourcePage.goto("http://127.0.0.1:5173/tab-source-test");
  await sourcePage.addStyleTag({content:".source-viewer{width:800px;height:500px}.source-editor{height:400px}"}); 
  await sourcePage.evaluate(async()=>{
   const api=await import("/tests/tab-size-harness.tsx");
   const primary={sourceId:0,uri:"file:///solution.go",name:"solution.go",text:"\torigin",language:"golang",declaration:false};
   const library={sourceId:1,uri:"file:///stdlib.go",name:"stdlib.go",text:"\tfirst\n\tsecond",language:"golang",declaration:false};
   const next={sourceId:2,uri:"file:///next.go",name:"next.go",text:"\tnext",language:"golang",declaration:false};
   const s=window.__sourceTabTest={api,cancels:0};
   const source={...library,line:0,range:{start:{line:0,character:1},end:{line:0,character:3}},navigation:{
    primary,originSelection:{ranges:[{anchor:1,head:1}],mainIndex:0},originScroll:{top:0,left:0},
    current:()=>true,definition:async()=>({locations:[{uri:next.uri,range:{start:{line:0,character:1},end:{line:0,character:3}}}],omitted:0}),
    load:async()=>next,origin:()=>{},cancel:()=>{s.cancels++;},
   }};
   s.mount=api.mountSourceTabSize(document.querySelector("#source"),source);
   await s.mount.setTabSize(4);
   s.view=()=>api.EditorView.findFromDOM(document.querySelector(".source-editor .cm-editor"));
   const v=s.view();s.before={view:v,doc:v.state.doc,selection:v.state.selection,cancels:s.cancels};
   await s.mount.setTabSize(8);
  });
  assert.deepEqual(await sourcePage.evaluate(()=>{
   const s=window.__sourceTabTest,v=s.view(),before=s.before;
   const text=v.state.doc.toString();v.dispatch({changes:{from:0,insert:"blocked"},filter:false});
   return {sameView:v===before.view,sameDoc:v.state.doc===before.doc,sameSelection:v.state.selection.eq(before.selection),tabSize:v.state.tabSize,readOnly:v.state.readOnly,editsBlocked:v.state.doc.toString()===text,sameNavigation:s.cancels===before.cancels};
  }),{sameView:true,sameDoc:true,sameSelection:true,tabSize:8,readOnly:true,editsBlocked:true,sameNavigation:true},"source width updates in place without discarding selection or navigation ownership");
  await sourcePage.getByLabel("只读标准库源码",{exact:true}).press("F12");
  await sourcePage.getByRole("heading",{name:"next.go",exact:true}).waitFor();
  assert.equal(await sourcePage.evaluate(()=>window.__sourceTabTest.view().state.tabSize),8,"new source navigation state uses the latest display width");
  await sourcePage.evaluate(()=>{const s=window.__sourceTabTest;s.forwardSelection=s.view().state.selection;});
  await sourcePage.getByRole("button",{name:"后退",exact:true}).click();
  assert.deepEqual(await sourcePage.evaluate(()=>{
   const s=window.__sourceTabTest,v=s.view();
   return {view:v===s.before.view,text:v.state.doc.toString(),selection:v.state.selection.eq(s.before.selection),tabSize:v.state.tabSize};
  }),{view:true,text:"\tfirst\n\tsecond",selection:true,tabSize:8},"back navigation keeps source history and the current width");
  await sourcePage.getByRole("button",{name:"前进",exact:true}).click();
  await sourcePage.getByRole("heading",{name:"next.go",exact:true}).waitFor();
  assert.deepEqual(await sourcePage.evaluate(()=>{
   const s=window.__sourceTabTest,v=s.view();
   return {view:v===s.before.view,text:v.state.doc.toString(),selection:v.state.selection.eq(s.forwardSelection),tabSize:v.state.tabSize,readOnly:v.state.readOnly};
  }),{view:true,text:"\tnext",selection:true,tabSize:8,readOnly:true},"forward navigation restores its selection and retains the current width");
  await sourcePage.evaluate(()=>window.__sourceTabTest.mount.destroy());
  assert.deepEqual(sourceErrors,[]);
 }finally{await sourcePage.close();}
 await writeFile("evidence/TAB_DISPLAY_UI_RESULT.txt","PASS: real App settings save-once, default/reload/reopen, retained main and notes editors, undo/redo, cursor columns and tab geometry, unchanged language indentation units, inherited source width and in-place source navigation. IPC/persistence are browser fixtures; native storage and live LSP are separate. Active snippet retention is checked in the existing snippet fixture.\n");
}
