import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

// Real App/CodeMirror/modal lifecycle, deliberately delayed mock IPC.
// This is not real language-server or native IME acceptance.
export async function runDefinitionFocusUI(page,editor){
  const original=await editor.innerText(),results=[];
  const reset=async()=>page.evaluate(()=>{
    Object.assign(window.__lspTest,{deferDefinition:false,deferAcquire:false,multiDefinition:false,primaryDefinition:false,definitionReply:null,acquireReply:null});
  });
  const release=async stage=>page.evaluate(stage=>{
    window.__lspTest[stage==="definition"?"definitionReply":"acquireReply"]();
  },stage);
  for(const stage of ["definition","acquire"]){
    for(const boundary of ["notes","settings","escape","caret","refocus","composition","window","body-refocus","language"]){
      await reset();
      await editor.focus();await editor.press("Control+Home");
      await page.evaluate(stage=>{window.__lspTest[stage==="definition"?"deferDefinition":"deferAcquire"]=true;},stage);
      await editor.press("F12");
      await page.waitForFunction(stage=>typeof window.__lspTest[stage==="definition"?"definitionReply":"acquireReply"]==="function",stage);
      let focused=editor,notes=null,expected=original;
      if(boundary==="notes"||boundary==="refocus"){
        await page.getByRole("button",{name:"笔记",exact:true}).click();
        notes=page.getByRole("textbox",{name:"Markdown 笔记",exact:true});
        await notes.fill("new focus owner");
        focused=notes;
        if(boundary==="refocus"){await editor.focus();focused=editor;}
      }else if(boundary==="settings"){
        await page.locator('[data-action="open-settings"]').click();
        focused=page.getByRole("dialog",{name:"设置",exact:true}).getByRole("textbox",{name:"搜索设置",exact:true});
        await focused.fill("vim");
      }else if(boundary==="escape")await editor.press("Escape");
      else if(boundary==="caret")await editor.press("ArrowRight");
      else if(boundary==="composition")await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true})));
      else if(boundary==="window")await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
      else if(boundary==="body-refocus")await editor.evaluate(node=>{node.blur();node.focus();});
      else {
        focused=page.getByRole("combobox",{name:"编程语言",exact:true});
        const previousId=await page.evaluate(()=>window.__lspTest.id);
        await focused.selectOption("rust");await focused.focus();
        await page.waitForFunction(id=>window.__lspTest.id>id,previousId);
        expected=await editor.innerText();
      }
      const selection=await page.locator(".statusbar").innerText();
      await release(stage);await page.waitForTimeout(100);
      assert.equal(await page.locator(".source-viewer,.source-target-picker").count(),0,stage+"/"+boundary+" cannot reopen navigation");
      assert.equal(await focused.evaluate(node=>document.activeElement===node),true,stage+"/"+boundary+" retains focus");
      assert.equal(await editor.innerText(),expected,stage+"/"+boundary+" preserves code");
      if(notes)assert.equal(await notes.innerText(),"new focus owner");
      if(boundary==="caret")assert.equal(await page.locator(".statusbar").innerText(),selection,"late definition does not move caret");
      if(boundary==="settings")await page.getByRole("button",{name:"关闭设置",exact:true}).click();
      if(boundary==="composition"){await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true})));await page.waitForTimeout(100);}
      if(boundary==="language"){
        await reset();
        await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");
        await page.locator('.lsp-status[data-status="Pyright 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
        assert.equal(await editor.innerText(),original);
      }
      results.push(stage+"/"+boundary);
    }
  }
  // Same-document responses must not move the caret after a canceled intent.
  await reset();await editor.focus();await editor.press("Control+End");
  await page.evaluate(()=>{window.__lspTest.primaryDefinition=true;window.__lspTest.deferDefinition=true;});
  await editor.press("F12");await page.waitForFunction(()=>typeof window.__lspTest.definitionReply==="function");
  await editor.press("Escape");
  const before=await page.locator(".statusbar").innerText();
  await release("definition");await page.waitForTimeout(100);
  assert.equal(await page.locator(".statusbar").innerText(),before);
  assert.equal(await editor.innerText(),original);
  results.push("primary/escape");

  // The old canceled attempt must not retire a newer picker or reader.
  await reset();await editor.focus();await editor.press("Control+Home");
  await page.evaluate(()=>{window.__lspTest.deferDefinition=true;});
  await editor.press("F12");await page.waitForFunction(()=>typeof window.__lspTest.definitionReply==="function");
  await page.evaluate(()=>{window.__oldDefinitionReply=window.__lspTest.definitionReply;window.__lspTest.deferDefinition=false;window.__lspTest.multiDefinition=true;});
  await editor.press("Escape");await editor.press("F12");
  const picker=page.getByRole("dialog",{name:"选择定义",exact:true});
  await picker.waitFor();
  await page.evaluate(()=>window.__oldDefinitionReply());await page.waitForTimeout(100);
  assert.equal(await picker.isVisible(),true);
  await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
  await page.getByRole("dialog",{name:"_collections_abc.py",exact:true}).waitFor();
  assert.equal(await page.getByLabel("只读标准库源码",{exact:true}).evaluate(node=>document.activeElement===node),true);
  await page.keyboard.press("Escape");await page.locator(".source-viewer").waitFor({state:"hidden"});
  results.push("owned-picker/newer-attempt");

  await reset();await editor.focus();
  await page.evaluate(()=>{window.__lspTest.multiDefinition=true;});
  await editor.press("F12");await picker.waitFor();await page.keyboard.press("Escape");
  await picker.waitFor({state:"hidden"});
  assert.equal(await editor.evaluate(node=>document.activeElement===node),true,"picker cancellation restores its editor");
  assert.equal(await page.locator(".source-viewer").count(),0);
  results.push("owned-picker/escape");
  await reset();
  await page.getByRole("button",{name:"笔记",exact:true}).click();
  await page.getByRole("textbox",{name:"Markdown 笔记",exact:true}).focus();
  const line=await editor.locator(".cm-line").first().boundingBox();
  assert.ok(line);
  await page.keyboard.down("Control");
  try{await page.mouse.click(line.x+25,line.y+line.height/2);}finally{await page.keyboard.up("Control");}
  await page.getByRole("dialog",{name:"collections.pyi",exact:true}).waitFor();
  await page.screenshot({path:"evidence/definition-focus-handoff.png"});
  await page.getByRole("button",{name:"关闭源码",exact:true}).click();
  await page.locator(".source-viewer").waitFor({state:"hidden"});
  results.push("notes-to-control-click");
  await reset();await editor.focus();await editor.press("Control+Home");
  assert.equal(await editor.innerText(),original);
  await writeFile("evidence/DEFINITION_FOCUS_RESULT.json",JSON.stringify({status:"PASS",scope:"App + CodeMirror with delayed mock IPC; synthetic composition, not native IME",cases:results},null,2)+"\n");
}
