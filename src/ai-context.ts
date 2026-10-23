export type AIContext = {
 number:string;title:string;originalTitle?:string;url:string;difficulty:string;
 statement:string;hasVisuals:boolean;sampleInput?:string|null;exampleInputs?:string|null;
 language:string;code:string;notes:string;
};
/** Fence length exceeds every backtick run, preserving arbitrary user code/notes. */
export function fencedText(text:string,language=""):string{
 const longest=(text.match(/`+/g)??[]).reduce((max,run)=>Math.max(max,run.length),0);
 const fence="`".repeat(Math.max(3,longest+1));
 return fence+language+"\n"+text+"\n"+fence;
}
export function buildAIContext(value:AIContext):string{
 const lines=["# 题目",value.number+". "+value.title];
 if(value.originalTitle&&value.originalTitle!==value.title)lines.push("原题名："+value.originalTitle);
 lines.push("来源："+value.url,"难度："+value.difficulty,"","## 题目描述、示例与约束",value.statement||"题面暂不可用，请参照原题链接。");
 if(value.hasVisuals)lines.push("","注意：原题包含图示或公式，纯文本可能无法完整表达，请结合原题链接查看。");
 if(value.sampleInput?.trim())lines.push("","## 官方示例输入",fencedText(value.sampleInput));
 if(value.exampleInputs?.trim()&&value.exampleInputs!==value.sampleInput)lines.push("","## 官方测试输入",fencedText(value.exampleInputs));
 lines.push("","## 当前解法代码","语言："+value.language,"以下是点击复制时的编辑器内容，可能包含未保存修改。",fencedText(value.code),"","## 我的题解笔记（当前题目共享）",value.notes.trim()?fencedText(value.notes,"markdown"):"（尚未填写）");
 return lines.join("\n");
}
