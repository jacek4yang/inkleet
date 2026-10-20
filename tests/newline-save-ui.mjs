import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runNewlineSaveUI(testPage,openSettings){
 const results=[];
 for(const separator of ["\r\n","\r"])for(const formatOnSave of [false,true])for(const origin of ["disk","template","recovery"]){
  const page=await testPage({viewport:{width:1440,height:900}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(({separator,formatOnSave,origin})=>{
   window.isTauri=true;
   const raw="first"+separator+"second"+separator;
   const recovered="edited"+separator+"second"+separator;
   const s=window.__newlineSaveTest={code:origin==="template"?null:raw,notes:"note"+separator+"body"+separator,
    draft:origin==="recovery"?{text:recovered,baseline:raw}:null,requests:[],writes:[],formats:[],raw,recovered};
   window.__formatTest=s;
   window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
    if(command==="get_editor_settings")return {settings:{version:1,formatOnSave,overrides:{}},revision:null};
    if(command==="load_recent_questions")return window.__fixtureQuestions.map(q=>({...q,codeSnippets:q.codeSnippets.map(snippet=>({...snippet,code:raw}))}));
    if(command==="search_questions")return {questions:[],total:0,hasMore:false};
    if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
    if(command==="load_document")return {code:s.code,notes:s.notes,codeDraft:s.draft,notesDraft:{text:s.notes.replace(/\r\n?/g,"\n"),baseline:s.notes}};
    if(command==="external_editor_supported")return false;
    if(command==="start_language_service")throw Error("offline newline fixture");
    if(command==="stop_language_service")return;
    if(command==="format_source"){s.formats.push(args.text);return args.text;}
    if(command==="save_text"){
     s.requests.push(args);
     if(s[args.kind]!==args.expected)throw Error("exact-byte CAS conflict");
     s[args.kind]=args.text;s.writes.push(args);return;
    }
    if(command==="resolve_file_conflict"){
     if(s[args.kind]!==args.expected)throw Error("exact-byte conflict baseline changed");
     if(args.choice==="local")s[args.kind]=args.local;
     return {text:s[args.kind],backup:"preserved-raw-conflict.json"};
    }
    throw Error("Unexpected newline IPC "+command);
   }};
  },{separator,formatOnSave,origin});
  await page.goto("http://127.0.0.1:5173");
  const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true});
  await editor.waitFor();
  const expected=(origin==="recovery"?"edited":"first")+"\nsecond\n";
  const readCode=()=>page.evaluate(async()=>{
   const {EditorView}=await import("/tests/input-harness.ts");
   return EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor")).state.doc.toString();
  });
  assert.equal(await readCode(),expected);
  assert.equal(await page.evaluate(()=>window.__newlineSaveTest.requests.length),0,"opening text never rewrites canonical files");
  assert.equal(await page.getByLabel("源码未保存",{exact:true}).count(),origin==="recovery"?1:0);
  await editor.press("Control+s");
  await page.waitForFunction(()=>window.__newlineSaveTest.writes.length===1);
  const saved=await page.evaluate(()=>window.__newlineSaveTest.writes[0]);
  assert.equal(saved.text,expected);
  assert.equal(saved.expected,origin==="template"?null:"first"+separator+"second"+separator,"CAS baseline retains raw original file bytes");
  assert.equal(await page.evaluate(()=>window.__newlineSaveTest.formats.length),formatOnSave?1:0);
  await page.waitForFunction(()=>!document.querySelector('[aria-label="源码未保存"]'));
  await editor.press("Control+End");await editor.pressSequentially("X");await editor.press("Control+z");
  assert.equal(await readCode(),expected);assert.equal(await page.getByLabel("源码未保存",{exact:true}).count(),0,"undo restores the clean editor representation");

  await page.getByRole("button",{name:"笔记",exact:true}).click();
  const notes=page.getByRole("textbox",{name:"Markdown 笔记",exact:true});
  await notes.waitFor();
  assert.equal(await page.getByLabel("笔记未保存",{exact:true}).count(),0,"newline-only sidecar is not a recovered edit");
  await notes.press("Control+s");
  await page.waitForFunction(()=>window.__newlineSaveTest.writes.length===2);
  const note=await page.evaluate(()=>window.__newlineSaveTest.writes[1]);
  assert.equal(note.expected,"note"+separator+"body"+separator);
  assert.equal(note.text,"note\nbody\n");

  if(separator==="\r\n"&&!formatOnSave&&origin==="disk"){
   await page.evaluate(()=>{window.__newlineSaveTest.code="external\r\nrevision\r\n";});
   await editor.fill("local draft");await editor.press("Control+s");
   await page.locator('[data-action="review-code-conflict"]').click();
   const dialog=page.getByRole("dialog",{name:"源码文件冲突",exact:true});
   await dialog.getByRole("button",{name:"使用文件版本",exact:true}).click();
   await dialog.waitFor({state:"hidden"});
   assert.equal(await readCode(),"external\nrevision\n");
   await editor.press("Control+s");
   await page.waitForFunction(()=>window.__newlineSaveTest.writes.length===3);
   assert.equal(await page.evaluate(()=>window.__newlineSaveTest.writes[2].expected),"external\r\nrevision\r\n","external choice preserves its raw CAS baseline");
   assert.equal(await page.evaluate(()=>window.__newlineSaveTest.writes[2].text),"external\nrevision\n");
  }
  assert.deepEqual(errors,[]);
  results.push({separator:separator==="\r\n"?"CRLF":"CR",formatOnSave,origin,result:"PASS"});
  await page.close();
 }
 await writeFile("evidence/NEWLINE_SAVE_RESULT.json",JSON.stringify({scope:"Real App/CodeMirror; mocked storage and formatter. Exact-byte CAS asserted; no native disk qualification.",results},null,2));
}
