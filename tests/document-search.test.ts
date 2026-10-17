import test from "node:test";
import assert from "node:assert/strict";
import {searchDocumentSegments} from "../src/document-search-model.ts";
const matches=(segments:string[],query:string)=>Array.from(searchDocumentSegments(segments,query).matches);
test("literal case-insensitive search preserves original UTF16 positions",()=>{
 assert.deepEqual(matches(["😀中 HashMap HASHMAP"],"hashmap"),[0,4,11,0,12,19]);
 assert.deepEqual(matches(["K k ß İ"],"k"),[0,0,1,0,2,3]);
 assert.deepEqual(matches(["ß İ"],"ss"),[]);assert.deepEqual(matches(["ß İ"],"i"),[]);
});
test("regex metacharacters are literal and block boundaries cannot join",()=>{
 const literal="[x]+.*(a)$^?{}|\\";
 assert.deepEqual(matches([literal,literal],literal),[0,0,literal.length,1,0,literal.length]);
 assert.deepEqual(matches(["Hash","Map"],"HashMap"),[]);
 assert.deepEqual(matches(["ab","aba"],"aba"),[1,0,3]);
});
test("empty queries, nonoverlapping matches and whitespace retain exact semantics",()=>{
 assert.deepEqual(matches(["aaaa"],"aa"),[0,0,2,0,2,4]);
 assert.deepEqual(matches(["abc"],""),[]);assert.deepEqual(matches(["a b"]," "),[0,1,2]);
 assert.deepEqual(matches(["e\u0301 😀"],"e\u0301"),[0,0,2]);
 assert.deepEqual(matches(["e\u0301 😀"],"😀"),[0,3,5]);
});
test("all repetitive matches including the document tail remain reachable",()=>{
 const result=searchDocumentSegments(["x".repeat(262144)],"x");
 assert.equal(result.error,null);assert.equal(result.matches.length,262144*3);
 assert.deepEqual(Array.from(result.matches.slice(-3)),[0,262143,262144]);
 assert.ok(result.matches.buffer.byteLength<=524288*3*4);
});
test("limits fail explicitly without searching a silent prefix",()=>{
 assert.equal(searchDocumentSegments(["x".repeat(524288)],"z").error,null);
 assert.equal(searchDocumentSegments(["x".repeat(524289)],"z").error,"text-limit");
 assert.equal(searchDocumentSegments(["x"],"x".repeat(1025)).error,"query-limit");
 assert.equal(searchDocumentSegments(Array(32769).fill(""),"x").error,"text-limit");
});
