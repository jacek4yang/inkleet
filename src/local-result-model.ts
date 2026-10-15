import {displayResult,parameterNames,type DisplayResult} from "./test-cases.ts";
import {canonicalJson,compareJson,type Expectation} from "./case-expectations.ts";
import type {RunContext} from "./run-context.ts";
export type RunOutput={phase:string;exitCode:number|null;timedOut:boolean;canceled:boolean;truncated:boolean;error:string;results:string[]};
export type Comparison={label:string;state:"match"|"mismatch"|"error"|"unavailable"|"incomplete"};
export type OutputRow={raw:string;index:number;value:DisplayResult;caseId?:string;caseName?:string;multiple:boolean;names:string[];expectation:Expectation|null;comparison:Comparison|null;missing:boolean};
export type BatchReport={rows:OutputRow[];expected:number;received:number;complete:boolean;matched:number;mismatched:number;errors:number;unchecked:number;missing:number};
export function localResultReport(result:RunOutput,record:RunContext|null):BatchReport{
 const names=record?parameterNames(record.snapshot.metadata):[];
 const groups=record?.cases.map((_,index)=>record.invocations.filter(v=>v.caseIndex===index).length)??[];
 const ids=result.results.map(raw=>{
  try{canonicalJson(raw);const v=JSON.parse(raw);return v&&typeof v.ok==="boolean"&&Number.isSafeInteger(v.case)&&v.case>0&&v.case<=100?v.case as number:null;}catch{return null;}
 });
 const validIds=ids.filter((id):id is number=>id!==null);
 const expected=record?.invocations.length??result.results.length;
 const unique=new Set(validIds);
 const structural=!!record&&ids.every(id=>id!==null&&id<=expected)&&unique.size===expected&&result.results.length===expected;
 const terminal=result.phase==="finished"&&result.exitCode===0&&!result.timedOut&&!result.canceled&&!result.truncated&&!result.error;
 const complete=terminal&&structural;
 const rows:OutputRow[]=result.results.map((raw,index)=>{
  const value=displayResult(raw,index),id=ids[index];
  const invocation=record&&id?record.invocations[id-1]:undefined;
  const item=invocation?record?.cases[invocation.caseIndex]:record?.cases.length===1?record.cases[0]:undefined;
  const expectation=item?.expectation?.value.trim()?item.expectation:null;
  let comparison:Comparison|null=null;
  if(value.error)comparison={label:"执行失败",state:"error"};
  else if(expectation){
   if(!terminal)comparison={label:"运行未完成，未比较",state:"incomplete"};
   else if(id===null||value.raw)comparison={label:"结果无法比较",state:"unavailable"};
   else if(invocation&&groups[invocation.caseIndex]!==1)comparison={label:"多组输入未比较",state:"unavailable"};
   else if(!structural||!invocation)comparison={label:"结果不完整，未比较",state:"unavailable"};
   else{
    const argument=expectation.target.kind==="argument"?value.argumentsAfterCall?.[expectation.target.index]:null;
    if(expectation.target.kind==="argument"&&(!argument||argument.unavailable))comparison={label:"参数无法比较",state:"unavailable"};
    else try{const match=compareJson(argument?argument.value:value.value,expectation.value)==="match";comparison={label:match?"符合预期":"与预期不符",state:match?"match":"mismatch"};}
    catch{comparison={label:"结果无法比较",state:"unavailable"};}
   }
  }
  return {raw,index,value,caseId:item?.id,caseName:item?.name,multiple:record?.cases.length===1?result.results.length>1:invocation?groups[invocation.caseIndex]>1:false,names,expectation,comparison,missing:false};
 });
 // For named batches, absent output is not called "not run": the process could
 // have started that invocation before interruption.
 if(record&&record.cases.length>1){
  for(const invocation of record.invocations){
   if(unique.has(invocation.caseNumber))continue;
   const item=record.cases[invocation.caseIndex];
   rows.push({raw:"",index:rows.length,value:{caseNumber:invocation.caseNumber,value:"",error:"",raw:false},caseId:item.id,caseName:item.name,multiple:groups[invocation.caseIndex]>1,names,expectation:item.expectation??null,comparison:{label:"未返回结果",state:"incomplete"},missing:true});
  }
 }
 const count=(state:Comparison["state"])=>rows.filter(row=>row.comparison?.state===state&&!row.missing).length;
 return {rows,expected,received:[...unique].filter(id=>id<=expected).length,complete,matched:count("match"),mismatched:count("mismatch"),errors:count("error"),unchecked:rows.filter(row=>!row.missing&&!["match","mismatch","error"].includes(row.comparison?.state??"")).length,missing:Math.max(0,expected-[...unique].filter(id=>id<=expected).length)};
}
