import test from "node:test";
import assert from "node:assert/strict";
import {debugVariables, debugFrames, debugScopes, debugThreads, isRawDebugVariable} from "../src/debug-model.ts";
test("DAP inspection rejects malformed payloads without losing frame zero",()=>{
  assert.deepEqual(debugVariables(null),[]);
  assert.deepEqual(debugVariables([null,{}, {name: "v", value: null}]),[]);
  const frames=debugFrames([{id:0,name:"entry",line:1},{id:0,name:"duplicate",line:2},{id:-1,name:"bad"},{id:1,name:"next",source:null}]);
  assert.deepEqual(frames.map(f=>f.id),[0,1]);
  assert.equal(frames[1].line,0);
  assert.deepEqual(debugThreads([{id:0,name:"invalid"},{id:1,name:"main"},{id:1,name:"duplicate"}]),[{id:1,name:"main"}]);
});
test("variable references, labels and collections remain bounded",()=>{
  const v=debugVariables([{name:"x".repeat(1000),value:"a".repeat(5000),variablesReference:-1,indexedVariables:Infinity,presentationHint:{lazy:true}}])[0];
  assert.equal(v.name.length,200);assert.equal(v.value.length,4000);
  assert.equal(v.variablesReference,0);assert.equal(v.indexedVariables,undefined);
  assert.equal(v.presentationHint?.lazy,true);
  assert.equal(debugVariables(Array.from({length:1000},()=>({name:"v",value:"1",variablesReference:0}))).length,100);
  assert.deepEqual(debugScopes([{name:"invalid",variablesReference:0},{name:"expensive",variablesReference:2,expensive:true}]),[{name:"expensive",variablesReference:2,expensive:true}]);
});

test("raw view is identified only by adapter metadata, never user field names",()=>{
  const values=debugVariables([
    {name:"[raw]",value:"type",variablesReference:1,presentationHint:{attributes:["readOnly","virtual"]}},
    {name:"[raw]",value:"user",variablesReference:2},
    {name:"base",value:"user",variablesReference:3,presentationHint:{attributes:["readOnly","virtual"]}},
    {name:"[raw]",value:"user",variablesReference:4,presentationHint:{attributes:["virtual",17,"unknown"]}}
  ]);
  assert.deepEqual(values.map(isRawDebugVariable),[true,false,false,false]);
  assert.deepEqual(values[3].presentationHint?.attributes,["virtual"]);
});
