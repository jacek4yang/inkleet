import test from "node:test";
import assert from "node:assert/strict";
import {createEditorSessionCache} from "../src/editor-session-cache.ts";
function entry(text:string){return {state:{doc:{length:text.length}},text};}
test("inactive session count evicts oldest and active take releases ownership",()=>{
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(2,20),a=entry("a"),b=entry("b"),c=entry("c");
 cache.set("a",a);cache.set("b",b);assert.equal(cache.take("a"),a);
 assert.equal(cache.size,1);assert.equal(cache.retainedUnits,1);
 cache.set("a",a);cache.set("c",c);
 assert.equal(cache.take("b"),undefined);assert.equal(cache.take("a"),a);assert.equal(cache.take("c"),c);
 assert.equal(cache.size,0);assert.equal(cache.retainedUnits,0);
});
test("replacement adjusts accounting and becomes most recent",()=>{
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(2,20);
 cache.set("a",entry("abc"));cache.set("b",entry("d"));cache.set("a",entry("xy"));
 assert.equal(cache.size,2);assert.equal(cache.retainedUnits,3);
 cache.set("c",entry("z"));assert.equal(cache.take("b"),undefined);
 assert.equal(cache.take("a")?.text,"xy");assert.equal(cache.retainedUnits,1);
});
test("UTF16 admission budget evicts whole sessions without flattening",()=>{
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(12,5);
 cache.set("a",entry("😀"));cache.set("b",entry("abc"));cache.set("c",entry("xy"));
 assert.equal(cache.take("a"),undefined);assert.equal(cache.retainedUnits,5);
 assert.equal(cache.take("b")?.text,"abc");assert.equal(cache.retainedUnits,2);
});
test("oversized replacement removes stale state but preserves unrelated entries",()=>{
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(2,4);
 cache.set("a",entry("a"));cache.set("b",entry("b"));
 assert.equal(cache.set("a",entry("oversized")),false);
 assert.equal(cache.take("a"),undefined);assert.equal(cache.take("b")?.text,"b");
 assert.equal(cache.retainedUnits,0);
});
test("empty documents still obey entry count and missing take is inert",()=>{
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(1,0);
 cache.set("a",entry(""));cache.set("b",entry(""));
 assert.equal(cache.size,1);assert.equal(cache.take("a"),undefined);
 assert.equal(cache.retainedUnits,0);assert.equal(cache.take("b")?.text,"");
});
test("invalid limits and invalid replacement are rejected without losing valid state",()=>{
 for(const args of [[0,1],[-1,1],[1,-1],[Infinity,1],[1,NaN],[1.5,2]])assert.throws(()=>createEditorSessionCache(...args));
 const cache=createEditorSessionCache<ReturnType<typeof entry>>(),valid=entry("ok");cache.set("a",valid);
 for(const length of [-1,NaN,Infinity,1.5])assert.throws(()=>cache.set("a",{state:{doc:{length}},text:"invalid"}));
 assert.equal(cache.take("a"),valid);
});
