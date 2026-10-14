import test from "node:test";
import assert from "node:assert/strict";
import {CommandRegistry,formatBinding,editorPlatform} from "../src/command-registry.ts";
test("command identity, disabled execution, search and disposal",()=>{
 const r=new CommandRegistry<{enabled:boolean}>();let calls=0;
 const remove=r.register({id:"editor.rename",label:"重命名符号",key:"F2",enabled:c=>c.enabled,run:()=>{calls++;return true;}});
 assert.equal(r.execute("editor.rename",{enabled:false}),false);assert.equal(calls,0);
 assert.equal(r.list({enabled:true},"rename").length,1);
 assert.equal(r.execute("editor.rename",{enabled:true}),true);assert.equal(calls,1);
 assert.throws(()=>r.register({id:"editor.rename",label:"duplicate",run:()=>true}));
 assert.throws(()=>r.register({id:"other",label:"conflict",key:"F2",run:()=>true}));
 remove();assert.equal(r.execute("editor.rename",{enabled:true}),false);
});
test("platform formatting matches native VS Code defaults",()=>{
 assert.equal(formatBinding("Linux x86_64"),"Ctrl-Shift-i");
 assert.equal(formatBinding("Win32"),"Alt-Shift-f");
 assert.equal(formatBinding("MacIntel"),"Alt-Shift-f");
 assert.equal(editorPlatform("MacIntel"),"mac");
});
