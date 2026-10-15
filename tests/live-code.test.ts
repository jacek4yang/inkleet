import test from "node:test";
import assert from "node:assert/strict";
import {CodeSignals} from "../src/live-code.ts";
test("sources are document-bound and notifications do not cross documents",()=>{
  const text=new Map([["a","A"],["b","B"]]),signals=new CodeSignals();
  const a=signals.source("a",()=>text.get("a")!),b=signals.source("b",()=>text.get("b")!);
  let ac=0,bc=0;const offA=a.subscribe(()=>ac++),offB=b.subscribe(()=>bc++);
  text.set("b","B2");signals.notify("b");assert.equal(a.read(),"A");assert.equal(b.read(),"B2");assert.equal(ac,0);assert.equal(bc,1);
  offA();offB();signals.notify("a");signals.notify("b");assert.equal(ac,0);assert.equal(bc,1);
});
test("late callbacks read their own latest text and captured operations stay immutable",()=>{
  const text=new Map([["a","A"],["b","B"]]),signals=new CodeSignals();
  const a=signals.source("a",()=>text.get("a")!);
  const captured={code:a.read()};text.set("a","A2");signals.notify("a");
  assert.equal(a.read(),"A2");assert.equal(captured.code,"A");
});
test("subscribe during notification is deferred and cleanup does not remove other subscribers",()=>{
  const signals=new CodeSignals(),a=signals.source("a",()=>"A");let first=0,second=0;let offSecond=()=>{};
  const offFirst=a.subscribe(()=>{first++;if(first===1)offSecond=a.subscribe(()=>second++);});
  signals.notify("a");assert.equal(first,1);assert.equal(second,0);
  offFirst();signals.notify("a");assert.equal(first,1);assert.equal(second,1);
  offSecond();signals.notify("a");assert.equal(second,1);
});
