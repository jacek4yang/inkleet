import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {decodeSemanticSpans,semanticField,setSemanticTokens} from "../src/semantic-tokens.ts";
test("semantic spans validate UTF16, known classes and source ordering",()=>{
 const state=EditorState.create({doc:"😀foo\nbar",extensions:[semanticField]});
 const span={line:0,start:2,end:5,kind:"function",modifiers:[]};
 assert.deepEqual(decodeSemanticSpans(state.doc,[span]).map(s=>[s.from,s.to]),[[2,5]]);
 assert.throws(()=>decodeSemanticSpans(state.doc,[{...span,start:1}]));
 assert.throws(()=>decodeSemanticSpans(state.doc,[span,span]));
 assert.throws(()=>decodeSemanticSpans(state.doc,[{...span,end:99}]));
 assert.deepEqual(decodeSemanticSpans(state.doc,[{...span,kind:"arbitrary-css"}]),[]);
 const painted=state.update({effects:setSemanticTokens.of(decodeSemanticSpans(state.doc,[span]))}).state;
 assert.equal(painted.field(semanticField).size,1);
 assert.equal(painted.update({changes:{from:0,insert:"x"}}).state.field(semanticField).size,0);
});
