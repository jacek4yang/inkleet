import assert from "node:assert/strict";
/** Isolated fixture: does not change existing tests' drafts or preferences. */
export async function runReadingControlsUI(browser,fixtures,baseURL="http://127.0.0.1:5173") {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 try {
  await page.addInitScript(question=>{
   if(localStorage.getItem("inkleet.reading.v1")===null)localStorage.setItem("inkleet.reading.v1",'{"fontSize":999,"ratio":-999,"language":"en"}');
   window.isTauri=true;
   const questions=[{...question,questionId:"901",titleSlug:"reading-one",content:"<p>English original</p>",translatedContent:"<p>中文原文</p>"},{...question,questionId:"902",titleSlug:"reading-two",content:null,translatedContent:"<p>仅中文题面</p>"}];
   window.__readingFixture={questions,opens:[]};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
    if(command==="load_recent_questions")return [];
    if(command==="search_questions")return {questions:questions.map(q=>({frontendQuestionId:q.questionFrontendId,title:q.title,titleCn:q.translatedTitle,titleSlug:q.titleSlug,difficulty:"Easy",paidOnly:false})),total:2,hasMore:false};
    if(command==="get_question"){window.__readingFixture.opens.push(args.slug);return {question:questions.find(q=>q.titleSlug===args.slug),cacheWarning:null,fromCache:false};}
    if(command==="get_editor_settings")return {settings:{version:1,formatOnSave:false,overrides:{}},revision:null};
    if(command==="load_document")return {code:null,notes:null};
    if(command==="list_solutions")return {entries:[{id:"default",name:"默认解答"}],unreadable:0};
    if(command==="login_status")return null;
    if(command==="external_editor_supported")return false;
    if(command==="list_judgements")return [];
    if(command==="begin_draft_session")return 1;
    if(["checkpoint_draft","stop_language_service","save_text"].includes(command))return;
    throw Error("Reading fixture has no service: "+command);
   }};
  },fixtures[0]);
  await page.goto(baseURL);
  await page.locator('[data-slug="reading-one"]').click();
  const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true});await editor.waitFor();
  await editor.fill("// unsaved reading draft\nfn main() {}\n");
  const content=()=>editor.evaluate(async node=>{const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");return EditorView.findFromDOM(node.closest(".cm-editor")).state.doc.toString();});
  const before=await content();
  assert.equal(await page.getByRole("spinbutton",{name:"题面字号"}).inputValue(),"32");
  assert.ok((await page.locator(".question-content").textContent()).includes("English original"));
  await page.getByRole("combobox",{name:"题面语言"}).selectOption("zh");
  assert.ok((await page.locator(".question-content").textContent()).includes("中文原文"));
  const editorFont=await editor.evaluate(node=>getComputedStyle(node).fontSize);
  const fontSize=page.getByRole("spinbutton",{name:"题面字号"});
  await fontSize.fill("");await fontSize.pressSequentially("24");
  assert.equal(await fontSize.inputValue(),"24","incremental input must not clamp the first digit");
  await fontSize.press("Enter");
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("inkleet.reading.v1")).fontSize),24);
  await fontSize.fill("18");await fontSize.press("Enter");
  assert.equal(await editor.evaluate(node=>getComputedStyle(node).fontSize),editorFont);
  for(let i=0;i<3;i++){
   await editor.focus();await page.getByRole("button",{name:"隐藏题面",exact:true}).click();
   assert.equal(await page.locator("#reading-pane").isVisible(),false);
   assert.equal(await editor.evaluate(node=>node.contains(document.activeElement)||node===document.activeElement),true);
   await page.getByRole("button",{name:"显示题面",exact:true}).click();
  }
  assert.equal(await content(),before);
  const splitter=page.getByRole("separator",{name:"调整题面宽度"});
  await splitter.focus();await page.keyboard.press("End");const max=Number(await splitter.getAttribute("aria-valuenow"));
  await page.keyboard.press("Home");assert.ok(Number(await splitter.getAttribute("aria-valuenow"))<max);
  await page.keyboard.press("Enter");assert.equal(Number(await splitter.getAttribute("aria-valuenow")),44);
  const box=await splitter.boundingBox();await page.mouse.move(box.x+4,box.y+100);await page.mouse.down();await page.mouse.move(box.x+100,box.y+100);
  await page.getByRole("combobox",{name:"题面语言"}).selectOption("en");
  await page.keyboard.press("Escape");await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem("inkleet.reading.v1"));return {ratio:p.ratio,language:p.language};}),{ratio:44,language:"en"},"persisting another preference must not save a canceled preview ratio");
  assert.equal(Number(await splitter.getAttribute("aria-valuenow")),44);
  assert.equal(await splitter.evaluate(node=>node.hasPointerCapture(1)),false,"Escape releases the mouse pointer capture");
  await page.mouse.move(box.x+4,box.y+100);await page.mouse.down();await page.mouse.move(box.x+80,box.y+100);
  await splitter.dispatchEvent("pointerdown",{pointerId:99,button:0,isPrimary:false,clientX:box.x+200});
  await page.setViewportSize({width:600,height:900});await page.mouse.up();
  await page.setViewportSize({width:1440,height:900});
  assert.equal(Number(await splitter.getAttribute("aria-valuenow")),44,"responsive transition cancels rather than persists a partial drag");
  assert.equal(await page.getByRole("button",{name:"上一题",exact:true}).isDisabled(),true);
  await page.getByRole("combobox",{name:"题面语言"}).selectOption("en");
  await page.getByRole("button",{name:"下一题",exact:true}).click();await page.getByText("暂无英文题面，显示中文题面。",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"下一题",exact:true}).isDisabled(),true);
  await page.getByRole("button",{name:"上一题",exact:true}).click();await page.getByText("English original",{exact:true}).waitFor();
  assert.equal(await content(),before);
  await page.setViewportSize({width:600,height:900});assert.equal(await splitter.isVisible(),false);
  await page.getByRole("button",{name:"代码",exact:true}).click();assert.equal(await editor.isVisible(),true);
  await page.getByRole("button",{name:"题目",exact:true}).click();assert.equal(await page.locator(".question-content").isVisible(),true);
  await page.setViewportSize({width:1440,height:900});assert.equal(await content(),before);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("inkleet.reading.v1")).fontSize),18);
  await page.reload();await splitter.waitFor();assert.equal(Number(await splitter.getAttribute("aria-valuenow")),44,"reload retains committed width rather than canceled drag preview");
 } finally {await page.close();}
}
