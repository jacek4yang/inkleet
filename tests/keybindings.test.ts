import test from "node:test";import assert from "node:assert/strict";
import {validateKeybindings,matchUserShortcut,commandChoices} from "../src/keybindings.ts";
test("finite additional shortcuts reject ambiguity and duplicates",()=>{
 validateKeybindings({});validateKeybindings({"editor.save":"Mod-Alt-s","workbench.settings":"Mod-Alt-Shift-s"});
 assert.equal(new Set(commandChoices.map(c=>c[0])).size,commandChoices.length);
 for(const value of [null,[],{"editor.save":null},{"editor.save":"Ctrl-s"},{"editor.save":"Mod-Alt-S"},{"editor.save":"Mod-Alt-s","editor.undo":"Mod-Alt-s"},{"shell.run":"Mod-Alt-a"}])assert.throws(()=>validateKeybindings(value));
});
test("matching respects platforms, composition, AltGraph and repeat",()=>{
 const base={key:"s",altKey:true,ctrlKey:true,metaKey:false,shiftKey:false,isComposing:false,keyCode:83,repeat:false,getModifierState:()=>false};
 const matches=(overrides:object,mac=false)=>matchUserShortcut({...base,...overrides} as KeyboardEvent,"Mod-Alt-s",mac);
 assert.equal(matches({}),true);assert.equal(matches({ctrlKey:false,metaKey:true},true),true);
 for(const changes of [{isComposing:true},{keyCode:229},{repeat:true},{shiftKey:true},{metaKey:true},{getModifierState:()=>true}])assert.equal(matches(changes),false);
 assert.equal(matches({},true),false);
});
