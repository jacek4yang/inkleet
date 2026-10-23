import test from "node:test";
import assert from "node:assert/strict";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
const S="$",evaluate=(source:string,variables:any={})=>evaluateSnippetTransforms(prepareSnippet(source,variables));
test("placeholder transforms resolve from canonical values and map following fields",()=>{
 const r=evaluate(S+"{1:hello} "+S+"{1/(.*)/"+S+"{1:/upcase}/} "+S+"{2:next}"+S+"0");
 assert.equal(r.text,"hello HELLO next");assert.equal(r.needsTransformEvaluation,false);assert.equal(r.transformState,"resolved");
 const next=r.fields.find(f=>f.group==="t:2")!;assert.equal(r.text.slice(next.from,next.to),"next");
});
test("variable transforms use supplied values and preserve global and Unicode behavior",()=>{
 const r=evaluate(S+"{FILE/\\.rs$/.txt/}",{FILE:{kind:"value",value:"hello.rs"}});
 assert.equal(r.text,"hello.txt");
 assert.equal(evaluate(S+"{X/a/b/g}",{X:{kind:"value",value:"aaa"}}).text,"bbb");
 assert.equal(evaluate(S+"{X/(?:)/x/gu}",{X:{kind:"value",value:"😀"}}).text,"x😀x");
});
test("conditional and case replacements preserve captures and empty branches",()=>{
 assert.equal(evaluate(S+"{X/(a)/"+S+"{1:?yes:no}/}",{X:{kind:"value",value:"a"}}).text,"yes");
 assert.equal(evaluate(S+"{X/(a)/"+S+"{1:+}/}",{X:{kind:"value",value:"a"}}).text,"");
 assert.equal(evaluate(S+"{X/(a)/"+S+"{1:-fallback}/}",{X:{kind:"value",value:"z"}}).text,"fallback");
 for(const [op,expected]of [["upcase","HELLO WORLD"],["downcase","hello world"],["capitalize","Hello world"],["pascalcase","HelloWorld"],["camelcase","helloWorld"],["snakecase","hello_world"],["kebabcase","hello-world"]]){
  assert.equal(evaluate(S+"{X/(.*)/"+S+"{1:/"+op+"}/}",{X:{kind:"value",value:"hello world"}}).text,expected);
 }
});
test("outer transform waits for nested derived source content",()=>{
 const r=evaluate(S+"{1:"+S+"{X/a/b/}} "+S+"{1/(.*)/"+S+"{1:/upcase}/}",{X:{kind:"value",value:"a"}});
 assert.equal(r.text,"b B");assert.equal(r.fields.filter(f=>f.derived).length,2);
});
test("invalid regex and cyclic transform dependencies reject the whole result",()=>{
 assert.throws(()=>evaluate(S+"{X/[/x/}",{X:{kind:"value",value:"a"}}));
 assert.throws(()=>evaluate(S+"{1:"+S+"{1/a/b/}}"),/Cyclic/);
});
test("global empty matches and large replacement output are bounded",()=>{
 assert.throws(()=>evaluate(S+"{X/(?:)/x/g}",{X:{kind:"value",value:"a".repeat(5000)}}),/match limit/);
 assert.throws(()=>evaluate(S+"{X/a/"+"b".repeat(1000)+"/g}",{X:{kind:"value",value:"a".repeat(100)}}),/output limit/);
});
test("transform evaluation leaves the caller's pending result untouched",()=>{
 const before=prepareSnippet(S+"{X/a/longer/}",{X:{kind:"value",value:"a"}});
 const result=evaluateSnippetTransforms(before);
 assert.equal(before.text,"a");assert.equal(before.needsTransformEvaluation,true);
 assert.equal(result.text,"longer");assert.equal(result.fields[0].to,6);
});
