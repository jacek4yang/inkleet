import test from "node:test";
import assert from "node:assert/strict";
import {emptyJumpHistory,recordJump,moveJump,type JumpVisit} from "../src/editor-jump-history-model.ts";
import {navigationBindings,commandBindingLabel} from "../src/command-registry.ts";
const visit=(n:number):JumpVisit=>({selection:{ranges:[{anchor:n+2,head:n}],mainIndex:0},scroll:{top:n*10,left:n*3}});
test("history retains reversed selection, both viewport axes and branching",()=>{
 let h=recordJump(emptyJumpHistory(),visit(1),visit(2));h=recordJump(h,visit(2),visit(3));
 let m=moveJump(h,visit(3),-1)!;assert.deepEqual(m.target,visit(2));
 m=moveJump(m.history,visit(2),-1)!;assert.deepEqual(m.target,visit(1));
 assert.equal(moveJump(m.history,visit(1),-1),null);
 m=moveJump(m.history,visit(1),1)!;assert.deepEqual(m.target,visit(2));
 const branch=recordJump(m.history,visit(2),visit(4));assert.equal(moveJump(branch,visit(4),1),null);
 assert.deepEqual(branch.entries.map(v=>v.selection.ranges[0].head),[1,2,4]);
});
test("history is bounded and isolates caller-owned objects",()=>{
 const origin=visit(1),target=visit(2);let h=recordJump(emptyJumpHistory(),origin,target);
 origin.selection.ranges[0].head=999;target.scroll.top=999;
 assert.equal(h.entries[0].selection.ranges[0].head,1);assert.equal(h.entries[1].scroll.top,20);
 for(let n=2;n<100;n++)h=recordJump(h,visit(n),visit(n+1));
 assert.equal(h.entries.length,64);assert.equal(h.index,63);
 assert.equal(recordJump(h,visit(100),visit(100)),h);
 assert.deepEqual(emptyJumpHistory(),{entries:[],index:-1});
});
test("navigation follows platform conventions without taking Mac Option arrows",()=>{
 assert.deepEqual(navigationBindings("MacIntel"),{back:"Ctrl--",forward:"Ctrl-Shift--"});
 assert.deepEqual(navigationBindings("Linux x86_64"),{back:"Ctrl-Alt--",forward:"Ctrl-Shift--"});
 assert.deepEqual(navigationBindings("Win32"),{back:"Alt-ArrowLeft",forward:"Alt-ArrowRight"});
 assert.equal(commandBindingLabel("Ctrl--","MacIntel"),"Ctrl+-");
 assert.equal(commandBindingLabel("Ctrl-Alt--","Linux"),"Ctrl+Alt+-");
 assert.equal(commandBindingLabel("Mod-F12","MacIntel"),"⌘+F12");
});
