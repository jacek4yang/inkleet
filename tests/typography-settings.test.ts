import test from "node:test";import assert from "node:assert/strict";
import {parseEditorSettingsJSON} from "../src/format-settings.ts";
import {setColorOverride,validateColorOverrides} from "../src/theme-colors.ts";
test("font and syntax preferences remain strict and separate per mode",()=>{
 const parsed=parseEditorSettingsJSON(JSON.stringify({version:1,formatOnSave:true,overrides:{},fontFamily:"Maple Mono NF CN",colorOverrides:{light:{syntaxKeyword:"#112233"},dark:{semanticType:"#aabbcc"}}}));
 assert.equal(parsed.fontFamily,"Maple Mono NF CN");
 const reset=setColorOverride(parsed.colorOverrides,"light","syntaxKeyword",undefined);
 assert.equal(reset?.light,undefined);assert.equal(reset?.dark?.semanticType,"#aabbcc");
 assert.throws(()=>parseEditorSettingsJSON('{"version":1,"formatOnSave":true,"overrides":{},"fontFamily":"unknown"}'));
 assert.throws(()=>validateColorOverrides({light:{syntaxKeyword:"url(test)"}}));
});
