/** Real installed Tauri/WebView2 on disposable Windows CI; no browser or IPC mocks.
 * CDP is enabled only in the spawned test process, never registry/system settings.
 */
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {spawn,execFile} from "node:child_process";
import {createServer} from "node:net";
import {promisify} from "node:util";
import {mkdir,readFile,writeFile,access} from "node:fs/promises";
import path from "node:path";
const run=promisify(execFile),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const configPath=process.argv[2],config=JSON.parse(await readFile(configPath,"utf8"));
assert.equal(process.platform,"win32","Windows installed probe must not run on another platform");
assert.equal(process.env.GITHUB_ACTIONS,"true");assert.equal(process.env.RUNNER_ENVIRONMENT,"github-hosted");
assert.ok(["fresh","legacy","upgraded"].includes(config.phase));
assert.match(config.version,/^\d+\.\d+\.\d+$/);assert.match(config.harnessCommit,/^[0-9a-f]{40}$/);assert.match(config.applicationSourceCommit,/^[0-9a-f]{40}$/);
const within=(child,parent)=>{const relative=path.relative(path.resolve(parent),path.resolve(child));return !!relative&&!relative.startsWith("..")&&!path.isAbsolute(relative);};
assert.ok(within(config.binary,config.installDir)&&within(config.installDir,config.temporary)&&within(config.temporary,process.env.RUNNER_TEMP));
assert.ok(within(config.evidence,process.cwd()));assert.equal(config.tokenInspector,path.join(process.cwd(),"scripts","windows-ci-host.ps1"));assert.match(config.userSid,/^S-1-5-21-\d+-\d+-\d+-\d+$/);
for(const root of new Set([config.appData,config.appCache,config.temporary,path.join(config.temporary,"WebView2 synthetic profile")]))assert.equal((await readFile(path.join(root,".inkleet-ci-owned"),"utf8")).trim(),config.harnessCommit);
await access(config.binary);await mkdir(config.evidence,{recursive:true});
const notebook=path.join(config.appData,"notebook","lc-900000001"),sourceFile=path.join(notebook,"solution.rs"),notesFile=path.join(notebook,"notes.md");
const freshCode="// Fresh MSI saved by real Windows WebView2\nfn solve(values: Vec<i32>) -> i32 { values.iter().sum() }";
const oldCode="// v0.1.1 saved before real MSI upgrade · 完整源码\nfn solve(values: Vec<i32>) -> i32 { values.iter().sum() }";
const oldNotes="# MSI upgrade fixture\n\n由 v0.1.1 原生窗口保存；升级与卸载必须保留。";
const namedCode="// Named solution written by v0.1.1\nfn solve(values: Vec<i32>) -> i32 { values.into_iter().sum() }";
const archivedDraft="// Unsaved archive draft retained across Windows restart\nfn solve(values: Vec<i32>) -> i32 { values.into_iter().sum() }";
const namedState=path.join(config.evidence,"legacy-solution.json");
const report={result:"FAIL",phase:config.phase,harnessCommit:config.harnessCommit,applicationSourceCommit:config.applicationSourceCommit,nativeVersion:null,normalClose:false,launches:[],launch_attempts:[],assertions:[],scope:"Installed release executable, real WebView2/CDP input and real Tauri IPC/storage. Not physical IME, OS pointer fidelity, LSP performance or real accounts."};
let current=null;
async function inspectOwned(owned,teardown=false){
 const args=["-NoLogo","-NoProfile","-NonInteractive","-File",config.tokenInspector,"-Config",configPath,"-Port",String(owned.port),...(teardown?["-TeardownPid",String(owned.pid),"-OwnedPids",owned.finalObservedPids.join(",")]:["-InspectPid",String(owned.pid),"-NodePid",String(process.pid)])];
 const {stdout}=await run(config.powershell,args,{timeout:20000,maxBuffer:1024*1024});return JSON.parse(stdout.replace(/^\uFEFF/,""));
}
async function poll(read,label,timeout=30000){
 const deadline=Date.now()+timeout;let last;
 while(Date.now()<deadline){try{const result=await read();if(result)return result;}catch(error){last=String(error);}await delay(150);}
 throw Error(label+" timed out"+(last?": "+last:""));
}
async function fileEquals(file,expected){return poll(async()=>await readFile(file,"utf8")===expected,"native file save "+path.basename(file));}
async function launch(){
 const server=createServer();await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const userData=path.join(config.temporary,"WebView2 synthetic profile");
 const child=spawn(config.binary,[],{cwd:config.installDir,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`,WEBVIEW2_USER_DATA_FOLDER:userData},stdio:["ignore","pipe","pipe"]});
 const attempt={pid:child.pid,node_pid:process.pid,port,diagnostics:null,exited:false,exit_code:null};report.launch_attempts.push(attempt);
 const owned={child,pid:child.pid,port,attempt,browser:null,page:null,exited:false,exitCode:null,launchError:null,stdout:"",stderr:"",pageErrors:[]};current=owned;
 child.on("error",error=>{owned.launchError=String(error);});child.on("exit",code=>{owned.exited=true;owned.exitCode=code;attempt.exited=true;attempt.exit_code=code;});
 child.stdout.on("data",bytes=>{owned.stdout=(owned.stdout+bytes.toString()).slice(-128000);});child.stderr.on("data",bytes=>{owned.stderr=(owned.stderr+bytes.toString()).slice(-128000);});
 assert.ok(Number.isSafeInteger(owned.pid)&&owned.pid>0,"spawned app must have an owned process ID");
 attempt.diagnostics=await inspectOwned(owned);owned.initialObservedPids=attempt.diagnostics.processes.map(value=>value.pid);
 const endpoint=`http://127.0.0.1:${port}`;
 await poll(async()=>{
  if(owned.launchError||owned.exited)throw Error("Installed process ended before CDP: "+owned.launchError+" / "+owned.exitCode);
  const response=await fetch(endpoint+"/json/version",{signal:AbortSignal.timeout(1000)});return response.ok;
 },"installed WebView2 CDP (no browser substitute)",60000);
 const observed=await inspectOwned(owned);attempt.diagnostics=observed;
 assert.equal(observed.result,"PASS");assert.equal(observed.node_token.process_id,process.pid);assert.equal(observed.app_token.process_id,owned.pid);
 assert.ok(observed.listeners.length>0&&observed.listeners.every(value=>value.owned&&value.port===port&&["127.0.0.1","::1"].includes(value.address)),"CDP must be bound only to an owned loopback listener");
 assert.ok(observed.processes.some(value=>value.confirmed_exited===false&&value.name==="msedgewebview2.exe"&&typeof value.webview_file_version==="string"&&value.webview_file_version.length>0),"actual owned WebView2 runtime version must be observed");
 owned.browser=await chromium.connectOverCDP(endpoint,{timeout:10000});
 owned.page=await poll(()=>owned.browser.contexts().flatMap(context=>context.pages()).find(page=>/^https?:\/\/tauri\.localhost(?:\/|$)/.test(page.url())),"installed local main webview");
 const page=owned.page;page.setDefaultTimeout(20000);page.on("pageerror",error=>owned.pageErrors.push(String(error)));
 await page.waitForFunction(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label==="main");
 const nativeVersion=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("plugin:app|version"));
 assert.equal(nativeVersion,config.version,"actual running native version, not a webpage fixture label");report.nativeVersion=nativeVersion;
 const editor=page.getByRole("textbox",{name:"代码编辑器",exact:true});await editor.waitFor({state:"visible"});
 await page.waitForFunction(()=>document.querySelector('main[data-close-protection="ready"]'));
 const launchRecord={pid:owned.pid,nodePid:process.pid,port,version:nativeVersion,url:page.url(),webviewVersion:await owned.browser.version(),observedHost:observed,initialObservedPids:owned.initialObservedPids,teardown:null};report.launches.push(launchRecord);owned.launchRecord=launchRecord;
 return {page,editor};
}
async function closeNormally(){
 const owned=current;assert.ok(owned?.page);assert.deepEqual(owned.pageErrors,[],"installed frontend must not raise uncaught errors");
 const closing=await inspectOwned(owned);owned.launchRecord.closingObservedPids=closing.processes.map(value=>value.pid);owned.finalObservedPids=[...new Set([...owned.initialObservedPids,...owned.launchRecord.observedHost.processes.map(value=>value.pid),...owned.launchRecord.closingObservedPids])].sort((a,b)=>a-b);assert.ok(owned.finalObservedPids.includes(owned.pid));owned.launchRecord.finalObservedPids=owned.finalObservedPids;
 // Normal Tauri close request executes the application's own write-drain and
 // dirty-draft handler. Never call destroy() or kill() to obtain a passing close.
 let requestError;
 await Promise.race([owned.page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("plugin:window|close",{label:"main"})),delay(20000).then(()=>{throw Error("Normal close IPC request timed out");})]).catch(error=>{requestError=String(error);});
 await poll(()=>owned.exited,"normal installed application close",20000);
 assert.equal(owned.exitCode,0,"normal installed application exit status");
 if(requestError&&!/closed|disconnect|Target page|context|browser/i.test(requestError))throw Error(requestError);
 await owned.browser.close().catch(()=>{});
 const teardown=await poll(async()=>{const result=await inspectOwned(owned,true);return result.result==="PASS"?result:null;},"owned app and CDP listener teardown",30000);owned.launchRecord.teardown=teardown;
 await writeFile(path.join(config.evidence,`${config.phase}-${report.launches.length}-process.txt`),owned.stdout+"\nSTDERR\n"+owned.stderr);
 current=null;report.normalClose=true;
}
async function codeEquals(editor,expected){await poll(async()=>await editor.innerText()===expected,"native editor loaded exact full source");}
async function saveCode(page,editor,text,file=sourceFile){await editor.fill(text);await page.getByRole("button",{name:"保存源码",exact:true}).click();await fileEquals(file,text);await poll(()=>page.getByRole("img",{name:"源码未保存",exact:true}).count().then(count=>count===0),"source is clean after native save");}
async function notes(page,text,write){
 await page.getByRole("button",{name:"笔记",exact:true}).click();
 const field=page.getByRole("textbox",{name:"Markdown 笔记",exact:true});await field.waitFor();
 if(write){await field.fill(text);await page.getByRole("button",{name:"保存笔记",exact:true}).click();await fileEquals(notesFile,text);}else await codeEquals(field,text);
 await page.getByRole("button",{name:"题目",exact:true}).click();
}
async function menu(page,label){await page.locator(".solution-menu>summary").click();await page.getByRole("button",{name:label,exact:true}).click();}
try{
 let {page,editor}=await launch();
 if(config.phase==="fresh"){
  await saveCode(page,editor,freshCode);await notes(page,"# Fresh Windows MSI fixture",true);
  await page.locator('[data-action="open-settings"]').click();await page.getByRole("dialog",{name:"设置",exact:true}).waitFor();await page.getByRole("button",{name:"关闭设置",exact:true}).click();
  await page.screenshot({path:path.join(config.evidence,"fresh-installed-webview2.png"),fullPage:true});
  report.assertions.push("fresh MSI executable starts; settings opens/closes; source and notes saved through real IPC");
  await closeNormally();
 }else if(config.phase==="legacy"){
  await codeEquals(editor,freshCode);
  await saveCode(page,editor,oldCode);await notes(page,oldNotes,true);
  await menu(page,"复制解答");const dialog=page.getByRole("dialog",{name:"复制解答",exact:true});await dialog.getByRole("textbox",{name:"解答名称",exact:true}).fill("升级保留解答");await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.waitFor({state:"hidden"});
  const id=await page.getByRole("combobox",{name:"解答",exact:true}).inputValue();assert.match(id,/^[a-f0-9]{32}$/);
  const namedFile=path.join(notebook,".solutions","rust",id,"solution.rs");await saveCode(page,editor,namedCode,namedFile);
  await writeFile(namedState,JSON.stringify({id,name:"升级保留解答",oldCode,oldNotes,namedCode},null,2));
  await page.screenshot({path:path.join(config.evidence,"v0.1.1-before-upgrade.png"),fullPage:true});
  report.assertions.push("public hash-verified v0.1.1 saved source, shared notes and named solution via native UI");
  await closeNormally();
 }else{
  const legacy=JSON.parse(await readFile(namedState,"utf8"));assert.match(legacy.id,/^[a-f0-9]{32}$/);
  const namedFile=path.join(notebook,".solutions","rust",legacy.id,"solution.rs"),metadataFile=path.join(path.dirname(namedFile),"name.json");
  await codeEquals(editor,oldCode);await notes(page,oldNotes,false);
  await page.getByRole("combobox",{name:"解答",exact:true}).selectOption(legacy.id);await codeEquals(editor,namedCode);assert.equal(await readFile(namedFile,"utf8"),namedCode);
  await editor.fill(archivedDraft);await menu(page,"归档解答");let dialog=page.getByRole("dialog",{name:"归档解答",exact:true});await dialog.getByRole("button",{name:"取消",exact:true}).click();assert.equal(JSON.parse(await readFile(metadataFile,"utf8")).archived??false,false);
  await menu(page,"归档解答");dialog=page.getByRole("dialog",{name:"归档解答",exact:true});await dialog.getByRole("button",{name:"确认归档",exact:true}).click();await dialog.waitFor({state:"hidden"});await codeEquals(editor,oldCode);
  assert.equal(JSON.parse(await readFile(metadataFile,"utf8")).archived,true);assert.equal(await readFile(namedFile,"utf8"),namedCode);
  await page.screenshot({path:path.join(config.evidence,"upgraded-archived-webview2.png"),fullPage:true});await closeNormally();
  ({page,editor}=await launch());await codeEquals(editor,oldCode);
  await page.locator(".solution-menu>summary").click();await page.locator(".solution-menu button").filter({hasText:/^已归档/}).click();dialog=page.getByRole("dialog",{name:"已归档解答",exact:true});await dialog.getByRole("button",{name:"恢复解答「升级保留解答」",exact:true}).click();await dialog.waitFor({state:"hidden"});
  await codeEquals(editor,archivedDraft);assert.equal(await readFile(namedFile,"utf8"),namedCode);assert.equal(await page.getByRole("img",{name:"源码未保存",exact:true}).count(),1);
  assert.equal(JSON.parse(await readFile(metadataFile,"utf8")).archived??false,false);await saveCode(page,editor,archivedDraft,namedFile);await notes(page,oldNotes,false);
  await page.screenshot({path:path.join(config.evidence,"upgraded-restored-webview2.png"),fullPage:true});
  report.assertions.push("v0.1.1 source/notes/named ID preserved through MSI upgrade", "archive cancel and confirm use real storage", "restart then restore retains unsaved draft without overwriting saved source", "explicit save persists restored draft");
  await closeNormally();
 }
 report.result="PASS";
}catch(error){
 report.error=String(error);
 if(current)try{current.attempt.diagnostics=await inspectOwned(current);}catch(diagnosticError){current.attempt.diagnostic_error=String(diagnosticError);}
 if(current?.page)await current.page.screenshot({path:path.join(config.evidence,`${config.phase}-failure.png`),fullPage:true}).catch(()=>{});
 throw error;
}finally{
 if(current){
  await writeFile(path.join(config.evidence,`${config.phase}-failed-process.txt`),current.stdout+"\nSTDERR\n"+current.stderr).catch(()=>{});
  // Cleanup is only for this spawned PID tree, only after failure, never evidence
  // of normal shutdown. No process-name scans, policy changes, or force-success.
  if(!current.exited&&Number.isSafeInteger(current.pid))await run("taskkill.exe",["/PID",String(current.pid),"/T","/F"]).catch(error=>{report.cleanupError=String(error);});
  await current.browser?.close().catch(()=>{});
 }
 await writeFile(path.join(config.evidence,`${config.phase}-ui.json`),JSON.stringify(report,null,2));
}
