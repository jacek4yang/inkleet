import type {RunContext} from "./run-context";
import type {LocalCase} from "./test-cases";
type Current={codeMismatch:boolean;language:string;metadata:string;title:string;cases:LocalCase[];selected:string};
// Results belong to an immutable execution snapshot; they do not expire with time.
export function runResultNotice(record:RunContext|null,current:Current):string|null {
 if(!record)return null;
 const changes:string[]=[];
 if(current.codeMismatch)changes.push("代码");
 if(record.snapshot.language!==current.language)changes.push("语言");
 if(record.snapshot.metadata!==current.metadata||record.snapshot.title!==current.title)changes.push("题目信息");
 const byId=new Map(current.cases.map(item=>[item.id,item]));
 const pairs=record.cases.map(old=>({old,now:byId.get(old.id)}));
 if(pairs.some(pair=>!pair.now)||(record.mode==="all"&&(record.cases.length!==current.cases.length||record.cases.some((item,i)=>item.id!==current.cases[i]?.id))))changes.push("用例列表");
 if(pairs.some(({old,now})=>now&&old.input!==now.input))changes.push("输入");
 if(pairs.some(({old,now})=>now&&JSON.stringify(old.expectation??null)!==JSON.stringify(now.expectation??null)))changes.push("预期结果");
 if(changes.length)return changes.join("、")+"已修改 · 重新运行以更新结果";
 if((record.mode??"selected")==="selected"&&record.cases.length===1&&record.cases[0].id!==current.selected)return "当前显示其他用例的结果";
 if(pairs.some(({old,now})=>now&&old.name!==now.name))return "用例已重命名 · 结果保留运行时名称";
 return null;
}
