import test from "node:test";
import assert from "node:assert/strict";
import {editorText,hasRecoveryEdits} from "../src/editor-text.ts";
test("editor text normalizes line separators, not content or storage objects",()=>{
 const raw="一\r\n二\r三\n\r\n9007199254740993";
 assert.equal(editorText(raw),"一\n二\n三\n\n9007199254740993");
 assert.equal(raw,"一\r\n二\r三\n\r\n9007199254740993");
 assert.equal(editorText(" \t💡 ")," \t💡 ");
 assert.equal(editorText(editorText(raw)),editorText(raw));
});
test("newline-only sidecars cannot resurrect clean or already persisted text",()=>{
 assert.equal(hasRecoveryEdits({text:"a\nb\n",baseline:"a\r\nb\r\n"},"external"),false);
 assert.equal(hasRecoveryEdits({text:"a\rb\r",baseline:"old"},"a\r\nb\r\n"),false);
 assert.equal(hasRecoveryEdits(null,"a"),false);
 assert.equal(hasRecoveryEdits({text:"",baseline:null},null),false);
});
test("real recovered edits preserve raw baselines and empty deletions",()=>{
 const draft={text:"edited\r\n",baseline:"original\r\n"};
 assert.equal(hasRecoveryEdits(draft,"original\r\n"),true);
 assert.equal(draft.baseline,"original\r\n");
 assert.equal(hasRecoveryEdits({text:"",baseline:"deleted content"},null),true);
 assert.equal(hasRecoveryEdits({text:"",baseline:"deleted content"},""),false);
});

test("an untouched initial template is a clean recovery baseline without a disk file",()=>{
 const template="impl Solution {\n    fn solve() {}\n}";
 assert.equal(hasRecoveryEdits({text:template,baseline:null},null,template),false);
 assert.equal(hasRecoveryEdits({text:template.replace(/\n/g,"\r\n"),baseline:null},null,template),false);
 assert.equal(hasRecoveryEdits({text:template+"\n// changed",baseline:null},null,template),true);
 assert.equal(hasRecoveryEdits({text:"",baseline:"saved"},null,template),true);
 assert.equal(hasRecoveryEdits({text:"edited",baseline:"old"},"external",template),true);
});
