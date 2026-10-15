import test from "node:test";
import assert from "node:assert/strict";
import {Text} from "@codemirror/state";
import {createSnapshotTextCache} from "../src/snapshot-text.ts";
function tracked(text:string){let calls=0;return {doc:{length:text.length,toString:()=>{calls++;return text;}},calls:()=>calls};}
test("same immutable snapshot is flattened once across consumers",()=>{
 const read=createSnapshotTextCache(),a=tracked("hello");
 for(let i=0;i<10;i++)assert.equal(read(a.doc),"hello");
 assert.equal(a.calls(),1);
 const b=tracked("hello");read(b.doc);assert.equal(b.calls(),1,"distinct identities are never assumed equal");
});
test("LRU entry count stays bounded even for empty snapshots",()=>{
 const read=createSnapshotTextCache(2,10),a=tracked(""),b=tracked(""),c=tracked("");
 read(a.doc);read(b.doc);read(a.doc);read(c.doc);read(b.doc);
 assert.equal(a.calls(),1);assert.equal(b.calls(),2);
});
test("retained UTF16 budget evicts oldest snapshots",()=>{
 const read=createSnapshotTextCache(4,5),a=tracked("abc"),b=tracked("de"),c=tracked("xy");
 read(a.doc);read(b.doc);read(c.doc);read(b.doc);
 assert.equal(b.calls(),1);read(a.doc);assert.equal(a.calls(),2);
});
test("oversize snapshots are correct but never retained",()=>{
 const read=createSnapshotTextCache(4,2),a=tracked("large"),b=tracked("ok");
 read(b.doc);assert.equal(read(a.doc),"large");assert.equal(read(a.doc),"large");read(b.doc);
 assert.equal(a.calls(),2);assert.equal(b.calls(),1);
});
test("real CM persistent edits and undo snapshots preserve exact Unicode",()=>{
 const read=createSnapshotTextCache(),original=Text.of(["你好😀","x\ty",""]);
 const changed=original.replace(0,2,Text.of(["墨题"]));
 assert.equal(read(original),"你好😀\nx\ty\n");
 assert.equal(read(changed),"墨题😀\nx\ty\n");
 assert.equal(read(original),"你好😀\nx\ty\n");
});
test("invalid cache limits are refused",()=>{
 for(const args of [[0,1],[1,-1],[1,Infinity],[NaN,1]])assert.throws(()=>createSnapshotTextCache(...args));
});
