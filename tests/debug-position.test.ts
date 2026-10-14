import test from "node:test";
import assert from "node:assert/strict";
import {Text} from "@codemirror/state";
import {debugLocation,type DebugPosition} from "../src/debug-position.ts";
import {debugFrames} from "../src/debug-model.ts";
const doc=Text.of(["let x = outer(inner());","\t中文😀abc","last"]);
const position=(line:number,column?:number,endColumn?:number,endLine?:number):DebugPosition=>({line,column,endColumn,endLine,frameId:0,execution:true});
test("precise UTF16 ranges, columns and conservative default-column fallback",()=>{
 assert.deepEqual(debugLocation(doc,position(1,9,14)),{line:1,from:8,to:13});
 assert.deepEqual(debugLocation(doc,position(1,15)),{line:1,from:14});
 assert.deepEqual(debugLocation(doc,position(1,1)),{line:1});
 assert.deepEqual(debugLocation(doc,position(1,0)),{line:1});
 assert.deepEqual(debugLocation(doc,position(2,5)),{line:2},"surrogate split rejected");
 assert.deepEqual(debugLocation(doc,position(2,4,6)),{line:2,from:doc.line(2).from+3,to:doc.line(2).from+5});
 assert.deepEqual(debugLocation(doc,position(2,6,2,3)),{line:2,from:doc.line(2).from+5,to:doc.line(3).from+1});
});
test("invalid positions never clamp into fabricated highlights",()=>{
 for(const line of [0,-1,4,NaN,1.5])assert.equal(debugLocation(doc,position(line,2)),null);
 for(const column of [0,-1,900,NaN,2.5])assert.deepEqual(debugLocation(doc,position(1,column)),{line:1});
 assert.deepEqual(debugLocation(doc,position(1,9,4)),{line:1,from:8});
 assert.deepEqual(debugLocation(doc,position(3,5)),{line:3,from:doc.line(3).from+4});
 assert.equal(debugLocation(doc,null),null);
});
test("frame parsing retains adapter precision and source identity",()=>{
 const [frame]=debugFrames([{id:0,name:"f",line:2,column:4,endLine:2,endColumn:6,inkleetSource:true,source:{path:"/owned/solution.py",sourceReference:12}}]);
 assert.equal(frame.column,4);assert.equal(frame.endColumn,6);assert.equal(frame.source?.sourceReference,12);assert.equal(frame.inkleetSource,true);
 const [bad]=debugFrames([{id:1,name:"f",line:1,column:"2",endColumn:Infinity,endLine:-1}]);
 assert.equal(bad.column,undefined);assert.equal(bad.endColumn,undefined);assert.equal(bad.endLine,undefined);
});
