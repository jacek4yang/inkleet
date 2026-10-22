import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

// UNRUN DRAFT. Real App/DOM with isolated settings IPC, separate from the
// original PR92 cases. This is not native storage, accessibility, or IME proof.
export async function runSettingsWorkbenchUI(browser,openSettings){
 const cases=[],failures=[];
 const defaults={version:1,vim:false,formatOnSave:true,overrides:{}};
 const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const panel=(dialog,kind)=>dialog.locator(kind==="editor"?".format-settings":".download-settings");
 const row=(dialog,id)=>dialog.locator(`[data-setting-id="${id}"]`);
 const search=dialog=>dialog.getByRole("textbox",{name:"搜索设置",exact:true});
 const category=(dialog,name)=>dialog.getByRole("navigation",{name:"设置分类"}).getByRole("button",{name,exact:true}).click();
 const visibleIds=dialog=>dialog.locator("[data-setting-id]:visible").evaluateAll(nodes=>nodes.map(node=>node.dataset.settingId));
 const writes=page=>page.evaluate(()=>{const s=window.__settingsWorkbenchTest;return {editor:s.writes.editor.length,downloads:s.writes.downloads.length};});
 const stateFor=(page,kind)=>page.evaluate(kind=>window.__settingsWorkbenchTest[kind],kind);
 const readsFor=(page,kind)=>page.evaluate(kind=>window.__settingsWorkbenchTest.reads[kind],kind);
 const resultCount=async dialog=>Number((await dialog.locator("[data-settings-result-count]").textContent()).match(/\d+/)?.[0]);
 async function configure(page,kind,operation,mode){await page.evaluate(({kind,operation,mode})=>{window.__settingsWorkbenchTest[operation+"Mode"][kind]=mode;},{kind,operation,mode});}
 async function settle(page,kind,operation,error=null){
  await page.evaluate(({kind,operation,error})=>{
   const queue=window.__settingsWorkbenchTest[operation==="read"?"pendingReads":"pendingWrites"];
   const index=queue.findIndex(item=>item.kind===kind);
   if(index<0)throw Error("No pending "+operation+" for "+kind);
   const [pending]=queue.splice(index,1);
   if(error)pending.reject(Error(error));else pending.resolve();
  },{kind,operation,error});
 }
 async function readDraft(dialog,kind){
  const owner=panel(dialog,kind);
  if(kind==="downloads"){
   const url=owner.getByLabel("HTTP / HTTPS 地址",{exact:true});
   return {mode:await owner.getByLabel("连接方式",{exact:true}).inputValue(),url:await url.count()?await url.inputValue():null};
  }
  return {
   vim:await owner.getByRole("checkbox",{name:"Vim",exact:true}).isChecked(),
   tabSize:await owner.getByRole("combobox",{name:"Tab 显示宽度",exact:true}).inputValue(),
   formatOnSave:await owner.getByRole("checkbox",{name:"保存时格式化",exact:true}).isChecked(),
   python:await owner.getByRole("combobox",{name:"Python 3 保存时格式化",exact:true}).inputValue(),
  };
 }
 async function editDraft(dialog,kind){
  const owner=panel(dialog,kind);
  if(kind==="editor"){
   await owner.getByRole("checkbox",{name:"Vim",exact:true}).check();
   await owner.getByRole("combobox",{name:"Tab 显示宽度",exact:true}).selectOption("8");
   await owner.getByRole("checkbox",{name:"保存时格式化",exact:true}).uncheck();
   await owner.getByRole("combobox",{name:"Python 3 保存时格式化",exact:true}).selectOption("true");
  }else{
   await owner.getByLabel("连接方式",{exact:true}).selectOption("custom");
   await owner.getByLabel("HTTP / HTTPS 地址",{exact:true}).fill("http://127.0.0.1:7899");
  }
 }
 async function run(name,body,options={}){
  const page=await browser.newPage({viewport:options.viewport??{width:1100,height:800}});
  page.setDefaultTimeout(5000);
  const record={name,status:"RUNNING",assertions:0,pageErrors:[],screenshots:[],ipc:null};cases.push(record);
  page.on("pageerror",error=>record.pageErrors.push(error.message));
  const equal=(actual,expected,message)=>{record.assertions++;assert.deepEqual(actual,expected,message);};
  try{
   await page.addInitScript(({editorSettings,proxy})=>{
    window.isTauri=true;
    const copy=value=>JSON.parse(JSON.stringify(value));
    const s=window.__settingsWorkbenchTest={
     editor:{settings:editorSettings,revision:"editor-initial"},downloads:{settings:{version:1,proxy},revision:"downloads-initial"},
     reads:{editor:0,downloads:0},writes:{editor:[],downloads:[]},commits:{editor:0,downloads:0},
     readMode:{editor:"immediate",downloads:"immediate"},writeMode:{editor:"immediate",downloads:"immediate"},
     pendingReads:[],pendingWrites:[],readSettled:{editor:0,downloads:0},writeSettled:{editor:0,downloads:0},unexpected:[],
    };
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
     if(command==="load_recent_questions")return [];
     if(command==="search_questions")return {questions:[],total:0,hasMore:false};
     if(command==="external_editor_supported")return false;
     if(command==="login_status")return null;
     if(command==="get_editor_settings"||command==="get_download_settings"){
      const kind=command==="get_editor_settings"?"editor":"downloads",snapshot=copy(s[kind]);s.reads[kind]++;
      try{
       if(s.readMode[kind]==="fail")throw Error("fixture "+kind+" read failed");
       if(s.readMode[kind]==="hold")await new Promise((resolve,reject)=>s.pendingReads.push({kind,resolve,reject}));
       return snapshot;
      }finally{s.readSettled[kind]++;}
     }
     if(command==="save_editor_settings"||command==="save_download_settings"){
      const kind=command==="save_editor_settings"?"editor":"downloads",request=copy(args);s.writes[kind].push(request);
      try{
       if(s.writeMode[kind]==="fail")throw Error("fixture "+kind+" save failed");
       if(s.writeMode[kind]==="hold")await new Promise((resolve,reject)=>s.pendingWrites.push({kind,resolve,reject}));
       if(request.expected!==s[kind].revision)throw Error("fixture settings revision conflict");
       const settings=kind==="editor"?request.settings:{version:1,proxy:{mode:request.proxy.mode,url:request.proxy.mode==="custom"?request.proxy.url:""}};
       s[kind]={settings,revision:kind+"-saved-"+ ++s.commits[kind]};return copy(s[kind]);
      }finally{s.writeSettled[kind]++;}
     }
     s.unexpected.push(command);throw Error("Unexpected richer Settings IPC: "+command);
    }};
   },{editorSettings:options.editorSettings??defaults,proxy:options.proxy??{mode:"system",url:""}});
   await page.goto("http://127.0.0.1:5173");
   await page.waitForFunction(()=>window.__settingsWorkbenchTest.readSettled.editor===1);
   await body(page,equal,async path=>{await page.screenshot({path});record.screenshots.push(path);});
   equal(record.pageErrors,[],"no page errors");
   equal(await page.evaluate(()=>window.__settingsWorkbenchTest.unexpected),[],"no unexpected IPC");
   record.status="PASS";
  }catch(error){record.status="FAIL";record.error=String(error);failures.push({name,error:String(error)});}
  finally{
   try{record.ipc=await page.evaluate(()=>{const s=window.__settingsWorkbenchTest;return {reads:s.reads,writes:s.writes,commits:s.commits,readSettled:s.readSettled,writeSettled:s.writeSettled,pendingReads:s.pendingReads.map(item=>item.kind),pendingWrites:s.pendingWrites.map(item=>item.kind)};});}
   catch(error){record.evidenceError=String(error);}
   await page.close();
  }
 }

 await run("search filters actual rows with exact C++ identity",async(page,equal)=>{
  const dialog=await openSettings(page,"源码");
  for(const [query,id] of [["Vim","editor.vim"],["  TAB  ","editor.tabSize"],["C++","editor.formatOnSave.cpp"],["Ｃ＋＋","editor.formatOnSave.cpp"],["cpp","editor.formatOnSave.cpp"],["C","editor.formatOnSave.c"],["C++ 格式化","editor.formatOnSave.cpp"],["editor.formatOnSave.cpp","editor.formatOnSave.cpp"]]){
   await search(dialog).fill(query);await paint(page);
   equal(await visibleIds(dialog),[id],JSON.stringify(query)+" matches one actual row");
   equal(await resultCount(dialog),1,JSON.stringify(query)+" counts only that row");
  }
  await search(dialog).fill("Vim proxy");await paint(page);
  equal(await visibleIds(dialog),[],"terms from separate rows do not combine into a result");
  equal(await resultCount(dialog),0,"empty cross-row AND has zero direct matches");
  equal(await readsFor(page,"downloads"),0,"unmatched proxy term does not load the download owner");
  equal(await writes(page),{editor:0,downloads:0},"search never writes");
 });

 await run("address search retains supporting mode without mutating proxy",async(page,equal)=>{
  const dialog=await openSettings(page,"编辑器");
  await search(dialog).fill("HTTP");await panel(dialog,"downloads").getByLabel("连接方式",{exact:true}).waitFor();await paint(page);
  equal(await visibleIds(dialog),["downloads.proxy.mode","downloads.proxy.url"],"address has its required mode context");
  equal(await resultCount(dialog),1,"supporting mode is excluded from direct result count");
  equal(await panel(dialog,"downloads").getByLabel("连接方式",{exact:true}).inputValue(),"system","search does not select custom mode");
  equal((await stateFor(page,"downloads")).settings.proxy,{mode:"system",url:""},"committed proxy stays unchanged");
  await panel(dialog,"downloads").getByLabel("连接方式",{exact:true}).selectOption("custom");
  await panel(dialog,"downloads").getByLabel("HTTP / HTTPS 地址",{exact:true}).fill("http://127.0.0.1:7899");
  await search(dialog).fill("connection");await paint(page);
  equal(await visibleIds(dialog),["downloads.proxy.mode","downloads.proxy.url"],"mode-only search keeps the required custom endpoint editable as context");
  equal(await resultCount(dialog),1,"the contextual custom endpoint is not counted as a second direct hit");
  equal(await panel(dialog,"downloads").getByLabel("HTTP / HTTPS 地址",{exact:true}).inputValue(),"http://127.0.0.1:7899","changing search retains the custom endpoint draft");
  await dialog.locator('[data-setting-reset="downloads.proxy"]').click();
  equal(await readDraft(dialog,"downloads"),{mode:"system",url:null},"proxy Reset restores the complete safe default bundle");
  equal(await writes(page),{editor:0,downloads:0},"proxy changes and Reset are draft-only");
  equal(await readsFor(page,"downloads"),1,"supporting context mounts one owner once");
 });

 await run("inheritance and explicit overrides remain distinct from defaults",async(page,equal)=>{
  const dialog=await openSettings(page,"编辑器"),owner=panel(dialog,"editor");
  equal(await row(dialog,"editor.formatOnSave.cpp").getAttribute("data-setting-source"),"override","explicit false is an override even when global is false");
  equal(await row(dialog,"editor.formatOnSave.golang").getAttribute("data-setting-source"),"default","absent Go override is inherited");
  await dialog.getByRole("button",{name:"仅显示已修改的编辑器设置",exact:true}).click();await paint(page);
  equal(await dialog.getByRole("button",{name:"仅显示已修改的编辑器设置",exact:true}).getAttribute("aria-pressed"),"true","modified filter exposes its active state");
  equal(await visibleIds(dialog),["editor.formatOnSave","editor.formatOnSave.python3","editor.formatOnSave.cpp"],"modified filter uses configuration intent, including equal-effective explicit override");
  await dialog.getByRole("button",{name:"仅显示已修改的编辑器设置",exact:true}).click();
  await owner.getByRole("checkbox",{name:"保存时格式化",exact:true}).check();await paint(page);
  equal(await row(dialog,"editor.formatOnSave.golang").getAttribute("data-setting-effective"),"true","inherited effective value follows the unsaved global draft");
  equal(await owner.getByRole("combobox",{name:"Go 保存时格式化",exact:true}).inputValue(),"inherit","global changes never create language overrides");
  equal(await row(dialog,"editor.formatOnSave.cpp").getAttribute("data-setting-effective"),"false","explicit override ignores global change");
  await dialog.locator('[data-setting-reset="editor.formatOnSave.python3"]').click();
  equal(await owner.getByRole("combobox",{name:"Python 3 保存时格式化",exact:true}).inputValue(),"inherit","Reset returns the language to inheritance");
  equal(await writes(page),{editor:0,downloads:0},"global and language Reset remain draft-only");
  equal((await stateFor(page,"editor")).settings,{version:1,vim:false,formatOnSave:false,overrides:{python3:true,cpp:false}},"Reset does not alter loaded settings");
  await owner.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(()=>window.__settingsWorkbenchTest.commits.editor===1);
  equal(await page.evaluate(()=>window.__settingsWorkbenchTest.writes.editor[0]),{settings:{version:1,vim:false,formatOnSave:true,overrides:{cpp:false}},expected:"editor-initial"},"Save deletes only reset override and uses loaded raw revision");
 },{editorSettings:{version:1,vim:false,formatOnSave:false,overrides:{python3:true,cpp:false}}});

 await run("row resets preserve unrelated draft values and omit Tab key",async(page,equal)=>{
  const dialog=await openSettings(page,"编辑器"),owner=panel(dialog,"editor");
  await owner.getByRole("combobox",{name:"C++ 保存时格式化",exact:true}).selectOption("false");
  await dialog.locator('[data-setting-reset="editor.vim"]').click();
  await dialog.locator('[data-setting-reset="editor.tabSize"]').click();
  await dialog.locator('[data-setting-reset="editor.formatOnSave"]').click();
  equal(await readDraft(dialog,"editor"),{vim:false,tabSize:"4",formatOnSave:true,python:"true"},"resets affect only their draft fields");
  equal(await owner.getByRole("combobox",{name:"C++ 保存时格式化",exact:true}).inputValue(),"false","unrelated in-progress override survives every reset");
  equal(await writes(page),{editor:0,downloads:0},"resets have no implicit Save");
  await owner.getByRole("button",{name:"保存设置",exact:true}).click();await page.waitForFunction(()=>window.__settingsWorkbenchTest.commits.editor===1);
  equal(await page.evaluate(()=>window.__settingsWorkbenchTest.writes.editor[0]),{settings:{version:1,vim:false,formatOnSave:true,overrides:{python3:true,cpp:false}},expected:"editor-initial"},"Save omits reset Tab key without losing other overrides");
 },{editorSettings:{version:1,vim:true,tabSize:8,formatOnSave:false,overrides:{python3:true}}});

 await run("Reset under the modified filter recovers focus when its row disappears",async(page,equal)=>{
  const dialog=await openSettings(page,"编辑器");
  await dialog.getByRole("button",{name:"仅显示已修改的编辑器设置",exact:true}).click();
  await search(dialog).fill("Vim");await paint(page);
  equal(await visibleIds(dialog),["editor.vim"],"modified query exposes the nondefault Vim row");
  await dialog.locator('[data-setting-reset="editor.vim"]').click();await paint(page);
  equal(await visibleIds(dialog),[],"Reset removes the now-default row from the modified results");
  equal(await resultCount(dialog),0,"count follows the updated draft");
  equal(await search(dialog).evaluate(node=>document.activeElement===node),true,"focus returns to the query when the focused Reset row disappears");
  equal((await stateFor(page,"editor")).settings.vim,true,"filtered Reset leaves committed Vim unchanged");
  equal(await writes(page),{editor:0,downloads:0},"filtered Reset is draft-only");
  await dialog.getByRole("button",{name:"清除搜索",exact:true}).click();
  await dialog.getByRole("button",{name:"仅显示已修改的编辑器设置",exact:true}).click();
  equal(await panel(dialog,"editor").getByRole("checkbox",{name:"Vim",exact:true}).isChecked(),false,"the hidden default draft returns when filtering is removed");
 },{editorSettings:{version:1,vim:true,formatOnSave:true,overrides:{}}});

 for(const kind of ["editor","downloads"]){
  await run(kind+" hidden save failure reveals the retained owner",async(page,equal)=>{
   const dialog=await openSettings(page,kind==="editor"?"编辑器":"下载"),owner=panel(dialog,kind);
   await editDraft(dialog,kind);const before=await readDraft(dialog,kind),reads=await readsFor(page,kind);
   await configure(page,kind,"write","hold");
   await owner.locator(".settings-form-actions button").first().click();
   await page.waitForFunction(kind=>window.__settingsWorkbenchTest.pendingWrites.some(item=>item.kind===kind),kind);
   await search(dialog).fill("no-settings-match-9f3b");await paint(page);
   equal(await owner.isVisible(),false,"owner controls are hidden while request is pending");
   await settle(page,kind,"write","fixture "+kind+" save failed");
   const reveal=dialog.locator(`[data-settings-reveal="${kind}"]`);await reveal.waitFor();
   equal(await reveal.isVisible(),true,"hidden failure has a visible route back to its owner");
   await reveal.click();await owner.waitFor();await paint(page);
   equal(await search(dialog).inputValue(),"","error reveal clears filtering");
   equal(await readDraft(dialog,kind),before,"reveal retains the failed draft");
   equal((await owner.getByRole("alert").allTextContents()).some(text=>text.includes("fixture "+kind+" save failed")),true,"revealed owner retains failure details");
   equal(await readsFor(page,kind),reads,"error reveal does not reread the owner");
   equal(await writes(page),{editor:kind==="editor"?1:0,downloads:kind==="downloads"?1:0},"error reveal never resubmits");
  });

  await run(kind+" Reload awaits completion and clears failure only on success",async(page,equal)=>{
   const dialog=await openSettings(page,kind==="editor"?"编辑器":"下载"),owner=panel(dialog,kind);
   await editDraft(dialog,kind);const draft=await readDraft(dialog,kind),initialReads=await readsFor(page,kind);
   await configure(page,kind,"write","fail");await owner.locator(".settings-form-actions button").first().click();
   await owner.getByRole("alert").filter({hasText:"fixture "+kind+" save failed"}).waitFor();
   await configure(page,kind,"read","hold");await owner.getByRole("button",{name:"重新读取",exact:true}).click();
   if(kind==="editor")await owner.getByRole("alertdialog",{name:"放弃设置草稿并重新读取",exact:true}).getByRole("button",{name:"放弃草稿并读取",exact:true}).click();
   await page.waitForFunction(kind=>window.__settingsWorkbenchTest.pendingReads.some(item=>item.kind===kind),kind);
   equal(await readDraft(dialog,kind),draft,"pending Reload keeps the draft visible");
   equal((await owner.getByRole("alert").allTextContents()).some(text=>text.includes("fixture "+kind+" save failed")),true,"pending Reload does not clear the prior failure early");
   equal(await owner.locator("input,select,button").evaluateAll(nodes=>nodes.every(node=>node.disabled)),true,"Reload disables all owner controls including resets");
   await owner.getByRole("button",{name:"重新读取",exact:true}).evaluate(button=>{button.click();button.click();});
   equal(await readsFor(page,kind),initialReads+1,"repeated disabled Reload cannot create another read");
   await category(dialog,"源码");await category(dialog,kind==="editor"?"编辑器":"下载");await owner.waitFor();
   equal(await readDraft(dialog,kind),draft,"navigation retains pending Reload and its draft");
   await settle(page,kind,"read","fixture "+kind+" read failed");
   await owner.getByRole("alert").filter({hasText:"fixture "+kind+" read failed"}).waitFor();
   equal(await readDraft(dialog,kind),draft,"failed Reload preserves the draft");
   await owner.getByRole("button",{name:"重新读取",exact:true}).click();
   if(kind==="editor")await owner.getByRole("alertdialog",{name:"放弃设置草稿并重新读取",exact:true}).getByRole("button",{name:"放弃草稿并读取",exact:true}).click();
   await page.waitForFunction(kind=>window.__settingsWorkbenchTest.pendingReads.some(item=>item.kind===kind),kind);
   equal((await owner.getByRole("alert").allTextContents()).some(text=>text.includes("fixture "+kind+" read failed")),true,"retry retains error until confirmed success");
   await settle(page,kind,"read");
   await page.waitForFunction(selector=>{const first=document.querySelector(selector)?.querySelector("input,select");return first&&!first.disabled;},kind==="editor"?".format-settings":".download-settings");await paint(page);
   equal(await owner.getByRole("alert").allTextContents(),[],"successful same-revision Reload clears prior save/read errors");
   equal(await readDraft(dialog,kind),kind==="editor"?{vim:false,tabSize:"4",formatOnSave:true,python:"inherit"}:{mode:"system",url:null},"success alone replaces the draft with the returned snapshot");
   equal((await stateFor(page,kind)).revision,kind+"-initial","same revision success is still a successful Reload");
   equal(await writes(page),{editor:kind==="editor"?1:0,downloads:kind==="downloads"?1:0},"Reload and retries never Save");
  });
 }

 await run("Settings shortcuts retain focus and Escape close semantics",async(page,equal)=>{
  const opener=page.locator('[data-action="open-settings"]');
  const dialog=await openSettings(page,"编辑器");await search(dialog).fill("Vim");await paint(page);
  for(const key of ["Control+f","Meta+f"]){
   await row(dialog,"editor.vim").getByRole("checkbox",{name:"Vim",exact:true}).focus();await page.keyboard.press(key);
   equal(await search(dialog).evaluate(node=>({focused:document.activeElement===node,start:node.selectionStart,end:node.selectionEnd})),{focused:true,start:0,end:3},key+" selects the Settings query");
  }
  await dialog.getByRole("button",{name:"清除搜索",exact:true}).click();
  equal(await search(dialog).inputValue(),"","Clear removes the query");
  equal(await search(dialog).evaluate(node=>document.activeElement===node),true,"Clear returns focus to the search field");
  await search(dialog).fill("Vim");await page.keyboard.press("Escape");
  equal(await page.getByRole("dialog",{name:"设置",exact:true}).count(),0,"Escape closes even with a nonempty query");
  equal(await opener.evaluate(node=>document.activeElement===node),true,"closing restores the actual Settings opener");
  equal(await writes(page),{editor:0,downloads:0},"keyboard navigation never writes");
 });

 await run("nested manual owns focus and consumes its Escape first",async(page,equal)=>{
  const dialog=await openSettings(page,"编辑器");await search(dialog).fill("Vim");
  const manualButton=dialog.getByRole("button",{name:"使用手册",exact:true});await manualButton.click();
  const manual=page.getByRole("dialog",{name:"使用手册",exact:true});await manual.waitFor();
  await manual.getByRole("button",{name:"关闭使用手册",exact:true}).focus();
  await page.keyboard.press("Control+f");
  equal(await manual.evaluate(node=>node.contains(document.activeElement)),true,"Settings Ctrl+F never steals focus from the nested modal");
  await page.keyboard.press("Escape");
  equal(await manual.count(),0,"first Escape closes the manual");
  equal(await dialog.evaluate(node=>node.open),true,"parent Settings stays open");
  equal(await manualButton.evaluate(node=>document.activeElement===node),true,"manual restores its own opener");
  equal(await search(dialog).inputValue(),"Vim","nested close retains the Settings query");
  await page.keyboard.press("Escape");equal(await dialog.count(),0,"next Escape closes Settings");
 });

 await run("retained filtered rows never become hidden Tab stops",async(page,equal)=>{
  const dialog=await openSettings(page,"下载");await editDraft(dialog,"downloads");
  await category(dialog,"编辑器");await editDraft(dialog,"editor");
  await search(dialog).fill("Vim");await paint(page);
  equal(await visibleIds(dialog),["editor.vim"],"only the matching preference row is visible");
  equal(await dialog.getByRole("combobox").count(),0,"hidden selects are absent from role queries");
  equal(await panel(dialog,"downloads").getByRole("button").count(),0,"hidden owner buttons are absent from role queries");
  const visits=[];await search(dialog).focus();
  for(let index=0;index<40;index++){
   await page.keyboard.press("Tab");
   visits.push(await page.evaluate(()=>{const active=document.activeElement;return {hidden:!!active?.closest("[hidden]"),row:active?.closest("[data-setting-id]")?.getAttribute("data-setting-id")??null};}));
  }
  equal(visits.some(visit=>visit.hidden),false,"sequential focus never lands in a hidden owner or row");
  equal(visits.filter(visit=>visit.row!==null).every(visit=>visit.row==="editor.vim"),true,"filtered controls contribute no focus stops");
  equal(visits.some(visit=>visit.row==="editor.vim"),true,"the matching row remains keyboard reachable");
  equal(await writes(page),{editor:0,downloads:0},"Tab navigation does not save retained drafts");
 });

 for(const viewport of [{width:1100,height:480},{width:390,height:844}]){
  await run("Settings fits and Save stays reachable at "+viewport.width+"x"+viewport.height,async(page,equal,capture)=>{
   const dialog=await openSettings(page,"编辑器"),owner=panel(dialog,"editor");
   // Font readiness prevents a late font swap from changing these layout bounds.
   await page.evaluate(async()=>{await document.fonts.load('14px "Intel One Mono"');await document.fonts.ready;});await paint(page);
   const measure=()=>dialog.evaluate(node=>{
    const body=node.querySelector(".settings-body"),content=node.querySelector(".settings-content");
    const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    return {dialog:bounds(node),body:bounds(body),content:bounds(content),viewport:{width:innerWidth,height:innerHeight},
     contentClientHeight:content.clientHeight,contentScrollHeight:content.scrollHeight,contentScrollTop:content.scrollTop,
     contentClientWidth:content.clientWidth,contentScrollWidth:content.scrollWidth,overflowY:getComputedStyle(content).overflowY,
     pageScrollWidth:document.documentElement.scrollWidth};
   });
   const layout=await measure();
   await writeFile(`evidence/settings-layout-${viewport.width}x${viewport.height}.json`,JSON.stringify(layout,null,2));
   await capture(`evidence/settings-layout-${viewport.width}x${viewport.height}.png`);
   equal(layout.dialog.left>=-1&&layout.dialog.top>=-1&&layout.dialog.right<=viewport.width+1&&layout.dialog.bottom<=viewport.height+1,true,"dialog stays within the viewport");
   equal(layout.body.left>=layout.dialog.left-1&&layout.body.top>=layout.dialog.top-1&&layout.body.right<=layout.dialog.right+1&&layout.body.bottom<=layout.dialog.bottom+1,true,"Settings body stays inside its dialog instead of overflowing a short-height clamp");
   equal(layout.content.left>=layout.body.left-1&&layout.content.top>=layout.body.top-1&&layout.content.right<=layout.body.right+1&&layout.content.bottom<=layout.body.bottom+1,true,"content viewport stays inside the Settings body");
   equal(layout.contentScrollWidth<=layout.contentClientWidth+1&&layout.pageScrollWidth<=viewport.width+1,true,"Settings creates no horizontal content or page overflow");
   if(viewport.height===480){
    equal(layout.contentScrollHeight>layout.contentClientHeight+1,true,"short desktop content overflows into its own scroll area");
    equal(["auto","scroll"].includes(layout.overflowY),true,"short desktop content supports scrolling");
   }
   await capture(viewport.width===390?"evidence/settings-workbench-narrow-390x844.png":"evidence/settings-workbench-short-1100x480.png");
   await owner.getByRole("checkbox",{name:"Vim",exact:true}).check();
   const save=owner.getByRole("button",{name:"保存设置",exact:true});
   await search(dialog).focus();
   let reached=false;
   for(let index=0;index<50;index++){
    await page.keyboard.press("Tab");
    if(await save.evaluate(node=>document.activeElement===node)){reached=true;break;}
   }
   equal(reached,true,"normal Tab navigation reaches the owner Save action");
   equal(await save.evaluate(node=>{
    const r=node.getBoundingClientRect(),content=node.closest(".settings-content").getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return r.width>0&&r.height>0&&r.left>=content.left-1&&r.right<=content.right+1&&r.top>=content.top-1&&r.bottom<=content.bottom+1&&(hit===node||node.contains(hit));
   }),true,"focused Save is visible within the scrolling content and not covered by another element");
   if(viewport.height===480)equal((await measure()).contentScrollTop>0,true,"keyboard focus scrolls the short desktop content to its footer actions");
   await capture(viewport.width===390?"evidence/settings-workbench-narrow-save-390x844.png":"evidence/settings-workbench-short-save-1100x480.png");
   await page.keyboard.press("Enter");await page.waitForFunction(()=>window.__settingsWorkbenchTest.commits.editor===1);
   equal(await writes(page),{editor:1,downloads:0},"reachable keyboard Save submits exactly once");
   equal((await stateFor(page,"editor")).settings.vim,true,"the visible Save commits the edited draft");
  },{viewport});
 }

 await writeFile("evidence/SETTINGS_WORKBENCH_UI_RESULT.json",JSON.stringify({
  scope:"Actual App in Chromium with isolated mocked settings IPC. Additive to all retained PR92 and Tab-display assertions. No native accessibility, IME, filesystem, or live-LSP qualification.",
  result:failures.length?"FAIL":"PASS",cases,failures,
 },null,2));
 assert.deepEqual(failures,[],"richer Settings must preserve row identity, configuration intent, owner lifetime, read/write guards and focus ownership");
}
