import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

export async function runNotesSaveUI(testPage){
  const page=await testPage({viewport:{width:1440,height:900}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.isTauri=true;
    const s=window.__notesSaveTest={files:{},requests:[],writes:[]};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="load_recent_questions")return window.__fixtureQuestions;
      if(command==="search_questions")return {questions:[],total:0,hasMore:false};
      if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
      if(command==="load_document")return {code:"// notes fixture",notes:s.files[args.problem]??"initial note"};
      if(command==="external_editor_supported")return false;
      if(command==="start_language_service")throw Error("offline notes fixture");
      if(command==="stop_language_service")return;
      if(command==="save_text"){
        if(args.kind!=="notes")throw Error("unexpected code save");
        return new Promise((resolve,reject)=>s.requests.push({args,release:()=>{
          if((s.files[args.problem]??"initial note")!==args.expected){reject(Error("CAS mismatch"));return;}
          s.files[args.problem]=args.text;s.writes.push(args);resolve();
        },reject}));
      }
      throw Error("Unexpected notes save IPC "+command);
    }};
  });
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("textbox",{name:"代码编辑器",exact:true}).waitFor();
  await page.getByRole("button",{name:"笔记",exact:true}).click();
  const notes=page.getByRole("textbox",{name:"Markdown 笔记",exact:true});
  await notes.fill("A requested");await notes.press("Control+s");
  await page.waitForFunction(()=>window.__notesSaveTest.requests.length===1);
  await notes.fill("B superseded");await notes.press("Control+s");
  await notes.fill("C requested");await page.getByRole("button",{name:"保存笔记",exact:true}).click();
  await notes.fill("D unsaved");
  assert.equal(await page.evaluate(()=>window.__notesSaveTest.requests.length),1,"one active disk write per notes file");
  await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("java");
  await page.evaluate(()=>window.__notesSaveTest.requests[0].release());
  await page.waitForFunction(()=>window.__notesSaveTest.requests.length===2);
  const queued=await page.evaluate(()=>window.__notesSaveTest.requests[1].args);
  assert.equal(queued.text,"C requested","coalesce to last explicitly requested snapshot, never later typing");
  assert.equal(queued.expected,"A requested","second write uses first committed CAS baseline");
  assert.equal(queued.language,"rust","queued intent retains its original target after workspace switch");
  await page.evaluate(()=>window.__notesSaveTest.requests[1].release());
  await notes.waitFor();assert.equal(await notes.innerText(),"D unsaved");
  await page.getByLabel("笔记未保存",{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__notesSaveTest.writes.map(w=>w.text)),["A requested","C requested"]);

  await notes.fill("E requested");await notes.press("Control+s");
  await page.waitForFunction(()=>window.__notesSaveTest.requests.length===3);
  await notes.fill("F only typed");
  await page.evaluate(()=>window.__notesSaveTest.requests[2].release());
  await page.waitForFunction(()=>window.__notesSaveTest.writes.length===3);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__notesSaveTest.requests.length),3,"editing alone never queues a canonical save");
  assert.equal(await notes.innerText(),"F only typed");
  await page.getByLabel("笔记未保存",{exact:true}).waitFor();
  await page.locator('.statusbar[data-storage-state="已保存快照 · 仍有未保存修改"]').waitFor();

  await notes.fill("G fails");await notes.press("Control+s");
  await page.waitForFunction(()=>window.__notesSaveTest.requests.length===4);
  await notes.fill("H queued");await notes.press("Control+s");
  await page.evaluate(()=>window.__notesSaveTest.requests[3].reject(Error("disk conflict")));
  await page.locator('.statusbar[data-storage-state="保存失败 · 草稿仍在，请先导出"]').waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__notesSaveTest.requests.length),4,"failure never retries or drains queued writes automatically");
  assert.equal(await notes.innerText(),"H queued","failed and superseded intents retain live notes");
  await page.getByLabel("笔记未保存",{exact:true}).waitFor();
  await notes.press("Control+s");
  assert.equal(await page.evaluate(()=>window.__notesSaveTest.requests.length),4,"blocked file requires explicit recovery before another write");
  assert.deepEqual(errors,[]);
  await page.screenshot({path:"evidence/notes-queued-save-draft-preserved.png"});
  await page.close();
  await writeFile("evidence/NOTES_SAVE_INTENT_RESULT.txt","PASS: real Notes/CodeMirror Save shortcut and toolbar, latest explicit snapshot coalescing, original target across language switch, ordered CAS baselines, unsaved newer text retained, no autosave after plain edits, and failure blocks queued writes without retry. Mocked storage IPC, not native disk acceptance.\n");
}
