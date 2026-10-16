import test from "node:test";
import assert from "node:assert/strict";
import {SourceHistory} from "../src/source-history.ts";
import {sourceOffset,sourceSpan,sourceTargets,validSourceSnapshot,sourceDisplayPath} from "../src/source-protocol.ts";
const snapshot=(name:string,text="abc\ndef")=>({sourceId:1,uri:"file:///"+name,text,name,declaration:false,language:"rust"});
const visit=(name:string,anchor=0,head=anchor)=>({source:snapshot(name),selection:{ranges:[{anchor,head}],mainIndex:0},scroll:{top:0,left:0}});
test("source history restores full selections and both scroll axes",()=>{
 const h=new SourceHistory(visit("a"));
 h.update({ranges:[{anchor:2,head:0},{anchor:4,head:5}],mainIndex:1},{top:23,left:41});
 h.push(visit("b"));h.push(visit("c"));
 assert.equal(h.move(-1),true);assert.equal(h.current.source.name,"b");
 assert.equal(h.move(-1),true);assert.deepEqual(h.current.selection,{ranges:[{anchor:2,head:0},{anchor:4,head:5}],mainIndex:1});assert.deepEqual(h.current.scroll,{top:23,left:41});
 assert.equal(h.move(1),true);assert.equal(h.current.source.name,"b");
 h.push(visit("d"));assert.equal(h.canForward,false);assert.equal(h.length,3);
});
test("same-file targets are distinct visits, exact duplicates are not",()=>{
 const h=new SourceHistory(visit("a"));assert.equal(h.push(visit("a",2)),true);
 assert.equal(h.push(visit("a",2)),false);assert.equal(h.length,2);
 h.move(-1);assert.equal(h.current.selection.ranges[0].head,0);
});
test("source history is bounded and rejects oversized admission without losing current",()=>{
 const h=new SourceHistory(visit("a"));for(let n=0;n<100;n++)h.push(visit(String(n)));
 assert.equal(h.length,64);assert.equal(h.current.source.name,"99");
 const huge={...visit("huge"),source:snapshot("huge","x".repeat(8*1024*1024+1))};
 assert.throws(()=>h.push(huge));assert.equal(h.current.source.name,"99");assert.equal(h.length,64);
});
test("source coordinates preserve UTF16 boundaries and never clamp",()=>{
 assert.equal(sourceOffset("a\n🦀x",{line:1,character:2}),4);
 assert.equal(sourceOffset("a\n🦀x",{line:1,character:1}),null);
 assert.equal(sourceOffset("a",{line:2,character:0}),null);
 assert.equal(sourceSpan("abc",{start:{line:0,character:2},end:{line:0,character:1}}),null);
});
test("definition normalization prefers targetSelectionRange and deduplicates exact locations",()=>{
 const range={start:{line:2,character:3},end:{line:2,character:4}};
 const target={targetUri:"jdt://contents/A.class?=encoded%20handle",targetSelectionRange:range,targetRange:{start:{line:0,character:0},end:{line:99,character:0}}};
 assert.deepEqual(sourceTargets([target,target]),[{uri:target.targetUri,range}]);
 assert.deepEqual(sourceTargets([{uri:"https://example.invalid",range},{uri:"file:///x",range:{start:{line:-1,character:0},end:{line:0,character:0}}}]),[]);
});

test("source snapshot DTO rejects malformed or unnormalized data",()=>{
 const s=snapshot("a");
 assert.equal(validSourceSnapshot(s,s.uri),true);
 for(const patch of [{sourceId:0},{name:{}},{language:"unknown"},{declaration:"false"},{text:"a\r\nb"}]){
  assert.equal(validSourceSnapshot({...s,...patch},s.uri),false);
 }
 assert.equal(validSourceSnapshot(s,"file:///other"),false);
});

test("source paths remove managed-cache noise without abbreviating meaningful paths",()=>{
 assert.equal(sourceDisplayPath("file:///tmp/private/tools/pyright-hash/dist/typeshed-fallback/stdlib/typing.pyi"),"typeshed/stdlib/typing.pyi");
 assert.equal(sourceDisplayPath("file:///tools/python-hash/lib/python3.14/typing.py"),"python3.14/typing.py");
 assert.equal(sourceDisplayPath("file:///tools/go-hash/go/src/unicode/utf8/utf8.go"),"go/src/unicode/utf8/utf8.go");
 assert.equal(sourceDisplayPath("file:///tools/rust/lib/rustlib/src/rust/library/alloc/src/vec/mod.rs"),"rust/library/alloc/src/vec/mod.rs");
 assert.equal(sourceDisplayPath("jdt://contents/java.base/java.util/ArrayList.java?=opaque"),"java.base/java.util/ArrayList.java");
 assert.equal(sourceDisplayPath("file:///custom/a%20b.rs"),"/custom/a b.rs");
});
