import test from "node:test";
import assert from "node:assert/strict";
import {buildAIContext,fencedText} from "../src/ai-context.ts";
test("AI context preserves current code and notes, labels missing content and visuals",()=>{
 const code='  fn main() {\n    println!("你好");\n}\n',notes="思路\n\n```rust\nx\n```";
 const text=buildAIContext({number:"1",title:"两数之和",originalTitle:"Two Sum",url:"https://leetcode.cn/problems/two-sum/",difficulty:"Easy",statement:"约束：1 <= n <= 10^(4)",hasVisuals:true,sampleInput:"[2,7]\n9",language:"Rust",code,notes});
 assert.ok(text.includes(code));assert.ok(text.includes(notes));assert.ok(text.includes("Two Sum"));assert.ok(text.includes("图示或公式"));assert.ok(text.includes("未保存"));
 assert.ok(!text.includes("undefined"));assert.equal(fencedText("a```b"),"````\na```b\n````");
});
test("empty notes and absent statement are explicit, no synthetic facts",()=>{
 const text=buildAIContext({number:"2",title:"题目",url:"https://leetcode.cn/problems/x/",difficulty:"Hard",statement:"",hasVisuals:false,language:"Python 3",code:"",notes:""});
 assert.ok(text.includes("题面暂不可用"));assert.ok(text.includes("尚未填写"));assert.ok(!text.includes("图示或公式"));assert.ok(!text.includes("官方示例输入"));
});
test("many backtick runs do not overflow the call stack",()=>{assert.ok(fencedText("`x".repeat(150000)).startsWith("```\n"));});
