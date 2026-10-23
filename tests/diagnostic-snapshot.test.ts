import test from "node:test";
import assert from "node:assert/strict";
import {unchangedDiagnostics} from "../src/diagnostic-snapshot.ts";
const item={from:0,to:1,severity:"warning",message:"message",source:"server"};
test("first empty diagnostics always apply, including cached editor states",()=>{
  const doc={};assert.equal(unchangedDiagnostics(null,doc,[]),false);
  assert.equal(unchangedDiagnostics({doc,items:[]},doc,[]),true);
});
test("fresh equivalent arrays are unchanged only for the same document identity",()=>{
  const doc={},snapshot={doc,items:[item]};
  assert.equal(unchangedDiagnostics(snapshot,doc,[{...item}]),true);
  assert.equal(unchangedDiagnostics(snapshot,{},[{...item}]),false);
});
test("all normalized visible fields and removal trigger an application",()=>{
  const doc={},snapshot={doc,items:[item]};
  for(const change of [{from:1},{to:2},{severity:"error"},{message:"changed"},{source:"other"}])
    assert.equal(unchangedDiagnostics(snapshot,doc,[{...item,...change}]),false);
  assert.equal(unchangedDiagnostics(snapshot,doc,[]),false);
  assert.equal(unchangedDiagnostics(snapshot,doc,[item,item]),false);
});
