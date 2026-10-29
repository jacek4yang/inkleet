import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function runCodeActionsUI(testPage){
 const page=await testPage({viewport:{width:1000,height:700}}),cases=[];
 await page.addInitScript(()=>{
  window.isTauri=true;
  const state=window.__codeActionsTest={id:1,version:1,requests:[],updates:[],pending:null,resolvePending:null,defer:false,deferResolve:false,mode:'valid'};
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
   if(command==='start_language_service')return {id:state.id,version:1,server:'fixture',uri:'file:///owned.rs',codeActions:true,completionResolve:false,completionSnippets:false};
   if(command==='update_language_document'){state.updates.push(args);state.version=args.version;return;}
   if(command==='stop_language_service'||command==='language_cancel_completion')return;
   if(command==='language_diagnostics')return {version:state.version,diagnostics:[]};
   if(command==='language_request')return null;
   if(command==='language_code_actions'){
    state.requests.push(args);const value=state.mode==='empty'?[]:[{token:1,title:'Make value mutable',kind:'quickfix'}];
    if(state.defer)return new Promise(resolve=>state.pending=()=>resolve(value));return value;
   }
   if(command==='language_code_action_resolve'){
    const value=state.mode==='invalid'?[{range:{start:{line:99,character:0},end:{line:99,character:0}},newText:'unsafe'}]:[{range:{start:{line:0,character:17},end:{line:0,character:17}},newText:'mut '}];
    if(state.deferResolve)return new Promise(resolve=>state.resolvePending=()=>resolve(value));return value;
   }
   throw Error('Unexpected fixture IPC '+command);
  }};
 });
 await page.goto('http://127.0.0.1:5173/tests/code-actions.html');
 await page.waitForFunction(()=>window.__codeActionIntelligence?.codeActionsAvailable());
 const editor=page.getByRole('textbox',{name:'Code action fixture'}),dialog=page.getByRole('dialog',{name:'代码操作',exact:true});
 const source=()=>page.evaluate(()=>window.__codeActionView.state.doc.toString());
 const original=await source();
 const open=async()=>{await editor.focus();await editor.press('Control+.');await dialog.waitFor();};
 await open();await dialog.getByRole('button',{name:'Make value mutable',exact:true}).click();
 await dialog.getByRole('region',{name:'代码操作预览'}).waitFor();
 assert.equal(await source(),original,'preview does not modify source');
 assert.equal(await dialog.getByLabel('新文本',{exact:true}).textContent(),'mut ');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 assert.equal(await source(),original.replace('let value','let mut value'));
 await editor.press('Control+z');assert.equal(await source(),original);
 await editor.press('Control+Shift+z');assert.equal(await source(),original.replace('let value','let mut value'));
 await editor.press('Control+z');cases.push('preview-confirm-single-undo-redo');
 await open();await dialog.getByRole('button',{name:'Make value mutable',exact:true}).click();
 await dialog.getByRole('button',{name:'返回',exact:true}).click();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await source(),original);cases.push('back-and-cancel');
 await page.evaluate(()=>window.__codeActionsTest.mode='invalid');await open();
 await dialog.getByRole('button',{name:'Make value mutable',exact:true}).click();
 await dialog.getByRole('status').filter({hasText:'越界'}).waitFor();assert.equal(await source(),original);
 assert.equal(await dialog.getByRole('button',{name:'应用',exact:true}).isVisible(),false);await page.keyboard.press('Escape');cases.push('reject-invalid-edit');
 await page.evaluate(()=>window.__codeActionsTest.mode='empty');await open();await dialog.getByText('此位置没有可安全应用的本题源码操作').waitFor();await page.keyboard.press('Escape');cases.push('empty-actions');
 await page.evaluate(()=>window.__codeActionsTest.mode='valid');
 for(const stage of ['list','resolve'])for(const boundary of ['escape','edit','selection','composition','destroy']){
  await page.evaluate(stage=>{const s=window.__codeActionsTest;s.defer=stage==='list';s.deferResolve=stage==='resolve';s.pending=null;s.resolvePending=null;},stage);
  await open();if(stage==='resolve')await dialog.getByRole('button',{name:'Make value mutable',exact:true}).click();
  await page.waitForFunction(stage=>typeof window.__codeActionsTest[stage==='list'?'pending':'resolvePending']==='function',stage);
  if(boundary==='escape')await page.keyboard.press('Escape');
  else if(boundary==='edit')await page.evaluate(()=>{const v=window.__codeActionView;v.dispatch({changes:{from:0,insert:'// owner edit\n'}});});
  else if(boundary==='selection')await page.evaluate(()=>window.__codeActionView.dispatch({selection:{anchor:3}}));
  else if(boundary==='composition')await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
  else await page.evaluate(()=>window.__codeActionIntelligence.destroy());
  const before=await source();await page.evaluate(stage=>window.__codeActionsTest[stage==='list'?'pending':'resolvePending'](),stage);await page.waitForTimeout(50);
  assert.equal(await dialog.count(),0,stage+'/'+boundary);assert.equal(await source(),before);cases.push(stage+'/'+boundary);
  if(boundary==='composition'){await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.waitForTimeout(100);}
  if(boundary==='destroy'){
   await page.reload();await page.waitForFunction(()=>window.__codeActionIntelligence?.codeActionsAvailable());
  }else await page.evaluate(original=>{const v=window.__codeActionView;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:original},selection:{anchor:0}});},original);
 }
 // Synthetic composition exercises ownership only, never claims an OS IME test.
 await page.evaluate(()=>{const s=window.__codeActionsTest;s.defer=false;s.deferResolve=false;s.updates=[];});
 await editor.focus();
 await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'})));
 await page.evaluate(()=>window.__codeActionView.dispatch({changes:{from:0,insert:'中'},userEvent:'input.type.compose'}));
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.__codeActionsTest.updates.length),0,'partial composition not sent to LSP');
 await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'})));
 await page.waitForFunction(()=>window.__codeActionsTest.updates.some(u=>u.text.startsWith('中')));
 cases.push('synthetic-composition-coalesces-document-sync');
 await page.screenshot({path:'evidence/code-actions-fixture.png'});
 await page.close();
 await writeFile('evidence/CODE_ACTIONS_UI_RESULT.json',JSON.stringify({status:'PASS',scope:'real CodeMirror lifecycle with mocked IPC; not actual LSP, native IME or latency acceptance',cases},null,2)+'\n');
}
