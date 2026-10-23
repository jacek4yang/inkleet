import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runImplementationUI(page,editor){
 const original=await editor.innerText(),cases=[];
 const state=async values=>page.evaluate(values=>Object.assign(window.__lspTest,values),values);
 const reset=async()=>{await state({implementationMode:"external",deferImplementation:false,deferAcquire:false,implementationReply:null,acquireReply:null});await editor.focus();await editor.press("Control+Home");};
 const close=async()=>{await page.getByRole("button",{name:"关闭源码",exact:true}).click();await page.locator(".source-viewer").waitFor({state:"hidden"});};
 await reset();await state({implementationMode:"local"});
 await editor.press("Control+F12");
 await page.waitForFunction(()=>String(window.getSelection())==="items");
 assert.equal(await editor.innerText(),original);cases.push("same-file");
 await reset();await editor.press("Control+Shift+p");
 await page.getByRole("combobox",{name:"搜索编辑器命令",exact:true}).fill("转到实现");
 await page.getByRole("option",{name:/转到实现/}).click();
 await page.getByRole("dialog",{name:"_collections_abc.py",exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__lspTest.requests.at(-1).kind),"implementation");
 await page.getByLabel("只读标准库源码",{exact:true}).press("Control+F12");
 await page.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="collections.pyi");
 assert.equal(await page.evaluate(()=>window.__lspTest.sourceRequests.at(-1).kind),"implementation");
 await page.getByLabel("只读标准库源码",{exact:true}).press("Alt+ArrowLeft");
 await page.waitForFunction(()=>document.querySelector("#source-title")?.textContent==="_collections_abc.py");
 await close();cases.push("palette-locationlink-recursive-history");
 await reset();await state({implementationMode:"multiple"});await editor.press("Control+F12");
 const picker=page.getByRole("dialog",{name:"选择实现",exact:true});await picker.waitFor();
 assert.equal(await picker.getByRole("button").count(),2);
 await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
 await page.getByRole("dialog",{name:"collections.pyi",exact:true}).waitFor();await close();cases.push("multiple-targets");
 for(const mode of ["empty","error"]){
  await reset();await state({implementationMode:mode});await editor.press("Control+F12");
  await page.waitForFunction(expected=>document.querySelector(".lsp-status")?.getAttribute("data-status")?.includes(expected),mode==="empty"?"未找到实现":"controlled implementation failure");
  assert.equal(await page.locator(".source-viewer,.source-target-picker").count(),0);cases.push(mode);
 }
 for(const stage of ["implementation","acquire"]){
  for(const boundary of ["notes","escape","language"]){
   await reset();await state(stage==="implementation"?{deferImplementation:true}:{deferAcquire:true});
   await editor.press("Control+F12");
   await page.waitForFunction(stage=>typeof window.__lspTest[stage+"Reply"]==="function",stage);
   let focus=editor;
   if(boundary==="notes"){
    await page.getByRole("button",{name:"笔记",exact:true}).click();
    focus=page.getByRole("textbox",{name:"Markdown 笔记",exact:true});await focus.fill("implementation must not steal focus");
   }else if(boundary==="escape")await editor.press("Escape");
   else{
    focus=page.getByRole("combobox",{name:"编程语言",exact:true});
    const id=await page.evaluate(()=>window.__lspTest.id);await focus.selectOption("rust");await focus.focus();
    await page.waitForFunction(id=>window.__lspTest.id>id,id);
   }
   await page.evaluate(stage=>window.__lspTest[stage+"Reply"](),stage);await page.waitForTimeout(100);
   assert.equal(await page.locator(".source-viewer,.source-target-picker").count(),0,stage+"/"+boundary);
   assert.equal(await focus.evaluate(node=>document.activeElement===node),true);
   if(boundary==="language"){await state({deferImplementation:false,deferAcquire:false});await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");await page.locator('.lsp-status[data-status="Pyright 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();}
   assert.equal(await editor.innerText(),original);cases.push(stage+"/"+boundary);
  }
 }
 await reset();await state({implementationSupported:false});
 await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("rust");
 await page.locator('.lsp-status[data-status="rust-analyzer 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
 const count=await page.evaluate(()=>window.__lspTest.requests.filter(r=>r.kind==="implementation").length);
 await editor.focus();await editor.press("Control+F12");await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.__lspTest.requests.filter(r=>r.kind==="implementation").length),count);
 await editor.press("Control+Shift+p");await page.getByRole("combobox",{name:"搜索编辑器命令",exact:true}).fill("转到实现");
 assert.equal(await page.getByRole("option",{name:/转到实现/}).count(),0);
 await page.keyboard.press("Escape");cases.push("unsupported-no-request");
 await state({implementationSupported:true});
 await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");
 await page.locator('.lsp-status[data-status="Pyright 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
 await reset();assert.equal(await editor.innerText(),original);
 await writeFile("evidence/IMPLEMENTATION_UI_RESULT.json",JSON.stringify({status:"PASS",scope:"mocked IPC; not real language-server acceptance",cases},null,2)+"\n");
}
