import assert from "node:assert/strict";
import test from "node:test";
import { defaultEditorSettings,formatEnabled,validateEditorSettings } from "../src/format-settings.ts";
test("format defaults inherit and language overrides are effective",()=>{
  assert.equal(formatEnabled(defaultEditorSettings,"rust"),true);
  assert.equal(formatEnabled({...defaultEditorSettings,overrides:{rust:false}},"rust"),false);
  assert.equal(formatEnabled({...defaultEditorSettings,formatOnSave:false,overrides:{python3:true}},"python3"),true);
  assert.equal(formatEnabled(null,"java"),false);
});
test("bad settings never silently enable formatting",()=>{
  for(const settings of [null,{version:2,formatOnSave:true,overrides:{}},{version:1,formatOnSave:"yes",overrides:{}},{version:1,formatOnSave:true,overrides:{shell:true}}]){
    assert.throws(()=>validateEditorSettings({settings,revision:null}));
  }
  assert.deepEqual(validateEditorSettings({settings:defaultEditorSettings,revision:null}).settings,defaultEditorSettings);
});
