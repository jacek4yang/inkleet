import test from "node:test";
import assert from "node:assert/strict";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {SnippetParser,Placeholder,Choice,Transform} from "../src/vendor/snippet-parser.ts";
import {SnippetLimitError,snippetLimits} from "../src/snippet-budget.ts";
const S="$";
test("canonical defaults propagate forward and backward; numeric navigation ends at zero",()=>{
 for(const source of [S+"{1:name} "+S+"1",S+"1 "+S+"{1:name}"]){
  const r=prepareSnippet(source);assert.equal(r.text,"name name");assert.deepEqual(r.navigation,["t:1","t:0"]);
  assert.deepEqual(r.fields.filter(f=>f.group==="t:1").map(f=>[f.from,f.to]),[[0,4],[5,9]]);
 }
 const r=prepareSnippet(S+"3 "+S+"1 "+S+"3 "+S+"0");
 assert.deepEqual(r.navigation,["t:1","t:3","t:0"]);
});
test("nested defaults carry distinct occurrence ids and parent ranges",()=>{
 const r=prepareSnippet(S+"{1:outer "+S+"{2:inner}} "+S+"1");
 assert.equal(r.text,"outer inner outer inner");
 const parents=r.fields.filter(f=>f.group==="t:1"),children=r.fields.filter(f=>f.group==="t:2");
 assert.equal(parents.length,2);assert.equal(children.length,2);
 for(const child of children){const p=r.fields[child.parent!];assert.equal(p.group,"t:1");assert.ok(p.from<=child.from&&p.to>=child.to);}
 assert.equal(new Set(r.fields.map(f=>f.id)).size,r.fields.length);
});
test("choice cloning does not share option nodes",()=>{
 const root=new SnippetParser().parse(S+"{1|one,two|} "+S+"1");
 const fields=root.placeholders.filter(p=>p.index===1);
 const a=fields[0].choice!,b=fields[1].choice!;
 assert.ok(a instanceof Choice&&b instanceof Choice);
 assert.notEqual(a.options[0],b.options[0]);
 a.options[0].value="changed";assert.equal(b.options[0].value,"one");
 const r=prepareSnippet(S+"{1|a\\,b,c\\|d,e\\\\f|}");
 assert.equal(r.text,"a,b");assert.deepEqual(r.fields[0].choices,["a,b","c|d","e\\f"]);
});
test("escaped literal snippet syntax, multiline and UTF16 offsets",()=>{
 const r=prepareSnippet("\\"+S+"{1:literal} 😀\n"+S+"{2:中文}");
 assert.equal(r.text,S+"{1:literal} 😀\n中文");
 const f=r.fields.find(f=>f.group==="t:2")!;assert.equal(r.text.slice(f.from,f.to),"中文");
 assert.equal(f.from,(S+"{1:literal} 😀\n").length);
 assert.equal(prepareSnippet("cost "+S+"-").text,"cost "+S+"-");
});
test("variables use supplied own properties and distinguish empty unset and unknown",()=>{
 const source=S+"{KNOWN:fallback} "+S+"{UNSET:fallback} "+S+"UNKNOWN";
 const r=prepareSnippet(source,{KNOWN:{kind:"value",value:""},UNSET:{kind:"unset"}});
 assert.equal(r.text," fallback UNKNOWN");
 assert.ok(r.fields.some(f=>f.group.startsWith("v:UNKNOWN:")));
 assert.equal(prepareSnippet(S+"__proto__").text,"__proto__");
 assert.equal(prepareSnippet(S+"{UNKNOWN:default}").text,"default");
 assert.throws(()=>prepareSnippet(S+"X",{X:{kind:"value",value:"x".repeat(65537)}}),SnippetLimitError);
});
test("transforms preserve descriptors but cannot execute or claim insertion-ready text",()=>{
 const r=prepareSnippet(S+"{1:name} "+S+"{1/(a+)+$/"+S+"{1:/upcase}/gim}");
 assert.equal(r.needsTransformEvaluation,true);assert.equal(r.transforms.length,1);
 assert.equal(r.transforms[0].pattern,"(a+)+$");assert.equal(r.transforms[0].flags,"gim");
 assert.equal((r.transforms[0].format[0] as any).operation,"upcase");
 const invalidRegex=prepareSnippet(S+"{1/[/text/}");
 assert.equal(invalidRegex.needsTransformEvaluation,true,"regex compilation is deferred");
 const root=new SnippetParser().parse(S+"{1/a/"+S+"1/dgims}");
 const transform=root.placeholders[0].transform!;
 assert.ok(transform instanceof Transform);assert.equal(transform.clone().regexFlags,"dgims");
 assert.throws(()=>transform.resolve("a"),/evaluation worker/);
 const variable=prepareSnippet(S+"{FILE/(.*)/"+S+"{1:?yes:no}/}",{FILE:{kind:"value",value:"file"}});
 assert.equal(variable.transforms[0].sourceValue,"file");assert.equal(variable.transforms[0].format[0].kind,"capture");
 assert.throws(()=>prepareSnippet(S+"{UNKNOWN/a/b/}"),/Unknown transformed variable/);
});
test("malformed constructs and unsafe identities fail as a whole",()=>{
 for(const source of [S+"{",S+"{1:x",S+"{V:x",S+"{1|a,b}",S+"{1/a/b/gg}",S+"{1/a/b/uv}",S+"9007199254740993"]){
  assert.throws(()=>prepareSnippet(source),undefined,source);
 }
});
test("source and expanded output are independently bounded",()=>{
 assert.throws(()=>prepareSnippet("x".repeat(snippetLimits.source+1)),SnippetLimitError);
 assert.equal(prepareSnippet("x".repeat(snippetLimits.source)).text.length,snippetLimits.source);
 const source=S+"{1:"+"x".repeat(40000)+"} "+S+"1";
 assert.throws(()=>prepareSnippet(source),SnippetLimitError);
});
test("lexical and cloned default depth, work and occurrence growth are bounded",()=>{
 assert.throws(()=>prepareSnippet((S+"{1:").repeat(70)+"x"+"}".repeat(70)),SnippetLimitError);
 assert.throws(()=>prepareSnippet((S+"1 ").repeat(513)),SnippetLimitError);
 assert.throws(()=>prepareSnippet(Array.from({length:129},(_,i)=>S+(i+1)).join(" ")),SnippetLimitError);
 const exponential=Array.from({length:20},(_,i)=>S+"{"+(i+1)+":"+S+(i+2)+S+(i+2)+"}").join("")+S+"{21:x}";
 assert.throws(()=>prepareSnippet(exponential),SnippetLimitError);
});
test("cycles terminate and failed parse budgets do not leak into the next request",()=>{
 assert.ok(prepareSnippet(S+"{1:"+S+"1}").text.length<10);
 assert.throws(()=>prepareSnippet((S+"1 ").repeat(513)));
 assert.equal(prepareSnippet(S+"{1:ok}").text,"ok");
 const parser=new SnippetParser();assert.throws(()=>parser.parse("x".repeat(65537)));
 assert.equal(parser.parse("ok").toString(),"ok");
});
test("representative six-language call forms retain navigable parameter stops",()=>{
 for(const name of ["push","append","println","print","printf","emplace_back"]){
  const r=prepareSnippet(name+"("+S+"{1:value})"+S+"0");
  assert.equal(r.text,name+"(value)");assert.deepEqual(r.navigation,["t:1","t:0"]);
 }
});

test("transformed copies are opaque and never add editable nested fields",()=>{
 const r=prepareSnippet(S+"{1:"+S+"{2:x}} "+S+"{1/(.*)/"+S+"1/}");
 const outer=r.fields.find(f=>f.group==="t:1"&&f.derived)!;
 assert.ok(outer);assert.equal(r.fields.filter(f=>f.group==="t:2").length,1);
 assert.equal(r.fields.some(f=>f.parent===outer.id),false);
});

test("unknown variables do not create contradictory linked defaults",()=>{
 const r=prepareSnippet(S+"X "+S+"{X:a}");assert.equal(r.text,"X a");
 const fields=r.fields.filter(f=>f.group.startsWith("v:X:"));assert.equal(fields.length,2);assert.notEqual(fields[0].group,fields[1].group);
});
test("empty transform conditional branches are retained",()=>{
 for(const replacement of [S+"{1:?yes:}",S+"{1:+}",S+"{1:-}",S+"{1:}"]){
  const r=prepareSnippet(S+"{1/(a)/"+replacement+"/}");assert.equal(r.transforms[0].format.length,1);
 }
});

test("empty literal choice options are retained explicitly",()=>{
 const r=prepareSnippet(S+"{1|,x,|} / "+S+"1");
 assert.equal(r.text," / ");assert.deepEqual(r.fields[0].choices,["","x",""]);
 assert.throws(()=>prepareSnippet(S+"{1|"),/Malformed/);
});
