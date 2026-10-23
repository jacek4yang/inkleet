import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
export async function runEditorJumpHistoryUI(page,editor){
 const sourceText=()=>editor.evaluate(async node=>{
  const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
  return EditorView.findFromDOM(node.closest(".cm-editor")).state.doc.toString();
 });
 const original=await sourceText(),fixture=Array.from({length:180},(_,i)=>"value_"+i+" = "+i+" # "+"long ".repeat(35)).join("\n");
 const keys=await page.evaluate(()=>/Mac/i.test(navigator.platform)?{back:"Control+-",forward:"Control+Shift+-"}:/Linux/i.test(navigator.platform)?{back:"Control+Alt+-",forward:"Control+Shift+-"}:{back:"Alt+ArrowLeft",forward:"Alt+ArrowRight"});
 const snapshot=()=>page.evaluate(async()=>{
  const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
  const view=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
  return {ranges:view.state.selection.ranges.map(({anchor,head})=>({anchor,head})),mainIndex:view.state.selection.mainIndex,top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft};
 });
 const restored=async expected=>page.waitForFunction(async expected=>{
  const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
  const v=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
  return v.state.selection.mainIndex===expected.mainIndex&&JSON.stringify(v.state.selection.ranges.map(({anchor,head})=>({anchor,head})))===JSON.stringify(expected.ranges)&&Math.abs(v.scrollDOM.scrollTop-expected.top)<2&&Math.abs(v.scrollDOM.scrollLeft-expected.left)<2;
 },expected);
 const choose=async line=>{
  await page.evaluate(line=>{window.__lspTest.primaryDefinition=true;window.__lspTest.definitionRange={start:{line,character:0},end:{line,character:5}};},line);
  await editor.press("F12");
  await page.waitForFunction(async line=>{
   const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
   const v=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
   return v.state.doc.lineAt(v.state.selection.main.head).number===line+1;
  },line);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 };
 await editor.fill(fixture);await editor.press("Control+Home");
 await editor.press("ArrowRight");await editor.press("ArrowRight");await editor.press("Shift+ArrowLeft");await editor.press("Shift+ArrowLeft");
 const a=await snapshot();
 await page.evaluate(async()=>{
  const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
  const {EditorSelection}=await import("/node_modules/.vite/deps/@codemirror_state.js");
  const {jumpEditor,moveEditorJump}=await import("/src/editor-jump-history.ts");
  const v=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
  jumpEditor(v,EditorSelection.single(v.state.doc.line(120).from));moveEditorJump(v,-1);
 });
 await restored(a);
 await choose(40);
 await editor.evaluate(node=>{node.closest(".cm-editor").querySelector(".cm-scroller").scrollLeft=120;});
 const b=await snapshot();assert.ok(b.left>0);await choose(100);
 await editor.press(keys.back);await restored(b);
 await editor.press(keys.back);await restored(a);
 await editor.press(keys.forward);await restored(b);
 await editor.press(keys.forward);
 await page.evaluate(async()=>{
  const {EditorView}=await import("/node_modules/.vite/deps/@codemirror_view.js");
  const {moveEditorJump}=await import("/src/editor-jump-history.ts");
  const v=EditorView.findFromDOM(document.querySelector(".code-pane .cm-editor"));
  moveEditorJump(v,-1);moveEditorJump(v,-1);moveEditorJump(v,1);
 });
 await restored(b);
 await choose(130);const branch=await snapshot();await editor.press(keys.forward);
 assert.deepEqual((await snapshot()).ranges,branch.ranges);
 const url=page.url();
 await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("rust");
 await page.locator('.lsp-status[data-status="rust-analyzer 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
 await editor.focus();const rust=await snapshot();await editor.press(keys.back);
 assert.deepEqual((await snapshot()).ranges,rust.ranges);assert.equal(page.url(),url);
 await page.getByRole("combobox",{name:"编程语言",exact:true}).selectOption("python3");
 await page.locator('.lsp-status[data-status="Pyright 已连接 · F12 / Ctrl+单击查看定义"]').waitFor();
 await editor.focus();await editor.press(keys.back);await restored(b);
 await page.evaluate(()=>{window.__lspTest.primaryDefinition=false;});
 await editor.press("F12");await page.locator(".source-viewer").waitFor();
 await page.getByRole("button",{name:"返回代码",exact:true}).click();
 await editor.press(keys.back);await restored(a);
 await editor.press(keys.forward);await restored(b);
 await page.evaluate(()=>{window.__lspTest.primaryDefinition=true;window.__lspTest.deferDefinition=true;window.__lspTest.definitionReply=null;});
 await editor.press("F12");await page.waitForFunction(()=>typeof window.__lspTest.definitionReply==="function");
 await editor.press(keys.back);await restored(a);
 await page.evaluate(()=>{window.__lspTest.definitionReply();window.__lspTest.deferDefinition=false;});
 await page.waitForTimeout(100);assert.deepEqual((await snapshot()).ranges,a.ranges);
 await editor.press("End");await editor.pressSequentially("x");await editor.press("Control+z");
 const afterUndo=await snapshot();await editor.press(keys.forward);assert.deepEqual((await snapshot()).ranges,afterUndo.ranges);
 assert.equal(await sourceText(),fixture);
 await page.screenshot({path:"evidence/editor-jump-history.png"});
 await page.evaluate(()=>{window.__lspTest.primaryDefinition=false;delete window.__lspTest.definitionRange;});
 await editor.fill(original);await editor.press("Control+Home");
 await writeFile("evidence/EDITOR_JUMP_HISTORY_RESULT.txt","PASS: editable jump history, reversed selection, both scroll axes, rapid movement, branching, cached language isolation, reader return, stale reply cancellation, edit/undo invalidation and browser boundary. Mocked LSP IPC.\n");
}
