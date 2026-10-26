import test from "node:test";
import assert from "node:assert/strict";
import {bounded,adjacentQuestion,parseReadingPreferences,readingDefaults,splitBounds,statementVersion} from "../src/reading-preferences.ts";
test("reading preferences are independent, bounded and tolerate corrupt storage",()=>{
 for(const raw of [null,"invalid","null","[]"])assert.deepEqual(parseReadingPreferences(raw),readingDefaults);
 assert.deepEqual(parseReadingPreferences('{"fontSize":99,"ratio":-20,"hidden":"true","language":"fr"}'),{fontSize:32,ratio:25,hidden:false,language:"zh"});
 assert.deepEqual(parseReadingPreferences('{"fontSize":12.7,"ratio":60,"hidden":true,"language":"en"}'),{fontSize:13,ratio:60,hidden:true,language:"en"});
});
test("split bounds reserve readable panes and handle narrow layouts",()=>{
 for(const width of [550,573,800,1400]){const {min,max}=splitBounds(width);assert.ok(min<=max);assert.ok(width*min/100>=240-1e-8);assert.ok(width*(1-max/100)>=310-1e-8);}
 assert.deepEqual(splitBounds(200),{min:44,max:44});assert.deepEqual(splitBounds(NaN),{min:44,max:44});
});
test("manual statement language uses available originals with explicit fallback",()=>{
 const q={content:"English",translatedContent:"中文",title:"Title",translatedTitle:"标题"};
 assert.deepEqual(statementVersion(q,"en"),{language:"en",fallback:false,content:"English",title:"Title"});
 assert.deepEqual(statementVersion({...q,translatedContent:"  "},"zh"),{language:"en",fallback:true,content:"English",title:"Title"});
 assert.equal(statementVersion({...q,content:null},"en").fallback,true);
});
test("adjacent navigation follows filtered page order and does not skip paid boundaries",()=>{
 const rows=[{titleSlug:"z",paidOnly:false},{titleSlug:"a",paidOnly:false},{titleSlug:"x",paidOnly:true}];
 assert.equal(adjacentQuestion(rows,"z",-1),null);assert.equal(adjacentQuestion(rows,"z",1),rows[1]);
 assert.equal(adjacentQuestion(rows,"a",1),null);assert.equal(adjacentQuestion(rows,"missing",1),null);
 assert.equal(adjacentQuestion([],undefined,1),null);
});

test("invalid numeric values clamp their fallback to live bounds",()=>{assert.equal(bounded(NaN,44,45,46),45);assert.equal(bounded(undefined,44,20,30),30);});
