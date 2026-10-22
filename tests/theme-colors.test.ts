import test from "node:test";
import assert from "node:assert/strict";
import {validateColorOverrides,setColorOverride,sameColorOverrides,colorOverrideCount} from "../src/theme-colors.ts";
import {parseEditorSettingsJSON,defaultEditorSettings} from "../src/format-settings.ts";
import {readEditorSettingState,resetEditorSetting,inspectEditorDraft} from "../src/settings-state.ts";
test("custom colors preserve separate modes and reset immutable nested values",()=>{
 const original={light:{accent:"#a56543"},dark:{editor:"#112233"}};
 assert.equal(validateColorOverrides(original),original);
 const next=setColorOverride(original,"light","accent",undefined);
 assert.deepEqual(next,{dark:{editor:"#112233"}});assert.deepEqual(original.light,{accent:"#a56543"});
 assert.equal(colorOverrideCount(original),2);assert.ok(sameColorOverrides(original,structuredClone(original)));
 assert.equal(setColorOverride(next,"dark","editor",undefined),undefined);
 const settings={...defaultEditorSettings,colorOverrides:original};
 assert.equal(readEditorSettingState(settings,"editor.colorOverrides").status,"known");
 assert.equal((readEditorSettingState(settings,"editor.colorOverrides") as {isDefault:boolean}).isDefault,false);
 assert.deepEqual(resetEditorSetting(settings,"editor.colorOverrides"),defaultEditorSettings);
 assert.deepEqual(inspectEditorDraft(settings,structuredClone(settings)),{status:"known",dirty:false,needsTabSizeCanonicalization:false});
 assert.equal((inspectEditorDraft(defaultEditorSettings,settings) as {dirty:boolean}).dirty,true);
});
test("custom colors only accept fixed keys and six hex digits",()=>{
 for(const value of [null,[],{other:{}},{light:null},{light:[]},{light:{accent:null}},{dark:{accent:"red"}},{light:{accent:"#fff"}},{light:{accent:"url(https://example.test)"}},{dark:{unknown:"#112233"}},{light:{accent:123}}]){
  assert.throws(()=>validateColorOverrides(value));
 }
 for(const colors of [{},{light:{}},{light:{accent:"#123AbC"},dark:{editor:"#001122"}}]){
  assert.doesNotThrow(()=>parseEditorSettingsJSON(JSON.stringify({...defaultEditorSettings,colorOverrides:colors})));
 }
 const prefix='"version":1,"formatOnSave":true,"overrides":{},';
 for(const tail of ['"colorOverrides":{"light":{},"light":{}}','"colorOverrides":{"dark":{"accent":"#112233","accent":"#445566"}}','"colorOverrides":{"dark":{"accent":"#112233","acc\\u0065nt":"#445566"}}']){
  assert.throws(()=>parseEditorSettingsJSON("{"+prefix+tail+"}"));
 }
});
