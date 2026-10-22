import test from "node:test";import assert from "node:assert/strict";
import {parseEditorSettingsJSON,validateEditorDocument,defaultEditorSettings,editorOptions} from "../src/format-settings.ts";
import {inspectEditorDraft,readEditorSettingState,resetEditorSetting} from "../src/settings-state.ts";
test("strict JSON accepts supported appearance options and defaults Vim off",()=>{
 const value=parseEditorSettingsJSON(JSON.stringify({...defaultEditorSettings,theme:"dark",fontSize:18,lineHeight:1.6,wordWrap:true,lineNumbers:false}));
 assert.equal(value.vim,false);assert.equal(value.theme,"dark");
 for(const option of editorOptions){assert.equal(readEditorSettingState(defaultEditorSettings,("editor."+option.key) as Parameters<typeof readEditorSettingState>[1]).status,"known");}
 assert.equal(inspectEditorDraft(defaultEditorSettings,value).status,"known");
 assert.equal(resetEditorSetting(value,"editor.theme").theme,undefined);
});
test("rejects duplicates including escaped names, unknown keys, JSONC and malformed values",()=>{
 const base='{"version":1,"formatOnSave":true,"overrides":{}}';
 for(const text of [
  '{"version":1,"vim":true,"\\u0076im":false,"formatOnSave":true,"overrides":{}}',
  '{"version":1,"formatOnSave":true,"overrides":{"rust":true,"rust":false}}',
  base.replace('"overrides":{}','"overrides":{},"typo":true'),base.replace('true','true,'),
  '// comment\n'+base,base.slice(0,-1)+',}',
  ...[{theme:"neon"},{theme:null},{fontSize:9},{fontSize:33},{fontSize:14.5},{lineHeight:null},{lineHeight:5},{wordWrap:null},{lineNumbers:"false"}].map(extra=>JSON.stringify({...defaultEditorSettings,...extra}))
 ])assert.throws(()=>parseEditorSettingsJSON(text),text);
 assert.throws(()=>parseEditorSettingsJSON(" ".repeat(4097)));
 assert.throws(()=>validateEditorDocument({...defaultEditorSettings,unknown:1}));
});
test("optional appearance omission preserves old documents and dirty tracks changed options",()=>{
 const old={version:1 as const,formatOnSave:true,overrides:{}};
 assert.deepEqual(validateEditorDocument(old),old);
 assert.equal(inspectEditorDraft(old,{...old,fontSize:14}).status,"known");
 const state=inspectEditorDraft(old,{...old,fontSize:14});assert.ok(state.status==="known"&&state.dirty);
 const row=readEditorSettingState({...old,fontSize:14},"editor.fontSize");assert.ok(row.status==="known"&&row.isDefault&&row.canReset);
});
