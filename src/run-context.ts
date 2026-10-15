import {validateCases,type LocalCase} from "./test-cases.ts";
import type {Language} from "./domain";
export type RunSource={code:string;input:string;metadata:string;title:string;language:Language};
export type RunContext={mode?:"selected"|"all"|"failed";documentKey:string;clientRequestId:string;snapshot:RunSource;cases:LocalCase[];invocations:{caseIndex:number;groupIndex:number;caseNumber:number}[]};
export function validateRunContext(value:unknown,documentKey:string,clientRequestId:string):RunContext{
 const r=value as RunContext,s=r?.snapshot;
 const mode=r?.mode??"selected";if(!["selected","all","failed"].includes(mode))throw Error("运行模式无效");
 if(!r||r.documentKey!==documentKey||r.clientRequestId!==clientRequestId||!s||
    typeof s.code!=="string"||s.code.length>2*1024*1024||typeof s.input!=="string"||s.input.length>1024*1024||
    typeof s.metadata!=="string"||s.metadata.length>65536||typeof s.title!=="string"||s.title.length>512||
    !["python3","golang","cpp","c","rust","java"].includes(s.language))throw Error("运行快照身份或内容无效");
 const {cases}=validateCases({version:2,cases:r.cases,selected:r.cases?.[0]?.id});
 if(!Array.isArray(r.invocations)||!r.invocations.length||r.invocations.length>100)throw Error("运行用例映射无效");
 const counts=cases.map(()=>0);let previous=0;
 for(let i=0;i<r.invocations.length;i++){
  const v=r.invocations[i];
  if(!v||!Number.isSafeInteger(v.caseIndex)||v.caseIndex<previous||v.caseIndex>=cases.length||
     v.groupIndex!==counts[v.caseIndex]||v.caseNumber!==i+1)throw Error("运行用例映射无效");
  counts[v.caseIndex]++;previous=v.caseIndex;
 }
 if(counts.some(n=>!n)||cases.map(c=>c.input).join("\n")!==s.input)throw Error("运行用例内容不一致");
 return {mode,documentKey,clientRequestId,snapshot:{code:s.code,input:s.input,metadata:s.metadata,title:s.title,language:s.language},cases,invocations:r.invocations.map(v=>({...v}))};
}
// Polls may allocate fresh arrays even when nothing changed. Preserve React state
// only when every observed field is unchanged; unknown fields are not silently ignored.
export function sameRunStatus(a:object|null,b:object|null):boolean{
 if(a===b)return true;if(!a||!b)return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 if(keys.length!==Object.keys(right).length)return false;
 return keys.every(key=>{
  const x=left[key],y=right[key];
  return key==="results"&&Array.isArray(x)&&Array.isArray(y)?x.length===y.length&&x.every((v,i)=>v===y[i]):x===y;
 });
}
