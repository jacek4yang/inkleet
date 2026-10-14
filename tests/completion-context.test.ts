import test from "node:test";
import assert from "node:assert/strict";
import {Text} from "@codemirror/state";
import {completionTrigger,advanceIncomplete,identifierTail} from "../src/completion-context.ts";
test("provider-specific triggers and explicit/incomplete precedence",()=>{
  assert.deepEqual(completionTrigger(true,".",["."],true),{triggerKind:1});
  assert.deepEqual(completionTrigger(false,"->",[">"],true),{triggerKind:2,triggerCharacter:">"});
  assert.deepEqual(completionTrigger(false,"/",["/"],false),{triggerKind:2,triggerCharacter:"/"});
  assert.deepEqual(completionTrigger(false,".",[],false),{triggerKind:1});
  assert.deepEqual(completionTrigger(false,"ap",["."],true),{triggerKind:3});
  assert.equal("obj.变量".match(identifierTail)?.[0],"变量");
  assert.equal("$name".match(identifierTail)?.[0],"$name");
  assert.equal("e\u0301".match(identifierTail)?.[0],"e\u0301");
});
test("incomplete continuation accepts only one adjacent identifier insertion",()=>{
  const before=Text.of(["Hash"]),after=Text.of(["HashM"]);
  const previous={doc:before,from:0,pos:4,session:9};
  assert.deepEqual(advanceIncomplete(previous,before,after,[{from:4,to:4,text:"M"}]),{...previous,doc:after,pos:5,continued:true});
  for(const changes of [[],[{from:4,to:4,text:"."}],[{from:3,to:4,text:"M"}],[{from:0,to:0,text:"x"}],[{from:4,to:4,text:"M"},{from:0,to:0,text:"x"}]]){
    assert.equal(advanceIncomplete(previous,before,after,changes),null);
  }
  assert.equal(advanceIncomplete(previous,Text.of(["Other"]),after,[{from:4,to:4,text:"M"}]),null);
});

test("scalar triggers include Java space and astral identifiers preserve UTF16 offsets",()=>{
  assert.deepEqual(completionTrigger(false,"x ",[" "],false),{triggerKind:2,triggerCharacter:" "});
  assert.deepEqual(completionTrigger(false,"x𐐀",["𐐀"],false),{triggerKind:2,triggerCharacter:"𐐀"});
  assert.equal("obj.𐐀name".match(identifierTail)?.[0],"𐐀name");
  const before=Text.of(["x"]),after=Text.of(["x𐐀"]);
  assert.equal(advanceIncomplete({doc:before,from:0,pos:1,session:1},before,after,[{from:1,to:1,text:"𐐀"}])?.pos,3);
});
