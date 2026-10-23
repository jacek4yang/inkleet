import assert from "node:assert/strict";
import test from "node:test";
import { defaultEditorSettings,effectiveTabSize,formatEnabled,validateEditorSettings } from "../src/format-settings.ts";
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

test("Vim defaults off, accepts legacy config and rejects malformed modes",()=>{
  assert.equal(defaultEditorSettings.vim,false);
  assert.equal(validateEditorSettings({settings:{version:1,formatOnSave:true,overrides:{}},revision:null}).settings.vim??false,false);
  assert.equal(validateEditorSettings({settings:{...defaultEditorSettings,vim:true},revision:null}).settings.vim,true);
  assert.throws(()=>validateEditorSettings({settings:{...defaultEditorSettings,vim:"true"},revision:null}));
});

test("tab display width defaults to four without adding a persisted key",()=>{
  const legacy={version:1 as const,formatOnSave:true,overrides:{}};
  assert.equal(effectiveTabSize(null),4);
  assert.equal(effectiveTabSize(defaultEditorSettings),4);
  assert.equal(effectiveTabSize(validateEditorSettings({settings:legacy,revision:null}).settings),4);
  assert.equal(Object.hasOwn(defaultEditorSettings,"tabSize"),false);
  assert.equal(Object.hasOwn(validateEditorSettings({settings:legacy,revision:null}).settings,"tabSize"),false);
});
test("tab display width accepts integer bounds and explicit default",()=>{
  for(const tabSize of [1,4,8]){
    const settings=validateEditorSettings({settings:{...defaultEditorSettings,tabSize},revision:null}).settings;
    assert.equal(effectiveTabSize(settings),tabSize);
    assert.equal(settings.version,1);
  }
});
test("tab display width rejects invalid present values",()=>{
  for(const tabSize of [0,9,-1,1.5,null,"4",true,NaN,Infinity,{},[]]){
    assert.throws(()=>validateEditorSettings({settings:{...defaultEditorSettings,tabSize},revision:null}));
  }
});
test("tab display width leaves formatting and language overrides unchanged",()=>{
  const settings={...defaultEditorSettings,tabSize:8,overrides:{rust:false}};
  assert.equal(formatEnabled(settings,"rust"),false);
  assert.equal(formatEnabled(settings,"python3"),true);
  assert.equal(effectiveTabSize(settings),8);
});

